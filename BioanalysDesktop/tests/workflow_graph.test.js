/**
 * 回归守卫：mod 注册表（src/workflows.json）+ 组合判定（server/workflow_graph.js）。
 *
 * 背景（2026-10-23 用户拍板 mod 化改造）：
 * 客户端、服务台、取证 runner 三方共读同一份依赖图，否则依赖关系三处漂移。
 * mod 命名规则（用户 2026-10-23 裁定）：**系列 + 工序 + 功能名**，
 * 形如 `l2_tf_scenic` / `l1_ingest_prep`，防三条线同名 mod 撞车。
 * 磁盘母版与远端 bin/ 仍用原名，注册表用 `script` 字段承接，两边不得混。
 *
 * 本测试钉住六件事：
 *   1. 注册表自洽：无悬空依赖、无跨线泄漏、母版齐全、命名合规；
 *   2. 三条线隔离：跨线选中必须被拒，且报错要说清「属于哪条线」；
 *   3. 必经约束：必经 stage 的非 optional mod 必须全选；optional 可跳过；
 *   4. 同名 mod 不串线：索引 key 必须带 series 前缀；
 *   5. mod id 与母版名的双向映射可用（runner 靠它对齐）；
 *   6. 拓扑排序与成本预估正确。
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  loadWorkflows, validateRegistry, resolvePlan, indexMods, indexProducers, describeSeries,
} from '../server/workflow_graph.js';

/** line2 必经主干（新命名）。 */
const L2_MIN = [
  'l2_ingest_counts', 'l2_qc_cells', 'l2_qc_normalize',
  'l2_integrate_harmony', 'l2_integrate_cluster', 'l2_integrate_annotate',
  'l2_profile_composition', 'l2_profile_deg',
];

function allModIds(seriesId) {
  const out = [];
  loadWorkflows().series.find((s) => s.id === seriesId)
    .stages.forEach((st) => st.mods.forEach((m) => out.push(m.id)));
  return out;
}

test('注册表自洽：无悬空依赖、无跨线泄漏、母版齐全', () => {
  const r = validateRegistry();
  assert.ok(r.errors.length === 0, `注册表有 ${r.errors.length} 处错误：\n${r.errors.join('\n')}`);
  assert.equal(r.stats.series, 3, '应为 3 个系列');
  assert.ok(r.stats.mods >= 50, `mod 数应 >= 50，实际 ${r.stats.mods}`);
});

test('JSON 注册表显式声明为当前架构的 module manifest', () => {
  const wf = loadWorkflows();
  assert.equal(wf.manifest_version, 2);
  assert.equal(wf.manifest_kind, 'workspace_module_registry');
  for (const series of wf.series) {
    for (const stage of series.stages) {
      for (const mod of stage.mods) {
        assert.ok(
          Array.isArray(mod.produces) && mod.produces.length > 0,
          `${series.id}/${mod.id}: manifest 缺 produces`,
        );
      }
    }
  }
});

test('mod 命名规则：<系列>_<工序>_<功能名>，且 script 承接母版原名', () => {
  const wf = loadWorkflows();
  const seen = new Set();
  for (const s of wf.series) {
    const prefix = `l${s.id.replace(/\D/g, '')}_`;
    for (const st of s.stages) {
      for (const m of st.mods) {
        const where = `${s.id}/${st.id}/${m.id}`;
        // 前缀必须与系列号一致（这是防三条线同名撞车的关键）
        assert.ok(m.id.startsWith(prefix), `${where}: id 必须以 ${prefix} 开头`);
        assert.match(m.id, /^l\d_[a-z][a-z0-9_]*$/, `${where}: id 须为小写下划线命名`);
        // 全局唯一
        assert.ok(!seen.has(m.id), `${where}: mod id 全局重复`);
        seen.add(m.id);
        // script 必须显式，且不得与 id 相同（相同说明忘了建映射）
        assert.ok(m.script, `${where}: 缺 script 字段（母版文件名）`);
        assert.notEqual(m.script, m.id,
          `${where}: script 不得与 id 相同，母版名应保持磁盘原名`);
      }
    }
  }
  // 母版名允许跨线同名（磁盘上分属不同目录），但 mod id 不允许
  const scripts = [];
  wf.series.forEach((s) => s.stages.forEach((st) => st.mods.forEach((m) => scripts.push(m.script))));
  assert.ok(scripts.length > new Set(scripts).size,
    '母版本名跨线同名是正常现状（分属不同目录），此断言防的是把 script 也改成唯一');
});

