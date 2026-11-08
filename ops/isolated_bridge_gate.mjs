#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WORKFLOWS = path.join(ROOT, 'tools', 'bio', 'workflows.json');

function fail(message) {
  console.error(`ISOLATED_BRIDGE_GATE_FAIL ${message}`);
  process.exit(1);
}

const raw = readFileSync(WORKFLOWS, 'utf8');
let registry;
try {
  registry = JSON.parse(raw);
} catch (error) {
  fail(`workflows.json 无法解析: ${error.message}`);
}

const constraints = registry?.constraints || {};
if (constraints.forbidden_cross_series !== true) {
  fail('默认必须保持 forbidden_cross_series=true');
}
const bridges = constraints.allowed_cross_series_bridges;
if (!Array.isArray(bridges)) {
  fail('缺少 allowed_cross_series_bridges 数组');
}
const bridge = bridges.find((item) => item?.id === 'l2_to_l3_celltype_signature');
if (!bridge) {
  fail('缺少 l2_to_l3_celltype_signature 受控桥');
}
const expected = {
  from: 'line2_scrna',
  to: 'line3_spatial',
  scope: 'same_project',
  path: 'public_references/celltype_signatures/<project_id>/signatures.tsv',
  manifest: 'public_references/celltype_signatures/<project_id>/bridge_manifest.json',
};
for (const [key, value] of Object.entries(expected)) {
  if (bridge[key] !== value) {
    fail(`${key} 必须为 ${value}`);
  }
}
if (!Array.isArray(bridge.producers) || bridge.producers[0] !== 'l2_export_celltype_signature') {
  fail('producers 必须声明 l2_export_celltype_signature');
}
if (!Array.isArray(bridge.consumers) || bridge.consumers[0] !== 'l3_branches_celltype') {
  fail('consumers 必须声明 l3_branches_celltype');
}
if (!Array.isArray(bridge.requires) ||
    !bridge.requires.includes('sha256') ||
    !bridge.requires.includes('species_mapping') ||
    !bridge.requires.includes('seed')) {
  fail('requires 必须包含 sha256、species_mapping、seed');
}
console.log('ISOLATED_BRIDGE_GATE_OK 受控桥接事实源成立');
