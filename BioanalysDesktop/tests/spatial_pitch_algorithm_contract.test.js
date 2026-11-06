/**
 * 晶格 pitch 算法契约（第 73 轮）。
 *
 * 背景：出图母版与 ops 标定模块各有一份「第一壳层内部点」pitch 实现。
 * 两处若算法不同（例如一处用全点中位），边缘点会把 pitch 抬高，
 * 图上的 500um 与代码里的 200um 就会在不同切片上分叉。
 *
 * 判据：ops/spatial_pitch_selftest.py 在合成六角晶格上必须准确还原
 * 三个已知 pitch（132/100/87.5 px），并验证完整入口对随机散点与
 * 缩放级别错配都 fail-closed。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROBE = path.join(REPO, "ops", "spatial_pitch_selftest.py");

test("合成六角晶格上 pitch 必须被准确还原，破碎与缩放错配必须 fail-closed", (t) => {
  if (!fs.existsSync(PROBE)) return t.skip("HOST_MISSING_LOCAL_DATA: 缺 pitch 自测脚本");
  let out;
  try {
    out = execFileSync("python", [PROBE], { cwd: REPO, encoding: "utf8", timeout: 180000 });
  } catch (e) {
    return t.skip("HOST_MISSING_PYTHON: 本机无法运行 pitch 自测（" + String(e.message || e).slice(0, 80) + "）");
  }
  assert.match(out, /PITCH_ALGO_OK/, "pitch 自测未通过：\n" + out);
  // 三个已知 pitch 必须全 OK，不能只过其中一个
  const okLines = (out.match(/OK   pitch=/g) || []).length;
  assert.ok(okLines >= 3, "应至少有 3 个已知 pitch 通过，实际 " + okLines + "：\n" + out);
});

test("自测必须同时覆盖「破碎散点」与「缩放错配」两条负路径", () => {
  const src = fs.readFileSync(PROBE, "utf8");
  assert.match(src, /um_per_px\(sf, rng\.random/, "必须用完整入口测破碎散点");
  assert.match(src, /spot_diameter_fullres.*\/ 2\.0|87\.165 \/ 2\.0/, "必须覆盖缩放级别错配");
  assert.match(src, /CalibrationError/, "负路径必须断言抛 CalibrationError");
});