test('三条线 id 与 aims 铁律二一致（虚拟敲除不是第四条线）', () => {
  const ids = loadWorkflows().series.map((s) => s.id).sort();
  assert.deepEqual(ids, ['line1_bulk', 'line2_scrna', 'line3_spatial']);
  const koMods = [];
  for (const s of loadWorkflows().series) {
    for (const st of s.stages) {
      for (const m of st.mods) if (m.ko_gene) koMods.push(`${s.id}/${m.id}`);
    }
  }
  assert.deepEqual(koMods.sort(), ['line2_scrna/l2_ko_virtual', 'line3_spatial/l3_ko_spatial']);
  assert.deepEqual(loadWorkflows().constraints.ko_gene_required_mods.sort(),
    ['l2_ko_virtual', 'l3_ko_spatial']);
});

test('同名 mod 不串线：索引 key 必须带 series 前缀', () => {
  const idx = indexMods();
  // 母版本名跨线存在，mod id 则各自带前缀
  for (const name of ['normalize_hvg', 'enrichment', 'enrichment_figures', 'dr_post_analysis']) {
    const l2 = idx.get(`line2_scrna:l2_${name === 'normalize_hvg' ? 'qc_normalize' : name}`);
    void l2;
  }
  const l2n = idx.get('line2_scrna:l2_qc_normalize');
  const l3n = idx.get('line3_spatial:l3_qc_normalize');
  assert.ok(l2n && l3n, '两条线的 normalize 都应可索引');
  assert.equal(l2n.mod.script, 'normalize_hvg');
  assert.equal(l3n.mod.script, 'normalize_hvg');
  assert.notEqual(l2n.mod.produces.join(), l3n.mod.produces.join(),
    '两条线同名母版的产物应不同（物种后缀区分）');
  // 产物索引 key 也必须带前缀，否则 line2 的产物会被 line3 冒名
  const producers = indexProducers();
  for (const key of producers.get('norm_report.txt') || []) {
    assert.match(key, /^line\d_\w+:/, `产物索引 key 应带 series 前缀，实际 ${key}`);
  }
});

test('line2 全链组合通过且拓扑有序', () => {
  const r = resolvePlan('line2_scrna', allModIds('line2_scrna'), { koGene: 'TNF' });
  assert.ok(r.ok, `全链应通过：\n${r.errors.join('\n')}`);
  assert.equal(r.ordered.length, 22);
  assert.equal(r.ordered[0], 'l2_ingest_counts');
  assert.ok(r.ordered.indexOf('l2_integrate_annotate') < r.ordered.indexOf('l2_ko_virtual'));
  assert.ok(r.ordered.indexOf('l2_profile_deg') < r.ordered.indexOf('l2_branches_enrich'));
  assert.ok(r.ordered.indexOf('l2_tf_scenic') < r.ordered.indexOf('l2_tf_scenic_fig'));
  assert.ok(r.peakMemMb <= loadWorkflows().constraints.mem_quota_mb,
    `峰值 ${r.peakMemMb}MB 超配额`);
});

test('line2 最小组合通过，optional mod 可跳过', () => {
  const r = resolvePlan('line2_scrna', L2_MIN);
  assert.ok(r.ok, `最小组合应通过：\n${r.errors.join('\n')}`);
  assert.equal(r.ordered.length, 8);
  assert.ok(!r.ordered.includes('l2_profile_subcluster'), 'subcluster 标了 optional 应可跳过');
});

