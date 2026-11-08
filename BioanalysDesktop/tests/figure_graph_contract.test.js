import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFigureTemplates, validateRegistry, validateFigureStepInputs, validateLineAffinity,
  resolveFigure, buildAdaptedFigureTasks, authorizeOverwrite,
} from '../server/figure_graph.js';
import { indexMods } from '../server/workflow_graph.js';

// ── figure_graph.js 契约面测试（2026-11-03，4 Argon 第十八轮第一梯队 P0）──
//
// 它是连接 54 个工作流 Mod 的 produces 声明与 ready 图件模板 input_tables
// 的核心校验引擎。所有断言都先经探针实测确认（严禁按假设写）：
//   - validateFigureStepInputs 返回错误数组（空数组=通过），mod 缺失时点名悬空 step
//   - validateRegistry 返回 {ok, errors, stats}，stats 锁定 92/39/52/0/1
//   - resolveFigure 跨线时报「无本线 linked_mods」，并对越线 adapt_vars 路径二次报错
//   - authorizeOverwrite 影响面按去重后的项目数计，>3 拒绝且要求标 deprecated
//   - buildAdaptedFigureTasks 的 task 形状：depends_on_step 用 analysis_step，
//     扩展名按语言（.R/.py），输出落 PROJECTS_ROOT/<pid>/<line>/figures/

const registry = loadFigureTemplates();
const mods = new Map();
for (const [, entry] of indexMods()) mods.set(entry.mod.id, entry);

test('validateRegistry：当前真源整体通过且 stats 锁定 92/39/52/0/1', () => {
  const v = validateRegistry();
  assert.equal(v.ok, true, 'errors: ' + v.errors.slice(0, 3).join(' | '));
  assert.deepEqual(v.stats, {
    templates: 92, ready: 39, pending: 52, pending_mapping: 0, blocked: 1,
  });
});

test('validateFigureStepInputs：input_tables 必须是所绑 step 声明的 produces', () => {
  const ko = mods.get('l1_de_limma');
  assert.ok(ko, 'l1_de_limma 必须存在');
  const pass = validateFigureStepInputs(
    { id: 'probe', analysis_step: 'l1_de_limma', input_tables: ['deg_all.tsv'] }, ko);
  assert.deepEqual(pass, [], '合法绑定不得报错');
  const fail = validateFigureStepInputs(
    { id: 'probe', analysis_step: 'l1_de_limma', input_tables: ['nope.tsv'] }, ko);
  assert.equal(fail.length, 1);
  assert.match(fail[0], /input_tables\.nope\.tsv 不是 l1_de_limma 的 produces/);
});

test('validateFigureStepInputs：mod 缺失时点名 analysis_step 悬空，不静默放行', () => {
  const errs = validateFigureStepInputs(
    { id: 'probe', analysis_step: 'ghost_step', input_tables: [] }, null);
  assert.deepEqual(errs, ['probe: analysis_step 引用的 mod 不存在']);
});

test('resolveFigure：合法同线绑定通过并回填 selected_mods 与 master_path', () => {
  const r = resolveFigure('fig_l2_pca', 'line1_bulk', 'PRJ_X',
    { input_data: 'data/line1_bulk/processed/pca_scores.tsv', group_col: 'group' }, []);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.selected_mods, ['l1_figures_bulk']);
  assert.ok(r.master_path && r.master_path.endsWith('.R'), 'R 模板母版路径必须落 .R');
});

test('resolveFigure：跨线选中双重报错（无本线 linked_mods + 路径含他线名）', () => {
  const r = resolveFigure('fig_l2_pca', 'line3_spatial', 'PRJ_X',
    { input_data: 'data/line1_bulk/processed/pca_scores.tsv', group_col: 'group' }, []);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /跨线，无本线 linked_mods/.test(e)), '必须报跨线');
  assert.ok(r.errors.some((e) => /禁止跨线取值，发现 line1_bulk/.test(e)), '路径里的他线名必须被点名');
});

test('resolveFigure：pending 模板禁止派发', () => {
  const pend = registry.templates.find((x) => x.deps_status === 'pending');
  const r = resolveFigure(pend.id, 'line1_bulk', 'PRJ_X', {}, []);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /deps_status=pending，当前不可派发/.test(e)));
});

