import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXAMPLES = path.join(REPO, 'tools', 'bio', 'figure_project_examples.json');

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

export function validateProjectExamples() {
  const doc = figureProjectExamples();
  const errors = [];
  const ids = new Set(doc.examples.map((row) => row.id));
  if (doc.source_chain !== 'DCM_CHAIN_20261109') errors.push('source_chain 不是 DCM_CHAIN_20261109');
  if (ids.size !== 39) errors.push(`实例模板数应为 39，实际 ${ids.size}`);
  for (const row of doc.examples) {
    const absolute = path.join(REPO, row.path);
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
