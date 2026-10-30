#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const checks = [];

function add(id, status, detail) {
  checks.push({ id, status, detail });
}

function exists(relative) {
  return fs.existsSync(path.join(ROOT, relative));
}

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function quotedArray(text, field) {
  const match = text.match(new RegExp(`${field}:\\s*\\[([\\s\\S]*?)\\]`));
  if (!match) return null;
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

function arrayLiteral(text, field) {
  const marker = `${field}:`;
  const fieldIndex = text.indexOf(marker);
  if (fieldIndex < 0) return null;
  const start = text.indexOf('[', fieldIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start + 1, index);
    }
  }
  return null;
}

function checkG1() {
  const modsRoot = path.join(ROOT, 'src', 'mods');
  const manifests = walk(modsRoot).filter((file) => file.endsWith('manifest.ts'));
  const errors = [];
  for (const file of manifests) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (/\bTODO\b|TODO_BY_CODING_AGENT|throw new Error\(['"]TODO/.test(text)) {
      errors.push(`${rel}: placeholder`);
    }
    for (const field of ['configPaths', 'verificationScripts']) {
      const paths = quotedArray(text, field) ?? [];
      for (const ref of paths) {
        if (!exists(ref)) errors.push(`${rel}: missing ${ref}`);
      }
    }
  }
  if (errors.length) add('G1', 'FAIL', errors.join('; '));
  else add('G1', 'PASS', `${manifests.length} manifests complete and referenced paths exist`);
}

function checkG2() {
  const businessMods = ['mod-portal-sync', 'mod-biz-alpha', 'mod-biz-beta', 'mod-template-studio'];
  const sampleRoot = path.join(ROOT, 'local_projects', 'PRJ_K40_SMOKE');
  const errors = [];
  let artifacts = 0;
  const globMatch = (pattern, value) => {
    let source = '^';
    for (let index = 0; index < pattern.length; index += 1) {
      const char = pattern[index];
      const next = pattern[index + 1];
      if (char === '*' && next === '*') { source += '.*'; index += 1; }
      else if (char === '*') source += '[^/]*';
      else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`${source}$`).test(value);
  };
  for (const mod of businessMods) {
    const manifestPath = path.join(ROOT, 'src', 'mods', mod, 'manifest.ts');
    const text = fs.readFileSync(manifestPath, 'utf8');
    const artifactsBlock = arrayLiteral(text, 'artifacts');
    if (!artifactsBlock || !artifactsBlock.trim()) {
      errors.push(`${mod}: no artifacts`);
      continue;
    }
    const entries = [...artifactsBlock.matchAll(/\{([\s\S]*?)\}/g)].map((match) => match[1]);
    if (!entries.length) {
      errors.push(`${mod}: empty artifacts`);
      continue;
    }
    for (const entry of entries) {
      const value = (field) => entry.match(new RegExp(`${field}:\\s*'([^']+)'`))?.[1] ?? '';
      const sample = value('sample_project_output');
      const glob = value('output_glob');
      const preview = value('preview_sha256');
      const source = value('source_sha256');
      const line = entry.match(/lines:\s*\[\s*'([^']+)'/)?.[1] ?? '';
      const sourceRelative = line.split(':')[0];
      if (!sample || !glob || !preview || !source || !sourceRelative) {
        errors.push(`${mod}: incomplete artifact`);
        continue;
      }
      if (!globMatch(glob, sample)) errors.push(`${mod}: glob mismatch`);
      const samplePath = path.join(sampleRoot, sample);
      if (!fs.existsSync(samplePath) || !fs.statSync(samplePath).isFile()) {
        errors.push(`${mod}: sample missing`);
        continue;
      }
      const sampleHash = crypto.createHash('sha256').update(fs.readFileSync(samplePath)).digest('hex');
      if (sampleHash !== preview) errors.push(`${mod}: preview hash mismatch`);
      const sourcePath = path.join(ROOT, sourceRelative);
      if (!fs.existsSync(sourcePath)) errors.push(`${mod}: source missing`);
      else {
        const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
        if (sourceHash !== source) errors.push(`${mod}: source hash mismatch`);
      }
      artifacts += 1;
    }
  }
  if (errors.length) add('G2', 'FAIL', errors.join('; '));
  else add('G2', 'PASS', `${artifacts} ArtifactQuadruple entries verified under PRJ_K40_SMOKE`);
}

const G3_REPORT = 'con_hf/runs/2026-10-28_a2a_v1_2/MATRIX_COVERAGE.md';
const G3_MATRIX = 'src/figure_sources/script_plot_matrix.json';
const G3_TEMPLATE_REGISTRY = 'src/figure_templates.json';
const G3_SOURCE_MANIFEST = 'src/figure_sources/manifest.json';
const G3_ARTIFACT_AUDIT = 'artifacts/figure-render-20261029/evidence/artifact_audit.json';
const G3_PNG_ROOT = 'artifacts/figure-render-20261029/outputs/figures';
const G3_EXPECTED_READY_TEMPLATES = 15;
const SHA256_RE = /^[0-9a-f]{64}$/;
const PNG_MAGIC_HEX = '89504e470d0a1a0a';
const PNG_MIN_DPI = 299;

function parseG3Json(value, label) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new Error(`${label} invalid: ${error.message}`);
  }
}

