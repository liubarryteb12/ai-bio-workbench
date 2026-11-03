import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseHeartbeat, evaluateHeartbeat, readHeartbeat,
  HEARTBEAT_SCHEMA, HEARTBEAT_REMOTE_SCRIPT, HEARTBEAT_DEFAULT_MAX_AGE_SEC, HEARTBEAT_SERVICES,
  ERR_STAGE_TUNNEL, ERR_STAGE_RUNSV, ERR_STAGE_PORT_8022, ERR_STAGE_PORT_10022, ERR_STAGE_MNT_RO,
  ERR_HEARTBEAT_UNREADABLE, ERR_HEARTBEAT_INVALID, ERR_HEARTBEAT_STALE,
} from '../server/heartbeat.js';

// ── server/heartbeat.js 契约面测试（4 Argon 第十九轮 Q2 裁定）──
//
// 这个模块是「ssh 全断时仍能定性」的观测通道：adb exec-out run-as 直接执行设备侧脚本，
// 拿回一行 JSON。它必须做到三件事，每件都有独立输入可以打红：
//   1. 从 adb 噪声里认出那一行 JSON（run-as 失败、adb server 重启都会往 stderr 写东西）
//   2. 逐字段严格校验（缺字段默认成 0 会让真异常变正常、真存活变死亡）
//   3. 按固定层序报第一个失败层，且只报代号，不做任何自愈

const REAL_LINE = JSON.stringify({
  schema: 'k40_heartbeat/v2', ts: 1793694009, runsvdir_count: 1,
  sshd_8022_listen: 1, dropbear_10022_listen: 1, ssd_writable: 1,
  port_probe: 'tcp-connect', svc_sshd: 'run', svc_ubuntu_sshd: 'run',
  svc_crond: 'run', svc_ssh_agent: 'run',
});

const baseData = () => parseHeartbeat({ stdout: REAL_LINE }).data;

test('解析设备真实返回：四个硬指标与四个服务状态全部落到字段上', () => {
  const parsed = parseHeartbeat({ stdout: REAL_LINE });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.code, null);
  assert.equal(parsed.data.ts, 1793694009);
  assert.equal(parsed.data.runsvdirCount, 1);
  assert.equal(parsed.data.sshd8022, 1);
  assert.equal(parsed.data.dropbear10022, 1);
  assert.equal(parsed.data.ssdWritable, 1);
  assert.equal(parsed.data.portProbe, 'tcp-connect');
  assert.deepEqual(Object.keys(parsed.data.services).sort(), [...HEARTBEAT_SERVICES].sort());
  assert.equal(parsed.data.services['ubuntu-sshd'], 'run');
});

test('从 adb 噪声里认出 JSON：取最后一行可解析且带 schema 的对象', () => {
  // 早先有一条样本（历史口径 runsvdir_count=3），后面才是本次的。取最后一行是硬要求：
  // 取第一行会把旧样本当成现状，等于拿陈旧证据下结论。
  const older = JSON.stringify({ ...JSON.parse(REAL_LINE), ts: 1793693000, runsvdir_count: 3 });
  const noisy = [
    'adb server version (41) doesn\'t match this client (39); killing...',
    '* daemon started successfully',
    older,
    '{"noise":true}',
    REAL_LINE,
    '',
  ].join('\r\n');
  const parsed = parseHeartbeat({ stdout: noisy, stderr: 'warning: something' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.runsvdirCount, 1);
  assert.equal(parsed.data.ts, 1793694009);
});

test('没有 JSON 时判 ERR_HEARTBEAT_UNREADABLE，并把 adb 噪声带进 detail 便于定位', () => {
  const parsed = parseHeartbeat({ stdout: '', stderr: 'error: closed' });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, ERR_HEARTBEAT_UNREADABLE);
  assert.match(parsed.detail, /error: closed/);
});

test('schema 不符判 ERR_HEARTBEAT_INVALID，不猜字段含义', () => {
  const parsed = parseHeartbeat({ stdout: '{"schema":"k40_heartbeat/v1","ts":1}' });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, ERR_HEARTBEAT_INVALID);
  assert.match(parsed.detail, new RegExp(HEARTBEAT_SCHEMA));
});

test('缺 ssd_writable 不得默认成 0 或 1：观测不完整时判红', () => {
  const parsed = parseHeartbeat({ stdout: JSON.stringify({ ...JSON.parse(REAL_LINE), ssd_writable: null }) });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, ERR_HEARTBEAT_INVALID);
  assert.match(parsed.detail, /ssd_writable/);
});

test('服务状态缺失时判红：四个服务名一个都不能少', () => {
  const raw = { ...JSON.parse(REAL_LINE) };
  delete raw.svc_crond;
  const parsed = parseHeartbeat({ stdout: JSON.stringify(raw) });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, ERR_HEARTBEAT_INVALID);
  assert.match(parsed.detail, /svc_crond/);
});

test('ts 非正数判红：陈旧判定没有可比的时间基准', () => {
  const parsed = parseHeartbeat({ stdout: JSON.stringify({ ...JSON.parse(REAL_LINE), ts: 0 }) });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, ERR_HEARTBEAT_INVALID);
  assert.match(parsed.detail, /ts/);
});

test('五层全通时 status=ok 且 stages 逐层通过', () => {
  const data = baseData();
  const evaluated = evaluateHeartbeat(data, { now: data.ts + 1 });
  assert.equal(evaluated.status, 'ok');
  assert.equal(evaluated.code, null);
  assert.deepEqual(evaluated.stages.map((s) => s.stage), ['runsvdir', 'port_8022', 'port_10022', 'ssd_writable']);
  assert.ok(evaluated.stages.every((s) => s.pass));
});

