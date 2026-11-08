/**
 * 出图口径注释与真源一致（B2，Argon 第 65 轮梯队 1）。
 *
 * 病灶：15 份母版头部写「doc/figure_spec.md（Agg/150dpi/...）」，
 * 而同文件 rcParams 是 figure.dpi=300，docs/figure_spec.md 与 ops/figure_spec_gate.mjs
 * 都锁 300 DPI。注释是接手人与 AI 读的第一口径，写 150 会诱导后人「按注释改回 150」。
 *
 * 判据：src/line*\/scripts/* 的注释里不得出现 150dpi 字面量；
 *       同时允许 300dpi 作为正确口径出现（正对照）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LINES = ["line1_bulk", "line2_scrna", "line3_spatial"];

function masterFiles() {
  const out = [];
  for (const line of LINES) {
    const dir = path.join(REPO, "tools", "bio", line, "scripts");
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      if (e.name === "README.md") continue;
      out.push({ rel: line + "/" + e.name, abs: path.join(dir, e.name) });
    }
  }
  return out;
}

test("母版注释里不出现 150dpi 陈旧口径", () => {
  const offenders = [];
  for (const { rel, abs } of masterFiles()) {
    const text = fs.readFileSync(abs, "utf8");
    text.split(/\r?\n/).forEach((line, idx) => {
      if (/150\s*dpi/i.test(line) && /^\s*#/.test(line)) {
        offenders.push(rel + ":" + (idx + 1) + "  " + line.trim().slice(0, 70));
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "以下母版注释仍写 150dpi，与 figure_spec 的 300 DPI 真源冲突：" + String.fromCharCode(10) + offenders.join(String.fromCharCode(10)),
  );
});

test("改口径的母版确实声明 300dpi（正对照，防误删整段口径注释）", () => {
  const text = fs.readFileSync(path.join(REPO, "tools/bio/line1_bulk/scripts/bulk_figures"), "utf8");
  const header = text.split(/\r?\n/).slice(0, 25).join(String.fromCharCode(10));
  assert.match(header, /300\s*dpi/i, "bulk_figures 头部应写明 300dpi 口径");
  // 同时 rcParams 必须仍是 300，防「只改注释不改代码」两头都错
  assert.match(text, /"figure\.dpi"\s*:\s*300/);
  assert.match(text, /"savefig\.dpi"\s*:\s*300/);
});
