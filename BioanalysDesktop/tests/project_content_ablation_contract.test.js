/**
 * 项目内容消融契约测试。
 *
 * 判据：
 *   1. 消融脚本与门禁包装器存在；
 *   2. 五类消融场景齐全，顺序稳定；
 *   3. 临时目录隔离标记与清理前路径校验存在；
 *   4. source_config 缺失判据是 ok=false 且不抛异常；
 *   5. 旧报告删除不破坏项目发现的判据存在；
 *   6. 报告构建不依赖 BENCHMARK_REPORT.md / INTEGRATED_REPORT.md；
 *   7. 占位 PNG 是合法 300 DPI PNG，清单模式展开正确。
 *
 * 本测试只用临时目录夹具，不读写真实 workspace/projects。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ABLATION_COMPONENTS,
  SCENARIOS,
  PROJECT_CONTENT_ABLATION_OK,
  makePlaceholderPng,
  expandFigurePattern,
  discoverLocalProjects,
  sourceManifestStatus,
} from '../../tools/dev/project_content_ablation.mjs';
import { readPngDpi, readPngSize, REQUIRED_DPI } from '../../tools/dev/figure_spec_gate.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(REPO, 'tools', 'dev', 'project_content_ablation.mjs');
const GATE = path.join(REPO, 'tools', 'dev', 'project_content_ablation_gate.mjs');

test('消融脚本与门禁包装器存在', () => {
  assert.ok(fs.existsSync(SCRIPT), '缺少 tools/dev/project_content_ablation.mjs');
  assert.ok(fs.existsSync(GATE), '缺少 tools/dev/project_content_ablation_gate.mjs');
  const gateSrc = fs.readFileSync(GATE, 'utf8');
  assert.match(gateSrc, /spawnSync/);
  assert.ok(gateSrc.includes(PROJECT_CONTENT_ABLATION_OK), '包装器必须检查成功哨兵');
});

test('五类消融场景齐全且顺序稳定', () => {
  assert.deepEqual([...ABLATION_COMPONENTS], [
    'old_reports',
    'legacy_figures',
    'composite_figures',
    'source_config',
    'old_ssh_runner',
  ]);
  assert.deepEqual(SCENARIOS.map((scenario) => scenario.id), [...ABLATION_COMPONENTS]);
  const src = fs.readFileSync(SCRIPT, 'utf8');
  for (const id of ABLATION_COMPONENTS) {
    assert.ok(src.includes("'" + id + "'"), '脚本缺少场景 ' + id);
  }
});

test('骨架显式补出已退役组图，避免组图消融空转', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, /for \(const rel of COMPOSITE_FIGURES\)/);
  assert.match(src, /if \(fs\.existsSync\(dst\)\) continue;/);
  assert.match(src, /fs\.writeFileSync\(dst, makePlaceholderPng\(\)\)/);
});

test('临时目录隔离标记与清理前路径校验存在', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, /\.tmp['"],\s*'project_content_ablation'/);
  assert.match(src, /process\.pid/);
  assert.match(src, /randomUUID|randomBytes|Math\.random|mkdtemp/);
  assert.match(src, /assertInsideWorkspaceTmp/);
  assert.match(src, /startsWith\(tmpRoot \+ path\.sep\)/);
  assert.match(src, /fs\.rmSync\(RUN_ROOT,\s*\{\s*recursive:\s*true/);
});

test('source_config 缺失判据是 ok=false 且不抛异常', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, /source_config/);
  assert.match(src, /sourceManifestStatus/);
  assert.match(src, /ok:\s*false/);
  assert.match(src, /try\s*\{[\s\S]*?catch/);
  assert.match(src, /manifestStatus\.ok === false/);
});

test('旧报告删除不破坏项目发现的判据存在', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, /old_reports/);
  assert.match(src, /BENCHMARK_REPORT\.md/);
  assert.match(src, /INTEGRATED_REPORT\.md/);
  assert.match(src, /discoverLocalProjects/);
  assert.match(src, /project\.json/);
});

test('报告构建独立性判据引用 project.json、ledgers 与真实产物', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, /build_client_report\.py/);
  assert.match(src, /project\.json/);
  assert.match(src, /ledgers/);
  assert.match(src, /processed\//);
  assert.match(src, /results\//);
  assert.match(src, /figures\//);
});

test('占位 PNG 是合法 300 DPI PNG', () => {
  const buf = makePlaceholderPng();
  const dpi = readPngDpi(buf);
  const size = readPngSize(buf);
  assert.ok(dpi, 'pHYs 块解析失败');
  assert.equal(dpi.dpiX, REQUIRED_DPI);
  assert.equal(dpi.dpiY, REQUIRED_DPI);
  assert.ok(size, 'IHDR 块解析失败');
  assert.ok(size.width > 0 && size.height > 0);
});

test('清单模式展开：精确名、星号、编号区间', () => {
  const names = [
    'l3_mouse_01_domains_A_Ctrl.png',
    'l3_mouse_01_domains_D_Ctrl_HF.png',
    'l3_mouse_05_knockout_dr.png',
    'l3_mouse_09_ko_dr_by_domain.png',
    'l3_mouse_10_dr_gsea_top.png',
    'l3_mouse_11_dr_overlap.png',
    'l3_mouse_12_ora_top.png',
    'l3_mouse_13_gsea_top.png',
    'l3_mouse_14_deconv_umap.png',
  ];
  assert.deepEqual(expandFigurePattern('l3_mouse_05_knockout_dr', names), [
    'l3_mouse_05_knockout_dr.png',
  ]);
  assert.deepEqual(expandFigurePattern('l3_mouse_01_domains_*', names), [
    'l3_mouse_01_domains_A_Ctrl.png',
    'l3_mouse_01_domains_D_Ctrl_HF.png',
  ]);
  assert.deepEqual(expandFigurePattern('l3_mouse_10..13', names), [
    'l3_mouse_10_dr_gsea_top.png',
    'l3_mouse_11_dr_overlap.png',
    'l3_mouse_12_ora_top.png',
    'l3_mouse_13_gsea_top.png',
  ]);
});

test('sourceManifestStatus 缺文件时返回 ok=false 且不抛异常', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ablation-contract-'));
  try {
    const projectDir = path.join(tmp, 'workspace/projects', 'PRJ_X');
    fs.mkdirSync(path.join(projectDir, 'figures', 'line3_spatial'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'project.json'), '{}', 'utf8');
    let result;
    assert.doesNotThrow(() => {
      result = sourceManifestStatus(projectDir);
    });
    assert.equal(result.ok, false);
    assert.equal(result.manifest, null);
    assert.equal(result.readme, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('旧报告缺失时项目仍可被本地发现', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ablation-discover-'));
  try {
    const projectsRoot = path.join(tmp, 'workspace/projects');
    const projectDir = path.join(projectsRoot, 'PRJ_X');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'project.json'),
      JSON.stringify({ project_id: 'PRJ_X', name: 'no old reports' }),
      'utf8'
    );
    fs.mkdirSync(path.join(projectDir, 'figures', 'line1_bulk'), { recursive: true });
    const projects = discoverLocalProjects(projectsRoot);
    const hit = projects.find((item) => item.projectId === 'PRJ_X');
    assert.ok(hit, '缺 BENCHMARK_REPORT.md / INTEGRATED_REPORT.md 不应影响发现');
    assert.equal(hit.meta?.project_id, 'PRJ_X');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('sourceManifestStatus 有清单时返回 ok=true', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ablation-manifest-'));
  try {
    const projectDir = path.join(tmp, 'workspace/projects', 'PRJ_X');
    const lineDir = path.join(projectDir, 'figures', 'line3_spatial');
    fs.mkdirSync(lineDir, { recursive: true });
    fs.writeFileSync(path.join(lineDir, 'FIGURE_SOURCE_MANIFEST.tsv'), 'figure\tsource\tstatus\n', 'utf8');
    const result = sourceManifestStatus(projectDir);
    assert.equal(result.ok, true);
    assert.equal(result.readme, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
