#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const gate = spawnSync(process.execPath, ['ops/module_ablation_matrix.mjs'], {
  cwd: REPO, encoding: 'utf8', windowsHide: true,
});
const output = `${gate.stdout || ''}${gate.stderr || ''}`.trim();
if (gate.status !== 0 || !output.includes('MODULE_ABLATION_MATRIX_OK')) {
  console.error(output || `module_ablation_matrix 退出码 ${gate.status}`);
  process.exit(1);
}
const tests = spawnSync(process.execPath, [
  '--test', path.join(REPO, 'BioanalysDesktop/tests/module_ablation_matrix_contract.test.js'),
], { cwd: REPO, encoding: 'utf8', windowsHide: true });
const testOutput = `${tests.stdout || ''}${tests.stderr || ''}`.trim();
if (tests.status !== 0) {
  console.error(testOutput);
  process.exit(1);
}
console.log('MODULE_ABLATION_MATRIX_GATE_OK');
