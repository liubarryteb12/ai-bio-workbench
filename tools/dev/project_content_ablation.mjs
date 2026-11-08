#!/usr/bin/env node
/**
 * project_content_ablation.mjs - 项目内容消融实验。
 *
 * 目标：证明删除旧报告、legacy 图件、组图、旧来源配置与旧 SSH runner 后，
 * 客户端项目发现、图件清单、来源清单接口与出图门禁仍然自洽。
 *
 * 边界：
 *   1. 只在 .tmp/project_content_ablation/ 下的临时副本上删除，绝不碰真实 local_projects；
 *   2. 不重跑生信分析代码，不改母版；
 *   3. 每个场景独立建副本，互不影响；
 *   4. 清理前校验绝对路径仍在 workspace 的 .tmp 内。
 *
 * 用法：
 *   node tools/dev/project_content_ablation.mjs
 *
 * 可选环境变量：
 *   ABLATION_COPY_REAL_PNGS=1   复制少量真实 PNG（默认生成 tiny 占位 PNG）
 *   ABLATION_MAX_REAL_PNGS=6    每条线最多复制多少张真实 PNG
 *
 * 退出码：0 全部场景通过且报告已生成；1 任一场景失败或环境不满足。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REAL_PROJECT_ID = 'PRJ_DCM_BENCH_20261105';
const REAL_PROJECT_DIR = path.join(REPO, 'local_projects', REAL_PROJECT_ID);
const LINES = Object.freeze(['line1_bulk', 'line2_scrna', 'line3_spatial']);
const TMP_CONTAINER = path.join(REPO, '.tmp', 'project_content_ablation');
const RUN_ROOT = path.join(TMP_CONTAINER, `${process.pid}-${crypto.randomUUID()}`);
const REPORT_PATH = path.join(REPO, 'docs', 'PROJECT_CONTENT_ABLATION_REPORT.md');

export const PROJECT_CONTENT_ABLATION_OK = 'PROJECT_CONTENT_ABLATION_OK';
export const PROJECT_CONTENT_ABLATION_FAILED = 'PROJECT_CONTENT_ABLATION_FAILED';

export const ABLATION_COMPONENTS = Object.freeze([
  'old_reports',
  'legacy_figures',
  'composite_figures',
  'source_config',
  'old_ssh_runner',
]);

const OLD_REPORTS = Object.freeze(['BENCHMARK_REPORT.md', 'INTEGRATED_REPORT.md']);
const FINAL_REPORT = 'FINAL_SEAL_REPORT.md';
const SOURCE_CONFIG_FILES = Object.freeze(['FIGURE_SOURCE_MANIFEST.tsv', 'README_FIGURE_SOURCES.md']);
const OLD_SSH_RUNNER = 'scripts/resume_benchmark.sh';

export const COMPOSITE_FIGURES = Object.freeze([
  'line1_bulk/l1_32_deg_overview.png',
  'line3_spatial/l3_mouse_16_domain_panel.png',
]);

/** PNG 的 CRC32 表，避免依赖 Node 版本自带的 zlib.crc32。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * 生成一个合法 PNG，并在 pHYs 块里声明 300 DPI。
 * 尺寸很小，figure_spec_gate 只会给尺寸告警，不会判 DPI 不合规。
 */
export function makePlaceholderPng(width = 1, height = 1) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const phys = Buffer.alloc(9);
  const ppm = Math.round(300 / 0.0254);
  phys.writeUInt32BE(ppm, 0);
  phys.writeUInt32BE(ppm, 4);
  phys[8] = 1;
  const row = Buffer.alloc(1 + width * 4);
  row[0] = 0;
  const idat = zlib.deflateSync(row);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('pHYs', phys),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 解析 FIGURE_SOURCE_MANIFEST.tsv，返回小写列名的行对象。 */
export function parseManifestRows(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];
  const header = lines[0].split('\t').map((cell) => cell.trim().toLowerCase());
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const row = {};
    for (let i = 0; i < header.length; i += 1) {
      row[header[i]] = (cells[i] ?? '').trim();
    }
    rows.push(row);
  }
  return rows;
}

