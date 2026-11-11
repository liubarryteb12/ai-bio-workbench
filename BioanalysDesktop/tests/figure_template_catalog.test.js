import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadTemplateCatalog,
  validateTemplateCatalog,
} from '../server/figure_template_catalog.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => fs.readFileSync(path.join(REPO, relative), 'utf8');
const READY_BASELINE = JSON.parse(read('tools/dev/figure_ready_allowlist.json')).ready_baseline;

test('92 个模板全量进入同一目录真源', () => {
  const catalog = loadTemplateCatalog();
  assert.equal(catalog.length, 92);
  assert.equal(new Set(catalog.map((item) => item.id)).size, 92);
  const registry = JSON.parse(read('tools/bio/figure_templates.json'));
  assert.deepEqual(
    new Set(catalog.map((item) => item.id)),
    new Set(registry.templates.map((item) => item.id)),
  );
});

test('每个模板都有完整基本信息与介绍', () => {
  const validation = validateTemplateCatalog();
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.ok, true);
  for (const item of loadTemplateCatalog()) {
    assert.ok(item.name, `${item.id}: 缺中文名`);
    assert.ok(item.english_name, `${item.id}: 缺英文名`);
    assert.ok(item.level_label, `${item.id}: 缺层级说明`);
    assert.ok(item.category_label, `${item.id}: 缺分类说明`);
    assert.ok(item.status_label, `${item.id}: 缺状态说明`);
    assert.ok(item.purpose.length >= 12, `${item.id}: 用途说明过短`);
    assert.ok(item.introduction.length >= 80, `${item.id}: 介绍过短`);
    assert.ok(Array.isArray(item.dependencies), `${item.id}: 依赖清单不是数组`);
    assert.ok(Array.isArray(inputTablesOf(item)), `${item.id}: 输入表不是数组`);
  }
});

function inputTablesOf(item) {
  return item.input_tables || [];
}

test('状态分层完整，全部 Ready 均有最新实例', () => {
  const catalog = loadTemplateCatalog();
  const ready = catalog.filter((item) => item.status === 'ready');
  const pending = catalog.filter((item) => item.status === 'pending');
  const blocked = catalog.filter((item) => item.status === 'blocked_r453');
  assert.equal(ready.length, READY_BASELINE);
  assert.equal(pending.length, catalog.length - READY_BASELINE - blocked.length);
  assert.equal(blocked.length, 1);
  assert.ok(ready.every((item) => item.preview_available && item.example_source === 'DCM_CHAIN_20261109'));
  assert.ok(pending.every((item) => item.introduction.includes('候选目录展示')));
});

test('门户与工作台都全量下发目录字段', () => {
  const portal = read('portal/serve.mjs');
  const workbench = read('BioanalysDesktop/server/routes/figures.routes.js');
  assert.match(portal, /loadTemplateCatalogById/);
  assert.match(portal, /purpose: profile\.purpose/);
  assert.match(portal, /introduction: profile\.introduction/);
  assert.match(workbench, /loadTemplateCatalog/);
  assert.match(workbench, /purpose: item\.purpose/);
  assert.match(workbench, /introduction: item\.introduction/);
});
