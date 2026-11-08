/**
 * S27 客户交付报告入口回归测试。
 *
 * 覆盖三块：
 *   1. buildReportCommand 纯函数（正常 + 路径穿越/空格/引号负路径拒绝）；
 *   2. runReportBuild / pullDeliverables 的 ssh 行为（childProcess 假 ssh 垫片，
 *      照 run.test.js 的 mock.method 手法，绝不真连 K40）；
 *   3. 三端点契约（in-process 起真服务打真 HTTP；build 链路全部走垫片）。
 *
 * 口径：非 0 退出码必须 reject 且 error 带 stderr 原文；download 只放行
 * localDeliverDir 内、名字在允许集合内的文件；本地交付根重定向到临时目录，
 * 不污染仓库 deliverables/。
 */

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import childProcess from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import zlib from 'node:zlib';
import { signDelivery, writeChecksums } from '../../tools/reporting/ed25519_tools.mjs';
import { buildMiniDeliveryPackage, sha256Hex } from './support/delivery_fixture.js';

// 环境变量必须在 import 服务端模块之前设好（report.js / index.js 在模块加载时读）
const LOCAL_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 's27-report-root-'));
process.env.BIO_LOCAL_DELIVERABLES = LOCAL_ROOT;
// 交付构建与回搬仍是 ssh/scp 特殊路径，尚未迁移 ADB。
// 本文件显式打开 ssh 特殊开关，让垫片只拦截 ssh/scp，不触发真实 ADB 通道。
process.env.BIO_COMPUTE_ADAPTER = 'ssh';

// 08 号书第 6 项之后，带 tar 的交付包必须带可验签的 CHECKSUMS，否则一律拒绝补旁挂哈希。
// 端点测试的假 scp 因此要能造出「真签名」的包：这里放一对临时测试密钥，
// 供 dispatchSpawn 在拉取 CHECKSUMS.sha256 / CHECKSUMS.sig 时就地生成并签名。
const TEST_KEY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 's27-report-key-'));
const TEST_KEY_PAIR = generateKeyPairSync('ed25519');
const TEST_PRIVATE_KEY_PATH = path.join(TEST_KEY_DIR, 'ed25519_private.pem');
const TEST_PUBLIC_KEY_PATH = path.join(TEST_KEY_DIR, 'ed25519_public.pem');
fs.writeFileSync(
  TEST_PRIVATE_KEY_PATH,
  TEST_KEY_PAIR.privateKey.export({ type: 'pkcs8', format: 'pem' }),
);
fs.writeFileSync(
  TEST_PUBLIC_KEY_PATH,
  TEST_KEY_PAIR.publicKey.export({ type: 'spki', format: 'pem' }),
);
process.env.BIO_ED25519_PRIVATE_KEY_PATH = TEST_PRIVATE_KEY_PATH;
process.env.BIO_ED25519_PUBLIC_KEY_PATH = TEST_PUBLIC_KEY_PATH;

