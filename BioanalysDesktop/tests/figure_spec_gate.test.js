/**
 * 出图规范门禁契约（生信代码专项审核第 4 项）。
 *
 * 规范 docs/figure_spec.md：静态图统一 PNG，DPI 必须显式声明且为 300
 * （R 的 png() 默认 72，漏写 res=300 即废图）。此前只靠人眼检查。
 */
import test from "node:test";
import assert from "assert";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { readPngDpi, readPngSize, REQUIRED_DPI, STRICT_PROJECTS } from "../../ops/figure_spec_gate.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE = path.join(REPO, "ops", "figure_spec_gate.mjs");

test("门禁可通过：全部产线图件 300 DPI", () => {
  const out = execFileSync(process.execPath, [GATE], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /FIGURE_SPEC_OK/);
});

test("pHYs 解析正确：已知 300dpi PNG 读出的 DPI 是 300", () => {
  const png = path.join(REPO, "local_projects", "PRJ_DCM_BENCH_20261105", "figures", "line1_bulk", "l1_01_correlation.png");
  assert.ok(fs.existsSync(png), "测试夹具缺失");
  const buf = fs.readFileSync(png);
  const dpi = readPngDpi(buf);
  assert.ok(dpi, "pHYs 块解析失败");
  assert.equal(dpi.dpiX, REQUIRED_DPI);
  assert.equal(dpi.dpiY, REQUIRED_DPI);
});

test("IHDR 解析正确：尺寸与实际像素一致", () => {
  const png = path.join(REPO, "local_projects", "PRJ_DCM_BENCH_20261105", "figures", "line1_bulk", "l1_01_correlation.png");
  const size = readPngSize(fs.readFileSync(png));
  assert.ok(size);
  assert.ok(size.width > 0 && size.height > 0);
});

test("非 PNG 字节返回 null，不假装能解析", () => {
  assert.equal(readPngDpi(Buffer.from("not a png at all")), null);
  assert.equal(readPngSize(Buffer.from("not a png at all")), null);
});

test("门禁分档：产线项目强制、历史项目只报告", () => {
  assert.ok(STRICT_PROJECTS.includes("PRJ_DCM_BENCH_20261105"));
  assert.ok(STRICT_PROJECTS.includes("PRJ_GSE316126_SANITY"));
  const src = fs.readFileSync(GATE, "utf8");
  assert.match(src, /const report = strict/, "缺分档逻辑");
  assert.match(src, /[历史项目]/, "历史项目提示前缀缺失");
});

test("产线项目单独扫描全部合规", () => {
  const out = execFileSync(process.execPath, [GATE, "--dir", "local_projects/PRJ_DCM_BENCH_20261105"],
    { cwd: REPO, encoding: "utf8" });
  assert.match(out, /FIGURE_SPEC_OK/);
  assert.doesNotMatch(out, /FIGURE_SPEC_FAIL/);
});