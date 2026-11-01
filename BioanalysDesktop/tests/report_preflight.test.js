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
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import childProcess from 'node:child_process';
import { signDelivery, writeChecksums } from '../../ops/ed25519_tools.mjs';

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

test('writeSha256Sidecars：文本交付件缺 CHECKSUMS 清单 → 拒绝补旁挂哈希', () => {
  const projectId = 'PRJ_SIDECAR_OK';
  const dir = localDeliverDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const md = Buffer.from('# 交付报告\n正文\n', 'utf8');
  const html = Buffer.from('<html><body>ok</body></html>', 'utf8');
  fs.writeFileSync(path.join(dir, 'Analysis_Report.md'), md);
  fs.writeFileSync(path.join(dir, 'Analysis_Report.html'), html);

  assert.throws(() => writeSha256Sidecars(projectId), /REPORT_INTEGRITY_FAIL/);
  assert.equal(fs.existsSync(path.join(dir, 'Analysis_Report.md.sha256')), false);
  assert.equal(fs.existsSync(path.join(dir, 'Analysis_Report.html.sha256')), false);
});

test('writeSha256Sidecars：目录不存在时回空数组而不是抛错', () => {
  assert.deepEqual(writeSha256Sidecars('PRJ_SIDECAR_ABSENT'), []);
});

// 08 号书第 6 项「先验后签」的负路径覆盖。
// 只测 happy path 等于没测：08 号书第 2 项的教训就是「测试覆盖率为 0 的修复等于假修复」。
// 这里要钉住的是「包被篡改时必须拒绝，并且绝不给坏文件补旁挂哈希（洗白）」。

function signedDelivery(projectId) {
  const dir = localDeliverDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Analysis_Report.md'), '# 交付报告\n原始正文\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'Analysis_Report.html'), '<html><body>原始正文</body></html>', 'utf8');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keys = {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
  };
  writeChecksums(dir);
  signDelivery(dir, { privateKey: keys.privateKey });
  // 公钥放包外：写进包里会被 writeChecksums 计入清单，改变被测语义
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 's33-preflight-pub-'));
  const publicKeyPath = path.join(keyDir, 'pub.pem');
  fs.writeFileSync(publicKeyPath, keys.publicKey, 'utf8');
  return { dir, publicKeyPath };
}

test('writeSha256Sidecars：验签通过后为全部交付件写 sha256sum 可直接复核的旁挂文件', () => {
  const projectId = 'PRJ_SIDECAR_SIGNED_FILES';
  const { dir, publicKeyPath } = signedDelivery(projectId);
  const saved = process.env.BIO_ED25519_PUBLIC_KEY_PATH;
  process.env.BIO_ED25519_PUBLIC_KEY_PATH = publicKeyPath;
  try {
    const written = writeSha256Sidecars(projectId);
    assert.equal(written.length, 4, '报告两件、清单与签名都要有本地旁挂哈希');
    const md = fs.readFileSync(path.join(dir, 'Analysis_Report.md'));
    const expectedMd = createHash('sha256').update(md).digest('hex');
    const sidecarText = fs.readFileSync(path.join(dir, 'Analysis_Report.md.sha256'), 'utf8');
    assert.equal(sidecarText, `${expectedMd}  Analysis_Report.md\n`);
    assert.ok(written.some((item) => item.name === 'Analysis_Report.md' && item.sha256 === expectedMd));
  } finally {
    if (saved === undefined) delete process.env.BIO_ED25519_PUBLIC_KEY_PATH;
    else process.env.BIO_ED25519_PUBLIC_KEY_PATH = saved;
  }
});

test('writeSha256Sidecars：签名完好时正常放行（证明下面的拦截不是恒失败）', () => {
  const { dir, publicKeyPath } = signedDelivery('PRJ_SIDECAR_SIGNED_OK');
  const saved = process.env.BIO_ED25519_PUBLIC_KEY_PATH;
  process.env.BIO_ED25519_PUBLIC_KEY_PATH = publicKeyPath;
  try {
    const written = writeSha256Sidecars('PRJ_SIDECAR_SIGNED_OK');
    assert.ok(written.some((item) => item.name === 'Analysis_Report.md'));
  } finally {
    if (saved === undefined) delete process.env.BIO_ED25519_PUBLIC_KEY_PATH;
    else process.env.BIO_ED25519_PUBLIC_KEY_PATH = saved;
  }
  assert.ok(fs.existsSync(path.join(dir, 'Analysis_Report.md.sha256')));
});

