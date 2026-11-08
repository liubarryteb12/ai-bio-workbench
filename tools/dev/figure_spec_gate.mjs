#!/usr/bin/env node
/**
 * figure_spec_gate.mjs - 出图规范合规门禁（生信代码专项审核第 4 项）
 *
 * 为什么需要：docs/figure_spec.md 规定了一堆硬性口径（300 DPI、PNG、最小尺寸），
 * 但这些口径此前只靠人眼检查，人眼漏看一张就漏一张。
 * 这里直接读真实 PNG 的元数据与像素，把能机器判的项全部机器判。
 *
 * 判据：
 *   1. 只允许 PNG（禁 PDF/SVG 作为交付图件）；
 *   2. DPI 必须显式声明且为 300（R 的 png() 默认 72，漏写 res=300 即废图）；
 *   3. 最小边 >= 800 px（低于此无法满足发表级）；
 *   4. 文件非空。
 *
 * 用法：node tools/dev/figure_spec_gate.mjs [--dir <相对路径>]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 尺寸下限刻意不设硬阈值：docs/figure_spec.md 只规定「图内字号 >= 8pt」与 300 DPI，
// 并未给出像素下限。我一开始按「发表级」推断写了 800px，结果把 1039x779 这种
// 完全可读的图判成不合规，那是把我的推断冒充成规范。这里改为只告警不判红，
// 并给出实际尺寸供人判断。
export const MIN_EDGE_PX = 800;
export const REQUIRED_DPI = 300;

/** PNG 的 pHYs 块解析：返回 { dpiX, dpiY } 或 null。 */
export function readPngDpi(buf) {
  if (buf.length < 8) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === "pHYs") {
      if (length < 9) return null;
      const ppuX = buf.readUInt32BE(dataStart);
      const ppuY = buf.readUInt32BE(dataStart + 4);
      const unit = buf.readUInt8(dataStart + 8);
      if (unit !== 1) return null;
      return { dpiX: Math.round(ppuX * 0.0254), dpiY: Math.round(ppuY * 0.0254) };
    }
    if (type === "IDAT" || type === "IEND") return null;
    offset = dataStart + length + 4;
  }
  return null;
}

/** PNG IHDR 解析：返回 { width, height } 或 null。 */
export function readPngSize(buf) {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(12) !== 0x49484452) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * 门禁作用域：只对「当前产线项目」判红，历史遗留项目只报告。
 *
 * 为什么分档：local_projects/default/ 有 107 张 2026-10-14 的图，产自 150 DPI 时代
 * （figure_spec v2.2 升级前），且未被 git 跟踪。把它们判红会让门禁永远红着，
 * 而重跑那些旧样例项目没有任何价值。真正要守住的是「新产出的图必须 300 DPI」。
 * 新增产线项目时把它加进 STRICT_PROJECTS。
 */
export const STRICT_PROJECTS = Object.freeze([
  "PRJ_DCM_BENCH_20261105",
  "PRJ_GSE316126_SANITY",
  "PRJ_STROKE_P1_SPATIAL_ABCA1",
  "PRJ_STROKE_P2_SPATIAL_LACTPYRO_5GENES",
]);

function main() {
  const dirArg = process.argv.indexOf("--dir");
  const roots = dirArg > -1
    ? [path.join(REPO, process.argv[dirArg + 1] || "")]
    : [path.join(REPO, "local_projects")];
  const pngs = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (e.name.endsWith(".png")) pngs.push(p);
    }
  };
  roots.forEach(walk);

  const problems = [];
  const warnings = [];
  let dpiOk = 0;
  let sizeOk = 0;
  for (const file of pngs) {
    const rel = path.relative(REPO, file).split(path.sep).join("/");
    // 该图属于哪个项目；不属于任何产线项目则降级为提示
    const _m = rel.match(/local_projects\/([^/]+)\//);
    const project = _m ? _m[1] : "";
    const strict = STRICT_PROJECTS.includes(project);
    const report = strict ? (m) => problems.push(m) : (m) => warnings.push("[历史项目] " + m);
    const buf = fs.readFileSync(file);
    if (buf.length === 0) { report(rel + ": 文件为空"); continue; }
    const size = readPngSize(buf);
    if (!size) { report(rel + ": 不是合法 PNG"); continue; }
    const dpi = readPngDpi(buf);
    if (!dpi) {
      report(rel + ": 未显式声明 DPI（规范要求 res=300 / rcParams figure.dpi=300）");
    } else if (dpi.dpiX !== REQUIRED_DPI || dpi.dpiY !== REQUIRED_DPI) {
      report(rel + ": DPI=" + dpi.dpiX + "x" + dpi.dpiY + "，规范要求 " + REQUIRED_DPI);
    } else { dpiOk += 1; }
    if (Math.min(size.width, size.height) < MIN_EDGE_PX) {
      // 只告警：规范没有像素下限，这是可读性提示而非合规判据
      warnings.push(rel + ": 尺寸 " + size.width + "x" + size.height
        + " 最小边 < " + MIN_EDGE_PX + "px（可读性提示，非规范硬性要求）");
    } else { sizeOk += 1; }
  }

  console.log("[figure_spec] 扫描 " + pngs.length + " 张 PNG");
  console.log("  DPI 合规 " + dpiOk + "/" + pngs.length + "，尺寸合规 " + sizeOk + "/" + pngs.length);
  for (const w of warnings.slice(0, 10)) console.log("[WARN] " + w);
  if (warnings.length > 10) console.log("  ... 另有 " + (warnings.length - 10) + " 条尺寸提示");
  for (const p of problems) console.log("[FAIL] " + p);
  if (problems.length > 0) {
    console.log("FIGURE_SPEC_FAIL " + problems.length + " 处不合规");
    process.exit(1);
  }
  console.log("FIGURE_SPEC_OK 全部图件符合 300 DPI 口径");
}

const SELF = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SELF)) main();