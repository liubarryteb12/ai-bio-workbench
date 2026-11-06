/**
 * 竖版单轴图排版契约（2026-11-06 用户指出 l3_mouse_01_domains_* 不合规范）。
 *
 * 病灶：spatial_figures 的 01_domains 用 figsize=(6.8, 5.5)（宽>高，横版），
 * 于是 layout_fix / caption 都按横版规则排：图例放轴框正下方、图注放左下角。
 * 但 ax.set_aspect("equal") + savefig.bbox="tight" 实际渲染出的是
 * 1287x1695 的**竖版** PNG（宽<高），规则与实际图幅错位，
 * 结果就是用户看到的：图缩在右上角、大片留白、图例在图下方、图注跑到左下角。
 *
 * 规范（docs/figure_spec.md §三之二）：
 *   竖版图（宽<高）：图例轴框外右上角；图注轴框外右上角，一条一行。
 *   横版图（宽>=高）：图例轴框下方；图注图幅下方。
 *
 * 判据：声明的 figsize 与最终 PNG 长宽比必须同向；竖版图的图例与图注锚点
 * 必须落在 x>1（轴框右侧），不得用 (0.5, -0.10) 这类下方锚点。
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

test("01_domains 不得声明横向 figsize 却渲染成竖版", () => {
  const src = read();
  // 抓 01 domains 区块里的 figsize
  const i = src.indexOf("01 spatial domain map");
  assert.ok(i > 0, "必须能找到 01 domains 区块");
  const block = src.slice(i, i + 2000);
  // 只认代码行里的 figsize，跳过注释（注释会引用历史值，首版就栽在这）
  const codeOnly = block.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
  const m = codeOnly.match(/figsize=\(([\d.]+),\s*([\d.]+)\)/);
  assert.ok(m, "01 domains 必须有显式 figsize");
  const w = Number(m[1]);
  const h = Number(m[2]);
  // 竖版图幅：高必须不小于宽（等宽也可，但不能明显横向）
  assert.ok(h >= w, "01_domains 图幅应为竖版或方形，实际 figsize=(" + w + ", " + h + ") 为横版；"
    + "横版会在等比例坐标下渲染成竖版 PNG，导致图例/图注锚点与真实图幅错位");
});

test("竖版图的图例锚点必须在轴框右侧（x>1）", () => {
  const src = read();
  const i = src.indexOf("01 spatial domain map");
  const block = src.slice(i, i + 2000);
  const anchors = [...block.matchAll(/bbox_to_anchor=\(([\d.]+),\s*(-?[\d.]+)\)/g)];
  assert.ok(anchors.length > 0, "01 domains 必须有显式图例锚点");
  for (const a of anchors) {
    const x = Number(a[1]);
    assert.ok(x > 1, "竖版图图例锚点 x 必须 >1（轴框右侧），实际 x=" + x);
  }
});

test("caption 的竖版分支锚点在右侧，横版分支在下方", () => {
  const src = read();
  const i = src.indexOf("def caption(");
  const block = src.slice(i, i + 900);
  // 竖版分支：fig.text(1.02, ...)
  assert.match(block, /fig\.text\(1\.02,\s*1\.0/, "竖版图注必须锚在 (1.02, 1.0)");
  // 横版分支：fig.text(0.01, -0.02, ...)
  assert.match(block, /fig\.text\(0\.01,\s*-0\.02/, "横版图注必须锚在 (0.01, -0.02)");
});

test("legend_out 的横竖分支与规范一致", () => {
  const src = read();
  const i = src.indexOf("def legend_out(");
  const block = src.slice(i, i + 900);
  assert.match(block, /if w >= h:/, "legend_out 必须按 w>=h 分横竖两分支");
  assert.match(block, /bbox_to_anchor=\(1\.02,\s*1\.0\)/, "竖版图例锚点必须为 (1.02, 1.0)");
  assert.match(block, /bbox_to_anchor=\(0\.5,\s*-0\.10\)/, "横版图例锚点必须为 (0.5, -0.10)");
});

test("layout_fix 用真实渲染尺寸判横竖，不用声明 figsize", () => {
  const src = read();
  const i = src.indexOf("def layout_fix(");
  const block = src.slice(i, i + 1400);
  // 规范要求按最终图幅判；layout_fix 通过 legend_out 内部的 fig.get_size_inches 取值，
  // 这里只断言它确实调用了 legend_out 与 fit_text_edges
  assert.match(block, /legend_out\(/, "layout_fix 必须调用 legend_out");
  assert.match(block, /fit_text_edges\(/, "layout_fix 必须调用 fit_text_edges");
});
