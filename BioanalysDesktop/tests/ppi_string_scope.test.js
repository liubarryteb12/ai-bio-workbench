/**
 * ppi_string 的 edge scope 契约（生信代码专项审核）。
 *
 * 缺陷：scan_links 原实现只要求「一端在查询集内」，把全蛋白组其他 1.9 万蛋白的边
 * 也拉了进来。实测 DCM 基准：any 口径 77259 边 / 12417 节点，both 口径 12840 边 / 2441 节点。
 */
import test from "node:test";
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(REPO, "tools", "bio", "line1_bulk", "scripts", "ppi_string");
const src = fs.readFileSync(SCRIPT, "utf8");

test("scan_links 支持 any 与 both 两种口径", () => {
  assert.match(src, /def scan_links\(path, wanted_ensp, min_score, scope="any"\)/);
  assert.match(src, /scope == "both"/);
  assert.match(src, /stats\["outside"\]/, "缺 outside 诊断计数");
});

test("both 口径语义正确：两端都在内才保留", () => {
  assert.match(src, /if not \(in_a and in_b\):/);
});

test("any 口径保持历史行为（一端在内即保留）", () => {
  assert.match(src, /elif not \(in_a or in_b\):/);
});

test("环境变量 BIO_STRING_SCOPE 接入且有非法值 fail-fast", () => {
  assert.match(src, /BIO_STRING_SCOPE/);
  assert.match(src, /"any", "both"/);
  assert.match(src, /BIO_STRING_SCOPE 只能是/);
});

test("env_str 辅助函数存在（默认值语义与 env_int/env_path 一致）", () => {
  assert.match(src, /def env_str\(name, default\):/);
});

test("默认仍是 any（不让既有结果静默改变）", () => {
  assert.match(src, /env_str\("BIO_STRING_SCOPE", "any"\)/);
});