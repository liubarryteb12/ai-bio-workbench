/**
 * K40 零 SSH 健康快照（Argon 第十九轮 Q2 裁定）
 *
 * 要解决的问题：链路断了以后，「是 SSH 断了，还是 runsvdir 死了，还是 10022 缺 key」这三件事
 * 从 Windows 侧看完全一样（ssh 一律 Connection refused / timeout）。原有 checkLink 的四段探测
 * 依赖 ssh 本身，断在 ssh 上就等于没有观测。
 *
 * 观测通道：adb exec-out run-as com.termux 直接以 app uid(10283) 执行设备侧脚本
 * ops/k40/heartbeat.sh，返回一行 JSON。整条通道不经过 sshd、不经过 TCP 端口，8022/10022
 * 全挂时仍然可读（实测 Termux 包 flags 含 DEBUGGABLE，run-as 可用）。
 *
 * 为什么按需执行而不是常驻 runit 服务：
 *   常驻意味着每分钟写闪存（全年十万次量级）且多一个自己会被监督失败的东西。按需执行零常驻
 *   开销、永远最新，读一次只花一次进程启动。
 *
 * 为什么端口查 TCP connect 而不是读 /proc/net/tcp：
 *   Android 10 起 app uid 读 /proc/net/tcp 与 /proc/self/net/tcp 都是 Permission denied
 *   （K40 实测 2026-11-03）。sshd 与探针同 uid 同 netns，connect 成功即等价于在监听。
 *
 * 判据口径（Q1 裁定）：只报精确故障层代号，不在这里做任何重启或自愈。层序固定
 *   隧道 -> runsvdir -> 8022 -> 10022 -> /mnt/ssd 可写
 * 第一层失败即停，不再往下报（下游失败多半是上游的后果，一起报会掩盖根因）。
 */

import { DEFAULT_SERIAL } from './domain.js';
import { runSync, findAdb } from './proc.js';

export const HEARTBEAT_SCHEMA = 'k40_heartbeat/v2';

/** 设备侧脚本相对 run-as 的工作目录（/data/data/com.termux） */
export const HEARTBEAT_REMOTE_SCRIPT = 'files/usr/bin/k40_heartbeat.sh';

/** 快照默认有效期：脚本是按需执行，超过这个岁数说明读的是陈旧缓存或设备时钟漂移 */
export const HEARTBEAT_DEFAULT_MAX_AGE_SEC = 180;

/** 结构化诊断码：一个代号对应一个故障层，照着代号就能定位到该查什么 */
export const ERR_STAGE_TUNNEL = 'ERR_STAGE_TUNNEL';
export const ERR_STAGE_RUNSV = 'ERR_STAGE_RUNSV';
export const ERR_STAGE_PORT_8022 = 'ERR_STAGE_PORT_8022';
export const ERR_STAGE_PORT_10022 = 'ERR_STAGE_PORT_10022';
export const ERR_STAGE_MNT_RO = 'ERR_STAGE_MNT_RO';
export const ERR_HEARTBEAT_UNREADABLE = 'ERR_HEARTBEAT_UNREADABLE';
export const ERR_HEARTBEAT_INVALID = 'ERR_HEARTBEAT_INVALID';
export const ERR_HEARTBEAT_STALE = 'ERR_HEARTBEAT_STALE';

/** 四个服务的 supervise/stat 期望值 */
export const HEARTBEAT_SERVICES = ['sshd', 'ubuntu-sshd', 'crond', 'ssh-agent'];

function fail(code, detail) {
  return { ok: false, code, detail, data: null };
}

/**
 * 解析设备侧返回的一行 JSON。
 *
 * 容忍 adb 的噪声：run-as 失败、adb server 重启都会往 stderr 写东西，所以从**最后一行**
 * 往前找第一个能解析且 schema 对得上的对象，而不是假设 stdout 只有一行干净 JSON。
 * 但找到之后逐字段严格校验：缺字段等于观测不完整，宁可判「读不懂」也不能默认 0（默认 0
 * 会让 runsvdir_count=3 这种真实异常被当成正常，或反过来把真实存活当成死亡）。
 *
 * @param {{stdout?: string, stderr?: string}|string} input
 * @returns {{ok: boolean, code: string|null, detail: string, data: object|null}}
 */
