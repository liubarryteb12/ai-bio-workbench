import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SCRIPT = path.join(REPO, 'src', 'line1_bulk', 'scripts', 'cox_analysis');

function readScript() {
  return fs.readFileSync(SCRIPT, 'utf8');
}

test('cox_analysis 不绑定旧项目数据集或旧项目设计', () => {
  const text = readScript();
  assert.doesNotMatch(text, /GSE277173/);
  assert.doesNotMatch(text, /paired lesion vs perilesional/i);
});

test('cox_analysis 从 project.json 解析训练数据集并在报告中留痕', () => {
  const text = readScript();
  assert.match(text, /BIOANALYS_PROJECT_JSON/);
  assert.match(text, /data_source/);
  assert.match(text, /datasets/);
  assert.match(text, /dataset\$role[\s\S]{0,80}train/);
  assert.match(text, /project_id/);
  assert.match(text, /train_dataset/);
  assert.match(text, /train_platform/);
});

test('cox_analysis 报告 seed 来自运行环境而不是硬编码', () => {
  const text = readScript();
  assert.doesNotMatch(text, /seed=20261013/);
  assert.match(text, /paste\("seed=",\s*Sys\.getenv\("BIOANALYS_SEED"\)\)/);
});
