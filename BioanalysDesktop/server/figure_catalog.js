import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const FIGURE_ROOT = 'reference/05.可参考生信代码';
const LIBRARY_ROOT = path.join(REPO, FIGURE_ROOT, 'library');
const CATALOG_PATH = path.join(LIBRARY_ROOT, 'catalog.json');
const VALID_STATUSES = new Set([
  'materialized',
  'k40_verified',
  'blocked_dependency',
  'blocked_network',
  'blocked_code',
  'blocked_image',
  'blocked_timeout',
  'split_materialized',
  'split_code_ready',
  'generic_candidate',
  'code_ready',
  'needs_split',
  'image_missing',
  'local_image_missing',
  'code_missing',
]);

let cache = null;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function isInside(root, candidate) {
  const normalizedRoot = path.resolve(root) + path.sep;
  const normalizedCandidate = path.resolve(candidate);
  return normalizedCandidate.startsWith(normalizedRoot);
}

function resolveLibraryPath(relative, errors, entryId, label) {
  if (typeof relative !== 'string' || relative.length === 0) {
    errors.push(`${entryId}: ${label} 缺失`);
    return null;
  }
  const target = path.resolve(LIBRARY_ROOT, relative);
  if (!isInside(LIBRARY_ROOT, target)) {
    errors.push(`${entryId}: ${label} 越界`);
    return null;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    errors.push(`${entryId}: ${label} 文件缺失`);
    return null;
  }
  return target;
}

export function loadFigureCatalog() {
  if (cache) return cache;
  cache = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  return cache;
}

export function reloadFigureCatalog() {
  cache = null;
  return loadFigureCatalog();
}

export function validateFigureCatalog() {
  const catalog = loadFigureCatalog();
  const errors = [];
  const seen = new Set();
  const stats = {
    entries: 0,
    materialized: 0,
    k40_verified: 0,
    blocked_dependency: 0,
    blocked_network: 0,
    blocked_code: 0,
    blocked_image: 0,
    blocked_timeout: 0,
    split_materialized: 0,
    split_code_ready: 0,
    generic_candidate: 0,
    code_ready: 0,
    needs_split: 0,
    image_missing: 0,
    local_image_missing: 0,
    code_missing: 0,
  };

  if (catalog.schema_version !== 1) errors.push('catalog schema_version 必须为 1');
  if (!Array.isArray(catalog.entries)) {
    errors.push('catalog entries 必须是数组');
    return { ok: false, errors, stats };
  }

  for (const entry of catalog.entries) {
    stats.entries += 1;
    const id = entry.catalog_id;
    if (typeof id !== 'string' || id.length === 0) {
      errors.push('catalog_id 缺失');
      continue;
    }
    if (seen.has(id)) errors.push(`${id}: catalog_id 重复`);
    seen.add(id);
    if (!VALID_STATUSES.has(entry.status)) {
      errors.push(`${id}: status 非法 ${entry.status}`);
      continue;
    }
    stats[entry.status] += 1;

    const requiresFiles = [
      'materialized', 'k40_verified', 'code_ready', 'split_materialized',
    ].includes(
      entry.status,
    );
    const codeOnly = entry.status === 'split_code_ready';
    const mayHaveFiles = [
      'blocked_dependency',
      'blocked_network',
      'blocked_code',
      'blocked_image',
      'blocked_timeout',
    ].includes(entry.status);
    if (requiresFiles) {
      const code = resolveLibraryPath(entry.code_path, errors, id, 'code_path');
      const preview = resolveLibraryPath(entry.preview_path, errors, id, 'preview_path');
      if (code && entry.code_file_sha256 !== sha256(code)) {
        errors.push(`${id}: code_file_sha256 与磁盘不一致`);
      }
      if (preview && entry.preview_sha256 !== sha256(preview)) {
        errors.push(`${id}: preview_sha256 与磁盘不一致`);
      }
    } else if (codeOnly) {
      const code = resolveLibraryPath(entry.code_path, errors, id, 'code_path');
      if (code && entry.code_file_sha256 !== sha256(code)) {
        errors.push(`${id}: code_file_sha256 与磁盘不一致`);
      }
      if (entry.preview_path !== null) {
        errors.push(`${id}: split_code_ready 不得带 preview_path`);
      }
    } else if (!mayHaveFiles && (entry.code_path !== null || entry.preview_path !== null)) {
      errors.push(`${id}: 非物化条目不得带 code_path 或 preview_path`);
    } else if (mayHaveFiles) {
      if (entry.code_path !== null) {
        const code = resolveLibraryPath(entry.code_path, errors, id, 'code_path');
        if (code && entry.code_file_sha256 !== sha256(code)) {
          errors.push(`${id}: code_file_sha256 与磁盘不一致`);
        }
      }
      if (entry.preview_path !== null) {
        const preview = resolveLibraryPath(entry.preview_path, errors, id, 'preview_path');
        if (preview && entry.preview_sha256 !== sha256(preview)) {
          errors.push(`${id}: preview_sha256 与磁盘不一致`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, stats };
}

export function searchFigureCatalog({
  query = '',
  language = '',
  status = '',
  limit = 50,
} = {}) {
  const needle = String(query).trim().toLowerCase();
  const normalizedLanguage = String(language).trim().toLowerCase();
  const normalizedStatus = String(status).trim();
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 50, 1000));
  return loadFigureCatalog().entries
    .filter((entry) => {
      if (normalizedLanguage && String(entry.lang).toLowerCase() !== normalizedLanguage) {
        return false;
      }
      if (normalizedStatus && entry.status !== normalizedStatus) return false;
      if (!needle) return true;
      const haystack = [
        entry.title,
        entry.chart_type,
        entry.family,
        entry.bio_tags,
        entry.deps,
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, cappedLimit);
}

export function resolveCatalogFigure(catalogId) {
  const entry = loadFigureCatalog().entries.find(
    (candidate) => candidate.catalog_id === catalogId,
  );
  const errors = [];
  if (!entry) {
    return { ok: false, errors: [`未知图库条目 '${catalogId}'`], entry: null };
  }
  if (![
    'materialized', 'k40_verified', 'code_ready',
    'split_materialized', 'split_code_ready',
  ].includes(entry.status)) {
    errors.push(`${catalogId}: status=${entry.status}，当前不可取用`);
  }
  const codeAbs = resolveLibraryPath(entry.code_path, errors, catalogId, 'code_path');
  const previewAbs = resolveLibraryPath(
    entry.preview_path,
    errors,
    catalogId,
    'preview_path',
  );
  if (codeAbs && entry.code_file_sha256 !== sha256(codeAbs)) {
    errors.push(`${catalogId}: code_file_sha256 与磁盘不一致`);
  }
  if (previewAbs && entry.preview_sha256 !== sha256(previewAbs)) {
    errors.push(`${catalogId}: preview_sha256 与磁盘不一致`);
  }
  return {
    ok: errors.length === 0,
    errors,
    entry,
    code_abs: codeAbs,
    preview_abs: previewAbs,
    code_repo_path: codeAbs
      ? path.relative(REPO, codeAbs).split(path.sep).join('/')
      : null,
    preview_repo_path: previewAbs
      ? path.relative(REPO, previewAbs).split(path.sep).join('/')
      : null,
    code_sha256: codeAbs ? sha256(codeAbs) : null,
    preview_sha256: previewAbs ? sha256(previewAbs) : null,
    suggested_template_id: entry.suggested_template_id || null,
  };
}

export const figureCatalogPaths = {
  repo: REPO,
  figure_root: FIGURE_ROOT,
  library_root: LIBRARY_ROOT,
  catalog: CATALOG_PATH,
};