function safeG3Path(value, prefix) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) {
    return null;
  }
  if (path.posix.isAbsolute(value) || value.split('/').includes('..')) return null;
  const normalized = path.posix.normalize(value);
  if (normalized !== value) return null;
  if (prefix && !normalized.startsWith(`${prefix}/`)) return null;
  return normalized;
}

function normalizeAuditPngPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) return null;
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) return null;
  return normalized;
}

function parsePngHeader(payload) {
  if (!Buffer.isBuffer(payload) || payload.length < 8) {
    throw new Error('PNG payload too short');
  }
  const magic = payload.subarray(0, 8).toString('hex');
  if (magic !== PNG_MAGIC_HEX) throw new Error(`PNG magic mismatch: ${magic}`);

  let width = null;
  let height = null;
  let dpi = null;
  let offset = 8;
  while (offset + 12 <= payload.length) {
    const length = payload.readUInt32BE(offset);
    if (offset + 12 + length > payload.length) throw new Error('PNG chunk exceeds payload');
    const type = payload.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === 'IHDR') {
      if (length < 13) throw new Error('PNG IHDR too short');
      width = payload.readUInt32BE(dataStart);
      height = payload.readUInt32BE(dataStart + 4);
    } else if (type === 'pHYs') {
      if (length < 9) throw new Error('PNG pHYs too short');
      const ppuX = payload.readUInt32BE(dataStart);
      const ppuY = payload.readUInt32BE(dataStart + 4);
      const unit = payload[dataStart + 8];
      if (unit !== 1) throw new Error('PNG DPI unit is not metre');
      dpi = [
        Number((ppuX * 0.0254).toFixed(3)),
        Number((ppuY * 0.0254).toFixed(3)),
      ];
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + length + 4;
  }
  if (!width || !height || !dpi) throw new Error('PNG IHDR or pHYs metadata missing');
  return { magic, width, height, dpi };
}

function defaultInspectG3Source(relative) {
  const absolute = path.join(ROOT, ...relative.split('/'));
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    return { exists: false };
  }
  const payload = fs.readFileSync(absolute);
  return {
    exists: true,
    sizeBytes: payload.length,
    sha256: crypto.createHash('sha256').update(payload).digest('hex'),
  };
}

function defaultInspectG3Png(relative) {
  const absolute = path.join(ROOT, ...relative.split('/'));
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    return { exists: false };
  }
  const payload = fs.readFileSync(absolute);
  return {
    exists: true,
    sizeBytes: payload.length,
    sha256: crypto.createHash('sha256').update(payload).digest('hex'),
    ...parsePngHeader(payload),
  };
}

