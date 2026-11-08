/**
 * 出图画幅图例位置契约（docs/figure_spec.md v2.2，2026-11-07 用户定稿）。
 *
 * 规范要求：所有图幅方向的图例一律轴框外右侧纵向排列，图注固定在左下角。
 * 旧规范把 16:9 横版的图例放在轴框下方，本测试锁住四个真源的默认值，
 * 防止 16:9 图例底部语义回潮。
 *
 * 判据锚在默认模板块与对应文案行上，不查全文字样：布局 helper 仍保留
 * bottom_center 分支用于读取旧 project.json，全文扫描会误报。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

/** 取以 marker 开头到下一个右花括号的块，避免读到同文件其它模板或兼容分支。 */
function blockFrom(src, marker, rel) {
  const start = src.indexOf(marker);
  assert.ok(start >= 0, rel + " 必须包含 " + marker);
  const end = src.indexOf("}", start);
  return src.slice(start, end >= 0 ? end + 1 : src.length);
}

/** 取包含指定模板 id 的所有行（文案真源同一 id 可能出现多次）。 */
function linesWith(src, id) {
  return src.split(/\r?\n/).filter((line) => line.includes(id));
}

test("server/project.js 的 template_16x9 默认图例在轴框外右侧纵向", () => {
  const block = blockFrom(read("BioanalysDesktop/server/project.js"), "template_16x9:", "BioanalysDesktop/server/project.js");
  assert.match(block, /legend_position:\s*'outside_right'/);
  assert.match(block, /legend_direction:\s*'vertical'/);
  assert.equal(/bottom_center|horizontal/.test(block), false,
    "template_16x9 默认块不得再出现图例底部语义");
});

test("constants.ts 的 16:9 文案使用图例右侧，不再声称图例底部", () => {
  const src = read("BioanalysDesktop/src/views/shared/constants.ts");
  const lines = [...linesWith(src, "template_16x9"), ...linesWith(src, "template_2_cell_wide")];
  assert.ok(lines.length >= 3, "16:9 与新旧 id 文案必须都有定义");
  for (const line of lines) {
    assert.match(line, /图例右侧/, "16:9 文案必须写明图例右侧：" + line.trim());
    assert.equal(/图例底部|图例下方|bottom_center/.test(line), false,
      "16:9 文案不得再出现图例底部语义：" + line.trim());
  }
});

test("portal/index.html 的 template_16x9 选项文案使用图例右侧", () => {
  const lines = linesWith(read("portal/index.html"), 'value="template_16x9"');
  assert.equal(lines.length, 1, "portal 必须只有一个 template_16x9 选项");
  assert.match(lines[0], /图例右侧/);
  assert.equal(/图例底部|图例下方|bottom_center/.test(lines[0]), false,
    "portal 的 16:9 选项不得再出现图例底部语义");
});

test("tools/reporting/layout_helper.py 的 template_16x9 默认规则为 outside_right/vertical", () => {
  const src = read("tools/reporting/layout_helper.py");
  const block = blockFrom(src, '"template_16x9": {', "tools/reporting/layout_helper.py");
  assert.match(block, /"legend_position":\s*"outside_right"/);
  assert.match(block, /"legend_direction":\s*"vertical"/);
  assert.equal(/bottom_center|horizontal/.test(block), false,
    "template_16x9 默认规则不得再出现图例底部语义");
  assert.match(src, /if position == "bottom_center":/,
    "旧配置兼容分支应保留，读取历史 project.json 时仍可落到正确位置");
});

test("四个真源均包含右侧纵向语义", () => {
  const project = blockFrom(read("BioanalysDesktop/server/project.js"), "template_16x9:", "BioanalysDesktop/server/project.js");
  const constants = linesWith(read("BioanalysDesktop/src/views/shared/constants.ts"), "template_16x9").join("\n");
  const portal = linesWith(read("portal/index.html"), 'value="template_16x9"').join("\n");
  const helper = blockFrom(read("tools/reporting/layout_helper.py"), '"template_16x9": {', "tools/reporting/layout_helper.py");
  assert.match(project, /outside_right/);
  assert.match(constants, /图例右侧/);
  assert.match(portal, /图例右侧/);
  assert.match(helper, /outside_right/);
  assert.match(helper, /vertical/);
});