test('writeSha256Sidecars：包体被篡改必须抛 REPORT_INTEGRITY_FAIL，且严禁补旁挂哈希', () => {
  const { dir, publicKeyPath } = signedDelivery('PRJ_SIDECAR_TAMPERED');
  // 篡改交付正文：签名与清单哈希都还是旧的，本地一验就该炸
  fs.writeFileSync(path.join(dir, 'Analysis_Report.md'), '# 交付报告\n被注入的正文\n', 'utf8');
  const saved = process.env.BIO_ED25519_PUBLIC_KEY_PATH;
  process.env.BIO_ED25519_PUBLIC_KEY_PATH = publicKeyPath;
  try {
    assert.throws(
      () => writeSha256Sidecars('PRJ_SIDECAR_TAMPERED'),
      /REPORT_INTEGRITY_FAIL/,
      '篡改包必须被验签拦下，不许走到重算哈希那一步',
    );
  } finally {
    if (saved === undefined) delete process.env.BIO_ED25519_PUBLIC_KEY_PATH;
    else process.env.BIO_ED25519_PUBLIC_KEY_PATH = saved;
  }
  // 关键反证：坏文件旁边不许出现「看起来合法」的 .sha256，否则等于给坏包洗白
  assert.equal(fs.existsSync(path.join(dir, 'Analysis_Report.md.sha256')), false);
});

test('writeSha256Sidecars：签名对不上公钥（换包冒充）同样拦截', () => {
  const { dir } = signedDelivery('PRJ_SIDECAR_WRONG_KEY');
  // 用另一把密钥的公钥去验同一份签名：signature_mismatch
  const { publicKey } = generateKeyPairSync('ed25519');
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 's33-preflight-pub-'));
  const publicKeyPath = path.join(keyDir, 'pub.pem');
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }), 'utf8');
  const saved = process.env.BIO_ED25519_PUBLIC_KEY_PATH;
  process.env.BIO_ED25519_PUBLIC_KEY_PATH = publicKeyPath;
  try {
    assert.throws(() => writeSha256Sidecars('PRJ_SIDECAR_WRONG_KEY'), /REPORT_INTEGRITY_FAIL/);
  } finally {
    if (saved === undefined) delete process.env.BIO_ED25519_PUBLIC_KEY_PATH;
    else process.env.BIO_ED25519_PUBLIC_KEY_PATH = saved;
  }
  assert.equal(fs.existsSync(path.join(dir, 'Analysis_Report.md.sha256')), false);
});

// 08 号书第 6 项的残余缺口：只有「清单与签名同时存在」才验签，等于告诉攻击者
// 删掉 CHECKSUMS.sig 就能让本地给坏包重算哈希洗白。交付包（tar.gz）在场时，
// 缺清单或缺签名一律按完整性失败处理。
function tarDeliveryWithSignature(projectId, { withSignature = true } = {}) {
  const dir = localDeliverDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Analysis_Report.md'), '# 交付报告\n原始正文\n', 'utf8');
  fs.writeFileSync(path.join(dir, `${projectId}_Client_Delivery.tar.gz`), Buffer.alloc(64, 0x74));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeChecksums(dir);
  if (withSignature) {
    signDelivery(dir, { privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  }
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 's33-preflight-pub-'));
  const publicKeyPath = path.join(keyDir, 'pub.pem');
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }), 'utf8');
  return { dir, publicKeyPath, tarPath: path.join(dir, `${projectId}_Client_Delivery.tar.gz`) };
}

