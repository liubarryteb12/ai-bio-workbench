import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ASSET_ROOT, assetPath, resolveDataOrAsset } from './paths.js';

const EXAMPLES = assetPath('tools', 'bio', 'figure_project_examples.json');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

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

export function figureProjectExamples() {
  return JSON.parse(fs.readFileSync(EXAMPLES, 'utf8'));
}

export function resolveProjectExample(templateId, kind = 'project') {
  const doc = figureProjectExamples();
  const wanted = kind === 'fixture' ? 'registry_sample' : 'latest_project';
  return doc.examples.find((item) => item.id === templateId && item.kind === wanted) || null;
}

/**
 * 本地项目数据图件是否整体在位。
 *
 * 这些 PNG 属于运行载荷（workspace/projects/...，由 gitignore 挡在仓库外），
 * 干净 checkout 上一张都没有；CI 的门户接口不该因此 500。
 * 只有「全部缺失」才算环境形态；部分缺失是本地数据被误删，仍须报错。
 */
export function projectExamplesAvailable() {
  const doc = figureProjectExamples();
  if (doc.examples.length === 0) return false;
  return doc.examples.every((row) => {
    const absolute = resolveDataOrAsset(row.path) || path.join(ASSET_ROOT, row.path);
    return fs.existsSync(absolute);
  });
}

export function validateProjectExamples() {
  const doc = figureProjectExamples();
  const errors = [];
  const ids = new Set(doc.examples.map((row) => row.id));
  if (doc.source_chain !== 'DCM_CHAIN_20261109') errors.push('source_chain 不是 DCM_CHAIN_20261109');
  if (ids.size !== 27) errors.push(`实例模板数应为 27，实际 ${ids.size}`);
  // 干净 checkout 缺整批运行载荷时按 HOST_MISSING_LOCAL_DATA 处理：
  // 静态清单本身（chain / ids）照常校验，逐文件哈希只在文件在位时才谈。
  if (!projectExamplesAvailable()) return errors;
  for (const row of doc.examples) {
    const absolute = resolveDataOrAsset(row.path) || path.join(ASSET_ROOT, row.path);
    if (!fs.existsSync(absolute)) {
      errors.push(`${row.id}: 文件缺失 ${row.path}`);
      continue;
    }
    if (sha256File(absolute) !== row.sha256) errors.push(`${row.id}: SHA256 漂移 ${row.path}`);
    if (row.kind === 'latest_project' && pngDpi(fs.readFileSync(absolute)) !== 300) {
      errors.push(`${row.id}: 最新实例 DPI 非 300`);
    }
  }
  return errors;
}
