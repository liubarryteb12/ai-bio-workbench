/**
 * K40 零 SSH 健康快照（Argon 第十九轮 Q2 裁定）
 *
 * 要解决的问题：链路断了以后，「是 SSH 断了，还是 runsvdir 死了，还是 10022 缺 key」这三件事
 * 从 Windows 侧看完全一样（ssh 一律 Connection refused / timeout）。原有 checkLink 的四段探测
 * 依赖 ssh 本身，断在 ssh 上就等于没有观测。
 *
 * 观测通道：adb exec-out run-as com.termux 直接以 app uid(10283) 执行设备侧脚本
 * tools/ops/k40/heartbeat.sh，返回一行 JSON。整条通道不经过 sshd、不经过 TCP 端口，8022/10022
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

/**
 * 复合诊断标志（Argon 第二十轮）。
 *
 * 起因是实测：`sv down ubuntu-sshd` 之后 10022 仍在监听。proot 用 ptrace 劫持子进程，
 * 容器内的 dropbear 已脱离控制终端，SIGTERM 未必转发得到它，于是「服务非 run」与
 * 「端口在听」同时成立。单看任一侧都会得出相反结论，必须把矛盾本身报出来。
 */
export const ANOMALY_RUN_NO_LISTEN = 'ANOMALY_RUN_NO_LISTEN';
export const ANOMALY_DOWN_STILL_LISTEN = 'ANOMALY_DOWN_STILL_LISTEN';

/**
 * 第三种矛盾形态，来自 2026-11-03 的真机演练：`sv down ubuntu-sshd` 之后 supervise/stat
 * 一直是 `run, got TERM, want down`，dropbear 与 10022 都还在。只截逗号前那一段会报成
 * 正常的 run，恰好把「停止请求被吞」洗掉。设备侧把这种状态归一化成 `down_pending`，
 * 这里据此报 `ANOMALY_STOP_IGNORED`：想要它停，它没停。
 */
export const ANOMALY_STOP_IGNORED = 'ANOMALY_STOP_IGNORED';

/** 设备侧归一化后的过渡态取值 */
export const SVC_STATE_DOWN_PENDING = 'down_pending';

/**
 * 服务与其负责端口的对照表。
 * crond 与 ssh-agent 不监听 TCP，不参与这项交叉校验：硬凑一对只会报假异常。
 */
export const HEARTBEAT_SERVICE_PORTS = [
  { service: 'sshd', port: 8022, field: 'sshd8022' },
  { service: 'ubuntu-sshd', port: 10022, field: 'dropbear10022' },
];

/**
 * 交叉校验服务状态与端口监听（纯函数）。
 * 报三种矛盾形态：run 但没人听、非 run 但还在听、被要求停却没停。
 * 其余组合（run+listen、非 run+不 listen）都是自洽的。
 *
 * @param {object} data parseHeartbeat 的 data
 * @returns {Array<{code: string, service: string, port: number, svc: string, listen: number, detail: string}>}
 */
export function detectServicePortAnomalies(data) {
  const anomalies = [];
  for (const { service, port, field } of HEARTBEAT_SERVICE_PORTS) {
    const svc = data?.services?.[service];
    const listen = data?.[field];
    if (typeof svc !== 'string' || (listen !== 0 && listen !== 1)) continue;
    const isRun = svc === 'run';
    if (svc === SVC_STATE_DOWN_PENDING && listen === 1) {
      anomalies.push({
        code: ANOMALY_STOP_IGNORED, service, port, svc, listen,
        detail: service + ' 已请求停止（want down）但进程未退，' + port + ' 仍在监听：TERM 被 proot 吞掉了',
      });
    } else if (isRun && listen === 0) {
      anomalies.push({
        code: ANOMALY_RUN_NO_LISTEN, service, port, svc, listen,
        detail: service + ' 服务 run 但 ' + port + ' 无人监听（守护进程空转或崩溃循环：缺 host key、配置错、端口被占）',
      });
    } else if (!isRun && listen === 1) {
      anomalies.push({
        code: ANOMALY_DOWN_STILL_LISTEN, service, port, svc, listen,
        detail: service + ' 服务 ' + svc + ' 但 ' + port + ' 仍在监听（孤儿进程逃逸 runsv 监管）',
      });
    }
  }
  return anomalies;
}

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
 * @returns {{status: 'ok'|'fail', code: string|null, detail: string, stages: Array<object>, anomalies: Array<object>}}
 */
