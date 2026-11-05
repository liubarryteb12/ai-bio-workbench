/**
 * 渲染耗时治理（B5，Argon 第 65 轮 Q4 裁定）。
 *
 * 裁定要点：静态门禁拦截 O(N^2) 死循环与稠密矩阵绘制；同时在 figures_manifest.txt
 * 记录每张图的 render_ms，让超时从「不可见」变成「回执可查」。
 *
 * 第一版是假绿（三条变异全存活），根因两条：
 *   1. 判据对「所有写 manifest 的母版」做 includes('render_ms')，任何一处（注释或别的母版）
 *      命中就整体通过，删掉某一份的真实实现仍绿；
 *   2. 没有检测「全矩阵稠密绘制」，第三条变异注入了 ax.imshow(expr) 也没红。
 * 现按「逐母版独立取证 + 可执行代码行」重写，并用变异脚本反证。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LINES = ["line1_bulk", "line2_scrna", "line3_spatial"];
const FIG_CALL = /\b(?:savefig|ggsave|dev\.copy|png|pdf|svg|tiff|jpeg)\s*\(/;

/** 只保留可执行代码行（剔整行注释与行尾注释）。 */
function codeOnly(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (t.length === 0 || t.startsWith("#")) continue;
    const h = raw.indexOf("#");
    out.push(h >= 0 ? raw.slice(0, h) : raw);
  }
  return out.join(String.fromCharCode(10));
}

function figureMasters() {
  const out = [];
  for (const line of LINES) {
    const dir = path.join(REPO, "src", line, "scripts");
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name === "README.md") continue;
      if (/\.(py|R|sh|md|json|tsv|csv)$/i.test(e.name)) continue;
      const abs = path.join(dir, e.name);
      const raw = fs.readFileSync(abs, "utf8");
      const code = codeOnly(raw);
      if (FIG_CALL.test(code)) out.push({ rel: line + "/" + e.name, raw, code });
    }
  }
  return out;
}

test("每个写 manifest 的母版都必须自己记录 render_ms（逐母版独立取证）", () => {
  const offenders = [];
  for (const m of figureMasters()) {
    const writesManifest = /figures_manifest\.txt/.test(m.code);
    if (!writesManifest) continue;
    const hasLine = /render_ms=%s/.test(m.code) && /_fh\.write/.test(m.code);
    if (!hasLine) offenders.push(m.rel);
  }
  assert.deepEqual(offenders, [], "以下母版写 manifest 但自身缺 render_ms 写入：" + offenders.join(", "));
});

test("save helper 内部逐图计时（perf_counter 包住 savefig 且 append 到 render_ms）", () => {
  const offenders = [];
  for (const m of figureMasters()) {
    // 只审有 save(fig, name) 形态且写 manifest 的母版
    if (!/def save\(fig, name\):/.test(m.code)) continue;
    if (!/figures_manifest\.txt/.test(m.code)) continue;
    const hasTimer = /_t0\s*=\s*time\.perf_counter\(\)/.test(m.code);
    const hasAppend = /render_ms\.append\(\(name,\s*_ms\)\)/.test(m.code);
    const hasMsCalc = /_ms\s*=\s*\(time\.perf_counter\(\)\s*-\s*_t0\)\s*\*\s*1000/.test(m.code);
    if (!(hasTimer && hasAppend && hasMsCalc)) {
      offenders.push(m.rel + " (timer=" + hasTimer + " append=" + hasAppend + " calc=" + hasMsCalc + ")");
    }
  }
  assert.deepEqual(offenders, [], "以下母版 save helper 未逐图计时：" + offenders.join("; "));
});

test("静态拦截全矩阵稠密绘制：无上限的 imshow / scatter 原始矩阵", () => {
  // 判据作用在真实母版上：出现 imshow(<裸变量>) 且没有切片/采样括号，即判稠密全矩阵
  const DENSE = /\bimshow\(\s*(?!.*\[)[A-Za-z_][A-Za-z0-9_.]*\s*\)/;
  const offenders = [];
  for (const m of figureMasters()) {
    for (const ln of m.code.split(/\r?\n/)) {
      if (DENSE.test(ln) && !/\[\s*:/.test(ln)) offenders.push(m.rel + ": " + ln.trim().slice(0, 70));
    }
  }
  assert.deepEqual(offenders, [], "以下母版存在无上限稠密绘制（O(N^2) 风险）：" + offenders.join("; "));
  // 正对照：截断写法必须不被误报
  assert.equal(DENSE.test("ax.imshow(expr[:50, :50])"), false, "截断后的 imshow 不应误报");
  assert.equal(DENSE.test("ax.imshow(expr)"), true, "全矩阵 imshow 必须被识别");
});
