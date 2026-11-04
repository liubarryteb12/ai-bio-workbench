/**
 * 客户门户需求单契约测试（第二十九轮 ①②⑤ 与 ⑥）。
 *
 * 背景：portal/index.html 是浏览器单文件页，不能 import，所以它的输入结构
 * 与「服务端建项契约」之间没有任何编译期约束。历史上这两边漂过一次：
 * 门户把样本数/组织来源做成项目级单值，服务端 normalizeDatasets 早就要求行级。
 * 本测试把「门户必须产出什么」钉成断言，与 project.js / normalizeDatasets 的真实
 * 取值直接比对，不再依赖人工记忆。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { ANALYSIS_CUTOFFS, normalizeAnalysisCutoffs } from '../server/project.js';
import { normalizeDatasets } from '../server/domain.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'portal', 'index.html'), 'utf8');

/** 从页面里抠出形如 \`var NAME = { ... };\` 的对象字面量并求值。 */
function objectLiteral(name) {
  const start = HTML.indexOf('var ' + name + ' = {');
  assert.notEqual(start, -1, '页面里找不到 var ' + name + ' = {');
  const open = HTML.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') {
      depth--;
      if (depth === 0) return vm.runInNewContext('(' + HTML.slice(open, i + 1) + ')');
    }
  }
  throw new Error('对象字面量 ' + name + ' 未闭合');
}

// ── ① 每个数据集各自一份样本数与组织来源 ──────────────────────────

test('样本数与组织来源是行级输入：每张数据集卡片各有一对，页面不再有项目级单值', () => {
  assert.match(HTML, /'d-count-' \+ d\.id/, '数据集卡片必须渲染行级样本数输入');
  assert.match(HTML, /'d-tissue-' \+ d\.id/, '数据集卡片必须渲染行级组织来源输入');
  // 旧的全局输入框 id 一旦回潮，就会与行级值打架
  assert.equal(/id="f-sample-count"/.test(HTML), false, '不得再有项目级样本总数输入');
  assert.equal(/id="f-tissue"/.test(HTML), false, '不得再有项目级组织来源输入');
});

test('新增数据集行带 sampleCount / tissue 空位，避免新增后写进 undefined', () => {
  const add = HTML.slice(HTML.indexOf("$('btn-add-dataset')"));
  assert.match(add.slice(0, 600), /sampleCount: '', tissue: ''/);
});

test('行级校验拦非法样本数，并在上一步就挡住提交', () => {
  assert.match(HTML, /function datasetRowProblem\(\)/);
  assert.match(HTML, /样本数必须填正整数/);
  assert.match(HTML, /组织来源必须填写/);
  assert.match(HTML, /else if \(datasetRowProblem\(\)\)/);
});

test('manifest 的 dataSource.datasets 逐行带 sampleCount / tissue，顶层值由行级派生', () => {
  const src = HTML.slice(HTML.indexOf('dataSource: {'), HTML.indexOf('groupingDesign: {'));
  assert.match(src, /sampleCount: Number\(String\(d\.sampleCount\)\.trim\(\)\) \|\| 0/);
  assert.match(src, /tissue: d\.tissue\.trim\(\)/);
  assert.match(src, /sampleCount: datasetTotalCount\(\)/);
  assert.match(src, /tissue: datasetTissueSummary\(\)/);
});

test('门户行级字段能原样穿过服务端 normalizeDatasets，不被回落成项目级', () => {
  const { datasets: rows } = normalizeDatasets({
    source: 'GEO',
    dataType: 'microarray',
    // 顶层故意留一组不同的值：行级是权威，回落只对留空的行生效
    sampleCount: 999,
    tissue: 'ShouldNotWin',
    datasets: [
      { gse: 'GSE1', gpl: 'GPL570', role: 'train', sampleCount: 60, tissue: 'Peripheral blood' },
      { gse: 'GSE2', gpl: '', role: 'validation' }
    ]
  });
  assert.equal(rows[0].sampleCount, 60);
  assert.equal(rows[0].tissue, 'Peripheral blood');
  assert.equal(rows[1].sampleCount, 999, '留空的行才回落项目级');
  assert.equal(rows[1].tissue, 'ShouldNotWin');
});

test('纸质需求单的数据集表有样本数与组织来源两列', () => {
  const table = HTML.slice(HTML.indexOf('二、数据集'), HTML.indexOf('二·补'));
  for (const col of ['样本数', '组织来源']) assert.ok(table.includes(col), '打印表格缺列：' + col);
});

// ── ② 分组角色与对比对无歧义 ────────────────────────────────────

test('分组角色只保留两种，文案直说「基准组」与「变化组」', () => {
  assert.match(HTML, /\['reference', '基准组（作为比较基准，全项目只能有 1 个）'\]/);
  assert.match(HTML, /\['disease_stage', '变化组（被检验有无差异的一组）'\]/);
  assert.equal(/疾病 \/ 实验组/.test(HTML), false, '旧的歧义文案必须清掉');
  assert.equal(/基准对照组（Reference）/.test(HTML), false);
});

