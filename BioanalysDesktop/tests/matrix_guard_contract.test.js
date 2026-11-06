/**
 * 表达矩阵指纹断言契约（第 69 轮第二审 DeepSeek 加固项 4）。
 *
 * 为什么要它：静态扫描 adata.X 赋值可被至少 6 条路径绕过
 * （切片视图赋值、in-place 缩放、obsm 别名、函数内改写、稀疏对象复用、
 * 下游脚本直接读被污染的 h5ad）。唯一无法绕过的是「进/出指纹比对」。
 *
 * 判据：
 *   1. fingerprint(X) 对形状、非零数、抽样和稳定；
 *   2. assert_unchanged 在指纹漂移时抛 MatrixMutatedError，
 *      错误信息必须带进/出两侧指纹，便于定位是哪一步改的；
 *   3. 指纹必须是纯读取，不得把稀疏矩阵 densify（内存红线）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOD = path.join(REPO, "ops", "matrix_guard.py");

function read() {
  return fs.readFileSync(MOD, "utf8");
}

test("指纹模块必须存在并提供两个入口", () => {
  assert.ok(fs.existsSync(MOD), "缺 ops/matrix_guard.py");
  const src = read();
  assert.match(src, /def fingerprint\(/, "必须提供 fingerprint");
  assert.match(src, /def assert_unchanged\(/, "必须提供 assert_unchanged");
});

test("指纹必须纯读取，不得 densify", () => {
  const src = read();
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.equal(/\.toarray\(\)/.test(code), false, "不得整体 densify 求指纹");
  assert.match(code, /issparse/, "必须区分稀疏与稠密两条路径");
});

test("漂移必须抛 MatrixMutatedError 并带两侧指纹", () => {
  const src = read();
  assert.match(src, /class MatrixMutatedError/, "必须定义专用异常类型");
  const i = src.indexOf("def assert_unchanged");
  assert.ok(i > 0);
  const block = src.slice(i, i + 1200);
  assert.match(block, /raise MatrixMutatedError/, "指纹不等必须抛错");
  assert.match(block, /before/, "错误信息必须含进侧指纹");
  assert.match(block, /after/, "错误信息必须含出侧指纹");
});

test("必须写明用途：拦截平滑矩阵污染 adata.X", () => {
  const src = read();
  assert.match(src, /BANKSY|平滑/, "文档必须点明防平滑污染");
  assert.match(src, /Moran|NNLS/, "文档必须点明保护下游 Moran/NNLS");
});
