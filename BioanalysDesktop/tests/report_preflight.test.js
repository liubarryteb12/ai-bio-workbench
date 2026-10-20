/**
 * 交付前置门禁回归测试（docs/delivery_package_spec.md 第三节第 3/5/6 条）。
 *
 * 覆盖：
 *   1. buildPreflightCommand 纯函数（命令形态 + 非法 id 拒绝）；
 *   2. parsePreflightOutput 纯函数（DF / LEDGER / END 三行协议，含截断判定）；
 *   3. runReportPreflight 四道闸（水位不足 / 进行中任务 / 失败台账 + force / 输出截断）；
 *   4. writeSha256Sidecars（旁挂文件格式必须能被 sha256sum -c 直接复核）。
 *
 * 全部走 childProcess 假 ssh 垫片，绝不真连 K40（照 report.test.js 手法）。
 */

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import childProcess from 'node:child_process';

// report.js 在模块加载时读 BIO_LOCAL_DELIVERABLES，必须在 import 前设好
const LOCAL_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 's33-preflight-root-'));
process.env.BIO_LOCAL_DELIVERABLES = LOCAL_ROOT;

const {
  buildPreflightCommand,
  parsePreflightOutput,
  runReportPreflight,
  writeSha256Sidecars,
  localDeliverDir,
  PREFLIGHT_MIN_FREE_PCT,
} = await import('../server/report.js');

