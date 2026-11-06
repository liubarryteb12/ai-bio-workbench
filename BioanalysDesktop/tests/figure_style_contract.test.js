/**
 * 图件样式契约（方案 B，2026-11-06 用户裁定）。
 *
 * 只采纳三项纯增益项，红线不动：
 *   1. 字体统一 Arial / Helvetica（无衬线）；
 *   2. 字号阶梯：轴标题与图例标题 7pt，刻度与图内标注 6-7pt；
 *   3. 离散分类色板改 Okabe-Ito 八色（超出后平滑扩充）。
 *
 * 红线（用户明确要求保留，任何改动都不得触碰）：
 *   - savefig.bbox = "tight" 必须保留（左下角图注与右侧图例依赖它扩边）；
 *   - 多图拼接（如 16_domain_panel）必须保留。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LINES = ["line1_bulk", "line2_scrna", "line3_spatial"];
const OKABE = ["#E69F00", "#56B4E9", "#009E73", "#F0E442",
               "#0072B2", "#D55E00", "#CC79A7", "#000000"];

function figureMasters() {
  const out = [];
  for (const line of LINES) {
    const dir = path.join(REPO, "src", line, "scripts");
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name === "README.md") continue;
      if (/\.(py|R|sh|md|json|tsv|csv)$/i.test(e.name)) continue;
      const abs = path.join(dir, e.name);
      const src = fs.readFileSync(abs, "utf8");
      if (!/savefig|ggsave|dev\.copy|\bpng\s*\(/.test(src)) continue;
      out.push({ rel: line + "/" + e.name, src, isR: /\bggsave\s*\(|\bpar\s*\(/.test(src) });
    }
  }
  return out;
}

function codeOnly(src) {
  return src.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
}

test("每份图件母版都必须声明 Arial 或 Helvetica", () => {
  const bad = [];
  for (const m of figureMasters()) {
    const c = codeOnly(m.src);
    // 必须含 Arial/Helvetica；同时必须给出度量兼容的回退（Liberation Sans），
    // 否则在未装 Arial 的机器上会静默退回 DejaVu Sans，字宽与 Arial 不一致。
    const ok = /font\.sans-serif[\s\S]{0,240}Arial|Arial[\s\S]{0,240}Helvetica/.test(c)
      || /base_family\s*=\s*["'](sans|Arial|Helvetica)["']/.test(c)
      || /par\s*\([^)]*family\s*=\s*["']sans["']/.test(c)
      || /family\s*=\s*["']Arial["']/.test(c);
    if (!ok) bad.push(m.rel);
  }
  assert.deepEqual(bad, [], "以下母版未声明 Arial/Helvetica：" + bad.join(", "));
});

test("字号字面量不得超过 7pt（轴标题/图例标题 7，刻度与标注 6-7）", () => {
  const bad = [];
  for (const m of figureMasters()) {
    const c = codeOnly(m.src);
    for (const mm of c.matchAll(/fontsize\s*=\s*([\d.]+)/g)) {
      const v = Number(mm[1]);
      if (v > 7) bad.push(m.rel + " fontsize=" + v);
    }
  }
  assert.deepEqual(bad, [], "以下位置字号超过 7pt：" + bad.join("; "));
});

test("rcParams 里的字号键也不得超过 7pt", () => {
  // 首版只查 fontsize= 字面量，改 rcParams 的 "font.size": 9 不会被发现（MUT-B 曾存活）。
  const bad = [];
  for (const m of figureMasters()) {
    if (m.isR) continue;
    const c = codeOnly(m.src);
    const re = /"(font\.size|axes\.titlesize|axes\.labelsize|legend\.fontsize|legend\.title_fontsize|xtick\.labelsize|ytick\.labelsize)"\s*:\s*([\d.]+)/g;
    for (const mm of c.matchAll(re)) {
      if (Number(mm[2]) > 7) bad.push(m.rel + " " + mm[1] + "=" + mm[2]);
    }
  }
  assert.deepEqual(bad, [], "rcParams 字号超过 7pt：" + bad.join("; "));
});

test("离散分类色板必须使用 Okabe-Ito 八色", () => {
  const bad = [];
  for (const m of figureMasters()) {
    // 只约束 Python 母版里的「字面量分类色板赋值」。
    // 合理例外（不纳入判据）：
    //   - R 母版：WGCNA 的 labels2colors 是领域标准模块色，case/ctrl 用项目语义色；
    //   - 项目语义色 #EE0000 / #3B4992：表示 case / control，不是任意分类。
    if (m.isR) continue;
    const c = codeOnly(m.src);
    const hasLiteralPalette = /\bpalette\s*=\s*[\[(]/.test(c) || /\bcat_colors\s*\(/.test(c);
    if (!hasLiteralPalette) continue;
    const hit = OKABE.some((h) => c.includes(h));
    if (!hit) bad.push(m.rel);
  }
  assert.deepEqual(bad, [], "以下母版定义了字面量分类色板但未使用 Okabe-Ito：" + bad.join(", "));
});

test("不得再把裸 tab20 当分类色板（会 i%20 循环撞色）", () => {
  // 2026-11-06 实测：spatial_figures 的 cat_colors 用 tab20 + i%20，
  // 57 个域会循环撞色；而契约首版被同文件另一处的 Okabe 色板满足而漏判。
  // tab20b / tab20c 作为「Okabe 之后的扩充」是允许的，只禁裸 tab20 取色。
  const bad = [];
  for (const m of figureMasters()) {
    if (m.isR) continue;
    const c = codeOnly(m.src);
    if (/plt\.get_cmap\(\s*["']tab20["']\s*\)/.test(c)) bad.push(m.rel);
  }
  assert.deepEqual(bad, [], "以下母版仍用裸 tab20 取分类色：" + bad.join(", "));
});

test("红线：savefig.bbox 必须是 tight（图注与图例靠它扩边）", () => {
  const bad = [];
  for (const m of figureMasters()) {
    if (m.isR) continue; // R 走 ggsave 自己的尺寸逻辑
    const c = codeOnly(m.src);
    if (!/savefig\.bbox["']?\s*:\s*["']tight/.test(c)) bad.push(m.rel);
  }
  assert.deepEqual(bad, [], "以下 Python 母版丢失了 savefig.bbox=tight：" + bad.join(", "));
});

test("红线：多图拼接母版必须保留（16_domain_panel 不得被拆）", () => {
  const sf = fs.readFileSync(path.join(REPO, "src/line3_spatial/scripts/spatial_figures"), "utf8");
  assert.match(sf, /16_domain_panel/, "16_domain_panel 必须仍在产出");
});
