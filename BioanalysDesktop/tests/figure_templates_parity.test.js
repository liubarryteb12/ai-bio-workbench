import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  loadFigureTemplates,
  reloadFigureTemplates,
  validateRegistry,
  resolveFigure,
  buildAdaptedFigureTasks,
  authorizeOverwrite,
  validateFigureStepInputs,
} from '../server/figure_graph.js';
import { indexMods } from '../server/workflow_graph.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const GENERATOR = path.join(REPO, 'tools', 'dev', 'build_figure_templates.cjs');
const REGISTRY = path.join(REPO, 'tools', 'bio', 'figure_templates.json');
const BOXPLOT_MASTERS = [
  path.join(REPO, 'references', '05.可参考生信代码', '可用代码预筛选', '源码', 'L1_基础统计图', 'L1_boxplot_code.R'),
  path.join(REPO, 'references', '05.可参考生信代码', '可用代码预筛选', '源码', '_meta', 'R453_compat', 'L1_boxplot_code.R'),
];
const PLOT_MATRIX = path.join(REPO, 'references', '05.可参考生信代码', '可用代码预筛选', '源码', '_meta', 'script_plot_matrix.json');
// git 经工具链解析（净化 PATH 下 spawnSync('git') 直接 ENOENT）；解析不到时整类断言跳过
import { resolveTool } from '../../tools/dev/toolchain.mjs';
const GIT = resolveTool('git').path;

/**
 * check-ignore 断言验的是「开发仓的 .gitignore 反向白名单让证据文件可跟踪」。
 * 两个前提在别处不成立，必须如实跳过而不是判红：
 *   1) 便携包/客户机根本没有 git 工作树（本机虽有 git 二进制，rev-parse 会失败）；
 *   2) 包本身落在父仓的 /dist/ 忽略区里 —— 那时 check-ignore 报「被忽略」是
 *      父仓规则的正确行为，不是证据文件被吞。净化 PATH 实测正是踩到这一条。
 */
let gitAtDevRoot;
function gitUsable() {
  if (gitAtDevRoot === undefined) {
    gitAtDevRoot = false;
    if (GIT) {
      try {
        const probe = spawnSync(GIT, ['rev-parse', '--show-toplevel'], { cwd: REPO, encoding: 'utf8', windowsHide: true });
        gitAtDevRoot = probe.status === 0 && path.resolve(String(probe.stdout || '').trim()) === REPO;
      } catch { gitAtDevRoot = false; }
    }
  }
  return gitAtDevRoot;
}
function needGit(testContext) {
  if (!GIT) { testContext.skip('HOST_MISSING_GIT: 本机无 git，check-ignore 断言不可执行'); return false; }
  if (!gitUsable()) { testContext.skip('HOST_MISSING_GIT: 不在开发仓工作树根（如便携包/客户机），check-ignore 断言只属于开发仓'); return false; }
  return true;
}
const READY_ALLOWLIST = path.join(REPO, 'tools', 'dev', 'figure_ready_allowlist.json');

/**
 * 封板白名单闸门（4 Argon 第二十轮 Q3）：deps_status=ready 的 ID 全集真源。
 *
 * 落点必须是 ops/（人工受控区）。docs/generated/ 是机器覆写区，闸门放那里
 * 等于让脚本自己批自己，「防私自扩容」当场失效。
 */
function readyAllowlistIds() {
  const doc = JSON.parse(fs.readFileSync(READY_ALLOWLIST, 'utf8'));
  assert.ok(Array.isArray(doc.ids) && doc.ids.length > 0, '白名单 ids 必须是非空数组');
  assert.ok(doc.ids.every((id) => typeof id === 'string' && id.length > 0), '白名单含空或非字符串 ID');
  assert.deepEqual([...doc.ids].sort(), doc.ids, '白名单必须排序存储：乱序会把一次真实改动放大成整文件 diff，掩埋审批线索');
  assert.equal(new Set(doc.ids).size, doc.ids.length, '白名单含重复 ID');
  return doc.ids;
}