export function checkG3Result(deps = {}) {
  const {
    reportExists = () => exists(G3_REPORT),
    readReport = () => read(G3_REPORT),
    matrixExists = () => exists(G3_MATRIX),
    readMatrix = () => read(G3_MATRIX),
    readTemplateRegistry = () => read(G3_TEMPLATE_REGISTRY),
    readSourceManifest = () => read(G3_SOURCE_MANIFEST),
    readArtifactAudit = () => read(G3_ARTIFACT_AUDIT),
    inspectSource = defaultInspectG3Source,
    inspectPng = defaultInspectG3Png,
  } = deps;

  if (!reportExists()) {
    return { id: 'G3', status: 'WARN', detail: 'MATRIX_COVERAGE.md missing' };
  }
  const reportText = String(readReport());
  if (!reportText.includes('## Plot Matrix') || !reportText.includes('## Execution Matrix')) {
    return {
      id: 'G3',
      status: 'FAIL',
      detail: 'MATRIX_COVERAGE.md missing required sections',
    };
  }
  if (!matrixExists()) {
    return {
      id: 'G3',
      status: 'FAIL',
      detail: `${G3_MATRIX} missing`,
    };
  }

  let matrixRaw;
  let templateRaw;
  let manifestRaw;
  let auditRaw;
  try {
    matrixRaw = readMatrix();
    templateRaw = readTemplateRegistry();
    manifestRaw = readSourceManifest();
    auditRaw = readArtifactAudit();
  } catch (error) {
    return {
      id: 'G3',
      status: 'FAIL',
      detail: `G3 input read failed: ${error.message}`,
    };
  }

  let matrix;
  let registry;
  let manifest;
  let audit;
  try {
    matrix = parseG3Json(matrixRaw, 'script_plot_matrix.json');
    registry = parseG3Json(templateRaw, 'figure_templates.json');
    manifest = parseG3Json(manifestRaw, 'figure_sources/manifest.json');
    audit = parseG3Json(auditRaw, 'artifact_audit.json');
  } catch (error) {
    return { id: 'G3', status: 'FAIL', detail: error.message };
  }

  const generatedFrom = matrix?.generated_from;
  const expectedGeneratedFrom = {
    template_registry: G3_TEMPLATE_REGISTRY,
    source_manifest: G3_SOURCE_MANIFEST,
    artifact_audit: G3_ARTIFACT_AUDIT,
    png_root: G3_PNG_ROOT,
  };
  for (const [field, expected] of Object.entries(expectedGeneratedFrom)) {
    if (generatedFrom?.[field] !== expected) {
      return {
        id: 'G3',
        status: 'FAIL',
        detail: `script_plot_matrix.json generated_from.${field} must be ${expected}`,
      };
    }
  }
  const inputHashes = matrix?.input_sha256;
  const rawInputs = {
    template_registry: templateRaw,
    source_manifest: manifestRaw,
    artifact_audit: auditRaw,
  };
  for (const [field, raw] of Object.entries(rawInputs)) {
    const actual = crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
    if (inputHashes?.[field] !== actual) {
      return {
        id: 'G3',
        status: 'FAIL',
        detail: `script_plot_matrix.json input SHA256 mismatch: ${field}`,
      };
    }
  }

  const templates = registry?.templates;
  if (!Array.isArray(templates)) {
    return { id: 'G3', status: 'FAIL', detail: 'figure_templates.templates is not a list' };
  }
  const ready = templates.filter((item) => item?.deps_status === 'ready');
  if (ready.length !== G3_EXPECTED_READY_TEMPLATES) {
    return {
      id: 'G3',
      status: 'FAIL',
      detail: `expected ${G3_EXPECTED_READY_TEMPLATES} ready templates, got ${ready.length}`,
    };
  }
  const readyById = new Map();
  for (const template of ready) {
    const templateId = String(template?.id || '');
    if (!templateId || readyById.has(templateId)) {
      return { id: 'G3', status: 'FAIL', detail: `invalid or duplicate ready template: ${templateId}` };
    }
    readyById.set(templateId, template);
  }

  const manifestSources = manifest?.sources;
  if (!Array.isArray(manifestSources) || manifestSources.length !== ready.length) {
    return {
      id: 'G3',
      status: 'FAIL',
      detail: 'figure source manifest does not contain one source per ready template',
    };
  }
  const sourceById = new Map(manifestSources.map((item) => [String(item?.template_id || ''), item]));
  const auditFigures = audit?.figures;
  if (!Array.isArray(auditFigures) || auditFigures.length !== ready.length) {
    return {
      id: 'G3',
      status: 'FAIL',
      detail: 'artifact audit does not contain one record per ready template',
    };
  }
  const auditById = new Map(auditFigures.map((item) => [String(item?.template_id || ''), item]));
  for (const templateId of readyById.keys()) {
    if (!sourceById.has(templateId)) {
      return { id: 'G3', status: 'FAIL', detail: `source manifest missing ${templateId}` };
    }
    if (!auditById.has(templateId)) {
      return { id: 'G3', status: 'FAIL', detail: `artifact audit missing ${templateId}` };
    }
  }
  if (sourceById.size !== readyById.size || auditById.size !== readyById.size) {
    return {
      id: 'G3',
      status: 'FAIL',
      detail: 'figure source manifest or artifact audit has template IDs outside ready set',
    };
  }

  const entries = matrix?.entries;
  if (!Array.isArray(entries) || entries.length !== ready.length) {
    const count = Array.isArray(entries) ? entries.length : 'non-list';
    return {
      id: 'G3',
      status: 'FAIL',
      detail: `script_plot_matrix.json expected ${ready.length} entries, got ${count}`,
    };
  }

  const errors = [];
  const seenTemplates = new Set();
  const seenPngHashes = new Set();
  const entryById = new Map();
  for (const [index, entry] of entries.entries()) {
    const entryId = String(entry?.entry_id || `entry_${index}`);
    const templateId = String(entry?.template_id || '');
    if (!entry?.entry_id || !templateId) errors.push(`${entryId}: identifiers missing`);
    if (seenTemplates.has(templateId)) errors.push(`${entryId}: duplicate template_id`);
    seenTemplates.add(templateId);
    entryById.set(templateId, entry);
    if (entry?.status !== 'pass') errors.push(`${entryId}: status is not pass`);
    if (!readyById.has(templateId)) errors.push(`${entryId}: not a ready template`);
  }
  if (seenTemplates.size !== readyById.size) {
    errors.push('matrix template set does not equal ready template set');
  }

  for (const [templateId, template] of readyById) {
    const entry = entryById.get(templateId);
    const source = sourceById.get(templateId);
    const auditFigure = auditById.get(templateId);
    if (!entry || !source || !auditFigure) continue;
    const label = templateId;

    if (entry.name !== template.name || entry.template_name !== template.name) {
      errors.push(`${label}: template name mismatch`);
    }
    if (!String(entry.name || '').trim()) errors.push(`${label}: template name missing`);

    const sourcePath = safeG3Path(entry.source_path, 'src/figure_sources');
    if (!sourcePath || sourcePath !== source.source) {
      errors.push(`${label}: source path mismatch`);
      continue;
    }
    if (!SHA256_RE.test(String(entry.source_sha256 || ''))
      || entry.source_sha256 !== source.source_sha256) {
      errors.push(`${label}: source SHA256 mismatch`);
    }
    const sourceEvidence = inspectSource(sourcePath);
    if (!sourceEvidence?.exists) {
      errors.push(`${label}: source file missing`);
    } else if (sourceEvidence.sha256 !== source.source_sha256
      || sourceEvidence.sha256 !== entry.source_sha256) {
      errors.push(`${label}: source file SHA256 mismatch`);
    }

    const auditPng = normalizeAuditPngPath(auditFigure.output_png);
    const expectedPngPath = auditPng ? `${G3_PNG_ROOT}/${auditPng}` : '';
    const pngPath = safeG3Path(entry.png_path, G3_PNG_ROOT);
    if (!pngPath || pngPath !== expectedPngPath) {
      errors.push(`${label}: PNG path mismatch`);
      continue;
    }
    if (auditFigure.status !== 'PASS') errors.push(`${label}: audit status is not PASS`);
    if (entry.audit_status !== 'PASS') errors.push(`${label}: matrix audit status is not PASS`);
    if (auditFigure.canonical_output !== entry.canonical_output) {
      errors.push(`${label}: canonical output mismatch`);
    }

    if (!Number.isFinite(entry.size_bytes) || entry.size_bytes <= 0) {
      errors.push(`${label}: PNG size invalid`);
    }
    if (!SHA256_RE.test(String(entry.png_sha256 || ''))) {
      errors.push(`${label}: PNG SHA256 invalid`);
    } else if (seenPngHashes.has(entry.png_sha256)) {
      errors.push(`${label}: duplicate PNG SHA256`);
    }
    seenPngHashes.add(entry.png_sha256);
    if (entry.png_magic !== PNG_MAGIC_HEX) errors.push(`${label}: PNG magic invalid`);
    if (!Number.isFinite(entry.width) || entry.width <= 0
      || !Number.isFinite(entry.height) || entry.height <= 0) {
      errors.push(`${label}: PNG dimensions invalid`);
    }
    if (!Array.isArray(entry.dpi) || entry.dpi.length < 2
      || entry.dpi.some((value) => !Number.isFinite(value) || value < PNG_MIN_DPI)) {
      errors.push(`${label}: PNG DPI below ${PNG_MIN_DPI}`);
    }
    if (!Number.isFinite(entry.pixel_variance) || entry.pixel_variance <= 0) {
      errors.push(`${label}: PNG pixel variance invalid`);
    }

    let pngEvidence;
    try {
      pngEvidence = inspectPng(pngPath);
    } catch (error) {
      errors.push(`${label}: PNG inspection failed: ${error.message}`);
      continue;
    }
    if (!pngEvidence?.exists) {
      errors.push(`${label}: PNG file missing`);
      continue;
    }
    if (pngEvidence.sizeBytes !== entry.size_bytes) errors.push(`${label}: PNG size mismatch`);
    if (pngEvidence.sha256 !== entry.png_sha256) errors.push(`${label}: PNG file SHA256 mismatch`);
    if (pngEvidence.magic !== entry.png_magic) errors.push(`${label}: PNG file magic mismatch`);
    if (pngEvidence.width !== entry.width || pngEvidence.height !== entry.height) {
      errors.push(`${label}: PNG file dimensions mismatch`);
    }
    if (!Array.isArray(pngEvidence.dpi)
      || pngEvidence.dpi.some((value, dpiIndex) => (
        !Number.isFinite(value)
        || !Number.isFinite(entry.dpi?.[dpiIndex])
        || Math.abs(value - entry.dpi[dpiIndex]) > 0.01
      ))) {
      errors.push(`${label}: PNG file DPI mismatch`);
    }

    const metrics = auditFigure.metrics || {};
    if (metrics.width_px !== pngEvidence.width || metrics.height_px !== pngEvidence.height) {
      errors.push(`${label}: audit dimensions mismatch`);
    }
    if (!Number.isFinite(metrics.dpi)
      || Math.abs(metrics.dpi - pngEvidence.dpi[0]) > 0.01) {
      errors.push(`${label}: audit DPI mismatch`);
    }
  }

  if (errors.length) {
    return {
      id: 'G3',
      status: 'FAIL',
      detail: errors.slice(0, 12).join('; '),
    };
  }
  return {
    id: 'G3',
    status: 'PASS',
    detail: `${ready.length} ready templates, ${entries.length} entries, ${seenPngHashes.size} PNGs, invalid=0`,
  };
}

