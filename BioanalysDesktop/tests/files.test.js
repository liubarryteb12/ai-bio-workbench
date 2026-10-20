import test from 'node:test';
import assert from 'node:assert/strict';

import { assertPathInsideProject, buildTreeFromFind, formatBytes } from '../server/files.js';
import { SSD_ROOT, PROJECTS_ROOT, DEFAULT_PROJECT, LINES } from '../server/domain.js';

const P = DEFAULT_PROJECT;

test('合法：本项目本线子目录通过', () => {
  for (const line of LINES) {
    const target = `${PROJECTS_ROOT}/${P}/${line}/processed`;
    const result = assertPathInsideProject(target, P, line);
    assert.equal(result.ok, true, result.reason || '');
  }
});

test('越界：同项目内指向别的线被拒', () => {
  const result = assertPathInsideProject(`${PROJECTS_ROOT}/${P}/line3_spatial/results`, P, 'line1_bulk');
  assert.equal(result.ok, false);
  assert.match(result.reason, /line3_spatial/);
});

test('越界：指向别的项目被拒（项目之间物理隔离）', () => {
  const result = assertPathInsideProject(`${PROJECTS_ROOT}/other/line1_bulk/processed`, P, 'line1_bulk');
  assert.equal(result.ok, false);
  assert.match(result.reason, /项目/);
});

test('越界：往上跳到 bio_data 根被拒', () => {
  const result = assertPathInsideProject(SSD_ROOT, P, 'line1_bulk');
  assert.equal(result.ok, false);
  assert.match(result.reason, /不属于/);
});

test('越界：绝对路径逃逸被拒', () => {
  for (const escape of ['/etc/passwd', '/root/.ssh', '/mnt/ssd/bio_data/../bio_data/projects/x/line2_scrna/results']) {
    const result = assertPathInsideProject(escape, P, 'line1_bulk');
    assert.equal(result.ok, false, `${escape} 必须被拒`);
  }
});

test('越界：.. 穿越被归一化后再判，不是字符串前缀糊弄', () => {
  const result = assertPathInsideProject(`${PROJECTS_ROOT}/${P}/line1_bulk/../../etc`, P, 'line1_bulk');
  assert.equal(result.ok, false, '.. 穿越必须拦，不能靠 startsWith 前缀判断');
});

test('共享区与台账区：在本线浏览时可见，但不属于该线', () => {
  const publicResult = assertPathInsideProject(`${SSD_ROOT}/public_references`, P, 'line2_scrna');
  assert.equal(publicResult.ok, true, 'public_references 是唯一合法共享读入口');
});

test('非法 project_id 被拒', () => {
  for (const bad of ['../x', '.hidden', 'a/b', '']) {
    const result = assertPathInsideProject(`${PROJECTS_ROOT}/${P}/line1_bulk/processed`, bad, 'line1_bulk');
    assert.equal(result.ok, false, `project_id=${bad} 必须被拒`);
  }
});

test('find 输出解析成目录树：type/name/path/size/mtime 齐全', () => {
  // 与真实 find 输出一致：目录条目本身也在列，父子关系靠路径推导
  const root = `${PROJECTS_ROOT}/${P}/line1_bulk`;
  const raw = [
    `${root}|d|4096|1728700000`,
    `${root}/processed|d|4096|1728700100`,
    `${root}/processed/expr.tsv|f|20480|1728700200`,
    `${root}/results|d|4096|1728700250`,
    `${root}/results/deg.tsv|f|1024|1728700300`,
  ].join('\n');

  const tree = buildTreeFromFind(raw, P, 'line1_bulk');

  // 顶层子目录：processed, results
  const names = tree.children.map((child) => child.name).sort();
  assert.deepEqual(names, ['processed', 'results']);

  const processed = tree.children.find((child) => child.name === 'processed');
  assert.equal(processed.children.length, 1);
  assert.equal(processed.children[0].name, 'expr.tsv');
  assert.equal(processed.children[0].size, 20480);
  assert.equal(processed.children[0].mtime, 1728700200);
  assert.equal(processed.children[0].path, `${root}/processed/expr.tsv`);
});

test('目录树不泄漏别的项目条目', () => {
  const root = `${PROJECTS_ROOT}/${P}/line1_bulk`;
  const raw = [
    `${root}/processed|d|4096|1728700100`,
    `${PROJECTS_ROOT}/other/line1_bulk/processed/secret.tsv|f|1|1728700200`,
  ].join('\n');
  const tree = buildTreeFromFind(raw, P, 'line1_bulk');
  const flat = JSON.stringify(tree);
  assert.ok(!flat.includes('secret.tsv'), '别的项目的文件不得出现在树里');
});

test('文件可读大小格式化成人类可读', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1048576), '1.0 MB');
  assert.equal(formatBytes(3221225472), '3.0 GB');
});

test('空目录与空输出都不炸', () => {
  const tree = buildTreeFromFind('', P, 'line1_bulk');
  assert.deepEqual(tree.children, []);
  assert.equal(tree.name, 'line1_bulk');
});

test('目录条目缺失时，文件仍能挂到已存在的父节点上（不会丢）', () => {
  // 真实场景：find 可能因权限/时机漏掉目录条目。此时文件应挂到已知的最近祖先，
  // 顺带补出中间目录，而不是被静默丢弃。这是防"有产物却看不见"的坑。
  const root = `${PROJECTS_ROOT}/${P}/line1_bulk`;
  const raw = [
    `${root}|d|4096|1728700000`,
    `${root}/processed|d|4096|1728700100`,
    `${root}/processed/deep/nested/gene.tsv|f|512|1728700400`,
  ].join('\n');

  const tree = buildTreeFromFind(raw, P, 'line1_bulk');
  assert.equal(tree.children.length, 1);
  const processed = tree.children[0];
  assert.equal(processed.name, 'processed');
  // deep 与 nested 被顺带建出，叶子是那个文件，整条链没断
  const deep = processed.children.find((child) => child.name === 'deep');
  assert.ok(deep, '缺失的中间目录应被顺带建出');
  assert.equal(deep.children[0].name, 'nested');
  assert.equal(deep.children[0].children[0].name, 'gene.tsv');
});