test('resolveFigure：未知模板与缺 adapt_vars 必填字段都报错', () => {
  const r1 = resolveFigure('fig_not_exist', 'line1_bulk', 'PRJ_X', {}, []);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => /未知图模板/.test(e)));
  const r2 = resolveFigure('fig_l2_pca', 'line1_bulk', 'PRJ_X',
    { input_data: 'data/line1_bulk/processed/pca_scores.tsv' }, []);
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => /adapt_vars 缺必填字段 group_col/.test(e)));
});


test('adapt_vars 路径守卫：绝对路径、穿越、跨项目、非法根目录全部拒绝', () => {
  const base = { input_data: 'data/line1_bulk/processed/pca_scores.tsv', group_col: 'group' };
  const cases = [
    ['C:\\Windows\\evil.tsv', /必须使用本项目相对路径/],
    ['/etc/passwd', /必须使用本项目相对路径/],
    ['data/../../etc/passwd', /禁止跨项目/],
    ['data/line1_bulk/processed/../../../other/x.tsv', /禁止跨项目/],
    ['local_projects/PRJ_OTHER/figures/a.png', /禁止跨项目，发现 prj_other/],
    ['etc/shadow', /必须位于本项目/],
  ];
  for (const [value, pattern] of cases) {
    const r = resolveFigure('fig_l2_pca', 'line1_bulk', 'PRJ_X',
      { ...base, input_data: value }, []);
    assert.equal(r.ok, false, '未拒绝: ' + value);
    assert.ok(r.errors.some((e) => pattern.test(e)),
      value + ' 应报 ' + pattern + '，实际 ' + JSON.stringify(r.errors));
  }
});

test('adapt_vars 允许值不误伤：本项目 local_projects 与常规根通过', () => {
  const ok = resolveFigure('fig_l2_pca', 'line1_bulk', 'PRJ_X',
    { input_data: 'local_projects/PRJ_X/figures/adapt/a.R', group_col: 'group' }, []);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
});

test('buildAdaptedFigureTasks：task 形状按探针实测锁定（依赖步/扩展名/输出路径/env）', () => {
  const r = buildAdaptedFigureTasks({
    projectId: 'PRJ_X', lineId: 'line1_bulk',
    selectedFigures: [{
      template_id: 'fig_l2_pca',
      adapt_vars: { input_data: 'data/line1_bulk/processed/pca_scores.tsv', group_col: 'group' },
    }],
    templatesRegistry: registry.templates,
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.tasks.length, 1);
  const task = r.tasks[0];
  assert.equal(task.task_id, 'task_adapt_fig_l2_pca');
  // depends_on_step 必须是该模板的 analysis_step
  assert.equal(task.depends_on_step, 'l1_qc_pca');
  assert.equal(task.language, 'r');
  assert.match(task.script_path, /\/line1_bulk\/scripts\/adapt_fig_l2_pca\.R$/);
  assert.match(task.outputs[0], /\/line1_bulk\/figures\/custom_fig_l2_pca\.png$/);
  assert.equal(JSON.parse(task.env_vars.BIO_ADAPT_VARS).group_col, 'group');
});

test('buildAdaptedFigureTasks：python 模板扩展名是 .py 且输出用模板 produces', () => {
  const py = registry.templates.find((x) => x.language === 'python' && x.deps_status === 'ready');
  const r = buildAdaptedFigureTasks({
    projectId: 'PRJ_X', lineId: py.lines[0],
    selectedFigures: [{ template_id: py.id, adapt_vars: {} }],
    templatesRegistry: registry.templates,
  });
  assert.equal(r.tasks.length, 1);
  assert.match(r.tasks[0].script_path, /\.py$/);
  assert.equal(r.tasks[0].custom_output, (py.produces || [])[0]);
});

test('buildAdaptedFigureTasks：pending 模板、跨线选择、空选择、未知线全部拒绝', () => {
  const pend = registry.templates.find((x) => x.deps_status === 'pending');
  let r = buildAdaptedFigureTasks({
    projectId: 'P', lineId: 'line1_bulk',
    selectedFigures: [{ template_id: pend.id }], templatesRegistry: registry.templates });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /不是 ready，禁止派发/.test(e)));

  r = buildAdaptedFigureTasks({
    projectId: 'P', lineId: 'line2_scrna',
    selectedFigures: [{ template_id: 'fig_l2_pca', adapt_vars: {} }],
    templatesRegistry: registry.templates });
  assert.ok(r.errors.some((e) => /不支持分析线 line2_scrna/.test(e)));

  r = buildAdaptedFigureTasks({ projectId: 'P', lineId: 'line1_bulk', selectedFigures: [], templatesRegistry: [] });
  assert.ok(r.errors.some((e) => /未选择图模板/.test(e)));

  r = buildAdaptedFigureTasks({
    projectId: 'P', lineId: 'no_such',
    selectedFigures: [{ template_id: 'fig_l2_pca', adapt_vars: {} }],
    templatesRegistry: registry.templates });
  assert.ok(r.errors.some((e) => /未知分析线 no_such/.test(e)));
});

