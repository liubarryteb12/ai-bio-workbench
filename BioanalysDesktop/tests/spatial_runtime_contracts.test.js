import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

test('celltype_annotation 对重复 symbol 只取首个表达列，并拒绝全零求解', () => {
  const text = fs.readFileSync(
    path.join(REPO, 'tools', 'bio', 'line3_spatial', 'scripts', 'celltype_annotation'),
    'utf8',
  );
  assert.match(text, /symbol_to_idx/);
  assert.match(text, /X_sig\.shape\[1\]\s*!=\s*A\.shape\[0\]/);
  assert.match(text, /solved\s*==\s*0|solved\s*<\s*1/);
  assert.doesNotMatch(text, /except Exception:\s*\n\s*pass/);
});

test('spatial_figures 无任何图件时失败，不写零产物绿灯', () => {
  const text = fs.readFileSync(
    path.join(REPO, 'tools', 'bio', 'line3_spatial', 'scripts', 'spatial_figures'),
    'utf8',
  );
  const manifestAt = text.indexOf('figures_manifest.txt');
  const guardAt = text.indexOf('if not made');
  assert.ok(guardAt > 0 && guardAt < manifestAt, 'made 空值门禁必须放在写 manifest 之前');
});

test('spatial_cooccurrence 接受少量近零噪声，拒绝整体聚集性失效', () => {
  const text = fs.readFileSync(
    path.join(REPO, 'tools', 'bio', 'line3_spatial', 'scripts', 'spatial_cooccurrence'),
    'utf8',
  );
  assert.match(text, /neg_frac/);
  assert.match(text, /np\.median\(z_vals\)/);
  assert.match(text, /float\(z_vals\.min\(\)\)\s*</);
});

test('spatial_communication 允许孤立单 spot 域无自邻域质量，但不允许样本整体无质量', () => {
  const text = fs.readFileSync(
    path.join(REPO, 'tools', 'bio', 'line3_spatial', 'scripts', 'spatial_communication'),
    'utf8',
  );
  assert.match(text, /zero_mass_diag/);
  assert.match(text, /float\(s_mass\.sum\(\)\)\s*<=?\s*0/);
  assert.doesNotMatch(text, /for k in local_doms:\s*\n\s*if s_mass\[k, k\] <= 0:\s*\n\s*fail/);
});

test('celltype_annotation 在落图前幂等创建 figures 目录', () => {
  const text = fs.readFileSync(
    path.join(REPO, 'tools', 'bio', 'line3_spatial', 'scripts', 'celltype_annotation'),
    'utf8',
  );
  assert.match(text, /os\.makedirs\(FIGDIR,\s*exist_ok=True\)/);
});