export function parseHeartbeat(input) {
  const stdout = typeof input === 'string' ? input : String(input?.stdout ?? '');
  const stderr = typeof input === 'string' ? '' : String(input?.stderr ?? '');

  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let parsed = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith('{')) continue;
    try {
      const candidate = JSON.parse(line);
      if (candidate && typeof candidate === 'object' && candidate.schema) {
        parsed = candidate;
        break;
      }
    } catch {
      // 噪声行，继续往前找
    }
  }

  if (!parsed) {
    const noise = stderr || stdout;
    return fail(
      ERR_HEARTBEAT_UNREADABLE,
      'adb 输出里没有心跳 JSON' + (noise.trim() ? '：' + noise.trim().slice(0, 200) : '')
    );
  }
  if (parsed.schema !== HEARTBEAT_SCHEMA) {
    return fail(
      ERR_HEARTBEAT_INVALID,
      'schema 应为 ' + HEARTBEAT_SCHEMA + '，实际 ' + JSON.stringify(parsed.schema ?? null)
    );
  }

  const ts = Number(parsed.ts);
  if (!Number.isFinite(ts) || ts <= 0) {
    return fail(ERR_HEARTBEAT_INVALID, 'ts 必须是正的 epoch 秒，实际 ' + JSON.stringify(parsed.ts ?? null));
  }
  const runsvdirCount = Number(parsed.runsvdir_count);
  if (!Number.isInteger(runsvdirCount) || runsvdirCount < 0) {
    return fail(ERR_HEARTBEAT_INVALID, 'runsvdir_count 必须是非负整数，实际 ' + JSON.stringify(parsed.runsvdir_count ?? null));
  }

  const bit = (key) => {
    const value = parsed[key];
    if (value === 1 || value === '1' || value === true) return 1;
    if (value === 0 || value === '0' || value === false) return 0;
    return null;
  };
  const bits = {};
  for (const [wireKey, field] of [
    ['ssd_writable', 'ssdWritable'],
    ['sshd_8022_listen', 'sshd8022'],
    ['dropbear_10022_listen', 'dropbear10022'],
  ]) {
    const value = bit(wireKey);
    if (value === null) {
      return fail(ERR_HEARTBEAT_INVALID, wireKey + ' 必须是 0 或 1，实际 ' + JSON.stringify(parsed[wireKey] ?? null));
    }
    bits[field] = value;
  }

  const services = {};
  for (const name of HEARTBEAT_SERVICES) {
    const key = 'svc_' + name.replace(/-/g, '_');
    const value = parsed[key];
    if (typeof value !== 'string' || !value.trim()) {
      return fail(ERR_HEARTBEAT_INVALID, key + ' 必须是非空字符串，实际 ' + JSON.stringify(value ?? null));
    }
    services[name] = value.trim();
  }

  return {
    ok: true, code: null, detail: '',
    data: {
      ts,
      runsvdirCount,
      ssdWritable: bits.ssdWritable,
      sshd8022: bits.sshd8022,
      dropbear10022: bits.dropbear10022,
      portProbe: typeof parsed.port_probe === 'string' ? parsed.port_probe : '',
      services,
    },
  };
}

/**
 * 按层序判定快照（纯函数）。
 *
 * 层序来自 Q1：隧道 -> runsvdir -> 8022 -> 10022 -> /mnt/ssd 可写。第一层失败即停：
 * 下游失败多半是上游的后果，一起报会掩盖根因。
 * 陈旧快照单独一码：ts 超龄说明拿到的不是「现在」，任何按它下的结论都不可靠。
 *
 * @param {object} data parseHeartbeat 的 data
 * @param {{now?: number, maxAgeSec?: number}} options
 * @returns {{status: 'ok'|'fail', code: string|null, detail: string, stages: Array<object>}}
 */