test('authorizeOverwrite：不覆写直接放行；影响面按去重项目数计，>3 拒绝', () => {
  assert.deepEqual(authorizeOverwrite({ projectId: 'P', templateId: 't', overwrite: false }),
    { ok: true, reason: '新增派生副本，不覆写母版' });
  assert.equal(authorizeOverwrite({ projectId: 'P', templateId: 't', overwrite: true, references: ['A', 'B', 'C'] }).ok, true);
  const over = authorizeOverwrite({ projectId: 'P', templateId: 't', overwrite: true, references: ['A', 'B', 'C', 'D'] });
  assert.equal(over.ok, false);
  assert.match(over.reason, /超过 3.*deprecated/);
  // 重复引用只算一次（去重后 2 个项目）
  assert.equal(authorizeOverwrite({ projectId: 'P', templateId: 't', overwrite: true, references: ['A', 'A', 'B'] }).reason, '母版影响面 2/3');
  // 对象形态与脏元素：取 projectId，null/无字段被过滤
  assert.equal(authorizeOverwrite({
    projectId: 'P', templateId: 't', overwrite: true,
    references: [{ projectId: 'A' }, 'B', null, { x: 1 }],
  }).reason, '母版影响面 2/3');
});

// ── 第 4 条拓扑不变量：跨线/跨语言亲和性闭合（第二十一轮 4 Argon Q3）──
// 4A 语言失配：模板 language 与 linked_mods 语言不一致，必须拦并点名。
// 4B 跨线不可达：lines 声明的每条线，analysis_step 必须属于该线，linked_mods 必须有该线出图 Mod。
// 断言都用克隆真实 ready 模板的合成注册表注入，不碰磁盘真源。

function modsAllIndex() {
  const all = new Map();
  for (const [, entry] of indexMods()) {
    if (!all.has(entry.mod.id)) all.set(entry.mod.id, []);
    all.get(entry.mod.id).push(entry);
  }
  return all;
}

function cloneReadyTemplate(id) {
  const found = registry.templates.find((item) => item.id === id);
  assert.ok(found, '测试前提：模板 ' + id + ' 必须存在');
  return JSON.parse(JSON.stringify(found));
}

function validateOneTemplate(template) {
  return validateRegistry({
    registry: { schema_version: 1, templates: [template] },
    modsAll: modsAllIndex(),
  });
}

test('第 4 条不变量 4A：linked_mods 语言与模板 language 失配必败且点名语言冲突', () => {
  const base = cloneReadyTemplate('fig_l2_pca'); // language=r，lines=[line1_bulk]
  const modsAll = modsAllIndex();
  // 同线挂一个 Python 出图 Mod：线对、语言错，单独暴露 4A
  modsAll.set('probe_fig_mod', [{
    mod: { id: 'probe_fig_mod', language: 'Python' },
    series: { id: 'line1_bulk' },
    stage: {},
  }]);
  base.linked_mods = ['probe_fig_mod'];
  const bad = validateRegistry({ registry: { schema_version: 1, templates: [base] }, modsAll });
  assert.equal(bad.ok, false, '语言失配必须判红');
  assert.ok(bad.errors.some((e) => /linked_mods 语言不匹配，模板 r 与 probe_fig_mod Python/.test(e)),
    '必须点名模板与 mod 的语言冲突：' + JSON.stringify(bad.errors));
  // 对照：同线同语言（R）不报语言错误
  modsAll.set('probe_fig_mod', [{
    mod: { id: 'probe_fig_mod', language: 'R' },
    series: { id: 'line1_bulk' },
    stage: {},
  }]);
  const control = validateRegistry({ registry: { schema_version: 1, templates: [base] }, modsAll });
  assert.equal(control.errors.some((e) => /语言不匹配/.test(e)), false,
    '同线同语言不得误报：' + JSON.stringify(control.errors));
});

