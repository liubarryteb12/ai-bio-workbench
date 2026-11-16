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

import { readPngDpi, readPngSize, REQUIRED_DPI, STRICT_PROJECTS } from "../../tools/dev/figure_spec_gate.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE = path.join(REPO, "tools", "dev", "figure_spec_gate.mjs");

test("门禁可通过：全部产线图件 300 DPI", () => {
  const out = execFileSync(process.execPath, [GATE], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /FIGURE_SPEC_OK/);
});

/**
 * 解析器单测只喂最小 PNG 字节夹具，不依赖运行期项目图（干净 checkout 没有）。
 * 这里不验 CRC：解析器也只读 pHYs / IHDR 的固定偏移，职责是解析口径而非图像解码。
 */
function parserFixturePng(width = 1000, height = 900) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 4, "ascii");
    return Buffer.concat([head, data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  const phys = Buffer.alloc(9);
  const ppu = Math.round(REQUIRED_DPI / 0.0254);
  phys.writeUInt32BE(ppu, 0);
  phys.writeUInt32BE(ppu, 4);
  phys.writeUInt8(1, 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("pHYs", phys), chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("pHYs 解析正确：已知 300dpi PNG 读出的 DPI 是 300", () => {
  const dpi = readPngDpi(parserFixturePng());
  assert.ok(dpi, "pHYs 块解析失败");
  assert.equal(dpi.dpiX, REQUIRED_DPI);
  assert.equal(dpi.dpiY, REQUIRED_DPI);
});

test("IHDR 解析正确：尺寸与实际像素一致", () => {
  const size = readPngSize(parserFixturePng(1234, 987));
  assert.deepEqual(size, { width: 1234, height: 987 });
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
  const out = execFileSync(process.execPath, [GATE, "--dir", "workspace/projects/PRJ_DCM_BENCH_20261105"],
    { cwd: REPO, encoding: "utf8" });
  assert.match(out, /FIGURE_SPEC_OK/);
  assert.doesNotMatch(out, /FIGURE_SPEC_FAIL/);
});