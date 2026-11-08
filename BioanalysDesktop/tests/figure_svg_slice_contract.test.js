/**
 * Top SVG 逐基因空间表达图契约（任务 1.2，2026-11-06 用户拍板）。
 *
 * 目标：纯增量可视化，不改任何已有分析数值。
 *   1. 复用步骤 7 已算好的 gene_autocorr_<sp>.tsv，不重算 Moran's I；
 *   2. 取 morans_i_mean 最高的 Top N 个 SVG（默认 4）；
 *   3. 逐基因画空间连续表达（viridis），7pt 标注，无图内标题；
 *   4. 复用 1.1 的自适应物理比例尺；
 *   5. 图注写明该基因的 Moran's I 与所用样本，可追溯。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SF = path.join(REPO, "tools/bio/line3_spatial/scripts/spatial_figures");

function codeOnly(src) {
  return src.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
}

function read() {
  return codeOnly(fs.readFileSync(SF, "utf8"));
}

test("必须复用 autocorr 结果表，而不是重算 Moran's I", () => {
  const src = read();
  assert.match(src, /gene_autocorr_%s\.tsv|gene_autocorr_/,
    "必须读 gene_autocorr_<sp>.tsv");
  assert.match(src, /morans_i_mean/, "必须按 morans_i_mean 排序取 Top");
  // 不得在本步骤里重新计算 Moran's I
  assert.equal(/def\s+\w*moran/i.test(src), false,
    "出图步骤不得重新实现 Moran's I 计算");
});

test("输出图名必须落在 04_morans_slice_<gene> 命名族", () => {
  const src = read();
  assert.match(src, /04_morans_slice_/, "图名必须含 04_morans_slice_");
});

test("逐基因图必须用 viridis 连续色阶并挂物理比例尺", () => {
  const src = read();
  const i = src.indexOf("04_morans_slice_");
  assert.ok(i > 0, "必须能找到该图块");
  const block = src.slice(Math.max(0, i - 2600), i + 400);
  assert.match(block, /cmap="viridis"/, "连续表达量必须用 viridis");
  assert.match(block, /add_scalebar\(/, "必须复用自适应物理比例尺");
  assert.match(block, /colorbar\(/, "连续量必须有 colorbar");
});

test("图注必须写明 Moran's I 与所用样本（可追溯）", () => {
  const src = read();
  const i = src.indexOf("04_morans_slice_");
  const block = src.slice(Math.max(0, i - 2600), i + 400);
  assert.match(block, /Moran/, "图注必须写明 Moran's I 数值");
  assert.match(block, /morans_i_mean/, "图注数值必须取自表里的 morans_i_mean");
  assert.match(block, /sample=/, "图注必须写明所用样本");
});

test("Top N 必须可配置，默认 4", () => {
  const src = read();
  assert.match(src, /BIO_SVG_TOP_N/, "必须有 BIO_SVG_TOP_N 开关");
  assert.match(src, /BIO_SVG_TOP_N",\s*"4"/, "默认值应为 4");
});
