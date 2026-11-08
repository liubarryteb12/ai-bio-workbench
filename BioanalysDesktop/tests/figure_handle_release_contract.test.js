/**
 * 图形句柄释放兜底（B3，Argon 第 65 轮 Q3 裁定）。
 *
 * 裁定原文要点：逐图 plt.close(fig) 保证单步跑多张图时峰值内存不叠加（K40 7.5GB 命根子），
 * 末尾加一行 plt.close("all") 兜底既防御异常分支泄漏，又 100% 满足 figure_spec.md
 * 与 docs/AI_FIGURE_PROMPT.md 的字面静态扫描契约。
 *
 * 判据：
 *   1. 每份产图母版必须有 plt.close("all")（Python）或 graphics.off()（R）兜底；
 *   2. 逐图 plt.close(fig) 的既有写法保留（不许为凑判据删掉逐图释放）；
 *   3. R 母版每个 png( 设备必须成对 dev.off()。
 *
 * 为什么判据要先剔除注释行：第一版用裸正则扫全文，结果注释里那句
 * 「收尾再 graphics.off() 兜住...」把判据自己喂饱了 —— 删掉真代码测试仍绿（MUT-B3-B 存活）。
 * 注释是给人读的，不能当执行证据。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LINES = ["line1_bulk", "line2_scrna", "line3_spatial"];
const FIG_CALL = /\b(?:savefig|ggsave|dev\.copy|png|pdf|svg|tiff|jpeg)\s*\(/;

/** 只保留可执行代码行（剔除整行注释与行尾注释），与门禁里 hasFigureCall 同口径。 */
function codeLines(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (t.length === 0 || t.startsWith("#")) continue;
    const h = raw.indexOf("#");
    out.push(h >= 0 ? raw.slice(0, h) : raw);
  }
  return out;
}

function figureMasters() {
  const out = [];
  for (const line of LINES) {
    const dir = path.join(REPO, "tools", "bio", line, "scripts");
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name === "README.md") continue;
      if (/\.(py|R|sh|md|json|tsv|csv)$/i.test(e.name)) continue;
      const abs = path.join(dir, e.name);
      const text = fs.readFileSync(abs, "utf8");
      const code = codeLines(text).join(String.fromCharCode(10));
      if (FIG_CALL.test(code)) out.push({ rel: line + "/" + e.name, text, code });
    }
  }
  return out;
}

test("每份产图母版都有句柄释放兜底（Python close(all) / R graphics.off）", () => {
  const missing = [];
  for (const m of figureMasters()) {
    const hasPy = /plt\.close\((['"])all\1\)/.test(m.code);
    const hasR = /\bgraphics\.off\(\)/.test(m.code);
    if (!hasPy && !hasR) missing.push(m.rel);
  }
  assert.deepEqual(missing, [], "以下产图母版缺句柄兜底：" + missing.join(", "));
});

test("逐图 plt.close(fig) 的既有写法被保留（不许为凑判据删精度）", () => {
  const text = fs.readFileSync(path.join(REPO, "tools/bio/line1_bulk/scripts/bulk_figures"), "utf8");
  const code = codeLines(text).join(String.fromCharCode(10));
  assert.match(code, /plt\.close\(fig\)/, "bulk_figures 必须保留逐图 close(fig)");
  assert.match(code, /plt\.close\((['"])all\1\)/, "bulk_figures 必须有 close(all) 兜底");
});

test("注释里的 graphics.off / close(all) 不算证据（防判据被注释喂饱）", () => {
  // 正对照：纯注释里写满关键字，判据必须仍判「没有兜底」
  const fakeOnlyComment = [
    "#!/usr/bin/env bash",
    "# graphics.off()",
    "# plt.close(\"all\")",
    "Rscript - <<'RSCRIPT'",
    'png("x.png")',
    "RSCRIPT",
  ].join(String.fromCharCode(10));
  assert.equal(/\bgraphics\.off\(\)/.test(codeLines(fakeOnlyComment).join(String.fromCharCode(10))), false);
  assert.equal(/plt\.close\((['"])all\1\)/.test(codeLines(fakeOnlyComment).join(String.fromCharCode(10))), false);
});

test("R 母版每个 png( 设备都有成对 dev.off()", () => {
  const offenders = [];
  for (const m of figureMasters()) {
    const isR = !/matplotlib/.test(m.text) && /\bpng\s*\(|\bggsave\s*\(/.test(m.code);
    if (!isR) continue;
    const opens = (m.code.match(/\bpng\s*\(/g) || []).length;
    const closes = (m.code.match(/\bdev\.off\(\)/g) || []).length;
    if (opens > 0 && closes === 0) offenders.push(m.rel + " opens=" + opens + " closes=" + closes);
  }
  assert.deepEqual(offenders, [], "以下 R 母版开了 png 设备却无 dev.off()：" + offenders.join(", "));
});