function checkG3() {
  const result = checkG3Result();
  add(result.id, result.status, result.detail);
}

function checkG4() {
  const definitions = [];
  for (const file of walk(path.join(ROOT, 'src')).filter((item) => item.endsWith('.ts'))) {
    const text = fs.readFileSync(file, 'utf8');
    if (/export\s+(?:interface|type)\s+ModManifest\b/.test(text)) {
      definitions.push(path.relative(ROOT, file).split(path.sep).join('/'));
    }
  }
  const todoCore = walk(path.join(ROOT, 'src', 'core'))
    .filter((file) => file.endsWith('.ts'))
    .filter((file) => /TODO_BY_CODING_AGENT/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file).split(path.sep).join('/'));
  if (definitions.length !== 1 || definitions[0] !== 'src/core/types.ts' || todoCore.length) {
    add('G4', 'FAIL', `definitions=${definitions.join(',')} todo=${todoCore.join(',')}`);
  } else {
    add('G4', 'PASS', 'single ModManifest definition and no core TODO placeholders');
  }
}

export function checkG5Result(deps = {}) {
  const { gitStatus = defaultGitStatus, releasePlanJson = defaultReleasePlanJson } = deps;
  let status;
  try {
    status = gitStatus().trim();
  } catch (error) {
    return { id: 'G5', status: 'WARN', detail: `git status failed: ${error.message}` };
  }
  let plan;
  try {
    plan = JSON.parse(releasePlanJson());
  } catch (error) {
    return {
      id: 'G5',
      status: 'FAIL',
      detail: `release-plan failed: ${error.message}`,
    };
  }
  if (!plan.ok) {
    return {
      id: 'G5',
      status: 'FAIL',
      detail: `unclassified release files: ${plan.unassigned.join(', ')}`,
    };
  }
  if (status) {
    return {
      id: 'G5',
      status: 'WARN',
      detail: `worktree dirty; ${plan.summary.total} files classified into 4 batches, awaiting authorized commits`,
    };
  }
  return { id: 'G5', status: 'PASS', detail: 'worktree clean' };
}

