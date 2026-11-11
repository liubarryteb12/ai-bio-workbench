/**
 * 客户端图实例与服务端生信能力对齐契约。
 *
 * 判据：
 *   1. 27 条 Ready 模板的外键必须命中 workflows.json 的真实分析线。
 *   2. 服务端可派发适配器集合必须覆盖全部 Ready 模板。
 *   3. 门户与工作台的图实例必须来自 DCM_CHAIN_20261109 最新测试数据。
 *   4. 最新图实例清单必须逐条 300 DPI 且 SHA256 与磁盘一致。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAdaptedFigureSource } from '../server/figure_adapters.js';
import {
  figureProjectExamples,
  validateProjectExamples,
} from '../server/figure_examples.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => fs.readFileSync(path.join(REPO, relative), 'utf8');
const readBytes = (relative) => fs.readFileSync(path.join(REPO, relative));

function pngDpi(buffer) {
  if (buffer.subarray(1, 4).toString('ascii') !== 'PNG') return null;
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const kind = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    if (kind === 'pHYs' && length >= 9) {
      return Math.round(buffer.readUInt32BE(offset + 8) * 0.0254);
    }
    offset += 12 + length;
  }
  return null;
}

test('Ready 模板外键与服务端分析线闭合', () => {
  const registry = JSON.parse(read('tools/bio/figure_templates.json'));
  const workflows = JSON.parse(read('tools/bio/workflows.json'));
  const modToLine = new Map();
  for (const series of workflows.series) {
    for (const stage of series.stages) {
      for (const mod of stage.mods) modToLine.set(mod.id, series.id);
    }
  }
  const ready = registry.templates.filter((item) => item.deps_status === 'ready');
  assert.equal(ready.length, 27);
  for (const template of ready) {
    const line = modToLine.get(template.producing_mod_id);
    assert.ok(line, `${template.id}: producing_mod_id 命中失败`);
    assert.ok(template.lines.includes(line), `${template.id}: lines 与 producing_mod_id 所属线不一致`);
  }
});

test('全部 Ready 模板都有服务端适配器实现', () => {
  const registry = JSON.parse(read('tools/bio/figure_templates.json'));
  const ready = registry.templates.filter((item) => item.deps_status === 'ready');
  for (const template of ready) {
    const source = buildAdaptedFigureSource({
      template,
      masterSource: '#!/usr/bin/env python3\n# synthetic master\n',
      inputPath: `results/${template.lines[0]}/probe.tsv`,
      projectId: 'PRJ_DCM_ALIGN_20261109',
      lineId: template.lines[0],
      adaptVars: Object.fromEntries(Object.keys(template.adapt_vars)
        .map((key) => [key, key === 'input_data' ? `results/${template.lines[0]}/probe.tsv` : 'probe'])),
    });
    assert.match(source, /Real-Data-Adapter: v1/, `${template.id}: 缺真实数据适配头`);
    assert.match(source, /ADAPT_REAL_INPUT_OK/, `${template.id}: 缺真实输入执行段`);
    if (template.render_evidence?.entry_id?.startsWith('v2_delivery_')) {
      assert.equal(source.includes('#!/usr/bin/env bash'), false, `${template.id}: 把 v2 包装脚本拼进了 Python 产物`);
      assert.equal(/basename\(input_data\)/.test(source), false, `${template.id}: 仍是占位图，不是真实图形`);
      assert.match(source, /(savefig|_save\()/, `${template.id}: 缺真实落图调用`);
    }
  }
});

test('空间域图对高基数标签走连续色标，避免图例膨胀', () => {
  const registry = JSON.parse(read('tools/bio/figure_templates.json'));
  const template = registry.templates.find((item) => item.id === 'fig_l3_banksy_domain');
  const source = buildAdaptedFigureSource({
    template,
    masterSource: '#!/usr/bin/env bash\n',
    inputPath: 'data/line3_spatial/processed/spatial_domains_mouse.h5ad',
    projectId: 'PRJ_DCM_ALIGN_20261109',
    lineId: 'line3_spatial',
    adaptVars: Object.fromEntries(Object.keys(template.adapt_vars)
      .map((key) => [key, key === 'input_data' ? 'data/line3_spatial/processed/spatial_domains_mouse.h5ad' : 'probe'])),
  });
  assert.match(source, /len\(unique_labels\) > 30/);
  assert.match(source, /fig\.colorbar\(scatter, ax=ax/);
});

test('最新 DCM 图实例清单覆盖 27 条 Ready 模板且逐条达标', () => {
  const doc = figureProjectExamples();
  assert.equal(doc.source_chain, 'DCM_CHAIN_20261109');
  assert.deepEqual(validateProjectExamples(), []);
  const ids = new Set(doc.examples.map((row) => row.id));
  assert.equal(ids.size, 27);
  for (const row of doc.examples.filter((item) => item.kind === 'latest_project')) {
    assert.equal(row.dpi, 300, `${row.id}: 最新实例不是 300 DPI`);
    assert.ok(row.path.includes('DCM_CHAIN_20261109') || row.path.includes('PRJ_DCM_L2_20261109')
      || row.path.includes('PRJ_DCM_L3_20261109') || row.path.includes('PRJ_DCM_L1_20261109'),
    `${row.id}: 最新实例未来自本轮 DCM 测试数据`);
  }
});

test('门户图模板端点下发最新实例，工作台模板端点同源', () => {
  const portal = read('portal/serve.mjs');
  const figuresRoute = read('BioanalysDesktop/server/routes/figures.routes.js');
  const gallery = read('BioanalysDesktop/src/views/FigureGalleryView.tsx');
  assert.match(portal, /resolveProjectExample/);
  assert.match(portal, /latest-dcm-project/);
  assert.match(figuresRoute, /resolveProjectExample/);
  assert.match(figuresRoute, /project_preview/);
  assert.match(gallery, /实例来源/);
});

test('三条分析线都有独立的原生质检图分区', () => {
  const html = read('portal/index.html');
  for (const line of ['line1_bulk', 'line2_scrna', 'line3_spatial']) {
    assert.match(html, new RegExp(`${line}:\\s*\\[`), `门户缺 ${line} 质检图清单`);
  }
  const server = read('portal/serve.mjs');
  assert.match(server, /line2_scrna:\s*new Set/);
  assert.match(server, /line3_spatial:\s*new Set/);
});

test('L2 与 L3 质检图来自最新测试数据且为 300 DPI', () => {
  const figures = [
    'workspace/projects/DCM_CHAIN_20261109/report/figures/L2_qc_nfeature_by_sample.png',
    'workspace/projects/DCM_CHAIN_20261109/report/figures/L2_qc_mito_by_sample.png',
    'workspace/projects/DCM_CHAIN_20261109/report/figures/L3_qc_genes_by_spot.png',
    'workspace/projects/DCM_CHAIN_20261109/report/figures/L3_qc_counts_by_spot.png',
  ];
  for (const relative of figures) {
    assert.ok(fs.existsSync(path.join(REPO, relative)), `${relative}: 最新质检图缺失`);
    assert.equal(pngDpi(readBytes(relative)), 300, `${relative}: DPI 非 300`);
  }
  const html = read('portal/index.html');
  for (const name of figures.map((item) => path.basename(item))) {
    assert.ok(html.includes(name), `门户质检图清单缺 ${name}`);
  }
});
