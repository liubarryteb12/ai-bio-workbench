/**
 * ppi_string 的上游零显著短路与面板选择偏倚披露（Argon 4A 裁定）。
 *
 * 4A 裁定：不做 NanoString PPI 的真正理由不是「网络稀疏」（实测 760/782 匹配、
 * 面板内 12332 条边，反而稠密），而是 ① 上游零显著输入时 PPI 无可比对差异；
 * ② 靶向面板破坏了全基因组无偏拓扑假设，degree 中心性不能宣称新 hub。
 */
import test from "node:test";
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(REPO, "src", "line1_bulk", "scripts", "ppi_string");
const src = fs.readFileSync(SCRIPT, "utf8");

test("n_sig < 2 时短路跳过而非 fail（缺输入是上游结论，不是本步失败）", () => {
  assert.match(src, /if len\(genes\) < 2:/);
  assert.match(src, /上游无足够显著基因/);
  assert.match(src, /sys\.exit\(0\)/, "短路应以成功退出");
  assert.doesNotMatch(src, /fail\("显著模块基因 < 3"\)/, "旧的三基因硬失败应已移除");
});

test("短路落 skip 文件，说明 status 与 reason", () => {
  assert.match(src, /ppi_skip\.json/);
  assert.match(src, /"status": "skipped"/);
  assert.match(src, /"threshold_required": 2/);
  assert.match(src, /不是本步失败/);
});

test("面板选择偏倚按来源类型判定，不按基因数量", () => {
  assert.match(src, /is_wgcna_subset/);
  assert.match(src, /"wgcna" in os\.environ/);
  assert.match(src, /"grey" in sig_modules/);
  assert.match(src, /panel_selection_bias=1 kind=targeted_panel/);
  assert.match(src, /panel_selection_bias=0 kind=genome_scale/);
});

test("偏倚说明含「不得宣称新 hub」的明确边界", () => {
  assert.match(src, /不得据此宣称发现新的 hub 基因/);
  assert.match(src, /需换成全基因组无偏输入/);
});

test("报告固化 edge_scope，便于追溯用的是哪种口径", () => {
  assert.match(src, /edge_scope=%s/);
});

test("hub 轴标签点明限定口径，避免读者误读为全局中心性", () => {
  assert.match(src, /degree within input set/);
  assert.doesNotMatch(src, /set_xlabel\("degree \(STRING interactions\)"\)/);
});