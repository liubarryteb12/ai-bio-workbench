/**
 * 单轴空间图排版契约（2026-11-06 用户指出 l3_mouse_01_domains_* 不合规范）。
 *
 * 用户原话：「图例和图注未在主图框外右边」。要求很明确：
 * 单轴空间图的图例与图注都必须落在轴框外的右侧。
 *
 * 演进过程（留档，防回退）：
 *   首版 figsize=(6.8,5.5) 横版声明 -> 等比例坐标 + bbox tight 实际渲染成竖版，
 *     legend_out/caption 按横版分支把图例放轴框下方、图注放左下角，与真实图幅错位。
 *   二版改竖版声明 -> 锚点对了，但方形数据区在竖版画布里留大片空白。
 *   现版改横向画布 + subplots_adjust 固定右栏，图例与图注都在右栏自上而下排列。
 *
 * 判据（与最终实现一致）：
 *   1. 01_domains 用 subplots_adjust 显式预留右栏（right 明显小于 1）；
 *   2. 图例锚点 x>1（轴框右侧）；
 *   3. 图注用 fig.text 显式锚在 x>1，不走 caption() 的横竖自动分支。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SF = path.join(REPO, "src/line3_spatial/scripts/spatial_figures");

function read() {
  return fs.readFileSync(SF, "utf8");
}

/** 取 01 domains 区块的代码行（跳过注释，注释会引用历史值）。 */
function domainsBlock() {
  const src = read();
  const i = src.indexOf("01 spatial domain map");
  assert.ok(i > 0, "必须能找到 01 domains 区块");
  const chunk = src.slice(i, i + 2600);
  return chunk.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
}

test("01_domains 显式预留右侧栏（subplots_adjust right 明显小于 1）", () => {
  const code = domainsBlock();
  const m = code.match(/subplots_adjust\([^)]*right=([\d.]+)/);
  assert.ok(m, "01_domains 必须用 subplots_adjust 显式定位右栏");
  const right = Number(m[1]);
  assert.ok(right <= 0.7, "right 必须 <= 0.7 才留得出图例图注的右栏，实际 " + right);
});

test("01_domains 图例锚点在轴框右侧（x>1）", () => {
  const code = domainsBlock();
  const m = code.match(/bbox_to_anchor=\(([\d.]+),\s*([\d.]+)\)/);
  assert.ok(m, "01_domains 必须有显式图例锚点");
  assert.ok(Number(m[1]) > 1, "图例锚点 x 必须 >1（轴框右侧），实际 " + m[1]);
});

test("01_domains 图注锚在图幅左下角（轴框外），右栏只留图例", () => {
  const code = domainsBlock();
  // 2026-11-06 用户裁定：图注默认左下角，不占用主图数据区
  const m = code.match(/fig\.text\(\s*0\.01\s*,\s*(-?[\d.]+)/);
  assert.ok(m, "01_domains 图注必须用 fig.text 锚在图幅左下角");
  assert.ok(Number(m[1]) < 0, "图注 y 必须为负（轴框之外），实际 " + m[1]);
  // 右栏不得再放图注文字（只留给图例）
  assert.equal(/ax\.text\(\s*1\.\d+/.test(code), false,
    "右栏不得再放图注文字，应改 fig.text 左下");
});

test("caption 统一左下角；legend_out 仍按横竖分支", () => {
  const src = read();
  const cap = src.slice(src.indexOf("def caption("), src.indexOf("def caption(") + 900);
  assert.match(cap, /fig\.text\(0\.01,\s*-0\.02/, "caption 锚点必须为左下 (0.01, -0.02)");
  assert.equal(/if w >= h:/.test(cap), false, "caption 不得再按横竖分支");
  const lg = src.slice(src.indexOf("def legend_out("), src.indexOf("def legend_out(") + 900);
  assert.match(lg, /if w >= h:/, "legend_out 仍须按 w>=h 分横竖");
  assert.match(lg, /bbox_to_anchor=\(1\.02,\s*1\.0\)/, "竖版图例锚点必须为 (1.02, 1.0)");
});

test("layout_fix 对单轴图仍接管图例外置", () => {
  const src = read();
  const lf = src.slice(src.indexOf("def layout_fix("), src.indexOf("def layout_fix(") + 1400);
  assert.match(lf, /legend_out\(/, "layout_fix 必须调用 legend_out");
  assert.match(lf, /fit_text_edges\(/, "layout_fix 必须调用 fit_text_edges");
});
