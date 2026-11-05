/**
 * 字号刻度契约（梯队 4，可机器判定部分）。
 *
 * 实测现状：app.css 的 font-size 有 12 种值（10/11/12/12.5/13/14/15/16/18/20/24/9px），
 * 其中 12.5px 与 15px 不在常见字号刻度上。字号不成体系会让层级关系变模糊，
 * 属可机器判定项（区别于「好不好看」的主观判断）。
 *
 * 判据：字号只允许出现在刻度集合内；且全部 >= 9px（与 figure_spec 的 8pt 下限对齐后再保守一级）。
 * 刻意不做：不改字号体系本身的设计取舍，只把越界值归入刻度。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CSS = path.join(REPO, "BioanalysDesktop/src/app.css");

/** 字号刻度：9 / 10 / 11 / 12 / 13 / 14 / 16 / 18 / 20 / 24 / 28px + 继承值。 */
const FONT_SCALE = new Set([
  "9px", "10px", "11px", "12px", "13px", "14px", "16px", "18px", "20px", "24px", "28px",
  "inherit", "1em", "1.1em", "1.2em",
]);

function css() {
  return fs.readFileSync(CSS, "utf8");
}

test("font-size 只使用字号刻度内的值", () => {
  const offenders = [];
  for (const m of css().matchAll(/font-size:\s*([^;]+);/g)) {
    const v = m[1].trim();
    if (!FONT_SCALE.has(v)) offenders.push(v);
  }
  assert.deepEqual(
    [...new Set(offenders)], [],
    "以下 font-size 超出字号刻度：" + [...new Set(offenders)].join(", "),
  );
});

test("不存在小于 9px 的字号（手机与打印都要可读）", () => {
  const tooSmall = [];
  for (const m of css().matchAll(/font-size:\s*([0-9.]+)px/g)) {
    const px = Number(m[1]);
    if (px < 9) tooSmall.push(px + "px");
  }
  assert.deepEqual(tooSmall, [], "字号过小：" + tooSmall.join(", "));
});

test("字号刻度本身是稳定契约", () => {
  assert.ok(FONT_SCALE.has("12px"), "12px 是正文基准");
  assert.ok(FONT_SCALE.has("13px"), "13px 是次级正文");
  assert.equal(FONT_SCALE.has("12.5px"), false, "12.5px 不在刻度内");
  assert.equal(FONT_SCALE.has("15px"), false, "15px 不在刻度内");
});
