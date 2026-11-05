/**
 * deg_limma 的尺度守卫契约（生信代码专项审核 Q1）。
 *
 * 缺陷：limma 要求 log2 尺度输入，但原实现完全不检查尺度，原始计数会被静默
 * 当作 log2 值处理。实测 GSE316126 原始计数：max|log2FC| = 15113（荒谬），
 * log2(x+1) 后降到 2.47（合理）。
 */
import test from "node:test";
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(REPO, "src", "line1_bulk", "scripts", "deg_limma");
const src = fs.readFileSync(SCRIPT, "utf8");

test("尺度守卫使用上四分位数且阈值 50", () => {
  assert.match(src, /q75 <- as\.numeric\(quantile\(mat, 0\.75, na\.rm = TRUE\)\)/);
  assert.match(src, /if \(q75 > 50\)/);
});

test("守卫报错指名原因与解法（不是只说不合格）", () => {
  assert.match(src, /疑似未经 log 变换/);
  assert.match(src, /limma 要求 log2 尺度输入/);
  assert.match(src, /log2\(x\+1\) 或 voom/);
});

test("守卫在 groups 构造之前（尽早拒绝，不做无谓计算）", () => {
  const iGuard = src.indexOf("q75 > 50");
  const iGroups = src.indexOf("groups <- factor(setNames");
  assert.ok(iGuard > 0 && iGroups > 0);
  assert.ok(iGuard < iGroups, "尺度守卫应在分组构造之前");
});

test("守卫报错带实际上四分位数值（便于排障）", () => {
  assert.match(src, /上四分位数 %.2f > 50/);
});

test("既有 NA 校验与分组校验未被移除", () => {
  assert.match(src, /if \(any\(is\.na\(mat\)\)\) fail\("表达矩阵含 NA"\)/);
  assert.match(src, /只支持两组比较/);
});