test('对比对不再靠「组数 >= 3」才出现，两组也显式给出方向', () => {
  const fn = HTML.slice(HTML.indexOf('function renderContrasts()'), HTML.indexOf('function renderOutputs'));
  assert.equal(/named\.length < 3/.test(fn), false, '不得再用组数门槛决定是否显示对比对');
  assert.match(fn, /named\.length < 2/);
  assert.match(fn, /变化组「' \+ c\.case \+ '」 相比 基准组「' \+ c\.ctrl/);
});

test('三组及以上禁用自动配对，由用户挑「变化组 / 基准组」逐条添加', () => {
  assert.match(HTML, /id="ct-case"/);
  assert.match(HTML, /id="ct-ctrl"/);
  assert.match(HTML, /id="btn-add-contrast"/);
  const handler = HTML.slice(HTML.indexOf("$('btn-add-contrast')"), HTML.indexOf("// 数据类型 → 自动锁定分析线"));
  assert.match(handler, /变化组与基准组不能是同一组/);
  assert.match(handler, /这条对比对已经添加过了/);
  assert.match(handler, /state\.contrasts\.push/);
});

test('提交前拦住无基准组、无主对比、引用已删分组的对比对', () => {
  assert.match(HTML, /function groupRoleProblem\(\)/);
  assert.match(HTML, /基准组必须有且只有 1 个/);
  assert.match(HTML, /function contrastProblem\(\)/);
  assert.match(HTML, /请至少保留 1 条对比对，明确谁与谁比较/);
  assert.match(HTML, /请指定 1 条主对比/);
  assert.match(HTML, /引用了已删除的分组/);
});

// ── ⑤ 差异基因筛选阈值 ─────────────────────────────────────────

test('门户三档阈值的数值与服务端 ANALYSIS_CUTOFFS 逐档相等（唯一真源）', () => {
  const portal = objectLiteral('CUTOFF_PROFILES');
  assert.deepEqual(Object.keys(portal).sort(), Object.keys(ANALYSIS_CUTOFFS).sort());
  for (const id of Object.keys(ANALYSIS_CUTOFFS)) {
    assert.equal(portal[id].log2fc, ANALYSIS_CUTOFFS[id].log2fc, id + ' 的 log2FC 阈值与后端不一致');
    assert.equal(portal[id].p, ANALYSIS_CUTOFFS[id].p, id + ' 的 p 阈值与后端不一致');
  }
});

test('阈值档位下拉的三档与后端档位一一对应', () => {
  const sel = HTML.slice(HTML.indexOf('id="f-cutoff-profile"'), HTML.indexOf('id="f-use-adjp"'));
  for (const id of Object.keys(ANALYSIS_CUTOFFS)) {
    assert.ok(sel.includes('value="' + id + '"'), '下拉缺档位：' + id);
  }
  assert.equal(/>\s*<option value="legacy/.test(sel), false);
});

test('「用 adj.P 判定显著性」是勾选框，默认勾上，勾选态决定填哪个阈值', () => {
  const box = HTML.slice(HTML.indexOf('id="f-use-adjp"') - 200, HTML.indexOf('id="f-use-adjp"') + 200);
  assert.match(box, /type="checkbox"/);
  assert.match(box, /checked/);
  const src = HTML.slice(HTML.indexOf('function buildAnalysisCutoffs()'), HTML.indexOf('function validateStep'));
  assert.match(src, /use_adj_p: useAdjP\(\)/);
  assert.match(src, /out\.adj_p_threshold = a/);
  assert.match(src, /out\.p_threshold = p/);
});

test('门户产出的阈值能被服务端 normalizeAnalysisCutoffs 直接吃下并派生出唯一判据字段', () => {
  // 门户不勾 adj.P 时只送 profile + use_adj_p=false + 可选 p_threshold
  const nominal = normalizeAnalysisCutoffs({ profile: 'loose', use_adj_p: false, p_threshold: 0.1 });
  assert.equal(nominal.profile, 'loose');
  assert.equal(nominal.use_adj_p, false);
  assert.equal(nominal.effective_p_field, 'pvalue');
  assert.equal(nominal.effective_p_threshold, 0.1);
  // 未用 adj.P 时 padj_threshold 仍是该档位自带的 p 值（loose 档 0.1），
  // 保留它才能回溯「如果当时改用 adj.P 会是什么口径」
  assert.equal(nominal.padj_threshold, 0.1);

  // 勾了 adj.P 且自填阈值
  const adj = normalizeAnalysisCutoffs({ profile: 'standard', use_adj_p: true, adj_p_threshold: 0.02 });
  assert.equal(adj.effective_p_field, 'padj');
  assert.equal(adj.effective_p_threshold, 0.02);
  assert.equal(adj.log2fc_threshold, 1.0);
});

test('阈值写进 manifest，并出现在纸质需求单里（提交后锁死要留痕）', () => {
  assert.match(HTML, /analysisCutoffs: buildAnalysisCutoffs\(\),/);
  assert.match(HTML, /六·补、差异基因筛选阈值/);
  assert.match(HTML, /是否锁死/);
});

test('阈值格式非法时在上一步给出可读原因，而不是提交后由服务端 500', () => {
  assert.match(HTML, /function cutoffProblem\(\)/);
  assert.match(HTML, /必须是 0 到 1 之间的小数/);
  assert.match(HTML, /else if \(cutoffProblem\(\)\)/);
});
