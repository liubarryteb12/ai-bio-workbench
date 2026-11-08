/**
 * 像素-微米标定交叉复核契约（第 69 轮三审收敛项）。
 *
 * 背景（实测）：同一张切片上两条换算路径相差 20%，根因是
 * spot_diameter_fullres 在 Space Ranger 里是「理论 65 µm 光斑」的像素跨度
 * （含光学弥散包络），而不是 55 µm 捕获孔径。若把 55 µm 当分子，
 * 任何以微米为单位的阈值都会系统性偏小。
 *
 * 判据：
 *   1. 提供 um_per_px(scalefactors, xy) 单一入口，返回双口径与比值；
 *   2. 分子必须是 65.0（光斑包络），不得写 55.0；
 *   3. 比值超出 [0.90, 1.10] 必须抛错（fail-closed），不得只告警；
 *   4. 晶格口径必须只取内部点（第一壳层一致），否则边界效应会拉高中位数。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOD = path.join(REPO, "tools", "reporting", "spatial_calibration.py");

function read() {
  return fs.readFileSync(MOD, "utf8");
}

test("标定模块必须存在且提供 um_per_px 入口", () => {
  assert.ok(fs.existsSync(MOD), "缺 tools/reporting/spatial_calibration.py");
  const src = read();
  assert.match(src, /def um_per_px\(/, "必须提供 um_per_px 函数");
});

test("光斑口径分子必须是 65.0（包络），不得写 55.0", () => {
  const src = read();
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.match(code, /SPOT_ENVELOPE_UM\s*=\s*65\.0/, "必须定义 65.0 的光斑包络常量");
  assert.match(code, /SPOT_CAPTURE_UM\s*=\s*55\.0/, "必须同时记录 55.0 捕获孔径（供报告口径）");
  // 包络口径仍需保留（它是双口径校验的一半与回退路径），但不再作主口径。
  assert.match(code, /SPOT_ENVELOPE_UM\s*\/\s*d_px/, "包络口径必须仍然算得出来");
});

test("主口径必须是晶格 100um / pitch，包络只做交叉校验与回退", () => {
  const src = read();
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
  // 2026-11-07 实测：spot_diameter_fullres 逐图波动 3.6%，最近邻恒为平台常量。
  // 用包络当主口径会让 500um 的条实际画出 507.9~525.5um（偏长 1.5~5.1%）。
  assert.match(code, /LATTICE_PITCH_UM\s*=\s*100\.0/, "必须定义 100um 晶格常量");
  assert.match(code, /um_by_lattice\s*=\s*LATTICE_PITCH_UM\s*\/\s*pitch_px/,
    "必须按 100um / 实测 pitch 算晶格口径");
  const i = code.indexOf('"um_per_px":');
  assert.ok(i > 0, "必须返回 um_per_px");
  const line = code.slice(i, i + 80);
  assert.match(line, /"um_per_px":\s*um_by_lattice/, "主口径必须是晶格值，实际：" + line.split("\n")[0]);
});

test("比值必须 fail-closed 抛错，阈值 [0.90, 1.10]", () => {
  const src = read();
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.match(code, /RATIO_LOW\s*=\s*0\.90/, "下界必须 0.90");
  assert.match(code, /RATIO_HIGH\s*=\s*1\.10/, "上界必须 1.10");
  // 锚到比值判定那一条语句本身。首版只查「文件里出现过 raise CalibrationError」，
  // 于是把比值分支的 raise 换成 print 仍能靠其它三处 raise 通过（MUT-B 存活）。
  const i = code.indexOf("ratio < RATIO_LOW");
  assert.ok(i > 0, "必须存在比值下界判定");
  const branch = code.slice(i, i + 200);
  assert.match(branch, /:\s*\n\s*raise\s+CalibrationError/,
    "比值超界的分支体必须直接 raise CalibrationError，不得降级为告警");
});

test("晶格口径必须只取第一壳层内部点", () => {
  const src = read();
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.match(code, /SHELL_TOL\s*=\s*[\d.]+/, "必须有壳层一致性容差常量");
  // 锚到两处真实使用：筛选表达式 + 只对内部点取中位数。
  // 首版只查 interior 这个单词存在，把筛选改成「全选」仍能通过（MUT-C 存活）。
  assert.match(code, /interior\s*=\s*d2\s*<=\s*d1\s*\*\s*SHELL_TOL/,
    "内部点必须由第 2 近邻相对第 1 近邻的壳层容差筛出");
  assert.match(code, /np\.median\(d1\[interior\]\)/,
    "pitch 中位数必须只在内部点子集上计算");
});

test("必须暴露换算偏差的实测记录（防止再次误用 55）", () => {
  const src = read();
  assert.match(src, /0\.6306|0\.7453/, "必须把两条换算的实测值写进文档字符串");
});