function defaultGitStatus() {
  return execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
}

function defaultReleasePlanJson() {
  return execFileSync(
    process.execPath,
    [path.join(ROOT, 'ops', 'release-plan.mjs'), '--json'],
    { cwd: ROOT, encoding: 'utf8' }
  );
}

function checkG5() {
  const result = checkG5Result();
  add(result.id, result.status, result.detail);
}

function checkG6() {
  const handoff = path.join(ROOT, 'con_hf', 'handoff.md');
  if (!fs.existsSync(handoff)) {
    add('G6', 'WARN', 'con_hf/handoff.md not present');
    return;
  }
  const text = fs.readFileSync(handoff, 'utf8');
  const sections = ['项目背景', '当前进度', '已知坑', '下一步'];
  const missing = sections.filter((heading) => !new RegExp(`^##\\s+${heading}`, 'm').test(text));
  if (missing.length) add('G6', 'FAIL', `handoff missing sections: ${missing.join(',')}`);
  else add('G6', 'PASS', 'handoff sections present');
}

function checkG7() {
  const engines = ['compute-engine', 'bridge-engine', 'plot-engine', 'sync-engine'];
  const missing = engines.filter((engine) => !exists(`src/engines/${engine}/interface.ts`) || !exists(`src/engines/${engine}/implementation.ts`));
  if (missing.length) {
    add('G7', STRICT ? 'FAIL' : 'WARN', `missing engines: ${missing.join(',')}`);
  } else {
    add('G7', 'PASS', 'four business engines have interface and implementation files');
  }
}

