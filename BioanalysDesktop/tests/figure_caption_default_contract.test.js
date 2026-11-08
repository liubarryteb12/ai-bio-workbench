/**
 * 图注默认位置契约（2026-11-06 用户裁定）。
 *
 * 用户原话：「每个图的介绍默认写在图的左下角，并不要影响主图展示。」
 *
 * 因此：
 *   1. 图注（caption）默认一律锚在**图幅左下角**，且位于轴框之外（y < 0），
 *      靠 savefig(bbox="tight") 向下扩边容纳，**不占用、不挤压主图数据区**；
 *   2. 不再按图幅横竖分支选位置（旧规范是「横版在下、竖版右上」，竖版右上会让
 *      图注压到图例列或右上空白区，与用户要求不符）；
 *   3. 图例（legend）仍按横竖外置，不受本裁定影响。
 *
 * 判据锚在「caption 函数体内真实语句」上，不查全文字样：
 * 本仓库此前多次出现「注释或说明文字替规则作证」的假绿，这里逐母版取函数体。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LINES = ["line1_bulk", "line2_scrna", "line3_spatial"];

/** 列出所有定义了 def caption( 的母版。 */
function captionMasters() {
  const out = [];
  for (const line of LINES) {
    const dir = path.join(REPO, "tools", "bio", line, "scripts");
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name === "README.md") continue;
      if (/\.(py|R|sh|md|json|tsv|csv)$/i.test(e.name)) continue;
      const src = fs.readFileSync(path.join(dir, e.name), "utf8");
      const m = src.match(/def caption\(/);
      if (!m) continue;
      // 取函数体：从 def 行到下一个顶格 def/注释块之前的缩进块
      const start = m.index;
      const rest = src.slice(start);
      const lines = rest.split(/\r?\n/);
      const body = [];
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (i > 0 && ln.length > 0 && !/^\s/.test(ln)) break;
        body.push(ln);
      }
      out.push({ rel: line + "/" + e.name, body: body.join("\n") });
    }
  }
  return out;
}

test("每个 caption 都必须把图注锚在图幅左下角（轴框外）", () => {
  const masters = captionMasters();
  assert.ok(masters.length >= 12, "实测至少 12 份母版定义 caption，当前 " + masters.length);
  const offenders = [];
  for (const m of masters) {
    const code = m.body.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
    // 必须出现「左下角 + 轴框外」的锚点
    const anchored = /fig\.text\(\s*0\.01\s*,\s*-0\.0\d/.test(code);
    if (!anchored) offenders.push(m.rel + "（缺 fig.text(0.01, -0.0x) 左下锚点）");
  }
  assert.deepEqual(offenders, [], "以下母版图注未锚在左下角：" + offenders.join("; "));
});

test("caption 不得再按图幅横竖分支决定位置", () => {
  const masters = captionMasters();
  const offenders = [];
  for (const m of masters) {
    const code = m.body.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
    // 旧实现用 w,h = fig.get_size_inches() + if w >= h: 选位置；新实现应删除该分支
    const hasAspectBranch = /if\s+w\s*>=\s*h\s*:/.test(code);
    if (hasAspectBranch) offenders.push(m.rel);
  }
  assert.deepEqual(offenders, [],
    "以下母版仍按横竖分支放图注，与「默认左下角」冲突：" + offenders.join("; "));
});

test("图注锚点必须在轴框之外（y 为负），不占用主图数据区", () => {
  const masters = captionMasters();
  const offenders = [];
  for (const m of masters) {
    const code = m.body.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
    const mm = code.match(/fig\.text\(\s*0\.01\s*,\s*(-?[\d.]+)/);
    if (!mm) continue;
    const y = Number(mm[1]);
    if (!(y < 0)) offenders.push(m.rel + "（y=" + y + "，会压住或挤压轴框）");
  }
  assert.deepEqual(offenders, [],
    "以下母版图注 y 不为负，可能压住主图：" + offenders.join("; "));
});

test("spatial_figures 的逐样本图图注也改左下，图例仍在右侧", () => {
  const src = fs.readFileSync(
    path.join(REPO, "tools/bio/line3_spatial/scripts/spatial_figures"), "utf8");
  // 逐样本图（01/02/03）不得再用轴坐标把图注放右栏
  const rightColCaption = /ax\.text\(\s*1\.\d+/.test(src);
  assert.equal(rightColCaption, false,
    "逐样本图的图注不得再锚在右栏（ax.text(1.x)），应改 fig.text 左下");
  // 图例仍须外置右侧
  assert.match(src, /bbox_to_anchor=\(1\.02,\s*1\.0\)/, "图例仍须外置右侧");
});
