/**
 * annot_verify 的功效与置信区间判据（L2 注释核验增强）。
 *
 * 原判据「自 marker 均值高于他类最高值」对低检出小样本类不够充分：
 * B_cell 只有 135 个细胞，均值 25.7% 的 95% CI 宽达 14.6 个百分点。
 * 只看点估计会误以为「25.7% 就是真值」，据此下强断言是不可靠的。
 */
import test from "node:test";
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(REPO, ".tmp", "dcm_bench", "l2", "annot_verify.py");
const REPORT = path.join(REPO, "local_projects", "PRJ_DCM_BENCH_20261105", "results", "line2_scrna", "annot_verify_report.json");

test("源码含 Wilson 置信区间实现与功效警示", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /def wilson_interval/, "缺 Wilson 区间函数");
  assert.match(src, /statistical_power/, "缺功效标注");
  assert.match(src, /insufficient\(n<200\)/, "缺小样本阈值");
  assert.match(src, /membrane_marker_note/, "缺膜蛋白核内检出说明");
});

test("报告含 9 个细胞类型的置信区间", () => {
  const j = JSON.parse(fs.readFileSync(REPORT, "utf8"));
  assert.ok(Array.isArray(j.marker_power_notes));
  assert.equal(j.marker_power_notes.length, 9, "power notes 应覆盖 9 个有 marker 的类");
  for (const n of j.marker_power_notes) {
    assert.ok(n.ci95_low_pct <= n.self_marker_mean_pct, n.celltype + " CI 下界应 <= 均值");
    assert.ok(n.ci95_high_pct >= n.self_marker_mean_pct, n.celltype + " CI 上界应 >= 均值");
    assert.ok(["adequate", "insufficient(n<200)"].includes(n.statistical_power));
  }
});

test("B_cell 被标记功效不足（n=135 < 200）", () => {
  const j = JSON.parse(fs.readFileSync(REPORT, "utf8"));
  const b = j.marker_power_notes.find((n) => n.celltype === "B_cell");
  assert.ok(b, "缺 B_cell 记录");
  assert.equal(b.statistical_power, "insufficient(n<200)");
  // 区间宽度应显著（默认 95% 置信下 n=135 约 14 个百分点）
  assert.ok(b.ci95_high_pct - b.ci95_low_pct > 10, "B_cell 的 CI 宽度应 > 10 个百分点");
});

test("大样本类落在 adequate 且区间窄", () => {
  const j = JSON.parse(fs.readFileSync(REPORT, "utf8"));
  for (const name of ["cardiomyocyte", "fibroblast", "endothelial"]) {
    const n = j.marker_power_notes.find((x) => x.celltype === name);
    assert.equal(n.statistical_power, "adequate", name + " 应 adequate");
    assert.ok(n.ci95_high_pct - n.ci95_low_pct < 3, name + " 的 CI 宽度应 < 3 个百分点");
  }
});

test("膜蛋白 marker 清单非空且含典型膜蛋白", () => {
  const j = JSON.parse(fs.readFileSync(REPORT, "utf8"));
  assert.ok(j.membrane_marker_note.markers.length >= 5);
  assert.ok(j.membrane_marker_note.markers.includes("MS4A1"));
  assert.match(j.membrane_marker_note.note, /snRNA/);
});