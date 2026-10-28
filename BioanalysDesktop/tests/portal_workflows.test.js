/**
 * 用户提交台（portal）GET /api/workflows 契约测试。
 *
 * 背景（2026-10-23 mod 化改造）：客户端的步骤勾选原先硬编码了一份旧步骤清单
 * （LINE_STEPS / STEP_META），与注册表 src/workflows.json 双份维护必然漂移。
 * 现在 portal 自己读注册表暴露只读端点，客户端改为消费它。
 *
 * 为什么 portal 自己读文件而不转发工作台：本服务与工作台彻底解耦是既有设计
 * （serve.mjs 文件头写明"不挂工作台任何 API"），注册表是静态文件，直读既不破坏
 * 解耦，也避免"工作台没起客户端就点不了步骤"。
 *
 * 范式沿用 portal_auth.test.js：spawn 真进程 + 临时端口 + 临时收件箱。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
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

async function startPortal() {
  const port = await freePort();
  const inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-wf-inbox-'));
  const child = spawn(process.execPath, [PORTAL], {
    env: { ...process.env, PORTAL_PORT: String(port), PORTAL_INBOX: inbox },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(800) });
      if (r.ok) return { child, base, inbox };
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  child.kill();
  throw new Error('portal 测试实例启动失败');
}

test('GET /api/workflows 返回三条系列与注册表一致', async (t) => {
  const { child, base, inbox } = await startPortal();
  t.after(() => { child.kill(); fs.rmSync(inbox, { recursive: true, force: true }); });

  const r = await fetch(`${base}/api/workflows`, { signal: AbortSignal.timeout(5000) });
  assert.equal(r.status, 200);
  const body = await r.json();

  assert.equal(body.series.length, 3, '应为 3 个系列');
  const ids = body.series.map((s) => s.id).sort();
  assert.deepEqual(ids, ['line1_bulk', 'line2_scrna', 'line3_spatial']);

  // 与注册表本体逐字段对齐：端点只是视图，不许有自己的数据
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  for (const s of reg.series) {
    const got = body.series.find((x) => x.id === s.id);
    assert.ok(got, `端点缺少系列 ${s.id}`);
    assert.equal(got.stages.length, s.stages.length, `${s.id} 阶段数不符`);
    const regMods = s.stages.flatMap((st) => st.mods);
    const gotMods = got.stages.flatMap((st) => st.mods);
    assert.equal(gotMods.length, regMods.length, `${s.id} mod 数不符`);
    for (const m of regMods) {
      const g = gotMods.find((x) => x.id === m.id);
      assert.ok(g, `${s.id} 缺少 mod ${m.id}`);
      assert.equal(g.name, m.name);
      assert.equal(g.est_minutes, m.est_minutes);
      // desc / tool 是 M1 补进注册表的字段，端点必须透传
      assert.ok(g.desc, `${m.id} 缺 desc`);
      assert.ok(g.tool, `${m.id} 缺 tool`);
    }
  }
});

test('阶段按 order 升序，必经阶段的非 optional mod 可被识别', async (t) => {
  const { child, base, inbox } = await startPortal();
  t.after(() => { child.kill(); fs.rmSync(inbox, { recursive: true, force: true }); });

  const body = await (await fetch(`${base}/api/workflows`, { signal: AbortSignal.timeout(5000) })).json();
  for (const s of body.series) {
    const orders = s.stages.map((st) => st.order);
    assert.deepEqual(orders, [...orders].sort((a, b) => a - b), `${s.id} 阶段未按 order 升序`);
  }

  const l2 = body.series.find((s) => s.id === 'line2_scrna');
  const required = l2.stages.filter((st) => st.required);
  assert.ok(required.length >= 4, 'line2 至少 4 个必经阶段');
  // 必经阶段里必须存在非 optional 的 mod，否则客户端没法默认勾选
  const mustCheck = required.flatMap((st) => st.mods).filter((m) => !m.optional);
  assert.ok(mustCheck.length >= 8, `必经非 optional mod 应 >= 8，实际 ${mustCheck.length}`);
  assert.ok(mustCheck.some((m) => m.id === 'l2_ingest_counts'));
});

test('ko_gene 标记与全局约束一致', async (t) => {
  const { child, base, inbox } = await startPortal();
  t.after(() => { child.kill(); fs.rmSync(inbox, { recursive: true, force: true }); });

  const body = await (await fetch(`${base}/api/workflows`, { signal: AbortSignal.timeout(5000) })).json();
  assert.ok(body.constraints, '应下发 constraints');
  assert.equal(typeof body.constraints.mem_quota_mb, 'number');
  assert.deepEqual([...body.constraints.ko_gene_required_mods].sort(),
    ['l2_ko_virtual', 'l3_ko_spatial']);

  // 每个 ko_gene=true 的 mod 都必须出现在约束清单里（否则客户端不知道要问靶基因）
  for (const s of body.series) {
    for (const st of s.stages) {
      for (const m of st.mods) {
        if (m.ko_gene) {
          assert.ok(body.constraints.ko_gene_required_mods.includes(m.id),
            `${m.id} 标了 ko_gene 但没进 ko_gene_required_mods`);
        }
      }
    }
  }
});

test('端点不泄漏依赖图内部结构（requires/produces 不透出）', async (t) => {
  const { child, base, inbox } = await startPortal();
  t.after(() => { child.kill(); fs.rmSync(inbox, { recursive: true, force: true }); });

  const body = await (await fetch(`${base}/api/workflows`, { signal: AbortSignal.timeout(5000) })).json();
  for (const s of body.series) {
    for (const st of s.stages) {
      for (const m of st.mods) {
        assert.equal(m.requires, undefined, `${m.id} 不应透出 requires`);
        assert.equal(m.produces, undefined, `${m.id} 不应透出 produces`);
        assert.equal(m.script, undefined, `${m.id} 不应透出母版名 script`);
      }
    }
  }
});

test('portal 其余端点不受影响（/health 与 404 行为保持）', async (t) => {
  const { child, base, inbox } = await startPortal();
  t.after(() => { child.kill(); fs.rmSync(inbox, { recursive: true, force: true }); });

  const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200);
  const hb = await health.json();
  assert.equal(hb.service, 'user-portal');

  const nf = await fetch(`${base}/api/no-such-endpoint`, { signal: AbortSignal.timeout(5000) });
  assert.equal(nf.status, 404);
});

test('客户端不得再硬编码旧 mod id（防漂移）', async () => {
  // 这是本测试的核心价值：注册表改名后，客户端如果还写着一份旧清单就会漂移。
  // 用「旧 id 不允许出现在 index.html」来钉住，改名时这里必须跟着红。
  const html = fs.readFileSync(path.join(REPO, 'portal', 'index.html'), 'utf8');
  const oldIds = ['scenic_tf', 'prep_matrix', 'ingest_counts', 'qc_cells', 'virtual_knockout',
    'spatial_knockout', 'dr_post_analysis', 'annotate_celltypes', 'integrate_harmony'];
  const hits = [];
  for (const id of oldIds) {
    // 只查作为标识符出现的形态（引号包裹或数组元素），避免误伤中文文案
    const re = new RegExp(`['"\`\\[]\\s*${id}\\s*['"\`\\],]`);
    if (re.test(html)) hits.push(id);
  }
  assert.deepEqual(hits, [], `portal/index.html 仍硬编码旧 mod id: ${hits.join(', ')}`);
  assert.ok(/\/api\/workflows/.test(html), '客户端应改为请求 /api/workflows');
});