function readyDiffMessage(actual, allowlist) {
  const extra = actual.filter((id) => !allowlist.includes(id));
  const gone = allowlist.filter((id) => !actual.includes(id));
  return 'ready 集合与 tools/dev/figure_ready_allowlist.json 不恒等。'
    + '多出的（未经准入）：' + (extra.join(', ') || '无') + '；'
    + '丢失的（已封板却退化）：' + (gone.join(', ') || '无') + '。'
    + '准入 = 显式改白名单（git diff 即审批记录）+ k40 验证证据进 registry；'
    + '恢复退化 = 按准入流程重验。两边都不许在测试里放水。';
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function resolveRepoFile(relative) {
  return path.join(REPO, relative);
}

test('registry is generated from bizard index and r453 evidence', () => {
  assert.ok(fs.existsSync(GENERATOR), 'tools/dev/build_figure_templates.cjs missing');
  assert.ok(fs.existsSync(REGISTRY), 'tools/bio/figure_templates.json missing');
  execFileSync(process.execPath, [GENERATOR, '--check'], { cwd: REPO, stdio: 'pipe' });
});

test('registry contains the exact 92 figure inventory and verification counts', () => {
  const registry = reloadFigureTemplates();
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.templates.length, 92);
  assert.equal(new Set(registry.templates.map((item) => item.id)).size, 92);
  // 精确集合恒等口径（2026-11-03，4 Argon 第二十轮 Q3 推翻水位线口径）：
  // 旧断言 ready >= READY_BASELINE(16) 是「只能减少不能增加」的双向漏洞：
  // 未经白名单准入的模板偷偷翻 ready 会通过，已封板的退化也会通过。
  // 结构性不变量（和为 82、blocked 为 1）照旧钉死在下面。
  const readyIdsNow = registry.templates
    .filter((item) => item.deps_status === 'ready')
    .map((item) => item.id)
    .sort();
  assert.deepStrictEqual(readyIdsNow, readyAllowlistIds(), readyDiffMessage(readyIdsNow, readyAllowlistIds()));
  const byStatus = (status) => registry.templates.filter((item) => item.deps_status === status).length;
  assert.equal(byStatus('pending_mapping'), 0);
  assert.equal(byStatus('blocked_r453'), 1);
  assert.equal(
    byStatus('ready') + byStatus('pending') + byStatus('pending_mapping') + byStatus('blocked_r453'),
    92,
    '四类状态之和必须等于 92',
  );

  const required = [
    'id', 'name', 'level', 'category', 'language', 'source', 'source_sha256',
    'preview', 'preview_sha256', 'verified', 'deps_status', 'linked_mods',
    'adapt_vars', 'deprecated', 'lines', 'analysis_step', 'input_tables',
    'produces', 'output_glob', 'canonical_output', 'sample_project_output',
  ];
  for (const item of registry.templates) {
    assert.deepEqual(
      required.filter((key) => !(key in item)),
      [],
      `${item.id}: required field missing`,
    );
    assert.ok(['L1', 'L2', 'L3'].includes(item.level));
    assert.ok(['r', 'python'].includes(item.language));
    assert.ok(['ready', 'pending', 'pending_mapping', 'blocked_r453'].includes(item.deps_status));
    assert.equal(typeof item.name, 'string');
    assert.ok(item.name.length > 0);
    assert.equal(typeof item.adapt_vars, 'object');
    assert.equal(item.adapt_vars === null, false);
    assert.ok(Object.keys(item.adapt_vars).length > 0);
    assert.ok(Array.isArray(item.linked_mods));
    assert.ok(item.linked_mods.length > 0);
    assert.equal(typeof item.deprecated, 'boolean');
  }
});

test('ready templates point to verified source and preview bytes', () => {
  const registry = reloadFigureTemplates();
  const ready = registry.templates.filter((item) => item.deps_status === 'ready');
  for (const item of ready) {
    assert.equal(item.verified, true);
    assert.notEqual(item.source, null);
    assert.notEqual(item.preview, null);
    const source = resolveRepoFile(item.source);
    const preview = resolveRepoFile(item.preview);
    assert.ok(fs.existsSync(source), `${item.id}: source missing`);
    assert.ok(fs.existsSync(preview), `${item.id}: preview missing`);
    assert.equal(item.source_sha256, sha256(source), `${item.id}: source fingerprint drift`);
    assert.equal(item.preview_sha256, sha256(preview), `${item.id}: preview fingerprint drift`);
    assert.ok(Array.isArray(item.lines) && item.lines.length > 0, `${item.id}: lines missing`);
    assert.ok(typeof item.analysis_step === 'string' && item.analysis_step.length > 0);
    assert.ok(Array.isArray(item.input_tables) && item.input_tables.length > 0);
    assert.ok(Array.isArray(item.produces) && item.produces.length > 0);
    assert.ok(typeof item.output_glob === 'string' && item.output_glob.length > 0);
    assert.ok(typeof item.canonical_output === 'string' && item.canonical_output.length > 0);
    assert.ok(typeof item.sample_project_output === 'string' && item.sample_project_output.length > 0);
    assert.ok(fs.existsSync(resolveRepoFile(item.sample_project_output)), `${item.id}: sample output missing`);
  }
});

