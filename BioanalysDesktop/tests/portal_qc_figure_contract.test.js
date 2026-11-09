/**
 * 门户质检图与图级模板选择器契约。
 *
 * 背景（2026-11-09 用户实测）：
 *   1. L1 真实跑完后，PCA、样本间相关性、表达均质性与基因检出数已经生成，
 *      但门户只在结果区平铺文件，没有独立的质检图分区；
 *   2. 图级模板选择器的 L1/L2/L3 是图型复杂度 Tier，不是分析线，
 *      旧文案会让用户误以为选 L1 却混进了 L2/L3；
 *   3. 旧选择器对 lines 为空的规划中模板回退 linked_mods，
 *      会把未绑定分析线的草稿混进当前线。
 *
 * 本测试只读 portal/index.html 与 tools/bio 注册表，不启动浏览器。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'portal', 'index.html'), 'utf8');

function sliceBetween(startText, endText) {
  const start = HTML.indexOf(startText);
  const end = HTML.indexOf(endText, start + startText.length);
  assert.notEqual(start, -1, '页面里找不到起点：' + startText);
  assert.notEqual(end, -1, '页面里找不到终点：' + endText);
  return HTML.slice(start, end);
}

test('L1 分析线声明 QC 与 PCA 步骤，真实产出名与门户质检目录一致', () => {
  const workflows = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'tools', 'bio', 'workflows.json'), 'utf8'),
  );
  const line1 = workflows.series.find((series) => series.id === 'line1_bulk');
  assert.ok(line1, 'workflows.json 缺 line1_bulk');
  const mods = line1.stages.flatMap((stage) => stage.mods.map((mod) => mod.id));
  for (const id of ['l1_qc_matrix', 'l1_qc_pca']) {
    assert.ok(mods.includes(id), 'L1 分析线缺步骤：' + id);
  }
  for (const name of [
    'l1_01_correlation.png',
    'l1_02_pca.png',
    'l1_04_topvar_heatmap.png',
    'l1_05a_genes_detected.png',
    'l1_05b_within_group_cor.png',
  ]) {
    assert.ok(HTML.includes(name), '门户质检图目录缺文件：' + name);
  }
  const projectsRoot = path.join(ROOT, 'workspace', 'projects');
  const required = [
    'l1_01_correlation.png',
    'l1_02_pca.png',
    'l1_04_topvar_heatmap.png',
    'l1_05a_genes_detected.png',
    'l1_05b_within_group_cor.png',
  ];
  if (fs.existsSync(projectsRoot)) {
    const dcmProjects = fs.readdirSync(projectsRoot).filter((name) => name.startsWith('PRJ_DCM'));
    if (dcmProjects.length > 0) {
      const complete = dcmProjects.some((project) => {
        const dir = path.join(projectsRoot, project, 'figures', 'line1_bulk');
        return required.every((name) => fs.existsSync(path.join(dir, name)));
      });
      assert.ok(complete, 'DCM 真实测试项目应产出完整 L1 质检图组');
    }
  }
});

test('门户有独立质检图卡片与结果区，不再把质检图混在模板预览里', () => {
  assert.match(HTML, /id="native-qc-card"/);
  assert.match(HTML, /id="native-qc-list"/);
  assert.match(HTML, /质检图（标准步骤自动产出）/);
  assert.match(HTML, /id="result-qc-zone"/);
  assert.match(HTML, /id="result-qc-list"/);
  assert.match(HTML, /项目质检图（自动产出）/);
});

test('图型层级文案与数据字段分离：Tier 是复杂度，不是分析线', () => {
  assert.match(HTML, /FIGURE_LEVEL_LABELS/);
  assert.match(HTML, /基础统计图/);
  assert.match(HTML, /组学常用图/);
  assert.match(HTML, /高级组合图/);
  assert.match(HTML, /Tier 1 \/ 2 \/ 3 是图型复杂度，不是分析线/);
  assert.equal(HTML.includes('按 L1 / L2 / L3 分类浏览可复用图型'), false, '旧歧义文案必须清掉');
});

test('主区只显示 lines 绑定当前线的模板，空行模板单独进规划区', () => {
  const selector = sliceBetween('function renderFigureSelector(lineId)', 'function renderLineCounts()');
  assert.match(selector, /item\.lines\.includes\(lineId\)/);
  assert.match(selector, /figure-unbound-zone/);
  assert.match(selector, /const visibleItems = readyItems/);
  assert.match(selector, /if \(!items\.length\) return/);
  assert.equal(selector.includes("'L1' 图型"), false, '层级标题不得再写 L1 图型');
});

test('真实项目实例按钮取最近一次运行，不冒充当前项目产出', () => {
  assert.match(HTML, /真实项目实例（最近一次运行）/);
  assert.equal(HTML.includes('真实项目产出示例'), false, '旧按钮文案必须清掉');
});

test('门户服务端提供受限的质检图真实示例端点，只白名单文件可读', () => {
  const server = fs.readFileSync(path.join(ROOT, 'portal', 'serve.mjs'), 'utf8');
  assert.match(server, /NATIVE_QC_EXAMPLE_FILES/);
  assert.match(server, /handleNativeQcPreview/);
  assert.match(server, /\/api\/native-qc\/preview/);
  assert.match(server, /!allowed \|\| !allowed\.has\(name\)/);
  assert.match(server, /projectsRoot \+ path\.sep/);
});