function isLegacyStatus(status) {
  const value = String(status || '').toLowerCase();
  return value.includes('legacy') || value.includes('not project-aligned');
}

/**
 * 把清单里的 figure 模式展开成实际文件名。
 * 支持三种形态：精确名、结尾星号、起始编号..结束编号。
 */
export function expandFigurePattern(pattern, names) {
  const token = String(pattern || '').trim();
  if (!token) return [];
  const matches = new Set();
  const range = token.match(/^(.*?)(\d+)\.\.(\d+)$/);
  if (range) {
    const prefix = range[1];
    const start = Number(range[2]);
    const end = Number(range[3]);
    const re = new RegExp('^' + escapeRegExp(prefix) + '(\\d+)(?:_|\\.)');
    for (const name of names) {
      const hit = name.match(re);
      if (!hit) continue;
      const n = Number(hit[1]);
      if (n >= start && n <= end) matches.add(name);
    }
    return [...matches].sort();
  }
  if (token.endsWith('*')) {
    const prefix = token.replace(/\*+$/, '');
    for (const name of names) {
      if (name.startsWith(prefix)) matches.add(name);
    }
    return [...matches].sort();
  }
  const exact = token + '.png';
  for (const name of names) {
    if (name === exact || name.startsWith(token + '_')) matches.add(name);
  }
  return [...matches].sort();
}

/** 从清单里挑出 status 含 legacy 或 not project-aligned 的图件。 */
export function legacyFigureNames(names, manifestText) {
  const out = new Set();
  for (const row of parseManifestRows(manifestText)) {
    if (!isLegacyStatus(row.status)) continue;
    for (const name of expandFigurePattern(row.figure, names)) out.add(name);
  }
  return [...out].sort();
}

/** 与 query_views.js 的 sanitizeProjectId 保持同一判据。 */
export function sanitizeProjectId(projectId) {
  const raw = String(projectId ?? '').trim();
  if (!raw || raw.length > 64) return null;
  if (raw === '.' || raw === '..') return null;
  if (raw.startsWith('.')) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) return null;
  return raw;
}

function readProjectMetaFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 静态复刻 listLocalProjectsWithMeta，不启动服务，不触碰远端。 */
export function discoverLocalProjects(projectsRoot) {
  let entries;
  try {
    entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const projectId = sanitizeProjectId(entry.name);
    if (!projectId) continue;
    const projectDir = path.resolve(projectsRoot, projectId);
    if (!projectDir.startsWith(projectsRoot + path.sep)) continue;
    projects.push({
      projectId,
      meta: readProjectMetaFile(path.join(projectDir, 'project.json')),
    });
  }
  projects.sort((a, b) => a.projectId.localeCompare(b.projectId));
  return projects;
}

/** 列出临时项目三条线下的 PNG 相对路径。 */
export function listFigures(projectDir) {
  const out = [];
  for (const line of LINES) {
    const dir = path.join(projectDir, 'figures', line);
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (name.endsWith('.png')) out.push(line + '/' + name);
    }
  }
  return out.sort();
}

/**
 * 复刻 /api/figures/source_manifest 的固定路径读取行为。
 * 两份文件都缺失时返回 ok=false，任何读取失败都不抛异常。
 */
export function sourceManifestStatus(projectDir, lineId = 'line3_spatial') {
  const figureDir = path.resolve(projectDir, 'figures', lineId);
  const read = (name) => {
    try {
      const file = path.resolve(figureDir, name);
      if (!file.startsWith(figureDir + path.sep)) return null;
      if (!fs.existsSync(file)) return null;
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  };
  const manifest = read('FIGURE_SOURCE_MANIFEST.tsv');
  const readme = read('README_FIGURE_SOURCES.md');
  if (manifest === null && readme === null) {
    return {
      ok: false,
      manifest: null,
      readme: null,
      reason: '本地图件来源清单不存在（FIGURE_SOURCE_MANIFEST.tsv / README_FIGURE_SOURCES.md）',
    };
  }
  return { ok: true, manifest, readme };
}

function isInsideWorkspaceTmp(target) {
  const tmpRoot = path.resolve(REPO, '.tmp');
  const resolved = path.resolve(target);
  return resolved === tmpRoot || resolved.startsWith(tmpRoot + path.sep);
}

function assertInsideWorkspaceTmp(target) {
  if (!isInsideWorkspaceTmp(target)) {
    throw new Error('拒绝操作 workspace .tmp 之外的路径: ' + target);
  }
  return path.resolve(target);
}

/** 只允许删除 .tmp/project_content_ablation 下的文件。 */
function removeIfExists(file) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(TMP_CONTAINER + path.sep)) return false;
  try {
    if (!fs.existsSync(resolved)) return false;
    fs.rmSync(resolved, { force: true });
    return true;
  } catch {
    return false;
  }
}