test('快照超龄判 ERR_HEARTBEAT_STALE，且不再往下层判（结论不可靠）', () => {
  const data = baseData();
  const evaluated = evaluateHeartbeat(data, { now: data.ts + HEARTBEAT_DEFAULT_MAX_AGE_SEC + 1 });
  assert.equal(evaluated.status, 'fail');
  assert.equal(evaluated.code, ERR_HEARTBEAT_STALE);
  assert.equal(evaluated.stages.length, 1);
  assert.equal(evaluated.stages[0].stage, 'fresh');
});

test('第一层失败即停：runsvdir 异常时不再报端口层（下游失败多半是上游后果）', () => {
  const data = { ...baseData(), runsvdirCount: 0, sshd8022: 0, dropbear10022: 0 };
  const evaluated = evaluateHeartbeat(data, { now: data.ts });
  assert.equal(evaluated.status, 'fail');
  assert.equal(evaluated.code, ERR_STAGE_RUNSV);
  assert.match(evaluated.detail, /runsvdir 层失败/);
  assert.match(evaluated.detail, /runsvdir=0/);
});

test('runsvdir 活着但某个服务非 run：仍算监督层失败，并点名服务', () => {
  const data = { ...baseData(), services: { ...baseData().services, crond: 'down' } };
  const evaluated = evaluateHeartbeat(data, { now: data.ts });
  assert.equal(evaluated.code, ERR_STAGE_RUNSV);
  assert.match(evaluated.stages[0].detail, /crond/);
});

test('8022 不通而监督层正常：报 ERR_STAGE_PORT_8022', () => {
  const data = { ...baseData(), sshd8022: 0 };
  const evaluated = evaluateHeartbeat(data, { now: data.ts });
  assert.equal(evaluated.code, ERR_STAGE_PORT_8022);
  assert.match(evaluated.detail, /port_8022/);
});

test('10022 不通而监督层与 8022 正常：报 ERR_STAGE_PORT_10022（缺 host key 的形态）', () => {
  const data = { ...baseData(), dropbear10022: 0 };
  const evaluated = evaluateHeartbeat(data, { now: data.ts });
  assert.equal(evaluated.code, ERR_STAGE_PORT_10022);
  assert.match(evaluated.detail, /port_10022/);
});

test('/mnt/ssd 不可写：报 ERR_STAGE_MNT_RO（只读挂载或 SSD 掉线）', () => {
  const data = { ...baseData(), ssdWritable: 0 };
  const evaluated = evaluateHeartbeat(data, { now: data.ts });
  assert.equal(evaluated.code, ERR_STAGE_MNT_RO);
});

test('adb 执行抛错：隧道层失败，且不再假装设备侧有数据', () => {
  const snapshot = readHeartbeat({
    run: () => { throw new Error('adb: device offline'); },
    adb: 'adb', serial: 'SERIAL1', timeoutMs: 1000, now: 1793694009,
  });
  assert.equal(snapshot.tunnel.pass, false);
  assert.equal(snapshot.code, ERR_STAGE_TUNNEL);
  assert.equal(snapshot.status, 'fail');
  assert.equal(snapshot.data, null);
  assert.match(snapshot.detail, /隧道层失败/);
  assert.match(snapshot.tunnel.detail, /device offline/);
});

test('adb 通道走 run-as 执行设备侧脚本：参数逐项钉死，不经 ssh', () => {
  const calls = [];
  readHeartbeat({
    run: (argv, options) => {
      calls.push({ argv, options });
      return { stdout: REAL_LINE, stderr: '' };
    },
    adb: 'C:/adb/platform-tools/adb.exe', serial: '3a3e1f52', timeoutMs: 15000, now: 1793694010,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv, [
    'C:/adb/platform-tools/adb.exe', '-s', '3a3e1f52',
    'exec-out', 'run-as', 'com.termux', 'sh', '-c', 'sh ' + HEARTBEAT_REMOTE_SCRIPT,
  ]);
  assert.equal(calls[0].options.timeoutMs, 15000);
  assert.ok(!calls[0].argv.some((arg) => String(arg).includes('ssh')), '这条通道不得依赖 ssh');
});

test('adb 通了但设备侧输出读不懂：tunnel 通过、结论失败，两件事分开报', () => {
  const snapshot = readHeartbeat({
    run: () => ({ stdout: 'run-as: package not debuggable', stderr: '' }),
    adb: 'adb', serial: 'SERIAL1', timeoutMs: 1000, now: 1793694009,
  });
  assert.equal(snapshot.tunnel.pass, true);
  assert.equal(snapshot.status, 'fail');
  assert.equal(snapshot.code, ERR_HEARTBEAT_UNREADABLE);
});

test('全绿路径：readHeartbeat 组合出 tunnel 通过 + 五层判定 + 原始数据', () => {
  const snapshot = readHeartbeat({
    run: () => ({ stdout: REAL_LINE + '\n', stderr: '' }),
    adb: 'adb', serial: 'SERIAL1', timeoutMs: 1000, now: 1793694009,
  });
  assert.equal(snapshot.tunnel.pass, true);
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.code, null);
  assert.equal(snapshot.stages.length, 4);
  assert.equal(snapshot.data.runsvdirCount, 1);
});
