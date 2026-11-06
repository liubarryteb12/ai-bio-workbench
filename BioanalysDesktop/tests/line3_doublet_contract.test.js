/**
 * 空间线双细胞（doublet）处置契约（2026-11-06 用户要求补做）。
 *
 * 背景：line2 的 qc_cells 用作者标注的 class=="doublet" 排除了双细胞，
 * 但 line3 的 qc_spots 原先只按 nCount/nFeature/pct_mito 过滤，没有双细胞处置。
 *
 * 设计（含实测教训）：
 *   scrublet 放在独立作业 ops/doublet_score.py，逐样本用 h5py 只读该样本行块，
 *   峰值约 1.5 GB；qc_spots 只按 row_index 读表应用判定。
 *   为什么不能塞进 qc_spots：主进程持约 2.7 GB 输入与约 2.2 GB 过滤副本，
 *   再起 scrublet 子进程（约 1 GB），写输出时可用内存跌破 600 MB，
 *   Android 的 low-memory-killer 会杀掉整个 Termux（当天实测 5 次）。
 *
 * 口径必须诚实：Visium spot 直径约 55um，本身可能含多个细胞，
 * 此处 doublet 指表达谱混合，不等同于单细胞意义上的真双细胞。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const QC = path.join(REPO, "src/line3_spatial/scripts/qc_spots");
const TOOL = path.join(REPO, "ops/doublet_score.py");

function codeOf(p) {
  return fs.readFileSync(p, "utf8")
    .split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
}

test("独立作业 ops/doublet_score.py 真的调用 scrublet", () => {
  assert.ok(fs.existsSync(TOOL), "必须存在 ops/doublet_score.py");
  const c = codeOf(TOOL);
  assert.match(c, /sc\.pp\.scrublet\s*\(/, "必须调用 sc.pp.scrublet");
  assert.match(c, /predicted_doublet/, "必须输出 predicted_doublet");
  assert.match(c, /doublet_score/, "必须输出 doublet_score");
  assert.match(c, /row_index/, "必须输出 row_index 供 qc_spots 对齐");
});

test("独立作业逐样本按行切片读，不整份加载", () => {
  const c = codeOf(TOOL);
  assert.match(c, /h5py\.File/, "必须用 h5py 打开");
  assert.match(c, /indptr/, "必须按 CSR indptr 切片");
  assert.match(c, /attrs\["shape"\]/, "形状必须从 X.attrs 读（该 h5ad 无 var/_index）");
});

test("qc_spots 必须支持读表并真的过滤掉预测为双细胞的 spot", () => {
  const c = codeOf(QC);
  assert.match(c, /BIO_DOUBLET_TABLE/, "必须有 BIO_DOUBLET_TABLE 开关");
  assert.match(c, /predicted_doublet/, "必须读取 predicted_doublet 判定列");
  assert.match(c, /kept\[~_pred\]|kept\[~pred/, "主矩阵过滤必须真的剔除双细胞");
});

test("双细胞处置必须写进 uns，可事后审计", () => {
  const c = codeOf(QC);
  assert.match(c, /qc_doublet_disposition/, "必须写 uns['qc_doublet_disposition']");
  assert.match(c, /rate_by_sample/, "必须记录逐样本双细胞率");
});

test("Visium 多细胞口径必须在两处都写明", () => {
  for (const p of [QC, TOOL]) {
    const src = fs.readFileSync(p, "utf8");
    assert.match(src, /55\s*um|55um/, p + " 必须说明 spot 直径约 55um");
    assert.match(src, /不等同|不是单细胞|非单细胞/, p + " 必须说明不等同单细胞真双细胞");
  }
});
