import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROFILES = path.join(REPO, 'tools', 'bio', 'figure_template_profiles.json');
const EXAMPLES = path.join(REPO, 'tools', 'bio', 'figure_project_examples.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadTemplateCatalog() {
  const profiles = readJson(PROFILES).profiles;
  const examples = readJson(EXAMPLES).examples;
  const exampleByTemplate = new Map();
  for (const example of examples) {
    if (!exampleByTemplate.has(example.id)) exampleByTemplate.set(example.id, {});
    exampleByTemplate.get(example.id)[example.kind] = example;
  }
  return profiles.map((profile) => {
    const bound = exampleByTemplate.get(profile.id) || {};
    return {
      ...profile,
      registry_preview: profile.preview,
      registry_sample_project_output: profile.sample_project_output,
      latest_example: bound.latest_project || null,
      registry_example: bound.registry_sample || null,
      preview_available: profile.status === 'ready' && Boolean(bound.latest_project),
      preview_state: profile.status === 'ready' && bound.latest_project ? 'ok' : 'not_verified',
      preview_url: profile.status === 'ready' && bound.latest_project
        ? `/api/figure-templates/preview?id=${encodeURIComponent(profile.id)}`
        : null,
      project_preview_url: profile.status === 'ready' && bound.latest_project
        ? `/api/figure-templates/project-preview?id=${encodeURIComponent(profile.id)}`
        : null,
      preview_source: bound.latest_project?.path || profile.preview || null,
      example_source: bound.latest_project ? 'DCM_CHAIN_20261109' : null,
    };
  });
}

export function loadTemplateCatalogById() {
  return new Map(loadTemplateCatalog().map((item) => [item.id, item]));
}

export function validateTemplateCatalog() {
  const entries = loadTemplateCatalog();
  const errors = [];
  if (entries.length !== 92) errors.push(`全量模板目录应为 92 条，实际 ${entries.length}`);
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) errors.push(`${entry.id}: id 重复`);
    ids.add(entry.id);
    for (const key of ['name', 'english_name', 'purpose', 'introduction', 'status_label', 'level_label']) {
      if (!entry[key]) errors.push(`${entry.id}: 缺 ${key}`);
    }
    if (entry.status === 'ready' && !entry.preview_available) {
      errors.push(`${entry.id}: ready 模板缺最新图实例`);
    }
  }
  return { ok: errors.length === 0, errors, total: entries.length };
}