export function evaluateHeartbeat(data, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now() / 1000;
  const maxAgeSec = Number.isFinite(options.maxAgeSec) ? options.maxAgeSec : HEARTBEAT_DEFAULT_MAX_AGE_SEC;
  const age = Math.round(now - data.ts);

  if (age > maxAgeSec) {
    return {
      status: 'fail',
      code: ERR_HEARTBEAT_STALE,
      detail: '心跳快照已过期 ' + age + ' 秒（上限 ' + maxAgeSec + ' 秒），读到的不是当前状态',
      stages: [{ stage: 'fresh', pass: false, code: ERR_HEARTBEAT_STALE, detail: age + 's > ' + maxAgeSec + 's' }],
    };
  }

  const downServices = HEARTBEAT_SERVICES.filter((name) => data.services[name] !== 'run');
  const stages = [
    {
      stage: 'runsvdir',
      pass: data.runsvdirCount === 1 && downServices.length === 0,
      code: data.runsvdirCount === 1 && downServices.length === 0 ? null : ERR_STAGE_RUNSV,
      detail: 'runsvdir=' + data.runsvdirCount + (downServices.length ? '，非 run 服务: ' + downServices.join(',') : ''),
    },
    {
      stage: 'port_8022',
      pass: data.sshd8022 === 1,
      code: data.sshd8022 === 1 ? null : ERR_STAGE_PORT_8022,
      detail: 'tcp-connect 127.0.0.1:8022 ' + (data.sshd8022 === 1 ? 'ok' : '不通'),
    },
    {
      stage: 'port_10022',
      pass: data.dropbear10022 === 1,
      code: data.dropbear10022 === 1 ? null : ERR_STAGE_PORT_10022,
      detail: 'tcp-connect 127.0.0.1:10022 ' + (data.dropbear10022 === 1 ? 'ok' : '不通'),
    },
    {
      stage: 'ssd_writable',
      pass: data.ssdWritable === 1,
      code: data.ssdWritable === 1 ? null : ERR_STAGE_MNT_RO,
      detail: 'rootfs/mnt/ssd/bio_data ' + (data.ssdWritable === 1 ? '可写' : '不可写'),
    },
  ];

  const firstFailed = stages.find((stage) => !stage.pass);
  return {
    status: firstFailed ? 'fail' : 'ok',
    code: firstFailed ? firstFailed.code : null,
    detail: firstFailed ? firstFailed.stage + ' 层失败（' + firstFailed.detail + '）' : '五层全通',
    stages,
  };
}

/**
 * 一次读完：adb 触发设备侧脚本 -> 解析 -> 判定。
 * run 可注入：测试里换成立即返回的桩，不需要设备在线。
 *
 * @param {{run?: Function, adb?: string, serial?: string, now?: number, maxAgeSec?: number, timeoutMs?: number}} options
 * @returns {{testedAt: number, tunnel: {pass: boolean, code: string|null, detail: string}, status: 'ok'|'fail', code: string|null, detail: string, stages: Array<object>, data: object|null}}
 */
export function readHeartbeat(options = {}) {
  const run = options.run ?? runSync;
  const adb = options.adb ?? findAdb();
  const serial = options.serial ?? DEFAULT_SERIAL;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
  const testedAt = Number.isFinite(options.now) ? options.now : Date.now() / 1000;

  let raw;
  try {
    raw = run([adb, '-s', serial, 'exec-out', 'run-as', 'com.termux', 'sh', '-c', 'sh ' + HEARTBEAT_REMOTE_SCRIPT], { timeoutMs });
  } catch (error) {
    return {
      testedAt,
      tunnel: { pass: false, code: ERR_STAGE_TUNNEL, detail: 'adb 执行失败: ' + (error instanceof Error ? error.message : String(error)) },
      status: 'fail', code: ERR_STAGE_TUNNEL,
      detail: '隧道层失败：adb 连不上设备或 run-as 不可用', stages: [], data: null,
    };
  }

  const parsed = parseHeartbeat({ stdout: String(raw?.stdout ?? ''), stderr: String(raw?.stderr ?? '') });
  if (!parsed.ok) {
    return {
      testedAt,
      tunnel: { pass: true, code: null, detail: 'adb 通道可用' },
      status: 'fail', code: parsed.code, detail: parsed.detail, stages: [], data: null,
    };
  }

  const evaluated = evaluateHeartbeat(parsed.data, { now: testedAt, maxAgeSec: options.maxAgeSec });
  return {
    testedAt,
    tunnel: { pass: true, code: null, detail: 'adb 通道可用' },
    status: evaluated.status,
    code: evaluated.code,
    detail: evaluated.detail,
    stages: evaluated.stages,
    data: parsed.data,
  };
}