function checkA2AEngines() {
  const engines = {
    'a2a-rpc-engine': [
      'src/engines/a2a-rpc-engine/a2a_client_poller.py',
      'tests/test_a2a_core.py',
    ],
    'transport-keepalive-engine': [
      'src/engines/transport-keepalive-engine/interface.ts',
      'src/engines/transport-keepalive-engine/implementation.ts',
      'src/engines/transport-keepalive-engine/adapters.ts',
      'ops/check_transport_keepalive.mjs',
      'tests/transport_keepalive_compile.cjs',
      'tests/test_transport_keepalive.py',
    ],
    'artifact-sync-engine': [
      'src/engines/artifact-sync-engine/artifact_validator.py',
      'tests/test_a2a_artifact.py',
    ],
    'security-audit-engine': [
      'src/engines/security-audit-engine/security_audit.py',
      'tests/test_a2a_core.py',
    ],
  };
  const errors = [];
  for (const [engine, files] of Object.entries(engines)) {
    for (const file of files) {
      if (!exists(file)) errors.push(`${engine}: missing ${file}`);
    }
  }

  const contracts = [
    [
      'a2a-rpc-engine: self-test entry',
      'src/engines/a2a-rpc-engine/a2a_client_poller.py',
      /--self-test/,
    ],
    [
      'transport-keepalive-engine: interface',
      'src/engines/transport-keepalive-engine/interface.ts',
      /export\s+interface\s+TransportKeepaliveEngine\b/,
    ],
    [
      'transport-keepalive-engine: implementation',
      'src/engines/transport-keepalive-engine/implementation.ts',
      /export\s+class\s+TransportKeepaliveEngineImpl\b/,
    ],
    [
      'transport-keepalive-engine: real and mock adapters',
      'src/engines/transport-keepalive-engine/adapters.ts',
      /class\s+MockTransportCommandAdapter\b[\s\S]*class\s+ChildProcessTransportCommandAdapter\b/,
    ],
    [
      'transport-keepalive-engine: Tailscale and RTT contract',
      'tests/test_transport_keepalive.py',
      /test_missing_tailscale_binary_is_a_red_check[\s\S]*test_ten_endpoint_probes_require_all_success_and_average_rtt_below_60ms/,
    ],
    [
      'transport-keepalive-engine: Windows-safe local invocation',
      'src/engines/transport-keepalive-engine/adapters.ts',
      /Get-Command tailscale[\s\S]*powershell\.exe/,
    ],
    [
      'transport-keepalive-engine: executable preflight entry',
      'ops/check_transport_keepalive.mjs',
      /TransportKeepaliveEngineImpl/,
    ],
    [
      'transport-keepalive-engine: probe report path',
      'ops/check_transport_keepalive.mjs',
      /TRANSPORT_KEEPALIVE\.json/,
    ],
    [
      'artifact-sync-engine: SHA256 validation',
      'src/engines/artifact-sync-engine/artifact_validator.py',
      /sha256/i,
    ],
    [
      'security-audit-engine: token and bind guard',
      'src/engines/security-audit-engine/security_audit.py',
      /peerTokens[\s\S]*0\.0\.0\.0/,
    ],
  ];
  for (const [label, file, pattern] of contracts) {
    if (!exists(file)) continue;
    if (!pattern.test(read(file))) errors.push(label);
  }

  if (errors.length) {
    add('A2A-ENGINES', STRICT ? 'FAIL' : 'WARN', errors.join('; '));
  } else {
    add(
      'A2A-ENGINES',
      'PASS',
      'a2a-rpc, transport-keepalive, artifact-sync and security-audit have implementations, adapters and contract evidence',
    );
  }
}