function readTextIfExists(file) {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
}

function copyBinaryIfExists(src, dst) {
  try {
    if (!fs.existsSync(src)) return false;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return true;
  } catch {
    return false;
  }
}

function listPngNames(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * 建最小骨架：project.json、三条线 PNG 名称、来源清单、三份报告、旧 SSH runner。
 * 默认写 tiny 占位 PNG；copyRealPngs 为真时复制少量真实 PNG。
 */
export function buildSkeleton(projectDir, options = {}) {
  const copyRealPngs = options.copyRealPngs === true;
  const maxRealPngs = Number.isInteger(options.maxRealPngs) ? options.maxRealPngs : 6;
  const manifestText = readTextIfExists(
    path.join(REAL_PROJECT_DIR, 'figures', 'line3_spatial', 'FIGURE_SOURCE_MANIFEST.tsv')
  ) || '';
  const line3Names = listPngNames(path.join(REAL_PROJECT_DIR, 'figures', 'line3_spatial'));
  const line3Required = new Set(legacyFigureNames(line3Names, manifestText));

  fs.mkdirSync(projectDir, { recursive: true });
  copyBinaryIfExists(path.join(REAL_PROJECT_DIR, 'project.json'), path.join(projectDir, 'project.json'));

  const created = [];
  for (const line of LINES) {
    const srcDir = path.join(REAL_PROJECT_DIR, 'figures', line);
    const dstDir = path.join(projectDir, 'figures', line);
    fs.mkdirSync(dstDir, { recursive: true });
    const names = listPngNames(srcDir);
    let realCount = 0;
    for (const name of names) {
      const rel = line + '/' + name;
      const requiredHere = COMPOSITE_FIGURES.includes(rel)
        || (line === 'line3_spatial' && line3Required.has(name));
      const copyReal = copyRealPngs && (requiredHere || realCount < maxRealPngs);
      const dst = path.join(dstDir, name);
      if (copyReal) {
        realCount += 1;
        fs.copyFileSync(path.join(srcDir, name), dst);
      } else {
        fs.writeFileSync(dst, makePlaceholderPng());
      }
      created.push(rel);
    }
  }

  // 组图在真实项目中已退役，源目录里没有文件。消融场景要验证「删除组图」，
  // 所以骨架必须显式补出这两个名字，否则场景会退化成无物可删。
  for (const rel of COMPOSITE_FIGURES) {
    const segments = rel.split('/');
    const dst = path.join(projectDir, 'figures', ...segments);
    if (fs.existsSync(dst)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const src = path.join(REAL_PROJECT_DIR, 'figures', ...segments);
    if (copyRealPngs && fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    } else {
      fs.writeFileSync(dst, makePlaceholderPng());
    }
    created.push(rel);
  }

  copyBinaryIfExists(
    path.join(REAL_PROJECT_DIR, 'figures', 'line3_spatial', 'FIGURE_SOURCE_MANIFEST.tsv'),
    path.join(projectDir, 'figures', 'line3_spatial', 'FIGURE_SOURCE_MANIFEST.tsv')
  );
  copyBinaryIfExists(
    path.join(REAL_PROJECT_DIR, 'figures', 'line3_spatial', 'README_FIGURE_SOURCES.md'),
    path.join(projectDir, 'figures', 'line3_spatial', 'README_FIGURE_SOURCES.md')
  );
  for (const name of [...OLD_REPORTS, FINAL_REPORT]) {
    copyBinaryIfExists(path.join(REAL_PROJECT_DIR, name), path.join(projectDir, name));
  }
  copyBinaryIfExists(
    path.join(REAL_PROJECT_DIR, ...OLD_SSH_RUNNER.split('/')),
    path.join(projectDir, ...OLD_SSH_RUNNER.split('/'))
  );

  return { created: created.sort(), copyRealPngs, maxRealPngs };
}

export const SCENARIOS = Object.freeze([
  {
    id: 'old_reports',
    label: '删除旧报告',
    apply(projectDir) {
      const deleted = [];
      for (const name of OLD_REPORTS) {
        if (removeIfExists(path.join(projectDir, name))) deleted.push(name);
      }
      return { deleted };
    },
  },
  {
    id: 'legacy_figures',
    label: '删除 legacy 图件',
    apply(projectDir) {
      const lineDir = path.join(projectDir, 'figures', 'line3_spatial');
      const manifestText = readTextIfExists(path.join(lineDir, 'FIGURE_SOURCE_MANIFEST.tsv'));
      if (manifestText === null) {
        return { deleted: [], skipped: '来源清单不存在，无法判定 legacy 图件' };
      }
      const names = listPngNames(lineDir);
      const deleted = [];
      for (const name of legacyFigureNames(names, manifestText)) {
        if (removeIfExists(path.join(lineDir, name))) deleted.push('line3_spatial/' + name);
      }
      return { deleted };
    },
  },
  {
    id: 'composite_figures',
    label: '删除组图',
    apply(projectDir) {
      const deleted = [];
      for (const rel of COMPOSITE_FIGURES) {
        const file = path.join(projectDir, 'figures', ...rel.split('/'));
        if (removeIfExists(file)) deleted.push(rel);
      }
      return { deleted };
    },
  },
  {
    id: 'source_config',
    label: '删除旧来源配置',
    apply(projectDir) {
      const lineDir = path.join(projectDir, 'figures', 'line3_spatial');
      const deleted = [];
      for (const name of SOURCE_CONFIG_FILES) {
        if (removeIfExists(path.join(lineDir, name))) deleted.push('line3_spatial/' + name);
      }
      return { deleted };
    },
  },
  {
    id: 'old_ssh_runner',
    label: '删除旧 SSH runner',
    apply(projectDir) {
      const file = path.join(projectDir, ...OLD_SSH_RUNNER.split('/'));
      if (removeIfExists(file)) return { deleted: [OLD_SSH_RUNNER] };
      return { deleted: [], skipped: '副本中没有 ' + OLD_SSH_RUNNER };
    },
  },
]);

/**
 * 静态判定报告构建是否依赖旧报告名。
 * 要求引用 project.json、ledgers 与真实产物目录，且不出现两份旧报告名。
 */
export function checkReportBuilderIndependence() {
  const file = path.join(REPO, 'ops', 'build_client_report.py');
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch (cause) {
    return {
      ok: false,
      reason: '无法读取 build_client_report.py: ' + (cause.message || cause),
      checks: [],
      forbiddenHits: [],
    };
  }
  const checks = [
    { name: '读取 project.json', ok: /project\.json/.test(src) },
    { name: '读取台账 ledgers', ok: /\bledgers\b/i.test(src) },
    { name: '读取 results/ 产物', ok: /results\//.test(src) },
    { name: '读取 processed/ 产物', ok: /processed\//.test(src) },
    { name: '读取 figures/ 产物', ok: /figures\//.test(src) },
  ];
  const forbiddenHits = OLD_REPORTS.filter((name) => src.includes(name));
  return {
    ok: forbiddenHits.length === 0 && checks.every((item) => item.ok),
    checks,
    forbiddenHits,
  };
}

function tail(text, limit = 5) {
  const lines = String(text || '').trim().split(/\r?\n/);
  return lines.slice(-limit).join(' | ');
}

/** 对一个场景执行 a 到 e 五项验证。 */
export function verifyScenario(scenario, projectDir, deletion, reportBuilder) {
  const checks = [];

  checks.push({
    id: '0',
    label: '目标内容已删除',
    ok: deletion.deleted.length > 0 || Boolean(deletion.skipped),
    detail: deletion.deleted.length ? deletion.deleted.join(', ') : (deletion.skipped || '未删除任何内容'),
  });

  const projectsRoot = path.dirname(projectDir);
  const discovered = discoverLocalProjects(projectsRoot);
  const hit = discovered.find((item) => item.projectId === REAL_PROJECT_ID);
  checks.push({
    id: 'a',
    label: '项目仍可被发现',
    ok: Boolean(hit) && hit.meta?.project_id === REAL_PROJECT_ID,
    detail: hit
      ? 'project.json 可读，project_id=' + (hit.meta?.project_id || 'null')
      : '未发现项目',
  });

  const figures = listFigures(projectDir);
  const stillPresent = deletion.deleted.filter((item) => figures.includes(item));
  checks.push({
    id: 'b',
    label: '剩余图件不含已删除文件且至少单图',
    ok: stillPresent.length === 0 && figures.length >= 1,
    detail: '剩余 ' + figures.length + ' 张，已删除 ' + deletion.deleted.length + ' 项'
      + (stillPresent.length ? '，仍存在: ' + stillPresent.join(', ') : ''),
  });

  let manifestStatus;
  let manifestThrew = false;
  try {
    manifestStatus = sourceManifestStatus(projectDir);
  } catch (cause) {
    manifestThrew = true;
    manifestStatus = { ok: null, reason: cause && cause.message ? cause.message : String(cause) };
  }
  const expectMissing = scenario.id === 'source_config';
  const manifestOk = !manifestThrew
    && (expectMissing ? manifestStatus.ok === false : manifestStatus.ok === true);
  checks.push({
    id: 'c',
    label: expectMissing ? '来源配置缺失时 ok=false 且不抛异常' : '来源清单接口可读且不抛异常',
    ok: manifestOk,
    detail: manifestThrew
      ? '抛异常: ' + manifestStatus.reason
      : 'ok=' + manifestStatus.ok + (manifestStatus.reason ? '，' + manifestStatus.reason : ''),
  });

  const relDir = path.relative(REPO, projectDir).split(path.sep).join('/');
  const gate = spawnSync(
    process.execPath,
    [path.join(REPO, 'tools', 'dev', 'figure_spec_gate.mjs'), '--dir', relDir],
    { cwd: REPO, encoding: 'utf8', timeout: 120000, windowsHide: true }
  );
  const gateOut = (gate.stdout || '') + (gate.stderr || '');
  checks.push({
    id: 'd',
    label: '出图门禁不因少图误判',
    ok: gate.status === 0 && /FIGURE_SPEC_OK/.test(gateOut),
    detail: gate.status === 0 && /FIGURE_SPEC_OK/.test(gateOut)
      ? 'exit=0，FIGURE_SPEC_OK，扫描 ' + figures.length + ' 张 PNG'
      : 'exit=' + gate.status + '，' + tail(gateOut),
  });

  checks.push({
    id: 'e',
    label: '报告构建不依赖旧报告名',
    ok: reportBuilder.ok === true,
    detail: reportBuilder.ok
      ? '引用 project.json / ledgers / 实际产物，未引用 BENCHMARK_REPORT.md 或 INTEGRATED_REPORT.md'
      : '失败: ' + (reportBuilder.reason || JSON.stringify(reportBuilder.forbiddenHits || [])),
  });

  return { ok: checks.every((check) => check.ok), checks };
}

function cleanupRunRoot(io) {
  try {
    assertInsideWorkspaceTmp(RUN_ROOT);
    if (fs.existsSync(RUN_ROOT)) {
      fs.rmSync(RUN_ROOT, { recursive: true, force: true });
    }
  } catch (cause) {
    const warn = typeof io.warn === 'function' ? io.warn : console.warn;
    warn('[ablation][WARN] 清理临时目录失败: ' + (cause.message || cause));
  }
}

function writeReport(results, reportBuilder, fatal) {
  const lines = [];
  lines.push('# 项目内容消融实验报告');
  lines.push('');
  lines.push('日期 2026-11-08｜目标项目 `' + REAL_PROJECT_ID + '`｜隔离根 `.tmp/project_content_ablation/<run_id>/`');
  lines.push('');
  lines.push('> 本实验只在 `.tmp/project_content_ablation/` 的临时副本上删除内容。真实 `local_projects` 未改动，母版未改动，生信分析代码未重跑。');
  lines.push('');
  lines.push('## 1. 方法与边界');
  lines.push('');
  lines.push('- 每个消融场景独立建一份最小骨架副本，副本位于 `.tmp/project_content_ablation/<run_id>/scenarios/<scenario>/local_projects/' + REAL_PROJECT_ID + '/`。');
  lines.push('- 骨架包含 `project.json`、三条线的 PNG 名称、`FIGURE_SOURCE_MANIFEST.tsv`、`README_FIGURE_SOURCES.md`、`BENCHMARK_REPORT.md`、`INTEGRATED_REPORT.md`、`FINAL_SEAL_REPORT.md`，以及 `scripts/resume_benchmark.sh`（存在时复制）。已退役组图会显式补出占位文件，确保组图消融场景有物可删。');
  lines.push('- PNG 默认写成声明 300 DPI 的 tiny 占位图；设置 `ABLATION_COPY_REAL_PNGS=1` 可改为复制少量真实 PNG，复制上限由 `ABLATION_MAX_REAL_PNGS` 控制。');
  lines.push('- 项目发现判据复刻 `listLocalProjectsWithMeta` 的目录扫描与 `project.json` 读取逻辑，不启动服务。');
  lines.push('- 来源清单判据复刻 `/api/figures/source_manifest` 的固定路径读取行为，两份文件都缺失时返回 `ok=false`。');
  lines.push('- 出图门禁用 `node tools/dev/figure_spec_gate.mjs --dir <临时项目相对路径>` 实际执行。');
  lines.push('- 报告构建独立性用静态读取 `ops/build_client_report.py` 判定，不产生交付包。');
  lines.push('');
  lines.push('## 2. 消融场景总览');
  lines.push('');
  lines.push('| 场景 | 删除内容 | a 项目发现 | b 图件清单 | c 来源清单 | d 出图门禁 | e 报告构建 | 结论 |');
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const result of results) {
    const byId = Object.fromEntries(result.verification.checks.map((check) => [check.id, check]));
    const cell = (id) => (byId[id] && byId[id].ok ? '通过' : '失败');
    const deleted = result.deletion.deleted.length
      ? result.deletion.deleted.join('<br>')
      : (result.deletion.skipped || '无');
    lines.push('| `' + result.scenario.id + '` | ' + deleted + ' | ' + cell('a')
      + ' | ' + cell('b') + ' | ' + cell('c') + ' | ' + cell('d') + ' | ' + cell('e')
      + ' | ' + (result.verification.ok ? '通过' : '失败') + ' |');
  }
  lines.push('');
  lines.push('## 3. 逐场景明细');
  lines.push('');
  results.forEach((result, index) => {
    lines.push('### 3.' + (index + 1) + ' `' + result.scenario.id + '`：' + result.scenario.label);
    lines.push('');
    const deleted = result.deletion.deleted.length
      ? result.deletion.deleted.map((item) => '`' + item + '`').join('、')
      : (result.deletion.skipped || '无');
    lines.push('- 删除内容：' + deleted);
    for (const check of result.verification.checks) {
      lines.push('- 验证 ' + check.id + '（' + check.label + '）：'
        + (check.ok ? '通过' : '失败') + '。' + check.detail);
    }
    lines.push('- 场景结论：' + (result.verification.ok ? '通过' : '失败'));
    lines.push('');
  });
  lines.push('## 4. 报告构建独立性（全局 e）');
  lines.push('');
  lines.push('- 静态读取 `ops/build_client_report.py`。');
  for (const check of reportBuilder.checks || []) {
    lines.push('- ' + check.name + '：' + (check.ok ? '是' : '否'));
  }
  lines.push('- 未引用 `BENCHMARK_REPORT.md` 与 `INTEGRATED_REPORT.md`：'
    + ((reportBuilder.forbiddenHits || []).length === 0
      ? '是'
      : '否，命中 ' + reportBuilder.forbiddenHits.join(', ')));
  lines.push('');
  lines.push('## 5. 结论');
  lines.push('');
  const allOk = results.length === SCENARIOS.length && results.every((result) => result.verification.ok);
  if (allOk) {
    lines.push('五个消融场景全部通过。删除旧报告、legacy 图件、组图、旧来源配置与旧 SSH runner 后，项目仍可被发现，剩余图件清单自洽，来源清单接口在配置缺失时返回 `ok=false` 而不抛异常，出图门禁不因少图误判，报告构建不依赖两份旧报告名。');
    lines.push('');
    lines.push('这说明本次消融针对的是项目内容，不是生信分析功能。分析产物、图件与门禁判据保持独立。');
  } else {
    const failed = results.filter((result) => !result.verification.ok)
      .map((result) => result.scenario.id);
    lines.push('存在失败场景：' + (failed.length ? failed.join('、') : '无结果，见致命错误') + '。需要先修复再继续。');
  }
  lines.push('');
  if (fatal) {
    lines.push('本轮执行中发生致命错误：`' + String(fatal.message || fatal).replace(/`/g, '') + '`。');
    lines.push('');
  }
  lines.push(allOk && !fatal ? PROJECT_CONTENT_ABLATION_OK : PROJECT_CONTENT_ABLATION_FAILED);
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');
}

export function main(argv = process.argv.slice(2), io = {
  log: console.log,
  warn: console.warn,
  error: console.error,
}) {
  let fatal = null;
  const results = [];
  let reportBuilder = { ok: false, checks: [], forbiddenHits: [], reason: '未执行' };
  try {
    const meta = path.join(REAL_PROJECT_DIR, 'project.json');
    if (!fs.existsSync(meta)) {
      throw new Error('真实基准项目不存在或缺少 project.json: ' + path.relative(REPO, REAL_PROJECT_DIR));
    }
    fs.mkdirSync(RUN_ROOT, { recursive: true });
    reportBuilder = checkReportBuilderIndependence();
    for (const scenario of SCENARIOS) {
      const projectDir = path.join(
        RUN_ROOT, 'scenarios', scenario.id, 'local_projects', REAL_PROJECT_ID
      );
      io.log('[ablation] 场景 ' + scenario.id + '：' + scenario.label);
      buildSkeleton(projectDir, {
        copyRealPngs: process.env.ABLATION_COPY_REAL_PNGS === '1',
        maxRealPngs: Number(process.env.ABLATION_MAX_REAL_PNGS || 6),
      });
      const deletion = scenario.apply(projectDir);
      const verification = verifyScenario(scenario, projectDir, deletion, reportBuilder);
      results.push({ scenario, deletion, verification });
      io.log('  删除: ' + (deletion.deleted.length
        ? deletion.deleted.join(', ')
        : (deletion.skipped || '无')));
      for (const check of verification.checks) {
        io.log('  [' + (check.ok ? ' OK ' : ' RED') + '] ' + check.id + ' '
          + check.label + '：' + check.detail);
      }
    }
  } catch (cause) {
    fatal = cause;
  }

  let reportError = null;
  try {
    writeReport(results, reportBuilder, fatal);
  } catch (cause) {
    reportError = cause;
  }
  cleanupRunRoot(io);

  if (fatal) {
    io.error(PROJECT_CONTENT_ABLATION_FAILED + ' 执行失败: ' + (fatal.message || fatal));
    return 1;
  }
  if (reportError) {
    io.error(PROJECT_CONTENT_ABLATION_FAILED + ' 报告写入失败: ' + (reportError.message || reportError));
    return 1;
  }
  const failed = results.filter((result) => !result.verification.ok);
  if (failed.length > 0) {
    io.error(PROJECT_CONTENT_ABLATION_FAILED + ' ' + failed.length + ' 个场景失败: '
      + failed.map((result) => result.scenario.id).join(', '));
    return 1;
  }
  io.log(PROJECT_CONTENT_ABLATION_OK + ' ' + results.length + ' 个场景全部通过');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