test('跨线选中必须被拒，且报错点名属于哪条线', () => {
  const r = resolvePlan('line2_scrna', L2_MIN.concat(['l3_ko_spatial']));
  assert.ok(!r.ok, '跨线选中必须被拒');
  assert.ok(r.errors.some((e) => /跨线选中.*line3_spatial/.test(e)),
    `报错应点名 line3_spatial，实际：${r.errors.join(' | ')}`);
});

test('缺必经 mod 必须被拒', () => {
  const r = resolvePlan('line2_scrna', ['l2_profile_deg']);
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => /必经阶段 ingest 缺少 mod 'l2_ingest_counts'/.test(e)),
    `应报缺 l2_ingest_counts，实际：${r.errors.join(' | ')}`);
});

test('敲除 mod 不给靶基因必须被拒', () => {
  const noGene = resolvePlan('line2_scrna', L2_MIN.concat(['l2_ko_virtual']));
  assert.ok(!noGene.ok, '不给靶基因必须被拒');
  assert.ok(noGene.errors.some((e) => /需要靶基因/.test(e)));
  const withGene = resolvePlan('line2_scrna', L2_MIN.concat(['l2_ko_virtual']), { koGene: 'TNF' });
  assert.ok(withGene.ok, `给了靶基因应通过：\n${withGene.errors.join('\n')}`);
});

test('未知 mod 与未知系列都要被拒', () => {
  const bad = resolvePlan('line2_scrna', ['l2_ingest_counts', 'not_a_real_mod']);
  assert.ok(!bad.ok);
  assert.ok(bad.errors.some((e) => /未知 mod 'not_a_real_mod'/.test(e)));
  const badSeries = resolvePlan('line9_nope', ['l2_ingest_counts']);
  assert.ok(!badSeries.ok);
  assert.ok(badSeries.errors.some((e) => /未知系列/.test(e)));
});

test('line1 / line3 全链各自通过', () => {
  for (const sid of ['line1_bulk', 'line3_spatial']) {
    const r = resolvePlan(sid, allModIds(sid), sid === 'line3_spatial' ? { koGene: 'Spp1' } : {});
    assert.ok(r.ok, `${sid} 全链应通过：\n${r.errors.join('\n')}`);
    assert.equal(r.ordered.length, allModIds(sid).length);
  }
});

test('describeSeries 输出客户端可用的结构（含 script）', () => {
  const d = describeSeries('line2_scrna');
  assert.ok(d, 'line2 应可描述');
  assert.equal(d.id, 'line2_scrna');
  assert.ok(d.stages.length >= 6);
  const orders = d.stages.map((s) => s.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  for (const st of d.stages) {
    for (const m of st.mods) {
      assert.ok(typeof m.est_minutes === 'number', `${m.id} 缺 est_minutes`);
      assert.ok(typeof m.peak_mem_mb === 'number', `${m.id} 缺 peak_mem_mb`);
      assert.ok(m.script, `${m.id} 缺 script`);
    }
  }
});

test('runner 的 mod id -> 母版名映射可用', async () => {
  const { modScriptIndex, modIdIndex } = await import('../../cn_debug/lib/chain_runner.mjs');
  const fwd = modScriptIndex();
  const rev = modIdIndex();
  assert.equal(fwd.size, 54, '应有 54 个 mod');
  // 抽查三个系列各一个
  assert.equal(fwd.get('l2_tf_scenic'), 'scenic_tf');
  assert.equal(fwd.get('l1_ingest_prep'), 'prep_matrix');
  assert.equal(fwd.get('l3_ko_spatial'), 'spatial_knockout');
  assert.equal(rev.get('scenic_tf'), 'l2_tf_scenic');
});