// 第二十轮 Q1：打包末尾内联验收 + 回执门禁。垫片因此不能再回放假字节串——
// 四关验收要在本地真跑（解包、验签、双向差集），scp 必须回放结构合法的
// 迷你交付包字节（tests/support/delivery_fixture.js，签名键 = 上面的 TEST 键对）。
// 回执落点走 BIO_DELIVERY_RECORDS_DIR 指向临时区，绝不写进仓库受控区。
const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 's27-fixture-'));
process.env.BIO_DELIVERY_RECORDS_DIR = path.join(FIXTURE_ROOT, 'records');
const TEST_PUBLIC_PEM = fs.readFileSync(TEST_PUBLIC_KEY_PATH, 'utf8');
const TEST_PRIVATE_PEM = fs.readFileSync(TEST_PRIVATE_KEY_PATH, 'utf8');
function makeFixture(projectId) {
  return buildMiniDeliveryPackage({
    root: path.join(FIXTURE_ROOT, projectId),
    projectId,
    publicKey: TEST_PUBLIC_PEM,
    privateKey: TEST_PRIVATE_PEM,
  });
}
const FIXTURES = {
  PRJ_TEST_OK: makeFixture('PRJ_TEST_OK'),
  PRJ_PULL_OK: makeFixture('PRJ_PULL_OK'),
  PRJ_PULL_BADHASH: makeFixture('PRJ_PULL_BADHASH'),
  PRJ_PULL_NOHASH: makeFixture('PRJ_PULL_NOHASH'),
};
// PRJ_TEST_BADTAR：远端 tar 里的 01_Adapted_Code/run.sh 被翻了一个字节，
// 侧车与远端基准哈希都按篡改后的包给（传输层全绿），红线必须落在内联验收的
// 第 3 关（CHECKSUMS 验签），回执不落盘，下载持续 409。
const BADTAR_FIXTURE = makeFixture('PRJ_TEST_BADTAR');
{
  const raw = zlib.gunzipSync(fs.readFileSync(BADTAR_FIXTURE.tarPath));
  const at = raw.indexOf(Buffer.from('#!/bin/sh'));
  if (at < 0) throw new Error('fixture tar 缺 #!/bin/sh 锚点');
  raw[at + 7] ^= 0x20;
  BADTAR_FIXTURE.tarBytes = zlib.gzipSync(raw);
}
BADTAR_FIXTURE.tarSha256 = sha256Hex(BADTAR_FIXTURE.tarBytes);
FIXTURES.PRJ_TEST_BADTAR = BADTAR_FIXTURE;

/** 按项目 id + 文件 basename 取垫片要回放的真实字节 */
function fixtureBytesFor(projectId, name) {
  const fx = FIXTURES[projectId];
  if (!fx) return null;
  if (/_Client_Delivery\.tar\.gz$/.test(name)) {
    return fx.tarBytes ?? fs.readFileSync(fx.tarPath);
  }
  if (name === 'Analysis_Report.md') return fs.readFileSync(path.join(fx.deliveryDir, '03_Interpretation_Report', 'Analysis_Report.md'));
  if (name === 'Analysis_Report.html') return fs.readFileSync(path.join(fx.deliveryDir, '03_Interpretation_Report', 'Analysis_Report.html'));
  if (name === 'CHECKSUMS.sha256') return fs.readFileSync(path.join(fx.deliveryDir, 'CHECKSUMS.sha256'));
  if (name === 'CHECKSUMS.sig') return fs.readFileSync(path.join(fx.deliveryDir, 'CHECKSUMS.sig'));
  if (name === 'ED25519_PUBLIC_KEY.pem') return fs.readFileSync(path.join(fx.deliveryDir, 'ED25519_PUBLIC_KEY.pem'));
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const PORT = await freePort();
process.env.BAD_PORT = String(PORT);
const BASE = `http://127.0.0.1:${PORT}`;

const { buildReportCommand, runReportBuild, pullDeliverables, localDeliverDir, LOCAL_DELIVER_ROOT }
  = await import('../server/report.js');
const { server } = await import('../server/index.js');

/** 假 ssh/scp 子进程垫片：收集后回放 stdout/stderr 并按 exitCode 退出 */
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
    // exit 必须等 'data' 事件投递完再发（setImmediate 晚于流的 resume nextTick），
    // 否则 exit 回调里收到的 stdout/stderr 还是空串（本轮实测踩到）
    setImmediate(() => child.emit('exit', exitCode));
  });
  return child;
}

/** scp 垫片要照搬的字节：与远端清单声明的字节数严格一致，让大小校验通过 */
function fixtureBytes(name) {
  if (name === 'Analysis_Report.md') return Buffer.alloc(1024, 0x6d); // 'm'
  if (name === 'Analysis_Report.html') return Buffer.alloc(2048, 0x3c); // '<'
  if (name.endsWith('_Client_Delivery.tar.gz')) return Buffer.alloc(4096, 0x74); // 't'
  return null;
}