export function evaluateHeartbeat(data, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now() / 1000;
  const maxAgeSec = Number.isFinite(options.maxAgeSec) ? options.maxAgeSec : HEARTBEAT_DEFAULT_MAX_AGE_SEC;
  const age = Math.round(now - data.ts);
  // 服务状态与端口监听的矛盾与层序无关：即便快照过期，这个矛盾本身仍是对现状的描述。
  const anomalies = detectServicePortAnomalies(data);

  if (age > maxAgeSec) {
    return {
      status: 'fail',
      code: ERR_HEARTBEAT_STALE,
      detail: '心跳快照已过期 ' + age + ' 秒（上限 ' + maxAgeSec + ' 秒），读到的不是当前状态',
      stages: [{ stage: 'fresh', pass: false, code: ERR_HEARTBEAT_STALE, detail: age + 's > ' + maxAgeSec + 's' }],
      anomalies,
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
  const anomalyNote = anomalies.map((anomaly) => anomaly.code + ': ' + anomaly.detail).join(' ; ');
  const baseDetail = firstFailed ? firstFailed.stage + ' 层失败（' + firstFailed.detail + '）' : '五层全通';
  return {
    status: firstFailed ? 'fail' : 'ok',
    code: firstFailed ? firstFailed.code : null,
    detail: [baseDetail, anomalyNote].filter(Boolean).join(' ; '),
    stages,
    anomalies,
  };
}

/**
 * 「上一次五层全通是什么时候」（Argon 第二十轮）。
 *
 * 只有 code 时，「刚断 3 秒」与「已经死了 6 小时」长得一模一样，运维的处置优先级却相反。
 * 因此记录最后一次 ok 的时间戳，失败时同时给出已经断了多久。
 *
 * 从未成功过就返回 null 而不是 0 或 now：0 会被读成 1970 年，now 会伪造「刚刚还活着」。
 *
 * @param {{status: 'ok'|'fail', now: number, lastOkTs?: number|null}} input
 * @returns {{last_ok_ts: number|null, down_duration_sec: number|null}}
 */
export function describeLiveness({ status, now, lastOkTs }) {
  const previous = Number.isFinite(lastOkTs) ? Math.round(lastOkTs) : null;
  const at = Math.round(now);
  if (status === 'ok') return { last_ok_ts: at, down_duration_sec: 0 };
  return {
    last_ok_ts: previous,
    down_duration_sec: previous === null ? null : Math.max(0, at - previous),
  };
}

/**
 * 进程内记忆：只活在当前 server 进程里，不落盘。
 * 落盘（$PREFIX/var/log/k40_heartbeat_last_ok）会把设备侧也变成写入方，反而多一个
 * 需要自愈的东西；进程重启后 down_duration_sec 回到 null（诚实的「不知道」）。
 */
const livenessStore = { lastOkTs: null };

/** 测试专用：清掉进程内记忆，避免用例之间互相污染 */
export function resetHeartbeatLiveness() {
  livenessStore.lastOkTs = null;
}

/** 读当前进程记住的最后一次全通时间戳（从未成功为 null） */
export function getHeartbeatLastOkTs() {
  return livenessStore.lastOkTs;
}

/**
 * 一次读完：adb 触发设备侧脚本 -> 解析 -> 判定。
 * run 可注入：测试里换成立即返回的桩，不需要设备在线。
 *
 * @param {{run?: Function, adb?: string, serial?: string, now?: number, maxAgeSec?: number, timeoutMs?: number, state?: {lastOkTs: number|null}}} options
 * @returns {{testedAt: number, tunnel: {pass: boolean, code: string|null, detail: string}, status: 'ok'|'fail', code: string|null, detail: string, stages: Array<object>, anomalies: Array<object>, last_ok_ts: number|null, down_duration_sec: number|null, data: object|null}}
 */
export function readHeartbeat(options = {}) {
  const run = options.run ?? runSync;
  const adb = options.adb ?? findAdb();
  const serial = options.serial ?? DEFAULT_SERIAL;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
  const testedAt = Number.isFinite(options.now) ? options.now : Date.now() / 1000;
  // 记忆可以注入：路由与测试都需要一个确定的时间基准，共用进程内单例会让用例互相污染。
  const store = options.state ?? livenessStore;

  // 三条返回路径都要带 liveness：隧道断掉时恰恰最需要知道「上次活着是什么时候」。
  const finish = (snapshot) => {
    const liveness = describeLiveness({ status: snapshot.status, now: testedAt, lastOkTs: store.lastOkTs });
    if (snapshot.status === 'ok') store.lastOkTs = liveness.last_ok_ts;
    return { ...snapshot, ...liveness };
  };

  let raw;
  try {
    const argv = serial ? [adb, '-s', serial] : [adb];
    raw = run([...argv, 'exec-out', 'run-as', 'com.termux', 'sh', '-c', 'sh ' + HEARTBEAT_REMOTE_SCRIPT], { timeoutMs });
  } catch (error) {
    return finish({
      testedAt,
      tunnel: { pass: false, code: ERR_STAGE_TUNNEL, detail: 'adb 执行失败: ' + (error instanceof Error ? error.message : String(error)) },
      status: 'fail', code: ERR_STAGE_TUNNEL,
      detail: '隧道层失败：adb 连不上设备或 run-as 不可用', stages: [], anomalies: [], data: null,
    });
  }

  const parsed = parseHeartbeat({ stdout: String(raw?.stdout ?? ''), stderr: String(raw?.stderr ?? '') });
  if (!parsed.ok) {
    return finish({
      testedAt,
      tunnel: { pass: true, code: null, detail: 'adb 通道可用' },
      status: 'fail', code: parsed.code, detail: parsed.detail, stages: [], anomalies: [], data: null,
    });
  }

  const evaluated = evaluateHeartbeat(parsed.data, { now: testedAt, maxAgeSec: options.maxAgeSec });
  return finish({
    testedAt,
    tunnel: { pass: true, code: null, detail: 'adb 通道可用' },
    status: evaluated.status,
    code: evaluated.code,
    detail: evaluated.detail,
    stages: evaluated.stages,
    anomalies: evaluated.anomalies,
    data: parsed.data,
  });
}
