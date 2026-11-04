import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseHeartbeat, evaluateHeartbeat, readHeartbeat,
  detectServicePortAnomalies, describeLiveness, resetHeartbeatLiveness, getHeartbeatLastOkTs,
  HEARTBEAT_SCHEMA, HEARTBEAT_REMOTE_SCRIPT, HEARTBEAT_DEFAULT_MAX_AGE_SEC, HEARTBEAT_SERVICES,
  HEARTBEAT_SERVICE_PORTS, ANOMALY_RUN_NO_LISTEN, ANOMALY_DOWN_STILL_LISTEN,
  ANOMALY_STOP_IGNORED, SVC_STATE_DOWN_PENDING,
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
  sshd_8022_listen: 1, dropbear_10022_listen: 1, pi_9910_listen: 1, ssd_writable: 1,
  port_probe: 'tcp-connect', svc_sshd: 'run', svc_ubuntu_sshd: 'run',
  svc_crond: 'run', svc_ssh_agent: 'run', svc_pi_a2a: 'run',
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
    state: { lastOkTs: null },
  });
  assert.equal(snapshot.tunnel.pass, true);
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.code, null);
  assert.equal(snapshot.stages.length, 4);
  assert.equal(snapshot.data.runsvdirCount, 1);
});

// ── 服务状态与端口监听的复合诊断（Argon 第二十轮第一项）──
//
// 实测起因：`sv down ubuntu-sshd` 之后 10022 仍在监听。proot 用 ptrace 劫持子进程，
// 容器内 dropbear 已脱离控制终端，SIGTERM 未必转发得到。单看服务状态会说「已停」，
// 单看端口会说「活着」，两边都不算错，错的是各说一半。

test('服务 run 但端口没人听：报 ANOMALY_RUN_NO_LISTEN，点名服务与端口', () => {
  const data = { ...baseData(), sshd8022: 0 };
  const anomalies = detectServicePortAnomalies(data);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].code, ANOMALY_RUN_NO_LISTEN);
  assert.equal(anomalies[0].service, 'sshd');
  assert.equal(anomalies[0].port, 8022);
  assert.match(anomalies[0].detail, /缺 host key/);

  const evaluated = evaluateHeartbeat(data, { now: data.ts });
  assert.equal(evaluated.anomalies[0].code, ANOMALY_RUN_NO_LISTEN);
  // 层代号与复合标志是两件事：层代号说断在哪层，复合标志说这条证据自相矛盾。
  assert.equal(evaluated.code, ERR_STAGE_PORT_8022);
  assert.match(evaluated.detail, /port_8022 层失败/);
  assert.match(evaluated.detail, new RegExp(ANOMALY_RUN_NO_LISTEN));
});

test('服务非 run 但端口仍在听：报 ANOMALY_DOWN_STILL_LISTEN（sv down 不穿透 proot）', () => {
  const data = {
    ...baseData(),
    services: { ...baseData().services, 'ubuntu-sshd': 'down' },
    dropbear10022: 1,
  };
  const evaluated = evaluateHeartbeat(data, { now: data.ts });
  assert.equal(evaluated.anomalies.length, 1);
  assert.equal(evaluated.anomalies[0].code, ANOMALY_DOWN_STILL_LISTEN);
  assert.equal(evaluated.anomalies[0].service, 'ubuntu-sshd');
  assert.match(evaluated.detail, new RegExp(ANOMALY_DOWN_STILL_LISTEN));
  // 服务非 run 仍算监督层失败，两个判据同时成立不是重复报
  assert.equal(evaluated.code, ERR_STAGE_RUNSV);
});

test('不监听 TCP 的服务（crond/ssh-agent）不参与交叉校验，避免报假异常', () => {
  const data = { ...baseData(), services: { ...baseData().services, crond: 'down', 'ssh-agent': 'down' } };
  assert.deepEqual(detectServicePortAnomalies(data), []);
  assert.deepEqual(HEARTBEAT_SERVICE_PORTS.map((p) => p.service), ['sshd', 'ubuntu-sshd']);
});

test('被要求停却没停（want down 但进程在）：报 ANOMALY_STOP_IGNORED', () => {
  // 2026-11-03 真机演练：sv down ubuntu-sshd 后 supervise/stat 一直是
  // "run, got TERM, want down"，dropbear 与 10022 都还在。设备侧把这种状态归一化成
  // down_pending，只截逗号前一段会把它洗成正常的 run。
  const data = {
    ...baseData(),
    services: { ...baseData().services, 'ubuntu-sshd': SVC_STATE_DOWN_PENDING },
    dropbear10022: 1,
  };
  const evaluated = evaluateHeartbeat(data, { now: data.ts });
  assert.equal(evaluated.anomalies.length, 1);
  assert.equal(evaluated.anomalies[0].code, ANOMALY_STOP_IGNORED);
  assert.match(evaluated.anomalies[0].detail, /want down/);
  assert.equal(evaluated.code, ERR_STAGE_RUNSV);
  assert.match(evaluated.stages[0].detail, /ubuntu-sshd/);
});

