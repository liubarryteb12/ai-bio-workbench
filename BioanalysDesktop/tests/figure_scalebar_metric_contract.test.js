/**
 * 比例尺物理长度自检契约（第 69 轮真机发现）。
 *
 * 背景：比例尺画在数据坐标系里，随后 fit_text_edges 为把「500 um」文字收进轴框
 * 会扩大 xlim，条长随之被压缩。实测渲染出的条只代表约 470 um，标注却写 500 um。
 * 图上的物理尺度不可信，比不好看更严重。
 *
 * 判据：母版在布局定稿后用真实轴变换反算每条比例尺的微米数，写入
 * figures_manifest.txt 的 scalebar_check 行；本契约逐条核对 |actual-label|/label <= 3%。
 * 不用外部几何探针量像素：spot 圆点半径会撑大点云包围盒，带来系统性偏置。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runSync, sshArgv } from "../server/proc.js";

const TARGET = "bash -c 'cat /mnt/ssd/bio_data/projects/PRJ_STROKE_P1_SPATIAL_ABCA1/line3_spatial/figures/figures_manifest.txt 2>/dev/null; echo; cat /mnt/ssd/bio_data/projects/PRJ_STROKE_P2_SPATIAL_LACTPYRO_5GENES/line3_spatial/figures/figures_manifest.txt 2>/dev/null'";

test("manifest 必须记录比例尺自检且每条误差 <=3%", (t) => {
  const r = runSync(sshArgv("k40-ubuntu", TARGET), { timeoutMs: 60000 });
  if (r.code !== 0 || !String(r.stdout || "").trim()) {
    return t.skip("HOST_UNREACHABLE_K40: 取不到 figures_manifest.txt");
  }
  const text = String(r.stdout);
  const lines = text.split(/\r?\n/).filter((l) => l.startsWith("scalebar_check="));
  assert.ok(lines.length >= 10,
    "比例尺自检记录太少（应覆盖逐样本空间图），实际 " + lines.length);
  const bad = [];
  for (const l of lines) {
    // 格式：figure= label= actual= um_per_px= bar_px= px_per_data= dpi=
    // 硬判据只认物理量（actual vs label）。bar_px / px_per_data / dpi 是追溯字段：
    // 物理量在任何 dpi 下守恒，像素量只在特定 dpi 下成立，不能反过来当判据
    // （DeepSeek 第 73 轮审计结论）。
    const m = /^scalebar_check=figure=(\S+) label=([0-9.]+) actual=([0-9.]+) um_per_px=([0-9.]+) bar_px=([0-9.]+) px_per_data=([0-9.]+) dpi=([0-9.]+)$/.exec(l.trim());
    if (!m) { bad.push(l + "  <-- 无法解析"); continue; }
    if (m[1] === "-") bad.push(l + "  <-- 缺图名，无法与 PNG 对应");
    const label = Number(m[2]);
    const actual = Number(m[3]);
    const err = Math.abs(actual - label) / label;
    if (err > 0.03) bad.push(l + "  <-- 误差 " + (err * 100).toFixed(1) + "%");
    // 追溯字段必须齐全且非零，便于事后复盘是哪次渲染、什么 dpi
    if (!(Number(m[5]) > 0) || !(Number(m[6]) > 0) || !(Number(m[7]) > 0)) {
      bad.push(l + "  <-- 追溯字段 bar_px/px_per_data/dpi 缺失或为 0");
    }
  }
  assert.deepEqual(bad, [], "比例尺实际长度与标注不一致：\n" + bad.join("\n"));
});

test("um_per_px 必须按 65um 光斑包络折算（不得回到 55）", (t) => {
  const r = runSync(sshArgv("k40-ubuntu", TARGET), { timeoutMs: 60000 });
  if (r.code !== 0) return t.skip("HOST_UNREACHABLE_K40: 设备不可达");
  const lines = String(r.stdout).split(/\r?\n/).filter((l) => l.startsWith("scalebar_check="));
  const vals = lines.map((l) => Number(/um_per_px=([0-9.]+)/.exec(l)[1]));
  assert.ok(vals.length > 0, "无自检记录");
  // 55/87.17 = 0.6306（错），65/87.17 = 0.7458（对）
  for (const v of vals) {
    assert.ok(v > 0.70, "um/px=" + v + " 疑似仍按 55um 捕获孔径折算");
  }
});
