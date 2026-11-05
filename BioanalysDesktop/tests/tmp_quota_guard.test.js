/**
 * Q4 配额保护契约（第 41 轮，Argon 裁定）。
 *
 * 判据：配额是可查询的纯函数、超限会给出明确提示、提示不阻塞预检、
 * 且 preflight 的 --json 输出带 tmpQuota 字段。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PREFLIGHT = path.join(REPO, "ops", "preflight.mjs");

test("Q4：tmpQuota 是纯函数，空目录返回 0 且不超限", async () => {
  const { tmpQuota } = await import("../../ops/clean_workspace.mjs");
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "q4empty-"));
  const r = tmpQuota({ root: empty, quota: 500 });
  assert.equal(r.count, 0);
  assert.equal(r.over, false);
  assert.equal(r.quota, 500);
  fs.rmSync(empty, { recursive: true, force: true });
});

test("Q4：超过配额时 over=true", async () => {
  const { tmpQuota } = await import("../../ops/clean_workspace.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "q4full-"));
  fs.mkdirSync(path.join(dir, ".tmp"), { recursive: true });
  for (let i = 0; i < 6; i += 1) fs.writeFileSync(path.join(dir, ".tmp", "f" + i), "x");
  const r = tmpQuota({ root: dir, quota: 5 });
  assert.equal(r.count, 6);
  assert.equal(r.over, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Q4：preflight 报告含 .tmp 配额行，且超配额不判红", () => {
  const out = execFileSync(process.execPath, [PREFLIGHT], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /\.tmp\/ 文件数|配额/);
  assert.match(out, /PREFLIGHT_OK/);
});

test("Q4：preflight --json 带 tmpQuota 字段", () => {
  const out = execFileSync(process.execPath, [PREFLIGHT, "--json"], { cwd: REPO, encoding: "utf8" });
  const j = JSON.parse(out);
  assert.ok(j.tmpQuota, "缺 tmpQuota 字段");
  assert.equal(typeof j.tmpQuota.count, "number");
  assert.equal(typeof j.tmpQuota.over, "boolean");
});

test("Q4：提示里给出可执行的清理命令（不是空警告）", () => {
  const src = fs.readFileSync(PREFLIGHT, "utf8");
  assert.match(src, /clean_workspace\.mjs --execute/);
  assert.match(src, /超过配额/);
});