test('down_pending 且端口已停：停止请求生效中，不报异常（只看结论不看过程）', () => {
  const data = {
    ...baseData(),
    services: { ...baseData().services, 'ubuntu-sshd': SVC_STATE_DOWN_PENDING },
    dropbear10022: 0,
  };
  assert.deepEqual(detectServicePortAnomalies(data), []);
});

test('自洽组合不报异常：全绿、以及「服务 down 且端口也不通」', () => {
  assert.deepEqual(detectServicePortAnomalies(baseData()), []);
  const down = {
    ...baseData(),
    services: { ...baseData().services, 'ubuntu-sshd': 'down' },
    dropbear10022: 0,
  };
  assert.deepEqual(detectServicePortAnomalies(down), []);
});

test('快照过期时仍把服务与端口的矛盾带出来，但层序只报 stale', () => {
  const data = { ...baseData(), sshd8022: 0 };
  const evaluated = evaluateHeartbeat(data, { now: data.ts + HEARTBEAT_DEFAULT_MAX_AGE_SEC + 1 });
  assert.equal(evaluated.code, ERR_HEARTBEAT_STALE);
  assert.equal(evaluated.stages.length, 1);
  assert.equal(evaluated.anomalies[0].code, ANOMALY_RUN_NO_LISTEN);
});

// ── 最后一次全通时间戳（Argon 第二十轮第三项）──
//
// 只有 code 时，「刚断 3 秒」与「已死 6 小时」长得一样，处置优先级却相反。

test('首次即成功：last_ok_ts 记为本次，down_duration_sec=0', () => {
  assert.deepEqual(describeLiveness({ status: 'ok', now: 1793694009, lastOkTs: null }), {
    last_ok_ts: 1793694009, down_duration_sec: 0,
  });
});

test('成功过一次之后再失败：保留上次全通时刻并给出已断多久', () => {
  assert.deepEqual(describeLiveness({ status: 'fail', now: 1793694009, lastOkTs: 1793690009 }), {
    last_ok_ts: 1793690009, down_duration_sec: 4000,
  });
});

test('从未成功过：last_ok_ts 与 down_duration_sec 都是 null，不伪造 1970 或「刚刚」', () => {
  const liveness = describeLiveness({ status: 'fail', now: 1793694009, lastOkTs: undefined });
  assert.equal(liveness.last_ok_ts, null);
  assert.equal(liveness.down_duration_sec, null);
});

test('readHeartbeat 把全通时刻记进注入的 store，失败路径沿用并算出间隔', () => {
  const state = { lastOkTs: null };
  const ok = readHeartbeat({
    run: () => ({ stdout: REAL_LINE, stderr: '' }),
    adb: 'adb', serial: 'SERIAL1', timeoutMs: 1000, now: 1793694009, state,
  });
  assert.equal(ok.last_ok_ts, 1793694009);
  assert.equal(ok.down_duration_sec, 0);
  assert.equal(state.lastOkTs, 1793694009);

  const failed = readHeartbeat({
    run: () => { throw new Error('adb: device offline'); },
    adb: 'adb', serial: 'SERIAL1', timeoutMs: 1000, now: 1793694129, state,
  });
  assert.equal(failed.status, 'fail');
  assert.equal(failed.last_ok_ts, 1793694009);
  assert.equal(failed.down_duration_sec, 120);
  assert.equal(state.lastOkTs, 1793694009, '失败不得刷新全通时刻');
});

test('隧道断掉时也带 liveness：ssh 全断恰恰最需要知道上次活着是什么时候', () => {
  const snapshot = readHeartbeat({
    run: () => { throw new Error('adb: device offline'); },
    adb: 'adb', serial: 'SERIAL1', timeoutMs: 1000, now: 1793694129, state: { lastOkTs: 1793694009 },
  });
  assert.equal(snapshot.code, ERR_STAGE_TUNNEL);
  assert.equal(snapshot.last_ok_ts, 1793694009);
  assert.equal(snapshot.down_duration_sec, 120);
});

test('进程内记忆可显式清空：默认 store 全通后被 resetHeartbeatLiveness 清掉', () => {
  resetHeartbeatLiveness();
  assert.equal(getHeartbeatLastOkTs(), null);
  readHeartbeat({
    run: () => ({ stdout: REAL_LINE, stderr: '' }),
    adb: 'adb', serial: 'SERIAL1', timeoutMs: 1000, now: 1793694009,
  });
  assert.equal(getHeartbeatLastOkTs(), 1793694009);
  resetHeartbeatLiveness();
  assert.equal(getHeartbeatLastOkTs(), null);
});