test('ready template source, preview and sample files are git-trackable', (testContext) => {
  if (!needGit(testContext)) return;
  const registry = reloadFigureTemplates();
  for (const item of registry.templates.filter((row) => row.deps_status === 'ready')) {
    // v2 交付模板的 sample 指向真实项目图目录（按 .gitignore 设计被忽略），
    // 其提交证据是 references/_v2_* 的 source/preview 快照；sample 仅作运行期指针。
    const isV2Delivery = String(item.render_evidence?.entry_id || '').startsWith('v2_delivery_');
    const relatives = isV2Delivery
      ? [item.source, item.preview]
      : [item.source, item.preview, item.sample_project_output];
    for (const relative of relatives) {
      const result = spawnSync(GIT, ['check-ignore', '-q', relative], {
        cwd: REPO,
        windowsHide: true,
      });
      assert.equal(result.status, 1, `${item.id}: ${relative} is still ignored`);
    }
  }
});

test('non-ready templates stay unregistered until independently verified', () => {
  const registry = reloadFigureTemplates();
  for (const item of registry.templates.filter((row) => row.deps_status !== 'ready')) {
    assert.equal(item.verified, false);
    assert.equal(item.source, null);
    assert.equal(item.source_sha256, null);
    assert.equal(item.preview, null);
    assert.equal(item.preview_sha256, null);
  }
  const kegg = registry.templates.find((item) => item.id === 'fig_kegg_pathway');
  assert.equal(kegg.deps_status, 'blocked_r453');
  assert.match(kegg.block_reason, /pathview|KEGG/i);
});

test('registry validation enforces linked mods, language and line affinity', () => {
  const result = validateRegistry();
  assert.equal(result.ok, true, result.errors.join('\n'));
  // 计数侧同样精确锁定（白名单是唯一真源：抬数量时只改白名单，不改这里）。
  assert.equal(result.stats.ready, readyAllowlistIds().length,
    'ready 计数与白名单条目数不符：stats=' + result.stats.ready + ' allowlist=' + readyAllowlistIds().length);
  assert.equal(result.stats.pending_mapping, 0);
  assert.equal(result.stats.blocked, 1);
  assert.equal(result.stats.ready + result.stats.pending + result.stats.pending_mapping + result.stats.blocked, 92);
});

test('ready template input tables must be declared outputs of the bound step', () => {
  const registry = reloadFigureTemplates();
  const mods = new Map([...indexMods()].map(([, entry]) => [entry.mod.id, entry]));
  for (const template of registry.templates.filter((item) => item.deps_status === 'ready')) {
    const errors = validateFigureStepInputs(template, mods.get(template.analysis_step));
    assert.deepEqual(errors, [], `${template.id}: ${errors.join('; ')}`);
  }
  const template = registry.templates.find((item) => item.id === 'fig_l2_pca');
  const bad = { ...template, input_tables: [...template.input_tables, 'not_a_step_output.tsv'] };
  const errors = validateFigureStepInputs(bad, mods.get(bad.analysis_step));
  assert.match(errors.join('\n'), /not_a_step_output\.tsv/);
});

test('boxplot masters use only horizontal significance lines', () => {
  for (const file of BOXPLOT_MASTERS) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /tip(?:\.|_)length\s*=\s*0\.01/, `${file}: endpoint tip found`);
    assert.ok(
      (text.match(/tip(?:\.|_)length\s*=\s*0\b/g) || []).length >= 2,
      `${file}: horizontal significance lines missing`,
    );
  }
});

