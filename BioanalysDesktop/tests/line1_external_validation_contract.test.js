import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(REPO, "src", "line1_bulk", "scripts", "external_validation");
const WORKFLOWS = path.join(REPO, "src", "workflows.json");
const src = fs.readFileSync(SCRIPT, "utf8");

function findModule(node, id) {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findModule(item, id);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const value of Object.values(node)) {
    const found = findModule(value, id);
    if (found) return found;
  }
  return null;
}

test("external_validation 支持动态 case_group 与 ctrl_group 解析", () => {
  assert.match(src, /case_group\s*=\s*""/);
  assert.match(src, /ctrl_group\s*=\s*""/);
  assert.match(src, /DCM|LS|Tumor|Disease/);
  assert.match(src, /Control|Ctrl|Normal|NonDiseased/);
});

test("external_validation 预测表同时保留 prob_LS 与动态 prob_<case_group>", () => {
  assert.match(src, /"prob_LS":\s*p_val/);
  assert.match(src, /\("prob_"\s*\+\s*case_group\):\s*p_val/);
});

test("external_validation 冻结特征门槛支持单一关键基因（如 ATM）", () => {
  assert.match(src, /if\s+len\(features\)\s*<\s*1:/);
});

test("external_validation 方向表同时保留 direction 与 direction_LS", () => {
  assert.match(src, /"direction":\s*\("up_in_"\s*\+\s*case_group\)/);
  assert.match(src, /"direction_LS":\s*"up_in_LS"/);
});

test("external_validation 输入分流识别 external_frozen_model 与 val_* 文件", () => {
  assert.match(src, /\*external_frozen_model\*\.tsv\)\s+frozen_file="\$path"/);
  assert.match(src, /\*val_expr_genes\*\.tsv\)\s+val_expr_file="\$path"/);
  assert.match(src, /\*val_group_map\*\.tsv\)\s+val_group_file="\$path"/);
  assert.match(src, /\*\)\s+echo "无法识别的输入: \$path" >&2;\s+exit 2/);
});

test("external_validation 外部模式在 cwd 有冻结模型与独立验证集时启用", () => {
  assert.match(src, /\[ -f "\$frozen_file" \]\s*&&\s*\[ -f "\$val_expr_file" \]\s*&&\s*\[ -f "\$val_group_file" \]/);
  assert.match(src, /validation_mode="external_cohort_frozen"/);
});

test("external_validation 真正调用 parse_frozen_model 读取冻结参数", () => {
  assert.match(src, /metadata,\s*parameters\s*=\s*parse_frozen_model\(frozen_path\)/);
  assert.match(src, /validation_type = "external_cohort_frozen"/);
});

test("external_validation 外部模式只做冻结预测，不重训、不重新筛基因、不调参", () => {
  const start = src.indexOf("# 独立验证只消费冻结参数");
  const end = src.indexOf('    kt = pd.read_csv(os.environ["KEY_FILE"]', start);
  assert.ok(start >= 0 && end > start, "外部冻结预测分支应可定位");
  const externalBlock = src.slice(start, end);
  assert.match(externalBlock, /parse_frozen_model|parameters\["gene"\]/);
  assert.match(externalBlock, /np\.exp/);
  assert.match(externalBlock, /metadata\["intercept"\]/);
  assert.doesNotMatch(externalBlock, /LogisticRegression|StandardScaler|StratifiedShuffleSplit|\.fit\(/);
});

test("external_validation 外部报告写明冻结模型来源与训练、验证样本信息", () => {
  assert.match(src, /frozen_name = os\.path\.basename\(frozen_path\)/);
  assert.match(src, /"frozen_model_source=ml_model 产出 %s"/);
  assert.match(src, /"train_dataset=%s train_platform=%s"/);
  assert.match(src, /"frozen_features=%d"/);
  assert.match(src, /"n_validation=%d"/);
});

test("workflows.json 的 l1_ml_external 契约与实现一致且冻结模型为可选", () => {
  const registry = JSON.parse(fs.readFileSync(WORKFLOWS, "utf8"));
  const module = findModule(registry, "l1_ml_external");
  assert.ok(module, "l1_ml_external 应存在于 workflows.json");
  assert.equal(module.script, "external_validation");
  assert.equal(module.language, "Python");
  assert.ok(module.requires.includes("expr_genes.tsv"));
  assert.ok(module.requires.includes("group_map.tsv"));
  assert.ok(module.requires.includes("key_genes.tsv"));
  assert.ok(!module.requires.includes("external_frozen_model.tsv"), "冻结模型不应成为所有项目硬性必需输入");
  assert.match(module.notes, /external_frozen_model\.tsv/);
  assert.match(module.notes, /external_cohort_frozen/);
  assert.match(module.notes, /internal_holdout_approximation/);
  assert.match(module.notes, /可选输入/);
});