function fakeChild({ stdoutText = '', stderrText = '', exitCode = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.stdin = new Writable({ write(chunk, enc, cb) { cb(); } });
  queueMicrotask(() => {
    if (stdoutText) child.stdout.push(stdoutText);
    if (stderrText) child.stderr.push(stderrText);
    child.stdout.push(null);
    child.stderr.push(null);
    setImmediate(() => child.emit('exit', exitCode));
  });
  return child;
}

/** 按项目 id 回放不同门禁现场；未识别的项目按「一切正常」回放 */
function dispatchSpawn(program, args) {
  if (program !== 'ssh') return fakeChild({ exitCode: 0 });
  const remoteCmd = args[args.length - 1];
  if (!remoteCmd.includes("echo 'END|'")) return fakeChild({ exitCode: 0 });
  if (remoteCmd.includes('PRJ_GATE_LOW')) {
    return fakeChild({ stdoutText: 'DF|85%\nEND|\n' });
  }
  if (remoteCmd.includes('PRJ_GATE_FAILED')) {
    return fakeChild({
      stdoutText: 'DF|30%\n'
        + 'LEDGER|2026-10-20_PRJ_GATE_FAILED_line1_bulk_wgcna_58546485.json|failed\n'
        + 'LEDGER|2026-10-20_PRJ_GATE_FAILED_line1_bulk_enrichment_86b31149.json|failed\n'
        + 'END|\n',
    });
  }
  if (remoteCmd.includes('PRJ_GATE_RUNNING')) {
    return fakeChild({
      stdoutText: 'DF|30%\n'
        + 'LEDGER|2026-10-21_PRJ_GATE_RUNNING_line2_scrna_hvg_a1b2c3d4.json|running\n'
        + 'END|\n',
    });
  }
  if (remoteCmd.includes('PRJ_GATE_TRUNC')) {
    // 命令被截断：只有 DF 行，没有 END 标记
    return fakeChild({ stdoutText: 'DF|30%\n' });
  }
  if (remoteCmd.includes('PRJ_GATE_UNKNOWN_DF')) {
    return fakeChild({ stdoutText: 'END|\n' });
  }
  return fakeChild({ stdoutText: 'DF|40%\nEND|\n' });
}

before(() => {
  mock.method(childProcess, 'spawn', (program, args) => dispatchSpawn(program, args));
});

after(() => {
  mock.restoreAll();
  fs.rmSync(LOCAL_ROOT, { recursive: true, force: true });
});

// ------------------------------------------------------------
// 1. buildPreflightCommand
// ------------------------------------------------------------

test('buildPreflightCommand：命令含 df 水位、按项目过滤台账、END 标记', () => {
  const { command, remoteProjectDir } = buildPreflightCommand('PRJ_20261020_DKD_bulk');
  assert.equal(remoteProjectDir, '/mnt/ssd/bio_data/projects/PRJ_20261020_DKD_bulk');
  assert.ok(command.includes("df -P '/mnt/ssd/bio_data'"));
  assert.ok(command.includes('"project_id": "PRJ_20261020_DKD_bulk"'));
  assert.ok(command.includes("echo 'END|'"));
  assert.ok(command.includes('/mnt/ssd/bio_data/system_logs'));
});

test('buildPreflightCommand：路径穿越 / 含空格 / 含单引号的 id 一律拒绝（不触达远端）', () => {
  assert.throws(() => buildPreflightCommand('../../etc'), /projectId 非法/);
  assert.throws(() => buildPreflightCommand('PRJ with space'), /projectId 非法/);
  assert.throws(() => buildPreflightCommand("PRJ'; rm -rf / #"), /projectId 非法/);
});

// ------------------------------------------------------------
// 2. parsePreflightOutput
// ------------------------------------------------------------

test('parsePreflightOutput：正常三行协议解析出已用百分比与台账状态', () => {
  const parsed = parsePreflightOutput(
    'DF|83%\nLEDGER|2026-10-20_p_line1_bulk_wgcna_abcd1234.json|completed\nEND|\n'
  );
  assert.equal(parsed.usedPct, 83);
  assert.equal(parsed.sawEnd, true);
  assert.deepEqual(parsed.ledgers, [
    { file: '2026-10-20_p_line1_bulk_wgcna_abcd1234.json', status: 'completed' },
  ]);
});

test('parsePreflightOutput：缺 END 标记时 sawEnd=false（输出截断判据）', () => {
  const parsed = parsePreflightOutput('DF|30%\n');
  assert.equal(parsed.sawEnd, false);
  assert.equal(parsed.usedPct, 30);
});

test('parsePreflightOutput：空输出不抛异常，全部按未知处理', () => {
  const parsed = parsePreflightOutput('');
  assert.equal(parsed.usedPct, null);
  assert.deepEqual(parsed.ledgers, []);
  assert.equal(parsed.sawEnd, false);
});

// ------------------------------------------------------------
// 3. runReportPreflight 四道闸
// ------------------------------------------------------------

test('runReportPreflight：水位充足且无异常台账 → 全部通过', async () => {
  const result = await runReportPreflight('PRJ_GATE_OK');
  assert.equal(result.ok, true);
  assert.equal(result.freePct, 60);
  assert.equal(result.checks.length, 4);
  assert.ok(result.checks.every((check) => check.ok));
  assert.match(result.summary, /全部通过/);
});

test('runReportPreflight：剩余空间低于 20% → storage 闸失败并点名百分比', async () => {
  const result = await runReportPreflight('PRJ_GATE_LOW');
  assert.equal(result.ok, false);
  assert.equal(result.freePct, 100 - 85);
  const storage = result.checks.find((check) => check.name === 'storage');
  assert.equal(storage.ok, false);
  assert.match(storage.detail, /剩余 15%/);
  assert.match(storage.detail, /要求 >= 20%/);
  assert.match(result.summary, /前置门禁未通过/);
});

test('runReportPreflight：有 status=running 台账 → 拒绝打包并点名台账文件', async () => {
  const result = await runReportPreflight('PRJ_GATE_RUNNING');
  assert.equal(result.ok, false);
  const running = result.checks.find((check) => check.name === 'running');
  assert.equal(running.ok, false);
  assert.match(running.detail, /hvg_a1b2c3d4\.json/);
});

test('runReportPreflight：有失败台账且未加 force → 拒绝并列出失败台账', async () => {
  const result = await runReportPreflight('PRJ_GATE_FAILED');
  assert.equal(result.ok, false);
  assert.equal(result.failedLedgers.length, 2);
  const failed = result.checks.find((check) => check.name === 'failed_ledger');
  assert.equal(failed.ok, false);
  assert.match(failed.detail, /58546485/);
  assert.match(failed.detail, /force/);
});

test('runReportPreflight：有失败台账但 force=true → 放行且 detail 标明已按 force 继续', async () => {
  const result = await runReportPreflight('PRJ_GATE_FAILED', { force: true });
  assert.equal(result.ok, true);
  const failed = result.checks.find((check) => check.name === 'failed_ledger');
  assert.equal(failed.ok, true);
  assert.match(failed.detail, /已按 force 继续/);
  assert.equal(result.failedLedgers.length, 2, 'force 只放行，不隐瞒失败台账清单');
});

test('runReportPreflight：远端输出缺 END 标记 → remote_output 闸失败（防静默截断）', async () => {
  const result = await runReportPreflight('PRJ_GATE_TRUNC');
  assert.equal(result.ok, false);
  const remoteOutput = result.checks.find((check) => check.name === 'remote_output');
  assert.equal(remoteOutput.ok, false);
  assert.match(remoteOutput.detail, /END/);
});

test('runReportPreflight：df 行缺失 → storage 闸失败且不误判为通过', async () => {
  const result = await runReportPreflight('PRJ_GATE_UNKNOWN_DF');
  assert.equal(result.ok, false);
  assert.equal(result.usedPct, null);
  const storage = result.checks.find((check) => check.name === 'storage');
  assert.equal(storage.ok, false);
  assert.match(storage.detail, /存储水位未知/);
});

test('runReportPreflight：非法 projectId 直接抛错（不触达远端）', async () => {
  await assert.rejects(() => runReportPreflight('../etc'), /projectId 非法/);
});

// ------------------------------------------------------------
// 4. writeSha256Sidecars
// ------------------------------------------------------------

test('writeSha256Sidecars：为允许集合内的交付件写 sha256sum 可直接复核的旁挂文件', () => {
  const projectId = 'PRJ_SIDECAR_OK';
  const dir = localDeliverDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const md = Buffer.from('# 交付报告\n正文\n', 'utf8');
  const html = Buffer.from('<html><body>ok</body></html>', 'utf8');
  fs.writeFileSync(path.join(dir, 'Analysis_Report.md'), md);
  fs.writeFileSync(path.join(dir, 'Analysis_Report.html'), html);

  const written = writeSha256Sidecars(projectId);
  assert.equal(written.length, 2);

  const expectedMd = createHash('sha256').update(md).digest('hex');
  const sidecarPath = path.join(dir, 'Analysis_Report.md.sha256');
  const sidecarText = fs.readFileSync(sidecarPath, 'utf8');
  assert.equal(sidecarText, `${expectedMd}  Analysis_Report.md\n`);
  assert.ok(written.some((item) => item.name === 'Analysis_Report.md' && item.sha256 === expectedMd));
});

test('writeSha256Sidecars：目录不存在时回空数组而不是抛错', () => {
  assert.deepEqual(writeSha256Sidecars('PRJ_SIDECAR_ABSENT'), []);
});
