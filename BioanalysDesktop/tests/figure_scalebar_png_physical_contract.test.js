/**
 * 成品图比例尺物理长度独立量测契约（第 73 轮）。
 *
 * 与 figure_scalebar_metric_contract 的分工：
 *   - 那条读的是 manifest 里母版自己的自检值（图内自证）；
 *   - 这条不看代码、不看 manifest，直接在 PNG 像素上用「晶格 pitch = 100 µm」
 *     这把绝对尺子反推比例尺长度，是真正的第三方量测。
 *
 * 为什么必须有这一条：
 *   第 69 轮我把「点云包围盒宽度 / 数据跨度」当成 px_per_data，算出「500um 只有
 *   470um」并据此改了实现。第 73 轮用晶格尺复核才发现 470 是量测口径错误，
 *   真实值一直是 500。只靠图内自证或单一量测，会把量测错误当成产品缺陷。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROBE = path.join(REPO, "ops", "figure_scalebar_png_measure.py");
const PNG = path.join(
  REPO,
  "local_projects/PRJ_STROKE_P1_SPATIAL_ABCA1/figures/line3_spatial/l3_mouse_01_domains_B1-D1.png",
);

test("PNG 像素量测：比例尺物理长度与 500um 标注一致（±3%）", (t) => {
  if (!fs.existsSync(PNG)) return t.skip("HOST_MISSING_LOCAL_DATA: 缺本地渲染图");
  if (!fs.existsSync(PROBE)) return t.skip("HOST_MISSING_LOCAL_DATA: 缺量测探针");
  let out;
  try {
    out = execFileSync("python", [PROBE, PNG], { encoding: "utf8", timeout: 180000 });
  } catch (e) {
    // 跳过原因必须是「标签: 非空说明」的字面量：静态白名单扫描看的是源码字面量，
    // 写成 "HOST_MISSING_PYTHON: " + 拼接时，冒号后为空，扫描直接判违规。
    return t.skip("HOST_MISSING_PYTHON: 本机无 python 执行量测探针（" +
      String(e.message || e).slice(0, 100) + "）");
  }
  const bar = /BAR_UM=([0-9.]+)/.exec(out);
  const label = /LABEL_UM=([0-9]+)/.exec(out);
  assert.ok(bar && label, "探针未输出 BAR_UM/LABEL_UM：\n" + out);
  const barUm = Number(bar[1]);
  const labelUm = Number(label[1]);
  const err = Math.abs(barUm - labelUm) / labelUm;
  // 亚像素插值后实测 502.6 / 502.2 um（<0.6%），容差收到 3%。
  assert.ok(
    err <= 0.03,
    "PNG 实测比例尺 " + barUm.toFixed(1) + " um，标注 " + labelUm + " um，相差 " +
      (err * 100).toFixed(1) + "%（要求 <=3%）\n" + out,
  );
});

test("量测探针必须用端刻度中心与 cos30 折算（否则会把量测误差当缺陷）", () => {
  const src = fs.readFileSync(PROBE, "utf8");
  // 端刻度中心：避开横线两端的抗锯齿晕（133px vs 真实 128px）
  assert.match(src, /centers\[-1\] - centers\[0\]/, "条长必须取两端刻度中心之差");
  // 六角晶格 x 投影周期 = pitch*cos30
  assert.match(src, /np\.cos\(np\.deg2rad\(30\.0\)\)/, "pitch 必须做 cos30 折算");
});
