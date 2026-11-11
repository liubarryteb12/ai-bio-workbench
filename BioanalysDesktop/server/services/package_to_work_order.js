/**
 * package_to_work_order.js：把门户提交包转成 work_order/v2 草稿。
 *
 * 本模块只读包目录，不建项目、不跑 DAG、不碰 req/res。
 * 归档路径真源是 package_manifest.json 的 data_files[].to / references[].to，
 * 需求单真源是 shared/requirement_schema.mjs 的 validateRequirement，
 * 分析线真源是 server/domain.js 的 resolveLineFromDataType，
 * 默认 seed 与 Ready 图件分别读 tools/bio/workflows.json 与 tools/dev/figure_ready_allowlist.json。
 *
 * 返回 { ok:true, draft, package } 或 { ok:false, errors[], codes[] }。
 * errors 每条形如 "ERR_CODE: 说明"，与 shared/work_order_v2.mjs 同口径。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { validateRequirement } from '../../../shared/requirement_schema.mjs';
import { normalizeWorkOrderV2 } from '../../../shared/work_order_v2.mjs';
import { extOf } from '../../../shared/data_formats.mjs';
import { DATA_ROLES } from '../../../portal/lib/archive.mjs';
import { resolveLineFromDataType } from '../domain.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ASSETS_ROOT = path.resolve(HERE, '..', '..', '..');
const SAFE_TOKEN_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const PACKAGE_STAMP_RE = /^PKG_(\d{4}-\d{2}-\d{2})_(\d{6})_/;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function push(errors, code, message) {
  errors.push(`${code}: ${message}`);
}

function errorCode(line) {
  const index = line.indexOf(':');
  return index > 0 ? line.slice(0, index) : line;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

function formatOf(filename) {
  const ext = extOf(filename);
  return ext ? ext.slice(1) : '';
}

function packageToken(pkgName) {
  const matched = PACKAGE_STAMP_RE.exec(pkgName);
  if (matched) return `${matched[1].replace(/-/g, '')}_${matched[2]}`;
  return crypto.createHash('sha256').update(pkgName).digest('hex').slice(0, 12);
}

function safeOverride(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return fallback;
  if (!SAFE_TOKEN_RE.test(text) || text.startsWith('.')) return null;
  return text;
}

function loadLineSeed(lineId, assetsRoot) {
  try {
    const registry = readJson(path.join(assetsRoot, 'tools', 'bio', 'workflows.json'));
    const series = (Array.isArray(registry.series) ? registry.series : [])
      .find((item) => item && item.id === lineId);
    const seed = Number(series?.seed);
    return Number.isInteger(seed) && seed > 0 ? seed : null;
  } catch {
    return null;
  }
}

function loadReadyFigureIds(assetsRoot) {
  try {
    const allowlist = readJson(path.join(assetsRoot, 'tools', 'dev', 'figure_ready_allowlist.json'));
    return new Set((Array.isArray(allowlist.ids) ? allowlist.ids : []).map((id) => String(id)));
  } catch {
    return null;
  }
}

function resolvePackageFile(pkgDir, pkgName, relativeTo) {
  const text = String(relativeTo || '').trim();
  if (!text || text.startsWith('/') || text.startsWith('\\') || /^[A-Za-z]:/.test(text)) return null;
  const segments = text.split('/');
  if (text.includes('\\') || segments.some((segment) => segment === '..' || segment === '')) return null;
  const inner = text.startsWith(`${pkgName}/`) ? text.slice(pkgName.length + 1) : text;
  const absolute = path.resolve(pkgDir, inner);
  const relative = path.relative(pkgDir, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return absolute;
}

function collectInputs({
  entries, roleOf, pkgDir, pkgName, repoRoot, label, errors,
}) {
  const inputs = [];
  for (const [index, entry] of entries.entries()) {
    const at = `${label}[${index}]`;
    if (!isPlainObject(entry)) {
      push(errors, 'ERR_PACKAGE_SHAPE', `${at} 必须是 JSON 对象`);
      continue;
    }
    const to = String(entry.to || '');
    const file = resolvePackageFile(pkgDir, pkgName, to);
    if (!file) {
      push(errors, 'ERR_PACKAGE_PATH', `${at}.to 必须是包内相对路径，当前 ${JSON.stringify(to)}`);
      continue;
    }
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      push(errors, 'ERR_PACKAGE_FILE', `${at} 指向的文件不存在: ${to}`);
      continue;
    }
    if (!stat.isFile()) {
      push(errors, 'ERR_PACKAGE_FILE', `${at} 不是文件: ${to}`);
      continue;
    }
    if (Number.isInteger(entry.size) && entry.size !== stat.size) {
      push(errors, 'ERR_PACKAGE_SIZE', `${at} 声明 ${entry.size} 字节，实际 ${stat.size}: ${to}`);
      continue;
    }
    const declared = typeof entry.sha256 === 'string' ? entry.sha256.trim() : '';
    if (!SHA256_RE.test(declared)) {
      push(errors, 'ERR_PACKAGE_SHAPE', `${at}.sha256 缺失或不是 64 位小写十六进制: ${JSON.stringify(entry.sha256 ?? null)}`);
      continue;
    }
    const actual = hashFile(file);
    if (actual !== declared) {
      push(errors, 'ERR_PACKAGE_HASH', `${at} 声明 ${declared}，实际 ${actual}: ${to}`);
      continue;
    }
    const role = roleOf(entry);
    if (!DATA_ROLES.includes(role)) {
      push(errors, 'ERR_PACKAGE_ROLE', `${at}.role 非法: ${JSON.stringify(role)}`);
      continue;
    }
    const inputPath = posixRelative(repoRoot, file);
    if (!inputPath || inputPath.startsWith('..') || path.isAbsolute(inputPath)) {
      push(errors, 'ERR_PACKAGE_PATH', `${at}.to 解析后越出仓库根: ${to}`);
      continue;
    }
    const filename = path.basename(file);
    inputs.push({
      role,
      path: inputPath,
      filename,
      size: stat.size,
      sha256: actual,
      format: formatOf(filename),
    });
  }
  return inputs;
}

/**
 * 把提交包转成 work_order/v2 草稿。
 *
 * @param {string} packageDirAbsPath 包目录绝对路径，目录名必须以 PKG_ 开头
 * @param {object} options
 *   repoRoot   仓库根，用于把包内文件写成可被编排器解析的相对路径
 *   inboxRoot  收件箱根，用于校验包目录没有越界
 *   assetsRoot 读取 workflows.json 与 Ready 图件清单的仓库根
 *   lineId / modIds / seed / figureSelections / requireAdminReview
 *   projectId / workOrderId 可选覆盖
 * @returns {{ok:true, draft:object, package:object} | {ok:false, errors:string[], codes:string[]}}
 */
