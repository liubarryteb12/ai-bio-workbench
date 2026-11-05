/**
 * L2 谱系互斥度契约（Argon 3B 裁定落地）。
 *
 * 三次阈值修正的记录：90 分位 -> T/B 双阳性 100%（荒谬，因表达值 clip 在 10）；
 * >0 -> 多阳性 77.2%（非零不等于阳性）；
 * 相对该基因目标类型内中位表达 x0.5 -> 多阳性 36.2%，关键互斥对 < 5%。
 */
import test from "node:test";
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(REPO, ".tmp", "dcm_bench", "l2", "lineage_exclusivity.py");
const REPORT = path.join(REPO, "local_projects", "PRJ_DCM_BENCH_20261105", "results", "line2_scrna", "lineage_exclusivity.json");
const src = fs.readFileSync(SCRIPT, "utf8");
const j = JSON.parse(fs.readFileSync(REPORT, "utf8"));

test("谱系互斥：B_cell 与 T_cell 双阳性率 < 5%（免疫谱系干净）", () => {
  const pairs = j.exclusive_pair_detail;
  const bt = pairs.find((p) => p.labeled_as === "B_cell" && p.also_positive_for === "T_cell");
  const tb = pairs.find((p) => p.labeled_as === "T_cell" && p.also_positive_for === "B_cell");
  assert.ok(bt && tb, "缺 B/T 互斥对");
  assert.ok(bt.pct_double_positive < 5, "B->T 双阳性率应 < 5%%，实际 " + bt.pct_double_positive);
  assert.ok(tb.pct_double_positive < 5, "T->B 双阳性率应 < 5%%，实际 " + tb.pct_double_positive);
});

test("周细胞与内皮双阳性率低（心肌组织内谱系可分）", () => {
  const p = j.exclusive_pair_detail.find(
    (x) => x.labeled_as === "pericyte" && x.also_positive_for === "endothelial");
  assert.ok(p, "缺 pericyte/endothelial 对");
  assert.ok(p.pct_double_positive < 10, "应 < 10%%，实际 " + p.pct_double_positive);
});

test("结果覆盖 9 类互斥对，且样本量非零", () => {
  assert.equal(j.exclusive_pair_detail.length, 18, "应有 18 条有向对（9 对双向）");
  for (const p of j.exclusive_pair_detail) {
    assert.ok(p.n_cells > 0, p.labeled_as + " 样本量为 0");
  }
});

test("阈值口径记录在报告里（可追溯，不是黑箱）", () => {
  assert.ok(j.thresholds_applied, "缺 thresholds_applied");
  assert.ok(Object.keys(j.thresholds_applied).length >= 9);
  assert.match(j.threshold, /median expression among positive cells/);
});

test("脚本记录三次阈值修正的原因（防后人改回 90 分位）", () => {
  assert.match(src, /90 分位|90th percentile/);
  assert.match(src, /「非零」不等于「阳性」/);
  assert.match(src, /RELATIVE_LEVEL/);
});