/**
 * 布局节奏契约（梯队 4 首批，可机器判定部分）。
 *
 * 客观事实（本轮实测）：app.css 里 padding 用了 12 种不同值、gap 8 种、border-radius 6 种。
 * 这不必然是错，但「同一语义的元素用不同间距」会让界面看起来松散、无节奏，
 * 属于可机器判定的美化项（区别于「好不好看」这类主观判断）。
 *
 * 判据：建立间距刻度（spacing scale）与圆角刻度，超出刻度集合的值判红。
 * 刻意不做的事：不改任何具体像素值的美学取舍，只把集合收敛到刻度内。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CSS = path.join(REPO, "BioanalysDesktop/src/app.css");

/** 允许的间距与圆角刻度（4 的倍数 + 少数半格）。 */
const SPACING_SCALE = new Set([
  "0", "2px", "3px", "4px", "6px", "8px", "10px", "12px", "14px", "16px",
  "20px", "24px", "28px", "32px", "40px", "auto", "inherit",
]);
const RADIUS_SCALE = new Set(["0", "4px", "6px", "8px", "10px", "12px", "999px", "50%", "inherit"]);

function css() {
  return fs.readFileSync(CSS, "utf8");
}

/** 把 "8px 12px" 这类复合值拆成单值集合。 */
function tokens(value) {
  return value.trim().split(/\s+/).filter(Boolean);
}

test("padding 只使用间距刻度内的值", () => {
  const offenders = [];
  for (const m of css().matchAll(/padding:\s*([^;]+);/g)) {
    for (const t of tokens(m[1])) {
      if (!SPACING_SCALE.has(t)) offenders.push("padding: " + m[1].trim());
    }
  }
  assert.deepEqual(
    [...new Set(offenders)], [],
    "以下 padding 超出间距刻度：" + [...new Set(offenders)].join(" | "),
  );
});

test("gap 只使用间距刻度内的值", () => {
  const offenders = [];
  for (const m of css().matchAll(/gap:\s*([^;]+);/g)) {
    for (const t of tokens(m[1])) {
      if (!SPACING_SCALE.has(t)) offenders.push("gap: " + m[1].trim());
    }
  }
  assert.deepEqual(
    [...new Set(offenders)], [],
    "以下 gap 超出间距刻度：" + [...new Set(offenders)].join(" | "),
  );
});

test("border-radius 只使用圆角刻度内的值", () => {
  const offenders = [];
  for (const m of css().matchAll(/border-radius:\s*([^;]+);/g)) {
    for (const t of tokens(m[1])) {
      if (!RADIUS_SCALE.has(t)) offenders.push("border-radius: " + m[1].trim());
    }
  }
  assert.deepEqual(
    [...new Set(offenders)], [],
    "以下 border-radius 超出圆角刻度：" + [...new Set(offenders)].join(" | "),
  );
});

test("间距刻度与圆角刻度本身是稳定契约（改动须同步本测试）", () => {
  // 反向锚定：刻度集合被无意删项时，这里会红，防止「把不合法值加进刻度」的作弊
  assert.ok(SPACING_SCALE.has("8px"), "8px 是基准间距");
  assert.ok(SPACING_SCALE.has("16px"), "16px 是区块间距");
  assert.ok(RADIUS_SCALE.has("6px"), "6px 是默认圆角");
  assert.equal(SPACING_SCALE.has("13px"), false, "13px 不在刻度内");
});