/**
 * 统一 ssh/scp 派发器：
 *   - test -d ...              → 项目存在与否按项目 id 决定退出码
 *   - build_client_report.py   → PRJ_UNIT_FAIL / PRJ_TEST_FAIL 回退出码 1 + stderr 原文
 *   - find ... -printf         → 回三大件清单（PRJ_PULL_MISS 只给 md，测缺失路径）
 *   - scp                      → 真的把垫片字节写到本地落点（模拟传输成功）
 */
/** 记录全部 ssh 远端命令，供"门禁拦下后没有白跑打包"这类断言用 */
const sshCalls = [];

function dispatchSpawn(program, args) {
  if (program === 'ssh') {
    const remoteCmd = args[args.length - 1];
    sshCalls.push(remoteCmd);
    // 交付前置门禁查询（D4）：命令里含 print "DF|"
    if (remoteCmd.includes('print "DF|"')) {
      if (remoteCmd.includes('PRJ_TEST_FULL')) {
        return fakeChild({ exitCode: 0, stdoutText: 'DF|95%\nEND|\n' });
      }
      if (remoteCmd.includes('PRJ_TEST_BADLEDGER')) {
        return fakeChild({
          exitCode: 0,
          stdoutText: 'DF|42%\nLEDGER|2026-10-20_211500_PRJ_TEST_BADLEDGER_deg.json|failed\nEND|\n',
        });
      }
      if (remoteCmd.includes('PRJ_TEST_RUNNING')) {
        return fakeChild({
          exitCode: 0,
          stdoutText: 'DF|42%\nLEDGER|2026-10-20_212000_PRJ_TEST_RUNNING_deg.json|running\nEND|\n',
        });
      }
      if (remoteCmd.includes('PRJ_TEST_TRUNC')) {
        return fakeChild({ exitCode: 0, stdoutText: 'DF|42%\n' });
      }
      return fakeChild({ exitCode: 0, stdoutText: 'DF|42%\nEND|\n' });
    }
    if (remoteCmd.includes('test -d')) {
      if (remoteCmd.includes('PRJ_TEST_MISSING')) {
        return fakeChild({ exitCode: 1, stderrText: 'No such file or directory\n' });
      }
      return fakeChild({ exitCode: 0 });
    }
    if (remoteCmd.includes('build_client_report.py')) {
      if (remoteCmd.includes('PRJ_UNIT_FAIL') || remoteCmd.includes('PRJ_TEST_FAIL')) {
        return fakeChild({
          exitCode: 1,
          stdoutText: 'Warning: Permanently added \'[127.0.0.1]:10022\' (ED25519) to the list of known hosts.\n',
          stderrText: 'ENGINE_STDERR: 步骤结果文件缺失，报告不能编造数字（模拟引擎退出码 1）\n',
        });
      }
      return fakeChild({
        exitCode: 0,
        stdoutText: 'Warning: Permanently added \'[127.0.0.1]:10022\' (ED25519) to the list of known hosts.\nREPORT BUILD OK\n',
      });
    }
    if (remoteCmd.includes('sha256sum')) {
      // 08 号书第 6 项：回搬必须先拿远端基准哈希，本地复算后比对。
      // PRJ_PULL_BADHASH 模拟「传输后本地内容与远端基准不一致」，PRJ_PULL_NOHASH 模拟
      // 「远端给不出基准」，两种都必须阻断，不许本地重算洗白。
      if (remoteCmd.includes('PRJ_PULL_NOHASH')) {
        return fakeChild({ exitCode: 1, stderrText: 'sha256sum: command not found\n' });
      }
      const quotedPath = /'([^']+)'/.exec(remoteCmd);
      const remoteName = quotedPath ? quotedPath[1].split('/').pop() : '';
      const fixtureId = Object.keys(FIXTURES).find((id) => remoteCmd.includes(id));
      const bytes = fixtureId ? fixtureBytesFor(fixtureId, remoteName) : fixtureBytes(remoteName);
      if (!bytes) return fakeChild({ exitCode: 1, stderrText: 'No such file or directory\n' });
      const digest = remoteCmd.includes('PRJ_PULL_BADHASH')
        ? '0'.repeat(64)
        : createHash('sha256').update(bytes).digest('hex');
      return fakeChild({ exitCode: 0, stdoutText: `${digest}  ${remoteName}\n` });
    }
    if (remoteCmd.includes("-printf '%P|%s")) {
      const listed = Object.keys(FIXTURES).find((id) => remoteCmd.includes(id));
      if (listed) {
        // 照 K40 实测布局：报告嵌在 <pid>_Client_Delivery/03_Interpretation_Report/ 下，
        // tar.gz 在 deliverables 根；字节数回真实 fixture 尺寸（内联验收要真跑四关）
        const fx = FIXTURES[listed];
        const sizeOf = (name) => {
          const bytes = fixtureBytesFor(listed, name);
          return bytes ? bytes.length : 0;
        };
        const withIntegrityTrio = listed === 'PRJ_TEST_OK' || listed === 'PRJ_TEST_BADTAR';
        return fakeChild({
          exitCode: 0,
          stdoutText: `${listed}_Client_Delivery/01_Adapted_Scripts/run.sh|512\n`
            + `${listed}_Client_Delivery/03_Interpretation_Report/Analysis_Report.md|${sizeOf('Analysis_Report.md')}\n`
            + `${listed}_Client_Delivery/03_Interpretation_Report/Analysis_Report.html|${sizeOf('Analysis_Report.html')}\n`
            + `${listed}_Client_Delivery/delivery_manifest.json|256\n`
            + `${listed}_Client_Delivery.tar.gz|${sizeOf(listed + '_Client_Delivery.tar.gz')}\n`
            // 端点链路要跑 writeSha256Sidecars 与内联验收，带 tar 的包必须有可验签的清单与签名
            + (withIntegrityTrio
              ? `${listed}_Client_Delivery/CHECKSUMS.sha256|${sizeOf('CHECKSUMS.sha256')}\n`
                + `${listed}_Client_Delivery/CHECKSUMS.sig|64\n`
                + `${listed}_Client_Delivery/ED25519_PUBLIC_KEY.pem|${sizeOf('ED25519_PUBLIC_KEY.pem')}\n`
              : ''),
        });
      }
      if (remoteCmd.includes('PRJ_PULL_MISS')) {
        return fakeChild({
          exitCode: 0,
          stdoutText: 'PRJ_PULL_MISS_Client_Delivery/03_Interpretation_Report/Analysis_Report.md|1024\n',
        });
      }
      return fakeChild({ exitCode: 0, stdoutText: '' });
    }
    return fakeChild({ exitCode: 0 });
  }
  if (program === 'scp') {
    const remoteSpec = args.find((a) => a.startsWith('k40-ubuntu:')) || '';
    const localPath = args[args.length - 1];
    const name = remoteSpec.split('/').pop();
    const fixtureId = Object.keys(FIXTURES).find((id) => remoteSpec.includes(id));
    const bytes = fixtureId ? fixtureBytesFor(fixtureId, name) : fixtureBytes(name);
    if (bytes === null) {
      return fakeChild({ exitCode: 1, stderrText: 'scp: fixture missing\n' });
    }
    fs.writeFileSync(localPath, bytes);
    return fakeChild({ exitCode: 0 });
  }
  return fakeChild({ exitCode: 0 });
}