function checkA2AModules() {
  const modules = [
    'mod-core-engines',
    'mod-a2a-pi-server',
    'mod-a2a-codex-client',
    'mod-a2a-network-keepalive',
    'mod-a2a-artifact-audit',
    'mod-pi-observability',
  ];
  const requiredPiObservabilityAssets = [
    'BioanalysDesktop/server/pi_agent.js',
    'BioanalysDesktop/server/pi_agent_routes.js',
    'BioanalysDesktop/server/runtime_slots.js',
    'BioanalysDesktop/tests/pi_agent.test.js',
    'BioanalysDesktop/tests/pi_agent_routes.test.js',
    'BioanalysDesktop/tests/runtime_slots.test.js',
    'BioanalysDesktop/tests/runtime_slots_http.test.js',
    'tests/test_a2a_poller_state.py',
    'tests/test_pi_telemetry_sidecar.py',
    'BioanalysDesktop/src/App.tsx',
    'ops/build_runtime_core.mjs',
    'ops/pi_telemetry_sidecar.py',
  ];
  const errors = [];
  for (const modId of modules) {
    const manifestPath = `src/mods/${modId}/manifest.ts`;
    if (!exists(manifestPath)) {
      errors.push(`${modId}: missing manifest`);
      continue;
    }
    const text = read(manifestPath);
    if (!text.includes(`modId: '${modId}'`)) {
      errors.push(`${modId}: manifest id mismatch`);
    }
  }
  const piManifestPath = 'src/mods/mod-pi-observability/manifest.ts';
  if (exists(piManifestPath)) {
    const text = read(piManifestPath);
    for (const asset of requiredPiObservabilityAssets) {
      if (!exists(asset)) {
        errors.push(`mod-pi-observability: missing asset ${asset}`);
      }
    }
    if (!text.includes('tests/test_mod_pi_observability.py')) {
      errors.push('mod-pi-observability: missing manifest contract test');
    }
  }
  if (errors.length) {
    add('A2A-MODULES', 'FAIL', errors.join('; '));
  } else {
    add(
      'A2A-MODULES',
      'PASS',
      `${modules.length} AIMS modules pinned: ${modules.join(',')}; `
        + `mod-pi-observability assets pinned: ${requiredPiObservabilityAssets.join(',')}`,
    );
  }
}

