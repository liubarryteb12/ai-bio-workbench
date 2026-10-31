/**
 * 对账守卫：portal 与工作台的组合预检必须逐条同结论。
 *
 * 背景（2026-10-23 M2.4）：客户在 portal 勾选步骤，工作台也有一份 resolvePlan。
 * 两边各写一份是为了保住 portal「不依赖工作台」的独立性，但规则必须一致——
 * 否则客户在 portal 看到"合法"、到工作台建项却被拒，是最难排查的一类问题。
 *
 * 本测试同时起两个服务，用同一批用例打两边的 /api/workflows/resolve，
 * 逐条比对 status / errors / ordered / estMinutes / peakMemMb 五项。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKBENCH = path.join(REPO, 'BioanalysDesktop', 'server', 'index.js');
const PORTAL = path.join(REPO, 'portal', 'serve.mjs');
const REGISTRY = path.join(REPO, 'src', 'workflows.json');

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

/**
 * 等服务起来。
 * healthPath 必须按服务传：工作台是 /api/health，portal 是 /health
 * （2026-10-23 踩坑：拿 /api/health 探 portal 会一直拿到 404，误判成"起不来"）。
 */
async function waitUp(base, child, healthPath = '/api/health', timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const r = await fetch(`${base}${healthPath}`, { signal: AbortSignal.timeout(800) });
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/** 从注册表生成对账用例：每条线的全链 / 最小必经 / 跨线 / 缺必经。 */
function buildCases() {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const cases = [];
  for (const s of reg.series) {
    const all = [];
    s.stages.forEach((st) => st.mods.forEach((m) => all.push(m.id)));
    const min = [];
    s.stages.forEach((st) => {
      if (!st.required) return;
      st.mods.forEach((m) => { if (!m.optional) min.push(m.id); });
    });
    cases.push({ name: `${s.id} 全链`, seriesId: s.id, modIds: all, koGene: 'TNF' });
    cases.push({ name: `${s.id} 最小必经`, seriesId: s.id, modIds: min });
    cases.push({ name: `${s.id} 跨线选中`, seriesId: s.id, modIds: min.concat(['l2_ko_virtual']) });
    cases.push({ name: `${s.id} 缺必经`, seriesId: s.id, modIds: [min[0]] });
  }
  return cases;
}

test('portal 与工作台的 resolve 结论逐条一致', async (t) => {
  const wbPort = await freePort();
  const portalPort = await freePort();
  const inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-inbox-'));

  const wb = spawn(process.execPath, [WORKBENCH], {
    env: { ...process.env, BAD_PORT: String(wbPort) }, stdio: 'ignore',
  });
  const portal = spawn(process.execPath, [PORTAL], {
    env: { ...process.env, PORTAL_PORT: String(portalPort), PORTAL_INBOX: inbox },
    stdio: 'ignore',
  });
  t.after(() => {
    wb.kill();
    portal.kill();
    fs.rmSync(inbox, { recursive: true, force: true });
  });

  const wbBase = `http://127.0.0.1:${wbPort}`;
  const portalBase = `http://127.0.0.1:${portalPort}`;
  assert.ok(await waitUp(wbBase, wb, '/api/health'), '工作台测试实例未起来');
  assert.ok(await waitUp(portalBase, portal, '/health'), 'portal 测试实例未起来');

  const cases = buildCases();
  assert.ok(cases.length >= 12, `对账用例应 >= 12，实际 ${cases.length}`);

  const resolveOn = async (base, c) => {
    const r = await fetch(`${base}/api/workflows/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seriesId: c.seriesId, modIds: c.modIds, koGene: c.koGene || '' }),
      signal: AbortSignal.timeout(15000),
    });
    return { status: r.status, body: await r.json() };
  };

  const diffs = [];
  for (const c of cases) {
    const p = await resolveOn(portalBase, c);
    const w = await resolveOn(wbBase, c);
    const problems = [];
    if (p.status !== w.status) problems.push(`status ${p.status} vs ${w.status}`);
    if (JSON.stringify(p.body.errors) !== JSON.stringify(w.body.errors)) {
      problems.push(`errors ${JSON.stringify(p.body.errors)} vs ${JSON.stringify(w.body.errors)}`);
    }
    if (JSON.stringify(p.body.ordered) !== JSON.stringify(w.body.ordered)) {
      problems.push('ordered 不一致');
    }
    if (p.body.estMinutes !== w.body.estMinutes) {
      problems.push(`estMinutes ${p.body.estMinutes} vs ${w.body.estMinutes}`);
    }
    if (p.body.peakMemMb !== w.body.peakMemMb) {
      problems.push(`peakMemMb ${p.body.peakMemMb} vs ${w.body.peakMemMb}`);
    }
    if (problems.length) diffs.push(`${c.name}: ${problems.join('; ')}`);
  }

  assert.deepEqual(diffs, [], `两端 resolve 结论分叉：\n${diffs.join('\n')}`);
});

test('静态守卫：portal 必须自带 resolve 实现（不得转发工作台）', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(PORTAL, 'utf8');
  assert.match(src, /function resolveLocally\(/, 'portal 必须本地实现 resolve');
  assert.match(src, /api\/workflows\/resolve/, '必须暴露 /api/workflows/resolve');
  // 解耦红线：不得出现转发到工作台端口的代码
  assert.ok(!/127\.0\.0\.1:(18787|8791)/.test(src),
    'portal 不得硬编码工作台端口转发（解耦设计）');
  // 索引 key 必须带 series 前缀（三条线有同名母版）
  assert.match(src, /index\.set\(`\$\{s\.id\}:\$\{m\.id\}`/, '本地索引 key 必须带 series 前缀');
});
