/**
 * 逐样本表达图版式契约（2026-11-06 用户反馈后二次优化）。
 *
 * 用户反馈：l3_mouse_02_target_gene_C1-control / _C1-D7「这种图不符合出图标准」。
 *
 * 根因（与数据无关，是版式缺陷）：
 *   原实现用 fig.add_axes([0.60, 0.55, 0.022, 0.38]) 把 colorbar 钉死在右栏上半部，
 *   右栏下半截全空；配合 bbox_inches="tight"，整图被裁成上重下轻、右侧大片留白。
 *   用户截图里还能看到更早一版的遗留：图注被放在右栏中部。
 *
 * 现方案：colorbar 贴轴（fig.colorbar(sc, ax=ax, shrink=..., fraction=..., pad=...)），
 *   与轴框等高对齐，画布按内容自动收边；图注仍固定在左下角（框外）。
 *   这是**逐图**优化，不改动全局 caption()/legend_out() 的默认布局。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SF = path.join(REPO, "tools/bio/line3_spatial/scripts/spatial_figures");

function read() {
  return fs.readFileSync(SF, "utf8");
}

test("逐样本表达图不得再用固定 add_axes 钉死 colorbar", () => {
  const src = read();
  // 旧的分离式 colorbar：fig.add_axes([0.60, 0.55, 0.022, 0.38])
  const detached = /fig\.add_axes\(\s*\[\s*0\.\d+\s*,\s*0\.\d+\s*,\s*0\.\d+\s*,\s*0\.\d+\s*\]\s*\)/;
  assert.equal(detached.test(src), false,
    "不得用 fig.add_axes 固定 colorbar 位置：会造成右栏下半截空白、整图重心偏上");
});

test("02/03 的 colorbar 必须贴轴（ax=ax）", () => {
  const src = read();
  const attached = src.match(/fig\.colorbar\(\s*sc\s*,\s*ax=ax/g) || [];
  assert.ok(attached.length >= 2,
    "target gene 与 KO DR 两张逐样本图都必须用 fig.colorbar(sc, ax=ax)，实际 " + attached.length);
  // 逐处检查：每一处贴轴 colorbar 都必须带 shrink，避免撑满整幅。
  // 首版只查「全文存在一处带 shrink」，结果 03 那处没被改到就替 02 作证（MUT-B 存活），
  // 与项目此前记过的「别处代码替被测点作证」是同一类假绿。
  // 只约束「散点图连续量」那两处（mappable 是 sc）；热图的 colorbar（mappable 是 im）
  // 高度本来就贴合轴框，不需要 shrink，不应被这条断言牵连。
  // 先剥掉整行注释：说明文字里会引用 fig.colorbar(sc, ax=ax) 这种写法，
  // 不剥会把注释当成实现（这次就因此产生过一次假红）。
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
  const calls = code.match(/fig\.colorbar\(\s*sc\s*,[^)]*\)/g) || [];
  const attachedCalls = calls.filter((c) => /ax=ax/.test(c));
  assert.ok(attachedCalls.length >= 2, "至少两处散点贴轴 colorbar，实际 " + attachedCalls.length);
  for (const c of attachedCalls) {
    assert.match(c, /shrink=/, "每处散点贴轴 colorbar 都必须给 shrink：" + c);
  }
});

test("贴轴 colorbar 仍必须带 label（连续量图例可读）", () => {
  const src = read();
  assert.match(src, /_cb\.set_label\("expr"/, "target gene 的 colorbar 必须标 expr");
  assert.match(src, /_kcb\.set_label\("KO DR expr"/, "KO DR 的 colorbar 必须标 KO DR expr");
});

test("图注仍固定在左下角，不因这次优化被挪走", () => {
  const src = read();
  const i = src.indexOf("02 target gene expression");
  assert.ok(i > 0, "必须能找到 02 区块");
  const block = src.slice(i, i + 3000);
  assert.match(block, /fig\.text\(0\.01,\s*-0\.02/, "02 图注必须锚在左下角（框外）");
  const j = src.indexOf("03 ko_dr");
  if (j > 0) {
    const b3 = src.slice(j, j + 3000);
    assert.match(b3, /fig\.text\(0\.01,\s*-0\.02/, "03 图注必须锚在左下角（框外）");
  }
});