function checkRequiredArtifacts() {
  const required = [
    'src/core/types.ts',
    'src/core/PathGuard.ts',
    'src/core/LedgerStore.ts',
    'src/core/ModLoader.ts',
    'src/core/SlotManager.ts',
    'src/core/CapabilityBus.ts',
    'src/core/DeliverableCollector.ts',
  ];
  const missing = required.filter((item) => !exists(item));
  if (missing.length) add('CORE-SOCKETS', 'FAIL', `missing: ${missing.join(',')}`);
  else add('CORE-SOCKETS', 'PASS', 'seven core socket modules present');

  const mods = ['mod-portal-sync', 'mod-biz-alpha', 'mod-biz-beta', 'mod-template-studio'];
  const missingMods = mods.filter((mod) => !exists(`src/mods/${mod}/manifest.ts`));
  if (missingMods.length) add('BIZ-MODS', STRICT ? 'FAIL' : 'WARN', `missing: ${missingMods.join(',')}`);
  else add('BIZ-MODS', 'PASS', 'four business mods present');

  const docs = ['mod-core-engines', 'mod-portal-sync', 'mod-biz-alpha', 'mod-biz-beta', 'mod-template-studio'];
  const missingDocs = docs.filter((doc) => !exists(`docs/modules/${doc}`));
  if (missingDocs.length) add('MODULE-DOCS', STRICT ? 'FAIL' : 'WARN', `missing: ${missingDocs.join(',')}`);
  else add('MODULE-DOCS', 'PASS', 'five module docs present');

  const ops = ['ops/align-sha256.mjs', 'ops/deploy-k40-termux.sh'];
  const missingOps = ops.filter((item) => !exists(item));
  if (missingOps.length) add('OPS-GATES', STRICT ? 'FAIL' : 'WARN', `missing: ${missingOps.join(',')}`);
  else add('OPS-GATES', 'PASS', 'deploy and alignment gates present');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkG1();
  checkG2();
  checkG3();
  checkG4();
  checkG5();
  checkG6();
  checkG7();
  checkA2AEngines();
  checkA2AModules();
  checkRequiredArtifacts();

  const summary = {
    pass: checks.filter((item) => item.status === 'PASS').length,
    warn: checks.filter((item) => item.status === 'WARN').length,
    fail: checks.filter((item) => item.status === 'FAIL').length,
  };
  const ok = summary.fail === 0 && (!STRICT || summary.warn === 0);
  console.log(JSON.stringify({ ok, strict: STRICT, summary, checks }, null, 2));
  process.exit(ok ? 0 : 1);
}
