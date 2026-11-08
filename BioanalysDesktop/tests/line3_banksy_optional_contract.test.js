/**
 * BANKSY 可选空间平滑分支契约（Argon 第 69 轮 Q2c 裁定：默认关闭受控合入）。
 *
 * 裁定要点：
 *   1. 默认 lambda=0.0，完全旁路平滑，存量基准零漂移；
 *   2. 显式开启时走「HVG2000（上游已保证）-> lambda 平滑 -> PCA30（上游已给）」，
 *      只在 30 维上做矩阵乘法，不得回全基因 21318 维（8GB 设备会 OOM）；
 *   3. 平滑结果只写 obsm，绝不覆盖 adata.X；进出用 matrix_guard 指纹断言；
 *   4. 孤立点（degree=0）必须保留原值，不得被 (1-lambda) 收缩。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(REPO, "tools/bio/line3_spatial/scripts/spatial_domains");

function read() {
  return fs.readFileSync(SRC, "utf8");
}

function codeOnly(src) {
  return src.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
}

test("必须提供 --banksy-lambda 开关且默认 0.0（旁路）", () => {
  const src = codeOnly(read());
  assert.match(src, /--banksy-lambda/, "必须暴露 --banksy-lambda 命令行开关");
  assert.match(src, /BANKSY_LAMBDA/, "必须有 BANKSY_LAMBDA 变量");
  // 默认必须是 0.0：存量基准要求 100% 可复现
  // 本项目母版用「bash 解析 --xxx 后 export 环境变量给 python」的既有约定，
  // 不引入 argparse（与 --input/--output/--seed 保持一致）。
  assert.match(src, /--banksy-lambda\)\s*BANKSY_LAMBDA_ARG="\$2"/,
    "bash 侧必须解析 --banksy-lambda 并接住取值");
  assert.match(src, /BIO_BANKSY_LAMBDA="\$\{BANKSY_LAMBDA_ARG:-0\.0\}"/,
    "默认值必须是 0.0（未显式给时完全旁路）");
  assert.match(src, /BANKSY_LAMBDA\s*=\s*float\(\s*os\.environ\.get\(\s*"BIO_BANKSY_LAMBDA"\s*,\s*"0\.0"\s*\)\s*\)/,
    "python 侧必须从 BIO_BANKSY_LAMBDA 读取，缺省 0.0");
});

test("平滑必须在 PCA 维度上做，禁止回到全基因维", () => {
  const src = codeOnly(read());
  const i = src.indexOf("def _banksy_smooth");
  assert.ok(i > 0, "必须有 _banksy_smooth 函数");
  const block = src.slice(i, i + 1600);
  assert.match(block, /X_pca/, "平滑必须作用在 PCA 表示上");
  assert.equal(/adata\.X\s*=\s*/.test(block), false, "不得把平滑结果赋回 adata.X");
});

test("孤立点必须保留原值，不得被 (1-lambda) 收缩", () => {
  const src = codeOnly(read());
  const i = src.indexOf("def _banksy_smooth");
  const block = src.slice(i, i + 1600);
  assert.match(block, /deg\b|degree|isolated/, "必须识别孤立点");
  assert.match(block, /isolated/, "必须显式处理孤立点");
  assert.match(block, /X_pca\[isolated\]/, "孤立点必须回填原始 PCA 值");
});

test("平滑结果只写 obsm，并做进出指纹断言", () => {
  const src = codeOnly(read());
  assert.match(src, /X_banksy_pca/, '输出必须写到 obsm["X_banksy_pca"]');
  assert.match(src, /from matrix_guard import fingerprint, assert_unchanged/,
    "必须真的从 matrix_guard 导入两个函数");
  // 锚到调用点本身。首版只查 /matrix_guard|assert_unchanged|fingerprint/，
  // 把调用删掉后 import 行仍能匹配，断言照样通过（MUT-L 存活）。
  assert.match(src, /_mg\[1\]\(\s*_x_fp_before\s*,\s*adata\.X\s*,\s*stage=/,
    "必须在平滑后真的调用进出指纹断言");
  assert.equal(/^\s*adata\.X\s*=/m.test(src), false, "严禁对 adata.X 整体赋值");
  // sub 是 adata 的拷贝，写 sub.X 不污染 adata；真正危险的是直接写 adata.X。
});

test("默认态必须在报告里写明旁路（可追溯）", () => {
  const src = codeOnly(read());
  assert.match(src, /banksy_lambda/, "报告必须记录 banksy_lambda 取值");
});
test("env 取值必须排在参数解析之后（否则 --banksy-lambda 静默失效）", () => {
  const src = read();
  const argAt = src.indexOf('--banksy-lambda) BANKSY_LAMBDA_ARG=');
  const useAt = src.indexOf('BIO_BANKSY_LAMBDA="${BANKSY_LAMBDA_ARG:-0.0}"');
  assert.ok(argAt > 0 && useAt > 0, "参数解析与取值都必须存在");
  // 本轮实测踩到：取值写在 while 循环之前，参数还没解析完就取了值，
  // 于是 --banksy-lambda 0.2 静默变成 0.0，三次跑出完全相同的 md5。
  assert.ok(useAt > argAt,
    "BIO_BANKSY_LAMBDA 的赋值必须排在 --banksy-lambda 解析之后");
});
test("obsm 分配列数必须取 X_pca 实际维度，不得用 N_PCS", () => {
  const src = codeOnly(read());
  const i = src.indexOf('"X_banksy_pca" not in adata.obsm');
  assert.ok(i > 0, "必须有 X_banksy_pca 分配");
  const block = src.slice(i, i + 420);
  // 实测踩到：N_PCS=30 只是邻居用的维数，X_pca 实际 50 维，
  // 按 N_PCS 分配会报 shape mismatch (2417,50) vs (2417,30)。
  assert.match(block, /adata\.obsm\["X_pca"\]\.shape\[1\]/,
    "分配列数必须取 X_pca 的实际维度");
  assert.equal(/\(adata\.shape\[0\],\s*N_PCS\)/.test(block), false,
    "不得按 N_PCS 分配列数");
});