export function buildWorkOrderDraftFromPackage(packageDirAbsPath, options = {}) {
  const errors = [];
  const done = (draft, summary) => ({
    ok: errors.length === 0,
    errors,
    codes: errors.map(errorCode),
    ...(errors.length === 0 ? { draft, package: summary } : {}),
  });

  const rawDir = typeof packageDirAbsPath === 'string' ? packageDirAbsPath.trim() : '';
  if (!rawDir) {
    push(errors, 'ERR_PACKAGE_SHAPE', 'packageDirAbsPath 必须是非空字符串');
    return done();
  }

  let realPkgDir;
  try {
    realPkgDir = fs.realpathSync(path.resolve(rawDir));
  } catch {
    push(errors, 'ERR_PACKAGE_SHAPE', `包目录不存在或不可读: ${rawDir}`);
    return done();
  }
  let pkgStat;
  try {
    pkgStat = fs.statSync(realPkgDir);
  } catch {
    push(errors, 'ERR_PACKAGE_SHAPE', `包目录不存在或不可读: ${rawDir}`);
    return done();
  }
  if (!pkgStat.isDirectory()) {
    push(errors, 'ERR_PACKAGE_SHAPE', `包路径不是目录: ${rawDir}`);
    return done();
  }

  const pkgName = path.basename(realPkgDir);
  if (!pkgName.startsWith('PKG_')) {
    push(errors, 'ERR_PACKAGE_SHAPE', `包目录名必须以 PKG_ 开头，当前 ${pkgName}`);
    return done();
  }

  const inboxRoot = path.resolve(options.inboxRoot || path.dirname(realPkgDir));
  try {
    const realInbox = fs.realpathSync(inboxRoot);
    const relative = path.relative(realInbox, realPkgDir);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
      push(errors, 'ERR_PACKAGE_PATH', `包目录必须直接位于收件箱内: ${pkgName}`);
      return done();
    }
  } catch {
    push(errors, 'ERR_PACKAGE_PATH', `收件箱不可读: ${inboxRoot}`);
    return done();
  }

  const repoRoot = path.resolve(options.repoRoot || inboxRoot);
  const assetsRoot = path.resolve(options.assetsRoot || DEFAULT_ASSETS_ROOT);

  const requirementFile = path.join(realPkgDir, 'requirement.json');
  const manifestFile = path.join(realPkgDir, 'package_manifest.json');
  if (!fs.existsSync(requirementFile) || !fs.existsSync(manifestFile)) {
    const missing = !fs.existsSync(requirementFile) ? 'requirement.json' : 'package_manifest.json';
    push(errors, 'ERR_PACKAGE_SHAPE', `提交包缺少 ${missing}`);
    return done();
  }

  let requirement;
  let manifest;
  try {
    requirement = readJson(requirementFile);
  } catch (cause) {
    push(errors, 'ERR_PACKAGE_SHAPE', `requirement.json 无法解析: ${cause.message}`);
    return done();
  }
  try {
    manifest = readJson(manifestFile);
  } catch (cause) {
    push(errors, 'ERR_PACKAGE_SHAPE', `package_manifest.json 无法解析: ${cause.message}`);
    return done();
  }

  const requirementCheck = validateRequirement(requirement);
  for (const message of requirementCheck.errors) {
    push(errors, 'ERR_PACKAGE_REQUIREMENT', message);
  }

  if (!isPlainObject(manifest)) {
    push(errors, 'ERR_PACKAGE_SHAPE', 'package_manifest.json 必须是 JSON 对象');
    return done();
  }
  const dataFiles = manifest.data_files === undefined ? [] : manifest.data_files;
  const references = manifest.references === undefined ? [] : manifest.references;
  if (!Array.isArray(dataFiles)) push(errors, 'ERR_PACKAGE_SHAPE', 'manifest.data_files 必须是数组');
  if (!Array.isArray(references)) push(errors, 'ERR_PACKAGE_SHAPE', 'manifest.references 必须是数组');
  if (errors.length > 0) return done();

  const dataInputs = collectInputs({
    entries: dataFiles,
    roleOf: (entry) => String(entry.role || 'other'),
    pkgDir: realPkgDir,
    pkgName,
    repoRoot,
    label: 'manifest.data_files',
    errors,
  });
  const referenceInputs = collectInputs({
    entries: references,
    roleOf: () => 'other',
    pkgDir: realPkgDir,
    pkgName,
    repoRoot,
    label: 'manifest.references',
    errors,
  });
  if (errors.length > 0) return done();

  const dataType = String(requirement?.dataSource?.dataType || requirement?.basicInfo?.dataType || '').trim();
  const suggestedLine = resolveLineFromDataType(dataType);
  if (!suggestedLine) {
    push(errors, 'ERR_PACKAGE_DATA_TYPE', `无法从 dataType 解析分析线: ${JSON.stringify(dataType)}`);
    return done();
  }
  const requestedLine = String(options.lineId || options.line_id || '').trim();
  if (requestedLine && requestedLine !== suggestedLine) {
    push(
      errors,
      'ERR_PACKAGE_LINE_MISMATCH',
      `显式分析线 ${requestedLine} 与 dataType ${dataType} 对应的 ${suggestedLine} 不一致`,
    );
    return done();
  }
  const lineId = suggestedLine;

  const rawModIds = options.modIds ?? options.mod_ids;
  const modIds = [];
  if (Array.isArray(rawModIds)) {
    for (const item of rawModIds) {
      if (typeof item !== 'string' || !item.trim()) {
        push(errors, 'ERR_PACKAGE_OPTIONS', 'mod_ids 的每一项都必须是非空字符串');
        break;
      }
      modIds.push(item.trim());
    }
  }
  if (modIds.length === 0 && errors.length === 0) {
    push(errors, 'ERR_PACKAGE_OPTIONS', 'mod_ids 必须由调用方显式给出，且至少包含一个 Mod');
  }
  if (errors.length > 0) return done();

  let seed;
  if (options.seed !== undefined && options.seed !== null) {
    if (!Number.isInteger(options.seed) || options.seed <= 0) {
      push(errors, 'ERR_PACKAGE_OPTIONS', `seed 必须是正整数，当前 ${JSON.stringify(options.seed)}`);
      return done();
    }
    seed = options.seed;
  } else {
    seed = loadLineSeed(lineId, assetsRoot);
    if (!seed) {
      push(errors, 'ERR_PACKAGE_SEED', `无法读取 ${lineId} 的默认 seed`);
      return done();
    }
  }

  const figureSelections = options.figureSelections ?? options.figure_selections ?? [];
  if (!Array.isArray(figureSelections)) {
    push(errors, 'ERR_PACKAGE_OPTIONS', 'figure_selections 必须是数组');
    return done();
  }
  const figureTemplates = Array.isArray(requirement.figure_templates) ? requirement.figure_templates : [];
  const readyIds = loadReadyFigureIds(assetsRoot);
  const selectedFigureIds = [
    ...figureTemplates.map((item) => String(item?.template_id || '')),
    ...(Array.isArray(figureSelections) ? figureSelections.map((item) => String(item?.template_id || '')) : []),
  ].filter(Boolean);
  if (selectedFigureIds.length > 0 && !readyIds) {
    push(errors, 'ERR_PACKAGE_FIGURE_NOT_READY', 'Ready 图件清单不可读，无法放行图件选择');
  } else if (readyIds) {
    for (const templateId of selectedFigureIds) {
      if (!readyIds.has(templateId)) {
        push(errors, 'ERR_PACKAGE_FIGURE_NOT_READY', `图件 ${templateId} 不在 Ready 基线内`);
      }
    }
  }
  if (errors.length > 0) return done();

  const token = packageToken(pkgName);
  const projectId = safeOverride(options.projectId ?? options.project_id, `PRJ_${token}`);
  const workOrderId = safeOverride(options.workOrderId ?? options.work_order_id, `WO_${token}`);
  if (!projectId) {
    push(errors, 'ERR_PACKAGE_OPTIONS', 'project_id 只允许字母、数字、点、下划线、连字符，1 到 64 位');
    return done();
  }
  if (!workOrderId) {
    push(errors, 'ERR_PACKAGE_OPTIONS', 'work_order_id 只允许字母、数字、点、下划线、连字符，1 到 64 位');
    return done();
  }

  const species = String(requirement?.basicInfo?.species || '').trim();
  const requirementBlock = {
    basicInfo: requirement.basicInfo,
    dataSource: requirement.dataSource,
    groupingDesign: requirement.groupingDesign,
    figure_templates: figureTemplates,
  };
  if (requirement.analysisCutoffs !== undefined) {
    requirementBlock.analysisCutoffs = requirement.analysisCutoffs;
  }
  if (requirement.biologicalPriors !== undefined) {
    requirementBlock.biologicalPriors = requirement.biologicalPriors;
  }
  const draft = {
    schema_version: 'work_order/v2',
    work_order_id: workOrderId,
    project_id: projectId,
    source_package: {
      package_dir: pkgName,
      requirement_path: `${pkgName}/requirement.json`,
      manifest_path: `${pkgName}/package_manifest.json`,
      requirement_sha256: hashFile(requirementFile),
      manifest_sha256: hashFile(manifestFile),
    },
    requirement: requirementBlock,
    inputs: [...dataInputs, ...referenceInputs],
    execution: {
      line_id: lineId,
      mod_ids: modIds,
      figure_selections: figureSelections,
      seed,
      compute_adapter: 'adb',
      allow_ssh: false,
      species_scope: species ? [species] : [],
    },
    delivery: {
      profile: 'client_standard',
      report_md: 'Analysis_Report.md',
      report_html: 'Analysis_Report.html',
      delivery_tar_pattern: 'Client_Delivery.tar.gz',
    },
    controls: {
      require_admin_review: options.requireAdminReview !== false && options.require_admin_review !== false,
      resume: false,
      resume_since: null,
      force_report_build: false,
    },
  };

  const checked = normalizeWorkOrderV2(draft);
  if (!checked.ok) {
    for (const message of checked.errors) push(errors, 'ERR_PACKAGE_DRAFT', message);
    return done();
  }

  return done(draft, {
    package_dir: pkgName,
    data_type: dataType,
    suggested_line: lineId,
    data_files: dataInputs.length,
    references: referenceInputs.length,
  });
}