before(() => {
  mock.method(childProcess, 'spawn', (program, args) => dispatchSpawn(program, args));
});

/** 某项目 id 的远端命令里是否真的跑过打包引擎（门禁拦下时必须是 false） */
function buildRan(projectId) {
  return sshCalls.some((cmd) => cmd.includes('build_client_report.py') && cmd.includes(projectId));
}

after(() => {
  mock.restoreAll();
  server.closeAllConnections();
  server.close();
  fs.rmSync(LOCAL_ROOT, { recursive: true, force: true });
});

// ------------------------------------------------------------
// 1. buildReportCommand 纯函数
// ------------------------------------------------------------

test('buildReportCommand：正常项目 id 产出 cd 数据面 + --project 单引号目录', () => {
  const { command, remoteProjectDir } = buildReportCommand('PRJ_20261020_DKD_bulk');
  assert.equal(remoteProjectDir, '/mnt/ssd/bio_data/projects/PRJ_20261020_DKD_bulk');
  assert.ok(command.startsWith(
    "cd /mnt/ssd/bio_data && BIO_ED25519_PRIVATE_KEY_PATH='/mnt/ssd/bio_data/ops/secrets/ed25519_private.pem'",
  ));
  assert.match(command, /BIO_ED25519_PUBLIC_KEY_PATH='\/mnt\/ssd\/bio_data\/ops\/secrets\/ed25519_public\.pem'/);
  assert.match(command, /python3 ops\/build_client_report\.py/);
  assert.ok(command.includes("--project '/mnt/ssd/bio_data/projects/PRJ_20261020_DKD_bulk'"));
});

