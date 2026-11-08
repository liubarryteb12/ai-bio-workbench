/**
 * Q1 项目层脚本边界契约（第 41 轮，抄 nf-core/modules）。
 *
 * 判据：门禁通过、清单存在且逐条登记、项目层无母版同名副本。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE = path.join(REPO, "ops", "project_script_gate.mjs");
const MANIFEST = path.join(REPO, "local_projects", "PRJ_DCM_BENCH_20261105", "scripts", "scripts_manifest.json");

test("Q1：门禁可通过（项目层无母版副本）", () => {
  const out = execFileSync(process.execPath, [GATE], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /PROJECT_SCRIPT_GATE_OK/);
});

test("Q1：scripts_manifest.json 存在且每条都声明了用途", () => {
  assert.ok(fs.existsSync(MANIFEST));
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
  assert.equal(m.schema_version, 1);
  assert.ok(m.scripts.length > 0);
  for (const s of m.scripts) {
    assert.ok(s.file && s.purpose && s.role, JSON.stringify(s) + " 字段不全");
    assert.ok(/^(data_adapter|thin_wrapper)$/.test(s.role), s.file + " role 非法");
  }
});

test("Q1：项目 scripts/ 下没有与 src 母版同名的文件", () => {
  const master = new Set();
  for (const line of ["line1_bulk", "line2_scrna", "line3_spatial"]) {
    const dir = path.join(REPO, "tools", "bio", line, "scripts");
    for (const f of fs.readdirSync(dir)) master.add(f);
  }
  const dir = path.join(REPO, "local_projects", "PRJ_DCM_BENCH_20261105", "scripts");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? (e.name === "__pycache__" ? [] : walk(p)) : [p];
  });
  for (const f of walk(dir)) {
    assert.equal(master.has(path.basename(f)), false, path.basename(f) + " 是母版副本");
  }
});

test("Q1：门禁源码同时做同名检查与清单检查（两条判据都在）", () => {
  const src = fs.readFileSync(GATE, "utf8");
  assert.match(src, /masterNames\.has/, "缺同名副本判据");
  assert.match(src, /scripts_manifest\.json/, "缺清单判据");
});