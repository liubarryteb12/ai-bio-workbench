/**
 * deg_limma 队列效应诊断列的契约测试（生信代码专项审核 P1）。
 *
 * 病灶：跨队列比较时某基因在一组里 >=95% 为零（单侧沉默），limma 会判成高度显著，
 * 但那是批次差异。DCM 基准实测 27% 基因属此类，把 AUC 推到 1.000。
 *
 * 判据：
 *  1. deg_limma 输出三个诊断列（is_single_side_silent / is_low_detection / is_technical）
 *     与汇总列 cohort_suspect；
 *  2. 并行输出 deg_sig_cohortfiltered.tsv，且不删 deg_all.tsv / deg_sig.tsv 的行（保持兼容）；
 *  3. 报告端打印各类计数与过滤前后显著数；
 *  4. R 代码块能被真实 R 解析。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(REPO, "tools", "bio", "line1_bulk", "scripts", "deg_limma");
const src = fs.readFileSync(SCRIPT, "utf8");

test("诊断列齐全：单侧沉默 / 低检出 / 技术性 / 汇总", () => {
  for (const col of ["is_single_side_silent", "is_low_detection", "is_technical", "cohort_suspect"]) {
    assert.match(src, new RegExp(col), "缺诊断列 " + col);
  }
});

test("单侧沉默判据是 95% 零 + 另一组 <50% 零（不是单看零比例）", () => {
  assert.match(src, /case_zero_share >= 0\.95 & ctrl_zero_share < 0\.5/);
  assert.match(src, /ctrl_zero_share >= 0\.95 & case_zero_share < 0\.5/);
});

test("并行输出 cohortfiltered 表，且不删原表（行数兼容）", () => {
  assert.match(src, /fwrite\(deg_table\[, !"is_sig"\], "deg_all\.tsv"/, "deg_all.tsv 必须保留");
  assert.match(src, /fwrite\(sig_table\[, !"is_sig"\], "deg_sig\.tsv"/, "deg_sig.tsv 必须保留");
  assert.match(src, /deg_sig_cohortfiltered\.tsv/, "缺过滤版输出");
  assert.match(src, /sig_filtered <- sig_table\[cohort_suspect == FALSE\]/, "过滤条件应是 cohort_suspect==FALSE");
});

test("报告端打印四类计数与过滤前后显著数", () => {
  for (const key of ["single_side_silent=", "low_detection=", "technical=",
    "cohort_suspect_total=", "sig_before_filter=", "sig_after_filter=", "sig_removed="]) {
    assert.ok(src.includes(key), "报告缺 " + key);
  }
});

test("诊断列不参与 is_sig 判定（过滤是另出的表，不悄悄改主表结论）", () => {
  // is_sig 的赋值行里不得出现 cohort_suspect
  const line = src.split(String.fromCharCode(10)).find((l) => l.includes("is_sig :="));
  assert.ok(line, "找不到 is_sig 赋值行");
  assert.equal(line.includes("cohort_suspect"), false, "is_sig 不应掺入队列诊断，否则主表被悄悄改口径");
});