test('buildReportCommand：路径穿越 id 被拒绝', () => {
  assert.throws(() => buildReportCommand('../../etc'), /projectId 非法/);
});

test('buildReportCommand：含空格 id 被拒绝（防 shell 拆断）', () => {
  assert.throws(() => buildReportCommand('PRJ with space'), /projectId 非法/);
});

test('buildReportCommand：含单引号 id 被拒绝（防命令注入）', () => {
  assert.throws(() => buildReportCommand("PRJ'; rm -rf / #"), /projectId 非法/);
});

// ------------------------------------------------------------
// 2. runReportBuild / pullDeliverables（假 ssh 垫片）
// ------------------------------------------------------------

test('runReportBuild：成功 resolve 且 stdout 已去噪', async () => {
  const result = await runReportBuild('PRJ_UNIT_OK');
  assert.equal(result.ok, true);
  assert.ok(result.stdout.includes('REPORT BUILD OK'));
  assert.ok(!result.stdout.includes('Permanently added'), 'ssh 噪声必须被 stripSshNoise 剥掉');
});

test('runReportBuild：退出码非 0 → reject 且 error 含 stderr 原文（不吞失败）', async () => {
  await assert.rejects(
    () => runReportBuild('PRJ_UNIT_FAIL'),
    (cause) => {
      assert.match(cause.message, /ENGINE_STDERR: 步骤结果文件缺失/);
      assert.match(cause.message, /exit 1/);
      return true;
    }
  );
});

test('pullDeliverables：三大件任一缺失 → 明确报错点名缺失件（不许假成功）', async () => {
  await assert.rejects(() => pullDeliverables('PRJ_PULL_MISS'), /Analysis_Report\.html/);
});

test('pullDeliverables：成功拉回三大件，字节数与远端一致且 path 只回文件名', async () => {
  const result = await pullDeliverables('PRJ_PULL_OK');
  assert.equal(result.ok, true);
  assert.equal(result.files.length, 3);
  for (const file of result.files) {
    assert.ok(file.bytes > 0);
    assert.equal(file.path, file.name, 'path 必须只回相对 localDeliverDir 的文件名');
    assert.ok(!file.path.includes('/') && !file.path.includes('\\'));
  }
  assert.equal(result.report_md_bytes, 1024);
  assert.equal(result.report_html_bytes, 2048);
  const localFile = path.join(localDeliverDir('PRJ_PULL_OK'), 'Analysis_Report.md');
  assert.equal(fs.statSync(localFile).size, 1024);
});

