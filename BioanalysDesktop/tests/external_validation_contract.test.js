import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SCRIPT_DIR = path.join(REPO, 'src', 'line1_bulk', 'scripts');

function readScript(name) {
  return fs.readFileSync(path.join(SCRIPT_DIR, name), 'utf8');
}

test('ml_model 生成可供独立验证复用的冻结模型', () => {
  const text = readScript('ml_model');
  assert.match(text, /external_frozen_model\.tsv/);
  assert.match(text, /feature_order/);
  assert.match(text, /scaler_mean/);
  assert.match(text, /scaler_scale/);
  assert.match(text, /intercept/);
  assert.match(text, /train_dataset/);
  assert.match(text, /train_platform/);
  assert.match(text, /missing_value_strategy/);
  assert.match(text, /LogisticRegression\([\s\S]{0,160}?\.fit\(scaler\.transform\(X\), y\)/);
});

test('external_validation 只消费冻结模型和独立验证矩阵', () => {
  const text = readScript('external_validation');
  assert.doesNotMatch(text, /StratifiedShuffleSplit/);
  assert.doesNotMatch(text, /\.fit\s*\(/);
  assert.match(text, /external_frozen_model\.tsv/);
  assert.match(text, /val_expr_genes\.tsv/);
  assert.match(text, /val_group_map\.tsv/);
  assert.match(text, /validation_type=independent_external_dataset/);
  assert.match(text, /merged_expression=false/);
  assert.match(text, /cross_platform_combat=false/);
  assert.match(text, /feature_reselection=false/);
  assert.match(text, /model_refit=false/);
  assert.match(text, /missing_value_strategy=train_mean/);
  assert.match(text, /external_validation_preds\.tsv/);
  assert.match(text, /external_frozen_coefs\.tsv/);
  assert.match(text, /external_validation_metrics\.tsv/);
  assert.match(text, /external_validation_report\.txt/);
  assert.match(text, /\.\.\/figures\/l1_12_external_roc\.png/);
});

test('external_validation 保持退出码契约', () => {
  const text = readScript('external_validation');
  assert.match(text, /BIOANALYS_SEED[\s\S]{0,120}exit 3/);
  assert.match(text, /\*\)[\s\S]{0,120}exit 2/);
  assert.match(text, /def fail\([\s\S]{0,160}sys\.exit\(1\)/);
});

test('工作流声明冻结模型和独立验证输入的依赖关系', () => {
  const workflows = JSON.parse(fs.readFileSync(path.join(REPO, 'src', 'workflows.json'), 'utf8'));
  const mods = workflows.series
    .flatMap((series) => series.stages.flatMap((stage) => stage.mods));
  const ml = mods.find((mod) => mod.id === 'l1_ml_model');
  const external = mods.find((mod) => mod.id === 'l1_ml_external');
  assert.ok(ml, '缺 l1_ml_model');
  assert.ok(external, '缺 l1_ml_external');
  assert.ok(ml.produces.includes('external_frozen_model.tsv'));
  assert.ok(external.requires.includes('external_frozen_model.tsv'));
  assert.ok(external.requires.includes('val_expr_genes.tsv'));
  assert.ok(external.requires.includes('val_group_map.tsv'));
});