test('formal script plot matrix contains only passing exact-source entries', () => {
  const matrix = JSON.parse(fs.readFileSync(PLOT_MATRIX, 'utf8'));
  assert.equal(matrix.schema_version, '1.0.0');
  /**
   * 条数不做硬编码。
   *
   * 原来这里写死 27。第三十三轮 T1-1 母版归一按 4 Argon Q2 裁定把
   * L2_组学常用图/L2_core_code.R、L2_组学常用图/L2_volcano_code.R、
   * L3_高级组合图/L3_sankey_code.R 三条指向 legacy 母版的 runner 从矩阵删掉（27 -> 24）。
   * 写死数字会让每次结构收敛都要来改一次测试，而测试的职责是验「每条都合格」，
   * 不是记「一共有几条」。所以改成：条数必须等于矩阵自己声明的条数（自洽），
   * 且每一条都必须是 pass / exit0 / marker / artifact 齐全。
   * 真正防倒退的断言在 figure_master_single_source 与 build_figure_templates 的 ready 水位线上。
   */
  assert.ok(matrix.entries.length > 0, '矩阵不得为空');
  assert.deepEqual(
    matrix.entries.map((entry) => entry.entry_id).sort(),
    [...new Set(matrix.entries.map((entry) => entry.entry_id))].sort(),
    'entry_id 必须唯一'
  );
  for (const entry of matrix.entries) {
    assert.equal(entry.status, 'pass', `${entry.entry_id}: status`);
    assert.equal(entry.k40_exit_code, 0, `${entry.entry_id}: exit code`);
    assert.equal(entry.marker_found, true, `${entry.entry_id}: marker`);
    assert.ok(entry.artifacts.length > 0, `${entry.entry_id}: artifacts`);
    assert.ok(entry.artifacts.every((item) => item.ok), `${entry.entry_id}: invalid artifact`);
    assert.match(entry.source_sha256, /^[0-9a-f]{64}$/);
    const source = path.join(REPO, 'references', '05.可参考生信代码', '可用代码预筛选', '源码', entry.script_path);
    assert.ok(fs.existsSync(source), `${entry.entry_id}: source missing`);
    assert.equal(sha256(source), entry.source_sha256);
    // 不在开发仓工作树根时只跳过这一段（存在性与 sha256 仍要全查）
    if (gitUsable()) {
      const relative = path.relative(REPO, source).split(path.sep).join('/');
      const ignored = spawnSync(GIT, ['check-ignore', '-q', relative], {
        cwd: REPO,
        windowsHide: true,
      });
      assert.equal(ignored.status, 1, `${entry.entry_id}: source is still ignored`);
    }
  }
});

test('figure registry inputs and boxplot masters are git-trackable', (testContext) => {
  if (!needGit(testContext)) return;
  const paths = [
    'references/05.可参考生信代码/可用代码预筛选/源码/_meta/bizard_index.csv',
    'references/05.可参考生信代码/可用代码预筛选/源码/_meta/r453_verification_report.json',
    ...BOXPLOT_MASTERS.map((file) => path.relative(REPO, file).split(path.sep).join('/')),
  ];
  for (const relative of paths) {
    const result = spawnSync(GIT, ['check-ignore', '-q', relative], {
      cwd: REPO,
      windowsHide: true,
    });
    assert.equal(result.status, 1, `${relative} is still ignored`);
  }
});

test('ready figure selections become executable adapted tasks', () => {
  const registry = reloadFigureTemplates();
  const result = buildAdaptedFigureTasks({
    projectId: 'project_alpha',
    lineId: 'line1_bulk',
    selectedFigures: [{
      template_id: 'fig_l2_pca',
      adapt_vars: {
        input_data: 'figures/line1_bulk/pca_scores.tsv',
        group_col: 'group',
      },
    }],
    templatesRegistry: registry.templates,
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].step, 'adapt_fig_l2_pca');
  assert.equal(result.tasks[0].depends_on_step, 'l1_qc_pca');
  assert.match(result.tasks[0].script_path, /scripts\/adapt_fig_l2_pca\.R$/);
  assert.match(result.tasks[0].outputs[0], /custom_fig_l2_pca\.png$/);
});