// 08 号书第 6 项后半：回搬必须先拿远端基准哈希再比对，本地重算只能用于比对，
// 绝不能拿重算结果当基准给坏包洗白。
test('pullDeliverables：本地 tar 与远端基准哈希不一致 → REPORT_HASH_MISMATCH 且删除坏包', async () => {
  const projectId = 'PRJ_PULL_BADHASH';
  const dir = localDeliverDir(projectId);
  await assert.rejects(
    () => pullDeliverables(projectId),
    /REPORT_HASH_MISMATCH/,
    '哈希不一致必须阻断',
  );
  assert.equal(
    fs.existsSync(path.join(dir, `${projectId}_Client_Delivery.tar.gz`)),
    false,
    '被污染的 tar 包必须就地删除，不能留在本地等后续补哈希',
  );
});

test('pullDeliverables：远端给不出基准哈希 → 拒绝放行并删除本地 tar', async () => {
  const projectId = 'PRJ_PULL_NOHASH';
  const dir = localDeliverDir(projectId);
  await assert.rejects(
    () => pullDeliverables(projectId),
    /REPORT_HASH_MISSING/,
    '没有远端基准时不许静默跳过比对',
  );
  assert.equal(fs.existsSync(path.join(dir, `${projectId}_Client_Delivery.tar.gz`)), false);
});

// ------------------------------------------------------------
// 3. 三端点契约（in-process 真服务 + 真 HTTP）
// ------------------------------------------------------------

async function api(pathname, options = {}) {
  return fetch(`${BASE}${pathname}`, { ...options, signal: AbortSignal.timeout(10000) });
}

test('POST /api/report/build：成功 → 200、files 形状正确、无绝对路径，且内联验收全绿发回执', async () => {
  const res = await api('/api/report/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'PRJ_TEST_OK' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  // 三大件 + 完整性三件（CHECKSUMS.sha256 / CHECKSUMS.sig / ED25519_PUBLIC_KEY.pem）
  const names = body.files.map((file) => file.name).sort();
  for (const required of [
    'Analysis_Report.md', 'Analysis_Report.html', 'PRJ_TEST_OK_Client_Delivery.tar.gz',
    'CHECKSUMS.sha256', 'CHECKSUMS.sig', 'ED25519_PUBLIC_KEY.pem',
  ]) {
    assert.ok(names.includes(required), `必须拉回 ${required}`);
  }
  assert.equal(body.files.length, 6);
  assert.equal(body.report_md_bytes, 1024);
  assert.equal(body.report_html_bytes, 2048);
  for (const file of body.files) {
    assert.ok(file.bytes > 0);
    assert.equal(file.path, file.name);
    assert.ok(!JSON.stringify(file).includes('/mnt/'), '响应里不许出现服务器绝对路径');
  }
  // 第二十轮 Q1：打包末尾内联验收是后置条件，200 必须带全绿哨兵与回执文件名
  assert.equal(body.acceptance.sentinel, 'DELIVERY_ACCEPTANCE_OK 四道关全绿');
  assert.equal(body.acceptance.receipt, 'PRJ_TEST_OK.receipt.json');
  assert.equal(body.acceptance.verified_count, 8, 'fixture 包受保护业务件 8 个');
  const receiptFile = path.join(process.env.BIO_DELIVERY_RECORDS_DIR, 'PRJ_TEST_OK.receipt.json');
  assert.ok(fs.existsSync(receiptFile), '回执必须落在 records 目录');
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  assert.equal(receipt.project_id, 'PRJ_TEST_OK');
  assert.equal(receipt.tar_sha256, sha256Hex(fs.readFileSync(path.join(localDeliverDir('PRJ_TEST_OK'), 'PRJ_TEST_OK_Client_Delivery.tar.gz'))),
    '回执哈希必须与本地当前包实时哈希相等');
  assert.equal(receipt.coverage_ok, true);
  assert.match(receipt.verifier_version, /delivery-acceptance-core/);
});

test('POST /api/report/build：引擎退出码非 0 → 500 且 error 透传 stderr 原文', async () => {
  const res = await api('/api/report/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'PRJ_TEST_FAIL' }),
  });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /ENGINE_STDERR: 步骤结果文件缺失/);
});

