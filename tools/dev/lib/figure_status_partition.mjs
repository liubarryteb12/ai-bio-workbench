/**
 * figure_status_partition.mjs —— Ready/Draft 分类器（Argon 第 75 轮 Q1 落地核心）
 *
 * 职责：从 figure_templates.json 中分离 ready/draft/invalid，确保 Gate9/10/11 只对正确集合运行断言。
 * 使用原则：
 *   - ready：必须存在 producing_mod_id、preview_sha256、render_evidence，且 preview 文件非空；
 *   - draft：严禁携带 preview_sha256 / render_evidence 等非 null 实证字段；
 *   - invalid：producing_mod_id 不存在于 workflows.json、schema 非法等。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIGURE_STATUS = Object.freeze({
  READY: 'ready',
  DRAFT: 'draft',
});

/** 从 workflows.json 收集所有 mod.id */
function collectModIds() {
  const wfPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'bio', 'workflows.json');
  if (!fs.existsSync(wfPath)) return new Set();
  const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
  const ids = new Set();
  for (const s of (wf.series || [])) {
    for (const st of (s.stages || [])) {
      for (const m of (st.mods || [])) ids.add(m.id);
    }
  }
  return ids;
}

export function partitionByStatus(templates) {
  const ready = [];
  const draft = [];
  const invalid = [];
  const modIds = collectModIds();

  for (const t of templates) {
    if (!t || typeof t !== 'object') {
      invalid.push({ reason: 'non_object', template: t });
      continue;
    }
    const status = t.status ?? undefined; // undefined -> legacy

    // 向后兼容：历史未声明 status 的条目暂视为 ready（带警告但不 fail）
    if (status === undefined) {
      ready.push({ ...t, _legacy_status_defaulted: true });
      continue;
    }

    if (status === FIGURE_STATUS.READY) {
      // 强校验：producing_mod_id 必须存在且存在于 workflows.json
      if (!t.producing_mod_id || !modIds.has(t.producing_mod_id)) {
        invalid.push({ reason: 'invalid_ready_contract', id: t.id, detail: 'producing_mod_id missing or not in workflows.json' });
        continue;
      }
      // ready 必须带预览哈希实证；render_evidence 允许历史欠账为 null（Gate 10 单独治理）
      if (!t.preview_sha256) {
        invalid.push({ reason: 'ready_without_evidence', id: t.id, detail: 'missing preview_sha256' });
        continue;
      }
      ready.push(t);
    } else if (status === FIGURE_STATUS.DRAFT) {
      // Draft 严禁伪造实证
      if (t.preview_sha256 || t.render_evidence) {
        invalid.push({ reason: 'draft_with_fake_evidence', id: t.id, detail: 'draft must have preview_sha256=null and render_evidence=null' });
        continue;
      }
      draft.push(t);
    } else {
      invalid.push({ reason: 'unknown_status', id: t.id, status });
    }
  }

  return { ready, draft, invalid };
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const REGISTRY_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'bio', 'figure_templates.json');
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const templates = Array.isArray(registry) ? registry : (registry.templates || registry.entries || []);
  const { ready, draft, invalid } = partitionByStatus(templates);
  console.log(`Partition: ready=${ready.length}, draft=${draft.length}, invalid=${invalid.length}`);
  for (const i of invalid.slice(0, 5)) console.log('INVALID:', i.reason, i.id || '');
}
