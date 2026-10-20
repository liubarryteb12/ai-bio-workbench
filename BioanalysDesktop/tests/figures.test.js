import test from 'node:test';
import assert from 'node:assert/strict';

import { assertFiguresPath, parseFigureList, FIGURES_SUBDIR, captionFor, decorateFigures, formatBytes } from '../server/figures.js';
import { PROJECTS_ROOT, DEFAULT_PROJECT, LINES } from '../server/domain.js';

const P = DEFAULT_PROJECT;

test('合法：本项目本线 figures 目录通过', () => {
  for (const line of LINES) {
    const result = assertFiguresPath(P, line);
    assert.equal(result.ok, true, result.reason || '');
    assert.equal(result.dir, `${PROJECTS_ROOT}/${P}/${line}/${FIGURES_SUBDIR}`);
  }
});

test('合法：正常图件名通过', () => {
  const result = assertFiguresPath(P, 'line1_bulk', 'l1_02_pca.png');
  assert.equal(result.ok, true, result.reason || '');
});

test('越界：非法线被拒', () => {
  const result = assertFiguresPath(P, 'line9_x');
  assert.equal(result.ok, false);
  assert.match(result.reason, /非法/);
});

test('越界：非法 project 被拒', () => {
  for (const bad of ['../x', '.hidden', 'a/b', '']) {
    const result = assertFiguresPath(bad, 'line1_bulk');
    assert.equal(result.ok, false, `project=${bad} 必须被拒`);
  }
});

test('越界：非图像扩展名被拒', () => {
  const result = assertFiguresPath(P, 'line1_bulk', 'secret.json');
  assert.equal(result.ok, false);
  assert.match(result.reason, /图像/);
});

test('越界：路径分隔符与 .. 穿越被拒', () => {
  for (const bad of ['../x.png', 'a/b.png', 'a\\b.png', '..png']) {
    const result = assertFiguresPath(P, 'line1_bulk', bad);
    assert.equal(result.ok, false, `${bad} 必须被拒`);
  }
});

test('parseFigureList：解析 find 输出并过滤非图像', () => {
  const raw = [
    'l1_01_correlation.png|44000|1700000000.5',
    'notes.txt|10|1700000001',
    'l1_02_pca.png|43000|1700000002',
    '',
  ].join('\n');
  const figs = parseFigureList(raw);
  assert.equal(figs.length, 2);
  assert.deepEqual(figs.map((f) => f.name), ['l1_01_correlation.png', 'l1_02_pca.png']);
  assert.equal(figs[0].size, 44000);
});

test('parseFigureList：空输出返回空数组', () => {
  assert.deepEqual(parseFigureList(''), []);
});

test('captionFor：三线代表性图件都能命中中文说明', () => {
  assert.match(captionFor('l1_02_pca.png'), /PCA/);
  assert.match(captionFor('l1_03_volcano.png'), /火山/);
  assert.match(captionFor('l2_01_umap_celltype.png'), /UMAP/);
  assert.match(captionFor('l2_08_deg_volcano.png'), /火山/);
  assert.match(captionFor('l3_mouse_01_domains.png'), /空间域/);
  assert.match(captionFor('l3_human_05_knockout_dr.png'), /敲除/);
});

test('captionFor：未知文件名返回空串（不硬编）', () => {
  assert.equal(captionFor('whatever_xyz.png'), '');
});

test('decorateFigures：补 caption 与 sizeLabel', () => {
  const out = decorateFigures([{ name: 'l1_02_pca.png', size: 45056, mtime: 0 }]);
  assert.equal(out.length, 1);
  assert.match(out[0].caption, /PCA/);
  assert.equal(out[0].sizeLabel, formatBytes(45056));
  assert.equal(out[0].name, 'l1_02_pca.png');
});

test('formatBytes：基本换算', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
});
