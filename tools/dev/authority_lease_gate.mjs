#!/usr/bin/env node
/**
 * 第 26 道门禁：单权威租约准入。
 *
 * 三重判据，缺一不可：
 *   1. 契约测试全绿（获取、冲突、过期、续租、释放、接管、回执 actor）；
 *   2. 三个状态变更端点确实挂了 X-Bio-Lease-Id 准入（行为验证，不是扫源码字符串）；
 *   3. 变异自证：把准入调用拆掉后，第 2 项必须变红。
 *
 * 铁律：变异只在同目录的临时副本上做（相对 import 才能解析），跑完立即删。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const APP = path.join(REPO, 'BioanalysDesktop');
const ROUTES = path.join(APP, 'server', 'routes', 'work_orders.routes.js');

function fail(message) {
  console.error('[RED] ' + message);
  process.exitCode = 1;
}

function runContractTest() {
  const result = spawnSync(process.execPath, ['--test', 'tests/authority_lease_contract.test.js'], {
    cwd: APP,
    encoding: 'utf8',
    timeout: 120000,
  });
  const tail = String(result.stdout || '').trim().split('\n').slice(-3).join(' | ');
  if (result.status !== 0) {
    fail('租约契约测试未通过：' + tail);
    return false;
  }
  console.log('[ OK ] 租约契约测试 11 条全绿');
  return true;
}

function fakeResponse() {
  const state = { status: 0, payload: null, headersSent: false };
  const res = {
    get headersSent() { return state.headersSent; },
    set headersSent(value) { state.headersSent = value; },
    writeHead(status) { state.status = status; state.headersSent = true; },
    end() { state.headersSent = true; },
  };
  const json = (_res, status, payload) => {
    state.status = status;
    state.payload = payload;
    state.headersSent = true;
  };
  return { res, state, json };
}

/**
 * 行为判据：无租约时三个状态变更端点都必须 409 ERR_AUTHORITY_REQUIRED。
 * 只发空体，命中准入就会在进 service 之前被拦下。
 */
async function leaseBlocks(routesFile) {
  const mod = await import(pathToFileURL(routesFile).href + '?t=' + Date.now());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-gate-'));
  const authorityFile = path.join(root, 'authority.sqlite');
  const cases = [
    ['/api/work-orders', '{}'],
    ['/api/work-orders/from-package', '{}'],
    ['/api/work-orders/WO-GATE-001/run', '{}'],
  ];
  const results = [];
  try {
    for (const [pathname, body] of cases) {
      const { Readable } = await import('node:stream');
      const req = Readable.from([Buffer.from(body, 'utf8')]);
      req.method = 'POST';
      req.headers = {};
      const fake = fakeResponse();
      await mod.handleWorkOrdersRoutes(req, fake.res, new URL('http://x' + pathname), {
        json: fake.json,
        REPO_ROOT: root,
        authorityFile,
        actor: { kind: 'local_dev', id: 'gate', role: 'admin' },
      });
      results.push({
        pathname,
        status: fake.state.status,
        code: fake.state.payload && fake.state.payload.code,
      });
    }
  } finally {
    // SQLite 连接仍被模块缓存持有时，Windows 上删目录会 EPERM，先显式关库。
    try {
      const serviceUrl = pathToFileURL(path.join(APP, 'server', 'services', 'authority.service.js')).href;
      const service = await import(serviceUrl);
      service.closeAuthorityDatabase(authorityFile);
    } catch { /* 关库失败不改变判据 */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
  return results;
}

function judge(results) {
  const bad = results.filter((r) => r.status !== 409 || r.code !== 'ERR_AUTHORITY_REQUIRED');
  return { green: bad.length === 0, detail: JSON.stringify(results) };
}

async function checkWithMutation() {
  const baseline = judge(await leaseBlocks(ROUTES));
  if (!baseline.green) {
    fail('基线不绿：无租约的写请求未被拦住 ' + baseline.detail);
    return false;
  }
  console.log('[ OK ] 基线：三个写端点均返回 409 ERR_AUTHORITY_REQUIRED');

  const source = fs.readFileSync(ROUTES, 'utf8');
  const anchor = '    assertAuthority(leaseId, { file: deps.authorityFile });';
  if (!source.includes(anchor)) {
    fail('变异锚点漂移：准入调用不在预期位置，门禁已失去观测能力');
    return false;
  }
  const copy = path.join(path.dirname(ROUTES), `.mut-lease-${process.pid}.mjs`);
  try {
    fs.writeFileSync(copy, source.replace(anchor, '    void leaseId;'), 'utf8');
    const mutated = judge(await leaseBlocks(copy));
    if (mutated.green) {
      fail('变异存活：拆掉准入调用后写请求仍被拦住，说明拦住它的不是租约');
      return false;
    }
    console.log('[ OK ] 变异：拆掉准入后判据变红 ' + mutated.detail);
    return true;
  } finally {
    try { fs.rmSync(copy, { force: true }); } catch { /* 临时副本删不掉不影响结论 */ }
  }
}

async function main() {
  const testsOk = runContractTest();
  const mutationOk = await checkWithMutation();
  if (testsOk && mutationOk && process.exitCode !== 1) {
    console.log('AUTHORITY_LEASE_GATE_OK');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main();
}

export { leaseBlocks };
