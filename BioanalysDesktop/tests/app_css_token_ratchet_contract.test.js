/**
 * app.css 设计 token 棘轮契约（梯队 3 P1，Argon 第 65 轮 Q5 + 第 71 轮第 1 顺位）。
 *
 * 现状盘点（2026-11-07）：
 *   - :root 已定义 15 个语义 token，且全部被 var() 引用，无死 token；
 *   - 变量块之外仍有 81 处硬编码色值、49 个不同色值，其中最高频仅 4 次。
 *
 * 为什么不做全量「造 49 个 token」：
 *   绝大多数色值只出现 1 次。为单次使用的颜色发明语义名，是把「可读」换成
 *   「多一层间接」，属于过度工程（Argon 第 71 轮 Q2 明确反对无收益扩面）。
 *
 * 本契约采用**棘轮**策略：锁住当前硬编码规模，只准降不准升。
 *   - 新增颜色必须走 token，否则总数上升即红；
 *   - 若某个色值被复用 >=5 次，说明它已经是事实上的设计常量，必须提为 token。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CSS = path.join(REPO, "BioanalysDesktop", "src", "app.css");

/** 2026-11-07 实测基线。只允许下调：每提取一个 token，就把这里减一。 */
const HARDCODED_BASELINE = 81;
const REPEAT_LIMIT = 5;

function splitRoot(css) {
  const start = css.indexOf(":root");
  assert.ok(start >= 0, "app.css 必须保留 :root 变量块");
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  assert.ok(open > 0 && close > open, ":root 块必须闭合");
  return { root: css.slice(open + 1, close), body: css.slice(close + 1) };
}

function countHex(text) {
  const counts = new Map();
  for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const h = m[0].toLowerCase();
    counts.set(h, (counts.get(h) || 0) + 1);
  }
  return counts;
}

test(":root 必须保留且 token 全部被引用（无死 token）", () => {
  const css = fs.readFileSync(CSS, "utf8");
  const { root, body } = splitRoot(css);
  const tokens = [...root.matchAll(/(--[a-z-]+)\s*:/g)].map((m) => m[1]);
  assert.ok(tokens.length >= 15, "token 数量不应少于 15，当前 " + tokens.length);
  const dead = tokens.filter((t) => !body.includes("var(" + t + ")"));
  assert.deepEqual(dead, [], "以下 token 定义了但从未被引用：" + dead.join(", "));
});

test("硬编码色值规模只准降不准升（棘轮）", () => {
  const css = fs.readFileSync(CSS, "utf8");
  const { body } = splitRoot(css);
  const counts = countHex(body);
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  assert.ok(total <= HARDCODED_BASELINE,
    "硬编码色值 " + total + " 处，超过基线 " + HARDCODED_BASELINE +
    "。新增颜色请先加 :root token 再用 var() 引用；若已提取 token，把基线同步下调。");
});

test("复用 >=5 次的色值必须提为 token（事实常量不得散落）", () => {
  const css = fs.readFileSync(CSS, "utf8");
  const { body } = splitRoot(css);
  const counts = countHex(body);
  const repeated = [...counts.entries()].filter(([, n]) => n >= REPEAT_LIMIT);
  assert.deepEqual(repeated, [],
    "以下色值在变量块外重复出现 >= " + REPEAT_LIMIT + " 次，应提为 :root token：\n" +
    repeated.map(([h, n]) => "  " + h + " x" + n).join("\n"));
});
