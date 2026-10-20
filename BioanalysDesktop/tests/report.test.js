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

// 环境变量必须在 import 服务端模块之前设好（report.js / index.js 在模块加载时读）
const LOCAL_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 's27-report-root-'));
process.env.BIO_LOCAL_DELIVERABLES = LOCAL_ROOT;

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
function dispatchSpawn(program, args) {
  if (program === 'ssh') {
    const remoteCmd = args[args.length - 1];
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
    if (remoteCmd.includes("-printf '%P|%s")) {
      if (remoteCmd.includes('PRJ_TEST_OK') || remoteCmd.includes('PRJ_PULL_OK')) {
        // 照 K40 实测布局：报告嵌在 <pid>_Client_Delivery/03_Interpretation_Report/ 下，
        // tar.gz 在 deliverables 根
        return fakeChild({
          exitCode: 0,
          stdoutText: 'PRJ_TEST_OK_Client_Delivery/01_Adapted_Scripts/run.sh|512\n'
            + 'PRJ_TEST_OK_Client_Delivery/03_Interpretation_Report/Analysis_Report.md|1024\n'
            + 'PRJ_TEST_OK_Client_Delivery/03_Interpretation_Report/Analysis_Report.html|2048\n'
            + 'PRJ_TEST_OK_Client_Delivery/delivery_manifest.json|256\n'
            + 'PRJ_TEST_OK_Client_Delivery.tar.gz|4096\n',
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
    const bytes = fixtureBytes(name);
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
  assert.ok(command.startsWith('cd /mnt/ssd/bio_data && python3 ops/build_client_report.py'));
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

// ------------------------------------------------------------
// 3. 三端点契约（in-process 真服务 + 真 HTTP）
// ------------------------------------------------------------

async function api(pathname, options = {}) {
  return fetch(`${BASE}${pathname}`, { ...options, signal: AbortSignal.timeout(10000) });
}

test('POST /api/report/build：成功 → 200 且 files 形状正确、无绝对路径', async () => {
  const res = await api('/api/report/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'PRJ_TEST_OK' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.files.length, 3);
  assert.equal(body.report_md_bytes, 1024);
  assert.equal(body.report_html_bytes, 2048);
  for (const file of body.files) {
    assert.ok(file.bytes > 0);
    assert.equal(file.path, file.name);
    assert.ok(!JSON.stringify(file).includes('/mnt/'), '响应里不许出现服务器绝对路径');
  }
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

test('GET /api/report/download：合法文件 → 200 + 字节数正确', async () => {
  const res = await api('/api/report/download?projectId=PRJ_TEST_OK&file=Analysis_Report.html');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/octet-stream/);
  const body = await res.arrayBuffer();
  assert.equal(body.byteLength, 2048);
});

test('GET /api/report/download：路径穿越与不在允许集合 → 400', async () => {
  const traversal = await api(
    `/api/report/download?projectId=PRJ_TEST_OK&file=${encodeURIComponent('../../server/domain.js')}`
  );
  assert.equal(traversal.status, 400);
  const outsideSet = await api('/api/report/download?projectId=PRJ_TEST_OK&file=notes.txt');
  assert.equal(outsideSet.status, 400);
});
