/**
 * 解卷积零算力优化契约（任务 3.1 方案 A，2026-11-06 用户拍板）。
 *
 * 背景：AGENTS.md 硬规则禁止在生产链引入 cell2location / RCTD 等重型算法
 * （8GB 设备会 OOM Exit 137；当天已实测 Termux 被 LMK 杀掉 5 次）。
 * 精度提升走零算力路线，落在 celltype_annotation 三处：
 *   1. 每域签名从 Top5 提到 Top20（降 drop-out 干扰）；
 *   2. 特异性过滤：在超过 3 个域的 Top20 里出现的基因视为非特异，剔除；
 *   3. 输出端 <0.05 丰度硬截断后重新行归一化（压背景弥散假阳性）。
 * 口径不变：仍是域 marker 自签名 + scipy.optimize.nnls，不引入外部参考谱。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(REPO, "tools/bio/line3_spatial/scripts/celltype_annotation");

function codeOnly(src) {
  return src.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
}

function read() {
  return codeOnly(fs.readFileSync(SRC, "utf8"));
}

test("每域签名基因数必须提到 20", () => {
  const src = read();
  const m = src.match(/TOP_MARKERS_PER_DOMAIN\s*=\s*(\d+)/);
  assert.ok(m, "必须有 TOP_MARKERS_PER_DOMAIN 常量");
  assert.equal(Number(m[1]), 20, "每域签名基因数必须为 20，实际 " + m[1]);
});

test("必须有特异性过滤：跨域出现过多的基因要被剔除", () => {
  const src = read();
  assert.match(src, /MAX_MARKER_DOMAIN_SHARE\s*=\s*3/,
    "必须有「最多出现在几个域」的阈值常量，值 3");
  // 必须真的按域出现次数统计并剔除
  assert.match(src, /domain_share|appear|share\s*=/,
    "必须有跨域出现次数的统计变量");
  assert.match(src, /if\s+\w*share\w*\s*>\s*MAX_MARKER_DOMAIN_SHARE|>\s*MAX_MARKER_DOMAIN_SHARE/,
    "必须按阈值剔除基因");
});

test("输出端必须有 0.05 硬截断并在截断后重新归一化", () => {
  const src = read();
  assert.match(src, /PROPORTION_CUTOFF\s*=\s*0\.05/, "必须有 0.05 截断常量");
  assert.match(src, /props\[props\s*<\s*PROPORTION_CUTOFF\]\s*=\s*0\.0/,
    "必须把低于截断值的丰度强制归零");
  // 截断后必须重新归一化，否则每行不再和为 1。
  // 锚到「截断之后再出现 props = props / <行和>」这个真实语句，
  // 不依赖具体变量名（实现用的是 _cut_row_sum）。
  const cut = src.indexOf("props[props < PROPORTION_CUTOFF] = 0.0");
  assert.ok(cut > 0, "必须有截断语句");
  const tail = src.slice(cut);
  assert.match(tail, /props\s*=\s*props\s*\/\s*\w+/,
    "截断之后必须重新归一化（props = props / 行和）");
});

test("截断必须发生在 argmax 注释之前", () => {
  const src = read();
  const cut = src.indexOf("props[props < PROPORTION_CUTOFF] = 0.0");
  const argmax = src.indexOf("props.argmax(axis=1)");
  assert.ok(cut > 0 && argmax > cut,
    "注释取 argmax 必须在截断之后，否则主细胞类型仍来自未截断的伪阳性");
});

test("报告必须如实记录三项改动（可溯源）", () => {
  const src = read();
  const i = src.indexOf("report_lines = [");
  assert.ok(i > 0, "必须有 report_lines");
  const tail = src.slice(i);
  assert.match(tail, /TOP_MARKERS|top_markers/, "报告须记录签名基因数");
  assert.match(tail, /specificity/, "报告须记录特异性过滤开关");
  assert.match(tail, /cutoff/, "报告须记录截断阈值");
});