test('POST /api/report/build：远端项目目录不存在 → 400 且点名目录', async () => {
  const res = await api('/api/report/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'PRJ_TEST_MISSING' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /PRJ_TEST_MISSING/);
  assert.match(body.error, /不存在/);
});

test('POST /api/report/build：projectId 缺失或非法 → 400', async () => {
  const missing = await api('/api/report/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(missing.status, 400);
  const traversal = await api('/api/report/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: '../../etc' }),
  });
  assert.equal(traversal.status, 400);
});

test('GET /api/report/files：无本地交付的项目 → 200 + files:[]（不是 500）', async () => {
  const res = await api('/api/report/files?projectId=PRJ_NO_DELIVERABLES');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.files, []);
});

test('GET /api/report/files：projectId 缺失 → 400', async () => {
  const res = await api('/api/report/files');
  assert.equal(res.status, 400);
});

test('GET /api/report/download：合法文件且回执在 → 200 + 字节数正确', async () => {
  // 回执是上一个 build 用例内联验收写的：下载门禁不是拦「没构建过的」，是拦「没验收过的」
  const res = await api('/api/report/download?projectId=PRJ_TEST_OK&file=Analysis_Report.html');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/octet-stream/);
  const body = await res.arrayBuffer();
  assert.equal(body.byteLength, 2048);
});

test('GET /api/report/download：包已回搬但没走内联验收 → 409 ERR_DELIVERY_UNVERIFIED', async () => {
  // PRJ_PULL_OK 的三大件由 pullDeliverables 直接拉过（无 build 路由、无回执）：
  // 文件真实存在、名字合法，但下载必须被回执门禁拦下——这是 Q1 裁定的本体。
  assert.ok(fs.existsSync(path.join(localDeliverDir('PRJ_PULL_OK'), 'Analysis_Report.md')));
  const res = await api('/api/report/download?projectId=PRJ_PULL_OK&file=Analysis_Report.md');
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.code, 'ERR_DELIVERY_UNVERIFIED');
  assert.match(body.error, /回执|无验收回执/);
});

test('GET /api/report/download：回执在但包被替换 → 409 且点名哈希不一致', async () => {
  const dir = localDeliverDir('PRJ_TEST_OK');
  const tar = path.join(dir, 'PRJ_TEST_OK_Client_Delivery.tar.gz');
  const original = fs.readFileSync(tar);
  try {
    fs.writeFileSync(tar, Buffer.concat([original, Buffer.from('# swapped\n')]));
    const res = await api('/api/report/download?projectId=PRJ_TEST_OK&file=Analysis_Report.html');
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'ERR_DELIVERY_UNVERIFIED');
    assert.match(body.error, /回执哈希与当前 tar 不一致/);
  } finally {
    fs.writeFileSync(tar, original);
  }
});

test('GET /api/report/download：路径穿越与不在允许集合 → 400', async () => {
  const traversal = await api(
    `/api/report/download?projectId=PRJ_TEST_OK&file=${encodeURIComponent('../../server/domain.js')}`
  );
  assert.equal(traversal.status, 400);
  const outsideSet = await api('/api/report/download?projectId=PRJ_TEST_OK&file=notes.txt');
  assert.equal(outsideSet.status, 400);
});

test('POST /api/report/build：包内文件被篡改 → 500 DELIVERY_ACCEPTANCE_FAILED，第 3 关红，绝不发回执', async () => {
  // 传输层全绿（远端基准哈希与侧车都按篡改后的包给），红线必须落在内联验收：
  // 「打包成功」不等于「包可信」，验收红时 200 就是假交付。
  const res = await api('/api/report/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'PRJ_TEST_BADTAR' }),
  });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /DELIVERY_ACCEPTANCE_FAILED/);
  assert.match(body.error, /禁止交付/);
  const sigGate = body.acceptance.gates.find((g) => g.name === 'signature');
  assert.equal(sigGate.ok, false, '第 3 关（验签）必须红');
  assert.match(sigGate.detail, /hash_mismatch/);
  const receiptFile = path.join(process.env.BIO_DELIVERY_RECORDS_DIR, 'PRJ_TEST_BADTAR.receipt.json');
  assert.equal(fs.existsSync(receiptFile), false, '验收红时绝不写回执');
  // 下载同样被拦：没有回执就没有放行依据
  const dl = await api('/api/report/download?projectId=PRJ_TEST_BADTAR&file=Analysis_Report.md');
  assert.equal(dl.status, 409);
});