test('第 4 条不变量 4B：analysis_step 属于他线时必败并点名不可达', () => {
  const t = cloneReadyTemplate('fig_l2_pca'); // lines=[line1_bulk]，step=l1_qc_pca
  t.analysis_step = 'l2_qc_cells'; // line2_scrna
  const v = validateOneTemplate(t);
  assert.equal(v.ok, false, 'analysis_step 跨线必须判红');
  assert.ok(v.errors.some((e) => /跨线不可达，lines 声明 line1_bulk 但 analysis_step l2_qc_cells 只属于 line2_scrna/.test(e)),
    '必须点名 analysis_step 的线：' + JSON.stringify(v.errors));
});

test('第 4 条不变量 4B：linked_mods 没有本线出图 Mod 时必败', () => {
  const t = cloneReadyTemplate('fig_l2_umap'); // language=python，lines=[line2_scrna]
  const control = validateOneTemplate(t);
  assert.equal(control.errors.some((e) => /跨线不可达/.test(e)), false,
    '未改动的克隆不得出现跨线错误：' + JSON.stringify(control.errors));
  t.linked_mods = ['l3_figures_spatial']; // 同语言 python，但只挂 line3_spatial
  const v = validateOneTemplate(t);
  assert.equal(v.ok, false, '本线无出图 Mod 必须判红');
  assert.ok(v.errors.some((e) => /跨线不可达，lines 声明 line2_scrna 但 linked_mods 没有该线的出图 Mod/.test(e)),
    '必须点名缺失的出图线：' + JSON.stringify(v.errors));
});

test('第 4 条不变量 4B：多线声明逐线闭合，任一线缺 step 或缺出图 Mod 都拦', () => {
  const t = cloneReadyTemplate('fig_l2_umap');
  t.lines = ['line2_scrna', 'line3_spatial'];
  // step 只在 line2，line3 缺 step；linked_mods 只挂 line2，line3 也缺出图 Mod
  const errors = [];
  validateLineAffinity(t, modsAllIndex(), errors);
  assert.ok(errors.some((e) => /lines 声明 line3_spatial 但 analysis_step l2_integrate_cluster/.test(e)),
    'line3 缺 step 必须报：' + JSON.stringify(errors));
  assert.ok(errors.some((e) => /lines 声明 line3_spatial 但 linked_mods 没有该线的出图 Mod/.test(e)),
    'line3 缺出图 Mod 必须报：' + JSON.stringify(errors));
  // 真实直补：补上 line3 的出图 Mod 后仍因 step 缺线报红（逐线闭合不是只看交集）
  t.linked_mods = ['l2_figures_scrna', 'l3_figures_spatial'];
  const errors2 = [];
  validateLineAffinity(t, modsAllIndex(), errors2);
  assert.equal(errors2.filter((e) => /没有该线的出图 Mod/.test(e)).length, 0, '补全后不得再报缺出图 Mod');
  assert.ok(errors2.some((e) => /analysis_step l2_integrate_cluster/.test(e)), 'step 缺线仍须报');
});

test('第 4 条不变量：真源 39 个 ready 模板全部满足亲和性闭合（零误伤）', () => {
  const v = validateRegistry();
  assert.equal(v.ok, true, v.errors.slice(0, 3).join(' | '));
  assert.equal(v.errors.some((e) => /跨线不可达|语言不匹配/.test(e)), false,
    '真源不得触发亲和性告警：' + JSON.stringify(v.errors.filter((e) => /跨线|语言/.test(e))));
});
