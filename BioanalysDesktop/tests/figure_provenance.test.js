/**
 * 出图溯源诚实性门禁的契约测试（生信代码专项审核）。
 *
 * 审核核心发现：注册表登记了参考库 source，但出图脚本从未引用库。
 * 门禁要求诚实声明 DERIVED / INSPIRED / INDEPENDENT，并抓假溯源。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseProvenance, referencesLibrary, PROVENANCE_KINDS, REFERENCE_PATH_MARKERS,
} from "../../ops/figure_source_provenance.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE = path.join(REPO, "ops", "figure_source_provenance.mjs");
const NL = String.fromCharCode(10);
const QT = String.fromCharCode(34);

test("parseProvenance 只认三种合法声明", () => {
  assert.deepEqual([...PROVENANCE_KINDS], ["DERIVED", "INSPIRED", "INDEPENDENT"]);
  assert.equal(parseProvenance("# PROVENANCE: DERIVED" + NL), "DERIVED");
  assert.equal(parseProvenance("#!/usr/bin/env bash" + NL + "# PROVENANCE: INDEPENDENT 说明" + NL), "INDEPENDENT");
  assert.equal(parseProvenance("# PROVENANCE: BOGUS"), null);
  assert.equal(parseProvenance("no declaration here"), null);
});

test("referencesLibrary 剔除声明行，避免判据被自己污染", () => {
  const declOnly = [
    "# PROVENANCE: INDEPENDENT  未派生自 reference/05.可参考出图代码 的源码",
    "x <- 1",
  ].join(NL);
  assert.equal(referencesLibrary(declOnly), false, "声明行提到库路径不算真引用");

  const realRef = [
    "# PROVENANCE: DERIVED",
    "source(" + QT + "reference/05.可参考出图代码/_meta/R453_compat/L1_rest_code.R" + QT + ")",
  ].join(NL);
  assert.equal(referencesLibrary(realRef), true, "真实引用必须被识别");
});

test("假溯源被抓：声明 DERIVED 但不引用库", () => {
  const fake = "# PROVENANCE: DERIVED" + NL + "x <- 1";
  assert.equal(parseProvenance(fake), "DERIVED");
  assert.equal(referencesLibrary(fake), false);
});

test("门禁在工作树上可通过（6 个出图脚本均有诚实声明）", () => {
  const out = execFileSync(process.execPath, [GATE], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /FIGURE_PROVENANCE_OK/);
  assert.match(out, /扫描 6 个出图脚本/);
});

test("全部出图脚本都是 INDEPENDENT（如实反映审核结论：未引用参考库）", () => {
  const out = execFileSync(process.execPath, [GATE], { cwd: REPO, encoding: "utf8" });
  const rows = [...out.matchAll(/(line\d_[a-z]+\/[a-z_]+)\s+(DERIVED|INSPIRED|INDEPENDENT)\s+referencesLibrary=(true|false)/g)];
  assert.equal(rows.length, 6, "应解析出 6 行，实际 " + rows.length);
  for (const r of rows) {
    assert.equal(r[2], "INDEPENDENT", r[1] + " 声明应为 INDEPENDENT");
    assert.equal(r[3], "false", r[1] + " 不应引用参考库");
  }
});

test("参考库路径标记清单非空且含关键特征", () => {
  assert.ok(REFERENCE_PATH_MARKERS.length >= 3);
  assert.ok(REFERENCE_PATH_MARKERS.some((m) => m.includes("05.可参考出图代码")));
});