test('writeSha256Sidecars：交付包缺 CHECKSUMS.sig → 拒绝补旁挂哈希（不许删签名绕过验签）', () => {
  const projectId = 'PRJ_SIDECAR_TAR_NOSIG';
  const { dir, publicKeyPath } = tarDeliveryWithSignature(projectId, { withSignature: false });
  const saved = process.env.BIO_ED25519_PUBLIC_KEY_PATH;
  process.env.BIO_ED25519_PUBLIC_KEY_PATH = publicKeyPath;
  try {
    assert.throws(
      () => writeSha256Sidecars(projectId),
      /REPORT_INTEGRITY_FAIL/,
      '有交付 tar 却没有签名，必须按完整性失败阻断',
    );
  } finally {
    if (saved === undefined) delete process.env.BIO_ED25519_PUBLIC_KEY_PATH;
    else process.env.BIO_ED25519_PUBLIC_KEY_PATH = saved;
  }
  assert.equal(fs.existsSync(path.join(dir, 'Analysis_Report.md.sha256')), false);
});

test('writeSha256Sidecars：交付包验签失败 → 删除污染 tar 且拒绝补旁挂哈希', () => {
  const projectId = 'PRJ_SIDECAR_TAR_TAMPERED';
  const { dir, publicKeyPath, tarPath } = tarDeliveryWithSignature(projectId);
  fs.writeFileSync(path.join(dir, 'Analysis_Report.md'), '# 交付报告\n被注入的正文\n', 'utf8');
  const saved = process.env.BIO_ED25519_PUBLIC_KEY_PATH;
  process.env.BIO_ED25519_PUBLIC_KEY_PATH = publicKeyPath;
  try {
    assert.throws(() => writeSha256Sidecars(projectId), /REPORT_INTEGRITY_FAIL/);
  } finally {
    if (saved === undefined) delete process.env.BIO_ED25519_PUBLIC_KEY_PATH;
    else process.env.BIO_ED25519_PUBLIC_KEY_PATH = saved;
  }
  assert.equal(fs.existsSync(tarPath), false, '污染包必须删除，不能留在本地等下一次补哈希');
  assert.equal(fs.existsSync(path.join(dir, 'Analysis_Report.md.sha256')), false);
});

// 真机布局回归：引擎的 CHECKSUMS.sha256 记的是包内嵌套相对路径
// （03_Interpretation_Report/Analysis_Report.md、01_Adapted_Scripts/run.sh 等），
// 而 pullDeliverables 按 basename 平铺回搬、只拉允许集合。若按整包逐行校验，
// 正常包必然因缺 01_Adapted_Scripts/run.sh 被判成坏包，交付链路整体不可用。
test('writeSha256Sidecars：嵌套清单里未回搬的包内文件不误杀，已回搬文件仍逐一对哈希', () => {
  const projectId = 'PRJ_SIDECAR_NESTED';
  const dir = localDeliverDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const md = Buffer.from('# 交付报告\n嵌套布局\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'Analysis_Report.md'), md);
  fs.writeFileSync(path.join(dir, `${projectId}_Client_Delivery.tar.gz`), Buffer.alloc(64, 0x74));
  const mdDigest = createHash('sha256').update(md).digest('hex');
  const manifest = `${mdDigest}  03_Interpretation_Report/Analysis_Report.md\n`
    + `${'a'.repeat(64)}  01_Adapted_Scripts/run.sh\n`;
  fs.writeFileSync(path.join(dir, 'CHECKSUMS.sha256'), manifest, 'utf8');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(dir, 'CHECKSUMS.sig'), sign(null, Buffer.from(manifest), privateKey));
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 's33-preflight-pub-'));
  const publicKeyPath = path.join(keyDir, 'pub.pem');
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }), 'utf8');
  const saved = process.env.BIO_ED25519_PUBLIC_KEY_PATH;
  process.env.BIO_ED25519_PUBLIC_KEY_PATH = publicKeyPath;
  try {
    const written = writeSha256Sidecars(projectId);
    assert.ok(written.some((item) => item.name === 'Analysis_Report.md'), '正常包必须放行');
    assert.equal(fs.existsSync(path.join(dir, 'Analysis_Report.md.sha256')), true);
  } finally {
    if (saved === undefined) delete process.env.BIO_ED25519_PUBLIC_KEY_PATH;
    else process.env.BIO_ED25519_PUBLIC_KEY_PATH = saved;
  }
});
