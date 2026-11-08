/**
 * Ready 模板实证矩阵的门禁契约（第 41 轮，Argon 清单；组合图退役后 39 条）。
 *
 * 判据：ready 集合与白名单恒等、每条 source/preview 真实存在且 sha256 与登记值一致、
 * verified 全为真。这里跑真实门禁，不做静态断言。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE = path.join(REPO, "tools", "dev", "figure_ready_matrix.mjs");
const MATRIX = path.join(REPO, "tools", "dev", "figure_ready_matrix.json");

test("ready 矩阵门禁可通过（39 条证据链完整）", () => {
  const out = execFileSync(process.execPath, [GATE], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /FIGURE_READY_MATRIX_OK/);
  assert.match(out, /ready=39/);
  assert.match(out, /source_sha_match=39\/39/);
  assert.match(out, /preview_sha_match=39\/39/);
});

test("矩阵产物含逐条记录，且每条都标了哈希是否匹配", () => {
  assert.ok(fs.existsSync(MATRIX), "缺 tools/dev/figure_ready_matrix.json");
  const m = JSON.parse(fs.readFileSync(MATRIX, "utf8"));
  assert.equal(m.total_ready, 39);
  assert.equal(m.rows.length, 39);
  for (const row of m.rows) {
    assert.equal(row.source_sha_match, true, row.id + " source 哈希不匹配");
    assert.equal(row.preview_sha_match, true, row.id + " preview 哈希不匹配");
    assert.equal(row.verified, true, row.id + " 未真机验证");
  }
});

test("矩阵记录三条线的分布（L1 12 / L2 20 / L3 7）", () => {
  const m = JSON.parse(fs.readFileSync(MATRIX, "utf8"));
  assert.deepEqual(m.by_level, { L1: 12, L2: 20, L3: 7 });
  assert.equal(Object.values(m.by_language).reduce((a, b) => a + b, 0), 39);
});
