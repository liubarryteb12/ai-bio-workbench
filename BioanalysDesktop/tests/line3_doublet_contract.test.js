/**
 * 空间线双细胞（doublet）检测契约（2026-11-06 用户要求补做）。
 *
 * 背景：line2 的 qc_cells 用作者标注的 class=="doublet" 排除了双细胞，
 * 但 line3 的 qc_spots 只按 nCount/nFeature/pct_mito 过滤，**没有双细胞检测**。
 * 用户要求补齐并重跑。
 *
 * 口径必须诚实：Visium spot 直径 55um，本身可能含多个细胞，
 * 因此这里的「doublet」指「表达谱像两群混合」的 spot（多细胞/粘连/ambient），
 * 不等同于单细胞意义上的真双细胞。母版注释里必须写明这一点。
 *
 * 判据：
 *   1. 真的调用 scrublet（scanpy 自带 pp.scrublet，不依赖 scrublet 包）；
 *   2. 预测为 doublet 的 spot 被排除出主矩阵；
 *   3. 处置方式与参数写进 uns，可事后审计（对齐 line2 qc_doublet_disposition）；
 *   4. 有开关（BIO_DOUBLET_FILTER=0 可关闭），便于复现旧结果与做消融。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const QC = path.join(REPO, "src/line3_spatial/scripts/qc_spots");

function code() {
  const src = fs.readFileSync(QC, "utf8");
  // 只认可执行行，注释里提到 scrublet 不算实现
  return src.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
}

test("qc_spots 必须真的调用 scrublet 做双细胞检测", () => {
  const c = code();
  assert.match(c, /sc\.pp\.scrublet\s*\(/, "必须调用 sc.pp.scrublet（scanpy 自带实现）");
  assert.match(c, /predicted_doublet/, "必须读取 predicted_doublet 判定列");
  assert.match(c, /doublet_score/, "必须读取 doublet_score 分数");
});

test("预测为双细胞的 spot 必须被排除出主矩阵", () => {
  const c = code();
  // 过滤必须用到 predicted_doublet 的结果，而不是只打印统计
  assert.match(c, /~\s*pred|!\s*pred|np\.logical_not\(\s*pred/,
    "主矩阵过滤条件必须包含「非双细胞」");
});

test("双细胞处置与参数必须写进 uns，可事后审计", () => {
  const c = code();
  assert.match(c, /qc_doublet_disposition/, "必须写 uns['qc_doublet_disposition']");
  assert.match(c, /rate_by_sample|per_sample/, "必须记录逐样本双细胞率");
});

test("必须提供开关，便于复现旧结果与消融", () => {
  const c = code();
  assert.match(c, /BIO_DOUBLET_FILTER/, "必须有 BIO_DOUBLET_FILTER 开关");
});

test("Visium 多细胞口径必须在母版注释里写明（不能当作单细胞真双细胞）", () => {
  const src = fs.readFileSync(QC, "utf8");
  assert.match(src, /55\s*um|55um|多细胞|多个细胞/,
    "注释必须说明 Visium spot 是多细胞单元");
  assert.match(src, /不等同|不是单细胞|非单细胞/,
    "注释必须说明此处 doublet 不等同单细胞真双细胞");
});
