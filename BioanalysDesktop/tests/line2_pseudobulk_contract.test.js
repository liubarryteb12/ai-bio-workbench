// L2 组间差异分析供体级统计契约。
//
// 背景：deg_groups 原先只有逐细胞 Wilcoxon。细胞被当作独立观测时 p 值会随
// 细胞数膨胀，不能当作供体水平显著性。本契约要求同一脚本同时产出两层结果：
//   1. 保留逐细胞 Wilcoxon，并明确标为 exploratory cell-level；
//   2. 新增 donor x celltype pseudobulk，优先 DESeq2/edgeR/limma-voom，
//      依赖不可用或拟合失败时用 donor-level Welch t + BH，并如实标注 fallback；
//   3. 供体不足 2 的 celltype 必须落 skipped_insufficient_donors。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(REPO_ROOT, "tools", "bio", "line2_scrna", "scripts", "deg_groups");

function codeOnly(src) {
  return src
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

const SOURCE = fs.readFileSync(SCRIPT, "utf8");
const CODE = codeOnly(SOURCE);

test("脚本契约保持 LF、bash shebang 与严格模式", () => {
  assert.ok(!SOURCE.includes("\r\n"), "deg_groups 必须是 LF 行尾");
  assert.match(SOURCE, /^#!\/usr\/bin\/env bash\n/, "首行必须是 bash shebang");
  assert.match(SOURCE, /set -euo pipefail/);
});

test("pseudobulk 必须按 donor x celltype 聚合 counts 并做 CPM + log2(CPM+1)", () => {
  assert.match(CODE, /donor x celltype/);
  assert.match(CODE, /layers\[["']counts["']\]/);
  assert.match(CODE, /pd\.factorize|groupby\(/);
  assert.match(CODE, /1e6/);
  assert.match(CODE, /np\.log2\(/);
});

test("pseudobulk 产物文件名与必需字段齐全", () => {
  assert.match(CODE, /deg_pseudobulk_by_celltype\.tsv/);
  for (const col of [
    "celltype", "gene", "n_donors_case", "n_donors_ctrl",
    "log2fc", "p_value", "p_adj", "method", "status",
  ]) {
    assert.match(CODE, new RegExp(`"${col}"`), `pseudobulk 缺字段 ${col}`);
  }
});

test("供体不足的 celltype 必须显式 skipped_insufficient_donors", () => {
  assert.match(CODE, /MIN_DONORS_PER_GROUP\s*=\s*2/);
  assert.match(CODE, /skipped_insufficient_donors/);
  assert.match(
    CODE,
    /n_case\s*<\s*MIN_DONORS_PER_GROUP\s+or\s+n_ctrl\s*<\s*MIN_DONORS_PER_GROUP/,
    "必须在任一组 donor 数小于 2 时跳过",
  );
});

test("优先 DESeq2/edgeR/limma-voom，fallback 必须如实标注边界", () => {
  assert.match(CODE, /DESeq2/);
  assert.match(CODE, /edgeR/);
  assert.match(CODE, /limma/);
  assert.match(CODE, /donor_level_welch_t_BH_fallback/);
  assert.match(CODE, /fallback/);
  assert.match(CODE, /只用于筛选/);
  assert.match(CODE, /不能替代/);
});

test("逐细胞 Wilcoxon 保留，但必须标为 exploratory cell-level 且不声称供体显著", () => {
  assert.match(CODE, /method="wilcoxon"/);
  assert.match(CODE, /exploratory/);
  assert.match(CODE, /cell_level_scope/);
  const reportStart = CODE.indexOf("lines = [");
  assert.ok(reportStart > 0, "必须有 deg_report 的 lines 块");
  const reportBlock = CODE.slice(reportStart);
  assert.match(reportBlock, /exploratory cell-level/);
  assert.match(reportBlock, /cell_level_scope=exploratory_cell_level/);
  assert.match(reportBlock, /不构成供体水平显著性结论/);
});

test("uns['deg'] 与报告必须写入供体数、pseudobulk 方法与限制说明", () => {
  const updateStart = CODE.indexOf('adata.uns["deg"].update({');
  assert.ok(updateStart > 0, "必须有 uns['deg'] 的补充写入");
  const updateEnd = CODE.indexOf("})", updateStart);
  assert.ok(updateEnd > updateStart, "uns['deg'] 补充块必须闭合");
  const unsBlock = CODE.slice(updateStart, updateEnd + 2);
  assert.match(unsBlock, /"n_donors_case":/);
  assert.match(unsBlock, /"n_donors_ctrl":/);
  assert.match(unsBlock, /"pseudobulk_method":/);
  assert.match(unsBlock, /"pseudobulk_limitations":/);
  const reportStart = CODE.indexOf("lines = [");
  assert.ok(reportStart > 0, "必须有 deg_report 的 lines 块");
  const reportBlock = CODE.slice(reportStart);
  assert.match(reportBlock, /pseudobulk_method=%s/);
  assert.match(reportBlock, /n_donors_case=%d/);
  assert.match(reportBlock, /n_donors_ctrl=%d/);
  assert.match(reportBlock, /pseudobulk_limitations=/);
  assert.match(reportBlock, /只用于筛选/);
  assert.match(reportBlock, /不能替代/);
});

test("既有逐细胞产物文件名与 Wilcoxon 输出不变量保持不变", () => {
  assert.match(CODE, /to_csv\("deg_all_by_celltype\.tsv"/);
  assert.match(CODE, /to_csv\("deg_significant_by_celltype\.tsv"/);
  assert.match(CODE, /scrna_deg\.h5ad/);
  assert.match(CODE, /sc\.tl\.rank_genes_groups/);
});
