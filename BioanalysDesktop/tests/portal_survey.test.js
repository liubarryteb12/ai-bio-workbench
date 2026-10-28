/**
 * 模式 A 调研三件套的契约测试：需求页、结果页、两个 API。
 *
 * 测试自带服务生命周期（spawn 本仓库的 portal/serve.mjs），
 * 不依赖"某人已经起好了服务"。这是 handoff 里记过的假绿教训：
 * 连外部已启动实例的用例，改坏代码也会全绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVE = path.join(ROOT, 'portal', 'serve.mjs');

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

/** 起一个独立 portal 实例，收件箱指到临时目录，避免污染真实 inbox。 */
async function startPortal() {
  const inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'survey-test-'));
  const port = await freePort();
  const child = spawn(process.execPath, [SERVE], {
    cwd: ROOT,
    env: { ...process.env, PORTAL_PORT: String(port), PORTAL_INBOX: inbox },
    stdio: 'ignore',
  });
  return { child, port, inbox, base: `http://127.0.0.1:${port}` };
}

async function waitHealthy(base, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function stopPortal(ctx) {
  try { ctx.child.kill(); } catch { /* 已退出 */ }
  try { fs.rmSync(ctx.inbox, { recursive: true, force: true }); } catch { /* 忽略 */ }
}

test('需求页与结果页都能打开', async () => {
  const ctx = await startPortal();
  try {
    assert.equal(await waitHealthy(ctx.base), true, 'portal 应能起来');
    const a = await fetch(`${ctx.base}/survey_request.html`);
    assert.equal(a.status, 200);
    assert.match(await a.text(), /课题调研需求/);
    const b = await fetch(`${ctx.base}/survey_result.html`);
    assert.equal(b.status, 200);
    assert.match(await b.text(), /调研结果/);
  } finally { stopPortal(ctx); }
});

test('提交合法需求返回 ticket 并落盘', async () => {
  const ctx = await startPortal();
  try {
    assert.equal(await waitHealthy(ctx.base), true);
    const r = await fetch(`${ctx.base}/api/survey/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        disease: 'idiopathic pulmonary fibrosis',
        interest: 'fibroblast activation',
        organism: 'any',
        tissue: 'lung',
        data_kinds: ['bulk', 'scrna'],
        clue: '',
      }),
    });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.match(j.ticket_id, /^TSV-\d{8}-[0-9a-f]{8}$/);

    const file = path.join(ctx.inbox, `${j.ticket_id}.json`);
    assert.equal(fs.existsSync(file), true, '需求单应落盘');
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(rec.status, 'pending');
    assert.equal(rec.request.disease, 'idiopathic pulmonary fibrosis');
    assert.deepEqual(rec.request.data_kinds, ['bulk', 'scrna']);
  } finally { stopPortal(ctx); }
});

test('缺疾病名与空数据类型都被拒（422）', async () => {
  const ctx = await startPortal();
  try {
    assert.equal(await waitHealthy(ctx.base), true);
    const noDisease = await fetch(`${ctx.base}/api/survey/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_kinds: ['bulk'] }),
    });
    assert.equal(noDisease.status, 422);

    const noKinds = await fetch(`${ctx.base}/api/survey/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disease: 'ipf', data_kinds: [] }),
    });
    assert.equal(noKinds.status, 422);
  } finally { stopPortal(ctx); }
});

test('肿瘤词命中权威黑名单时被拦（422）', async () => {
  const ctx = await startPortal();
  try {
    assert.equal(await waitHealthy(ctx.base), true);
    const r = await fetch(`${ctx.base}/api/survey/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disease: 'lung adenocarcinoma', data_kinds: ['bulk'] }),
    });
    assert.equal(r.status, 422);
    const j = await r.json();
    assert.ok(j.matched && j.matched.length > 0, '应回带命中词');
  } finally { stopPortal(ctx); }
});

test('结果读取与课题选择闭环', async () => {
  const ctx = await startPortal();
  try {
    assert.equal(await waitHealthy(ctx.base), true);
    const sub = await fetch(`${ctx.base}/api/survey/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disease: 'ipf', data_kinds: ['bulk'] }),
    });
    const { ticket_id: tid } = await sub.json();

    const read = await fetch(`${ctx.base}/api/survey/result?ticket=${tid}`);
    assert.equal(read.status, 200);
    const rec = await read.json();
    assert.equal(rec.status, 'pending');

    const sel = await fetch(`${ctx.base}/api/survey/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_id: tid, topic_ids: ['T1', 'T7'] }),
    });
    assert.equal(sel.status, 200);
    const selBody = await sel.json();
    assert.deepEqual(selBody.selected, ['T1', 'T7']);

    const after = await (await fetch(`${ctx.base}/api/survey/result?ticket=${tid}`)).json();
    assert.equal(after.status, 'selected');
    assert.deepEqual(after.selection.topic_ids, ['T1', 'T7']);
  } finally { stopPortal(ctx); }
});

test('非法 ticket 与不存在的 ticket 分别返回 400 / 404', async () => {
  const ctx = await startPortal();
  try {
    assert.equal(await waitHealthy(ctx.base), true);
    const bad = await fetch(`${ctx.base}/api/survey/result?ticket=../../etc/passwd`);
    assert.equal(bad.status, 400);
    const missing = await fetch(`${ctx.base}/api/survey/result?ticket=TSV-20260101-deadbeef`);
    assert.equal(missing.status, 404);
  } finally { stopPortal(ctx); }
});

test('课题 id 只接受 T1 到 T9，其余被过滤', async () => {
  const ctx = await startPortal();
  try {
    assert.equal(await waitHealthy(ctx.base), true);
    const sub = await fetch(`${ctx.base}/api/survey/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disease: 'ipf', data_kinds: ['bulk'] }),
    });
    const { ticket_id: tid } = await sub.json();

    const sel = await fetch(`${ctx.base}/api/survey/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_id: tid, topic_ids: ['T1', 'X9', '../../x'] }),
    });
    assert.equal(sel.status, 200);
    assert.deepEqual((await sel.json()).selected, ['T1']);

    const none = await fetch(`${ctx.base}/api/survey/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_id: tid, topic_ids: ['nope'] }),
    });
    assert.equal(none.status, 422);
  } finally { stopPortal(ctx); }
});