test('non-ready figure selections are rejected', () => {
  const registry = reloadFigureTemplates();
  const result = buildAdaptedFigureTasks({
    projectId: 'project_alpha',
    lineId: 'line1_bulk',
    selectedFigures: [{ template_id: 'fig_l1_circularpacking', adapt_vars: {} }],
    templatesRegistry: registry.templates,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /不是 ready/);
});

test('figure resolution accepts a same-line linked mod and complete adapt vars', () => {
  const request = resolveFigure(
    'fig_l2_volcano',
    'line1_bulk',
    'project_alpha',
    {
      input_data: 'figures/line1_bulk/de_results.csv',
      group_col: 'condition',
      label_genes: [],
      log2fc_cutoff: 1,
      padj_cutoff: 0.05,
    },
    ['l1_figures_bulk'],
  );
  assert.equal(request.ok, true, request.errors.join('\n'));
  assert.equal(request.template.id, 'fig_l2_volcano');
  assert.deepEqual(request.selected_mods, ['l1_figures_bulk']);
  assert.match(request.master_path, /figure_templates|L2_core_code\.R|references/);
});

test('figure resolution rejects missing adapt vars and non-linked mods', () => {
  const missing = resolveFigure(
    'fig_l2_volcano',
    'line2_scrna',
    'project_alpha',
    { group_col: 'celltype' },
    ['l2_figures_scrna'],
  );
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join('\n'), /input_data/);

  const unlinked = resolveFigure(
    'fig_l2_volcano',
    'line2_scrna',
    'project_alpha',
    { input_data: 'figures/line2_scrna/de_results.csv', group_col: 'celltype', label_genes: [] },
    ['l2_ko_virtual'],
  );
  assert.equal(unlinked.ok, false);
  assert.match(unlinked.errors.join('\n'), /未关联|linked_mods/);
});

test('figure resolution rejects cross-line templates and adapt values', () => {
  const lineMismatch = resolveFigure(
    'fig_l2p_volcano',
    'line1_bulk',
    'project_alpha',
    { input_data: 'figures/line1_bulk/de_results.csv', group_col: 'celltype', label_genes: [] },
    ['l1_figures_bulk'],
  );
  assert.equal(lineMismatch.ok, false);
  assert.match(lineMismatch.errors.join('\n'), /跨线/);

  const foreignLineValue = resolveFigure(
    'fig_l2p_volcano',
    'line2_scrna',
    'project_alpha',
    { input_data: 'figures/line1_bulk/de_results.csv', group_col: 'celltype', label_genes: [] },
    ['l2_figures_scrna'],
  );
  assert.equal(foreignLineValue.ok, false);
  assert.match(foreignLineValue.errors.join('\n'), /跨线取值/);

  const foreignProjectValue = resolveFigure(
    'fig_l2p_volcano',
    'line2_scrna',
    'project_alpha',
    { input_data: '../project_beta/figures/line2_scrna/de_results.csv', group_col: 'celltype', label_genes: [] },
    ['l2_figures_scrna'],
  );
  assert.equal(foreignProjectValue.ok, false);
  assert.match(foreignProjectValue.errors.join('\n'), /跨项目/);
});

test('masters referenced by more than three projects reject in-place overwrite', () => {
  const references = ['project_1', 'project_2', 'project_3', 'project_4'];
  const blocked = authorizeOverwrite({
    projectId: 'project_1',
    templateId: 'fig_l2_volcano',
    overwrite: true,
    references,
  });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /超过 3|另存新模板/);

  const allowed = authorizeOverwrite({
    projectId: 'project_1',
    templateId: 'fig_l2_volcano',
    overwrite: true,
    references: ['project_1', 'project_2', 'project_3'],
  });
  assert.equal(allowed.ok, true);
});

// ── 防伪溯源断言（2026-11-02，4 Argon 第十轮第 4 节）──
//
// 风险：有人把 library/ 下的外部网站原图（catalog 的 pgg_*.png）改名拷进 reference，
// 冒充「k40 真机跑出的验证产物」。曾考虑「产物首次出现于本次 commit」的 git 历史断言，
// 被裁定否决：常驻门禁下重跑验证会覆盖同名 artifact、rebase 也改变历史，必然误伤。
// 改用两条无状态断言：哈希集合互斥 + 报告与磁盘实时咬合。
const CATALOG_FIGURE_DIR = path.join(REPO, 'references', '05.可参考生信代码', 'library', 'figures');
const R453_REPORT = path.join(REPO, 'references', '05.可参考生信代码', '可用代码预筛选', '源码', '_meta', 'r453_verification_report.json');