// ------------------------------------------------------------
// 4. 交付前置门禁接线（D4：docs/delivery_package_spec.md 第三节 3/5/6 条）
// ------------------------------------------------------------

test('POST /api/report/build：磁盘水位不足 → 409 且点名 storage、打包引擎未被调用', async () => {
  const res = await api('/api/report/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'PRJ_TEST_FULL' }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /前置门禁未通过/);
  assert.match(body.error, /storage/);
  assert.match(body.error, /剩余 5%/);
  assert.equal(body.preflight.checks.find((c) => c.name === 'storage').ok, false);
  assert.equal(buildRan('PRJ_TEST_FULL'), false, '门禁未过时不许白跑打包引擎');
});

test('POST /api/report/build：有失败台账 → 409 且点名 failed_ledger 与台账文件名', async () => {
  const res = await api('/api/report/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'PRJ_TEST_BADLEDGER' }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /failed_ledger/);
  assert.match(body.error, /2026-10-20_211500_PRJ_TEST_BADLEDGER_deg\.json/);
  assert.equal(body.preflight.failedLedgers.length, 1);
  assert.equal(buildRan('PRJ_TEST_BADLEDGER'), false, '有失败台账时不许白跑打包引擎');
});

test('POST /api/report/build：有进行中任务 → 409 且点名 running', async () => {
  const res = await api('/api/report/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'PRJ_TEST_RUNNING' }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /running/);
  assert.equal(buildRan('PRJ_TEST_RUNNING'), false);
});

test('POST /api/report/build：远端输出缺 END 标记 → 409 且点名 remote_output', async () => {
  const res = await api('/api/report/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'PRJ_TEST_TRUNC' }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /remote_output/);
  assert.equal(buildRan('PRJ_TEST_TRUNC'), false);
});

test('POST /api/report/build：门禁全过 → 200 且响应带 preflight 四道闸与 sha256 旁挂', async () => {
  const res = await api('/api/report/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'PRJ_TEST_OK' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.preflight.ok, true);
  assert.deepEqual(
    body.preflight.checks.map((c) => c.name),
    ['storage', 'running', 'failed_ledger', 'remote_output']
  );
  assert.equal(buildRan('PRJ_TEST_OK'), true, '门禁全过才应真的跑打包引擎');
  assert.ok(Array.isArray(body.sidecars), '响应必须带 sha256 旁挂清单');
  for (const item of body.sidecars) {
    assert.match(item.sha256, /^[0-9a-f]{64}$/);
    assert.equal(item.sidecar, `${item.name}.sha256`);
    const onDisk = fs.readFileSync(path.join(localDeliverDir('PRJ_TEST_OK'), item.sidecar), 'utf8');
    assert.equal(onDisk, `${item.sha256}  ${item.name}\n`);
  }
});

test('POST /api/report/build：force=true 放行失败台账（水位与运行中任务仍拦）', async () => {
  const res = await api('/api/report/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'PRJ_TEST_BADLEDGER', force: true }),
  });
  // 失败台账被放行后继续打包：本项目的打包垫片回 200，但三大件清单为空 → 回搬失败
  // 必须是"回搬阶段明确报错"，不能假成功；关键断言是它已经越过了门禁。
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.match(body.error, /Analysis_Report|三大件|缺失/);
  assert.equal(buildRan('PRJ_TEST_BADLEDGER'), true, 'force 后必须真的继续打包');
});

test('POST /api/report/build：force=true 也不放行磁盘水位不足', async () => {
  const res = await api('/api/report/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'PRJ_TEST_FULL', force: true }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /storage/);
});

