/**
 * ingest_spatial 多数据集格式契约（GSE233814 立项前置）。
 *
 * 病灶：母版按 GSE192741 的 Space Ranger **v1 h5** 形态写死：
 *   FILE_KINDS 只认 filtered_feature_bc_matrix / tissue_positions_list /
 *   scalefactors_json / tissue_hires_image / tissue_lowres_image，
 *   且 bash 段强制要求 GPL24247（小鼠）**与** GPL24676（人）两份 soft。
 *
 * 而 GSE233814（小鼠 pMCAO Visium）是 **mtx 三件套 + 独立 json 坐标**：
 *   GSM*_*_barcodes.tsv.gz / features.tsv.gz / matrix.mtx.gz / *.json.gz 与 *.tif.gz
 * 且只有小鼠一个平台（GPL24247）。当前实现会在参数解析阶段直接 exit 2。
 *
 * 第一版判据只查「关键词是否出现」，MUT-B（强制 h5 形态）与 MUT-C（清空 mtx barcode
 * 读取）双双存活 —— 因为 format_kind 的字符串与 barcodes 的读取行在别处仍出现。
 * 现改为**锚定具体语句**：形态判定必须依据实际计数、mtx 分支必须真的解析三件套。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MASTER = path.join(REPO, "src/line3_spatial/scripts/ingest_spatial");

function read() {
  return fs.readFileSync(MASTER, "utf8");
}
function codeOnly(text) {
  return text.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith("#");
  }).join(String.fromCharCode(10));
}

test("形态判定必须依据 tar 实际计数，而非写死", () => {
  const code = codeOnly(read());
  // 必须有「统计 mtx 命中数」与「按命中数决定 format_kind」两段真逻辑
  assert.match(code, /_mtx_hits\s*\+=?\s*1|_mtx_hits\s*=\s*0/, "必须实际统计 mtx 命中数");
  assert.match(code, /format_kind\s*=\s*"v1_mtx"\s*if\s+_mtx_hits\s*>\s*0/, "format_kind 必须由命中数决定");
});

test("mtx 分支必须真的解压并解析三件套", () => {
  const code = codeOnly(read());
  assert.match(code, /tf\.extractfile\(files\["barcodes"\]\)/, "必须真的读 barcodes");
  assert.match(code, /tf\.extractfile\(files\["features"\]\)/, "必须真的读 features");
  assert.match(code, /tf\.extractfile\(files\["matrix"\]\)/, "必须真的读 matrix");
  assert.match(code, /gzip\.decompress/, "mtx 文件是 gz，必须解压");
});

test("mtx 的 barcode 结果必须赋给 bc（不是空列表占位）", () => {
  const code = codeOnly(read());
  const m = code.match(/bc\s*=\s*gzip\.decompress\(tf\.extractfile\(files\["barcodes"\]\).*\.split\(\)/);
  assert.ok(m, "bc 必须来自 barcodes 文件的实际内容");
});

test("mtx 形态下仍产出 samples_meta.tsv 与 ingest_report.txt（下游契约不变）", () => {
  const code = codeOnly(read());
  assert.match(code, /samples_meta\.tsv/, "下游依赖 samples_meta.tsv");
  assert.match(code, /ingest_report\.txt/, "下游依赖 ingest_report.txt");
});

test("单物种数据集不再强制第二份 soft", () => {
  const code = codeOnly(read());
  const hardRequiresBoth = /\[ -z "\$mouse_soft" \]\s*\|\|\s*\[ -z "\$human_soft" \]/.test(code);
  assert.equal(hardRequiresBoth, false, "不得再把「必须有人的 soft」写成硬条件");
  assert.match(code, /\[ -z "\$mouse_soft" \] && \[ -z "\$human_soft" \]/, "必须改为「至少一份」");
});

test("物种由 soft 元数据判定", () => {
  const code = codeOnly(read());
  assert.match(code, /!Sample_organism_ch1|organism/, "必须依据 soft 的 organism 判定物种");
});

test("单物种时 uns 的 source_soft_human 写空串占位（下游 11 母版依赖键存在）", () => {
  const code = codeOnly(read());
  // 必须显式 or "" 兜底，否则单物种数据会在第 2 步 qc_spots 的 REQUIRED_UNS 检查处失败
  assert.match(code, /source_soft_mouse"\]\s*=\s*mouse_soft_path\s+or\s+""/, "mouse soft 键须空串兜底");
  assert.match(code, /source_soft_human"\]\s*=\s*human_soft_path\s+or\s+""/, "human soft 键须空串兜底");
});

test("下游母版确实只做键存在检查（不校验值为非空）", () => {
  const qc = fs.readFileSync(path.join(REPO, "src/line3_spatial/scripts/qc_spots"), "utf8");
  // 记录这条依赖：qc_spots 的 missing_uns 只比对键集合
  assert.match(qc, /missing_uns/, "qc_spots 应有 missing_uns 检查");
  assert.match(qc, /REQUIRED_UNS/, "qc_spots 应有 REQUIRED_UNS 清单");
  // 正对照：不得出现「source_soft_human 必须非空」这类判据，否则空串兜底无效
  const codeQc = codeOnly(qc);
  assert.equal(
    /source_soft_human[^\n]*!=\s*""|source_soft_human[^\n]*is not None/.test(codeQc),
    false,
    "下游不得校验 source_soft_human 非空（单物种时它合法为空）",
  );
});

test("v1_h5 路径完整保留（GSE192741 回归）", () => {
  const code = codeOnly(read());
  assert.match(code, /h5py\.File/, "h5 路径必须保留 h5py 读取");
  assert.match(code, /files\["filtered_feature_bc_matrix"\]/, "h5 路径必须读 filtered_feature_bc_matrix");
  assert.match(code, /files\["tissue_positions_list"\]/, "h5 路径必须读 positions csv");
});