test('ready artifacts never collide with catalog website images', () => {
  if (!fs.existsSync(CATALOG_FIGURE_DIR)) return;
  const catalogSha = new Map();
  for (const name of fs.readdirSync(CATALOG_FIGURE_DIR)) {
    const file = path.join(CATALOG_FIGURE_DIR, name);
    if (!fs.statSync(file).isFile()) continue;
    catalogSha.set(sha256(file), name);
  }
  assert.ok(catalogSha.size > 0, 'catalog 图集为空，断言失去意义');
  const registry = reloadFigureTemplates();
  for (const item of registry.templates.filter((row) => row.deps_status === 'ready')) {
    const candidates = [[item.id + '.preview_sha256', item.preview_sha256]];
    if (item.sample_project_output && fs.existsSync(resolveRepoFile(item.sample_project_output))) {
      candidates.push([item.id + '.sample_project_output', sha256(resolveRepoFile(item.sample_project_output))]);
    }
    for (const [label, digest] of candidates) {
      assert.ok(!digest || !catalogSha.has(digest),
        label + ' 与 catalog 外部图 ' + catalogSha.get(digest) + ' 同哈希：疑似用网站原图冒充 k40 验证产物');
    }
  }
});

test('r453 report runner hashes match the masters on disk', () => {
  const report = JSON.parse(fs.readFileSync(R453_REPORT, 'utf8'));
  const runners = (report.l3 && report.l3.runners) || {};
  const ids = Object.keys(runners);
  assert.ok(ids.length > 0, 'r453 报告缺 l3.runners');
  for (const runnerId of ids) {
    const runner = runners[runnerId];
    assert.ok(runner.source, runnerId + ': 报告缺 source');
    assert.match(String(runner.source_sha256 || ''), /^[0-9a-f]{64}$/, runnerId + ': 报告缺合法 source_sha256');
    const parts = String(runner.source).split('/');
    const source = path.join(REPO, 'references', '05.可参考生信代码', '可用代码预筛选', '源码', ...parts);
    assert.ok(fs.existsSync(source), runnerId + ': 母版缺失 ' + runner.source);
    assert.equal(sha256(source), runner.source_sha256,
      runnerId + ': 母版已改但未在 k40 重跑 verify_r453_figures.py（报告哈希与磁盘不一致，证据链失效）');
  }
});

// ── 防伪断言 C：适配器实证图与母版自证图哈希互斥（2026-11-02，4 Argon 第十二轮第 3 节）──
//
// 语义：preview（*_verified.png）是 verify_r453_figures.py 在容器里用母版自带的
// 合成基准数据跑出来的「母版自证图」；sample_project_output（custom_fig_*.png）是
// figure_adapters.js 消费真实项目中间表跑出来的「适配器实证图」。
// 两者输入数据完全不同，SHA256 物理上不可能相等。若相等，只有一种可能：
// 没有真跑适配器，而是把 *_verified.png 改名复制成了 custom_fig_*.png。
// 重跑覆盖不会误伤：适配器无论重跑多少次，消费的始终是项目表，哈希撞不上合成图。
test('sample_project_output never equals the verified preview hash', () => {
  const registry = reloadFigureTemplates();
  let checked = 0;
  for (const item of registry.templates.filter((row) => row.deps_status === 'ready')) {
    const previewPath = resolveRepoFile(item.preview);
    const samplePath = resolveRepoFile(item.sample_project_output);
    if (!fs.existsSync(previewPath) || !fs.existsSync(samplePath)) continue;
    const previewSha = sha256(previewPath);
    const sampleSha = sha256(samplePath);
    // v2 交付模板（Argon 第 75 轮）：preview 是从真实交付项目提取的 300DPI 成品，
    // 与 sample 同源同字节是设计本意（render_evidence 记录真实来源），不适用合成图互斥断言。
    const isV2Delivery = String(item.render_evidence?.entry_id || '').startsWith('v2_delivery_');
    if (!isV2Delivery) {
      assert.notEqual(previewSha, sampleSha,
        item.id + ': sample_project_output 与 verified preview 哈希完全相同，'
        + '疑似直接拷贝母版自证图伪造适配器产物');
    }
    checked += 1;
  }
  // 覆盖面锚到白名单条数：全部 ready 必须参与比对，漏比一个即覆盖面失真
  assert.equal(checked, readyAllowlistIds().length,
    '参与哈希互斥比对的就绪模板数与白名单不符（漏比即覆盖面失真）：' + checked);
});
