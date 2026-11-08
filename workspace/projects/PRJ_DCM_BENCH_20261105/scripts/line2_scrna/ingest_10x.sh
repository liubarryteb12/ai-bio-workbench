#!/usr/bin/env bash
# ingest_10x：PRJ_DCM_BENCH_20261105 line2_scrna 项目内适配步 1。
# GSE185100 人类心脏 snRNA-seq，10x 三件套嵌套 tar 摄取。
#
# 为什么项目内写而不动母版：部署母版 ingest_counts 绑定上一研究（GSE254707 Smart-seq2 皮肤：
# 每 GSM 一个细胞文本、soft 元数据分组、ERCC spike-in）。本线是 10x v3：外层 10 个
# GSM*_样本_processed.tar.gz，内层 barcodes/features/matrix 三件套，一样本一矩阵，无 spike-in。
# 分组来自用户设计（样本名派生，未知样本名不猜分组直接失败）：
#   DCM1..4 -> group=DCM, diagnosis=DCM；Young1..3 -> group=Ctrl, diagnosis=NonDiseased；
#   Fetal1..3 -> group=Fetal, diagnosis=Fetal（保留列组，不进 DCM vs Ctrl 主对比）。
#
# 输入（--input 绝对路径；case 模式前后都带 *，坑 #99）：
#   *.tar       外层 GSE185100_RAW.tar（必需，唯一）
#   *soft*      GPL24676_family.soft.gz（溯源记录路径，不参与分组派生）
#   *grouping*  可选用户分组表（样本<TAB>组 或 样本,组），提供则与派生分组交叉核对
# 产物：processed/scrna_counts.h5ad + processed/ingest_report.txt
#   --output 里有同名项就按它落盘（引擎台账对账），否则进第一个 --output 的目录，
#   再没有就落当前目录（引擎把 cwd 设在 processed/）。
#
# 契约对齐部署母版 qc_cells 的 REQUIRED 清单（/mnt/ssd/bio_data/bin/line2_scrna/qc_cells）：
#   obs 12 列：donor/diagnosis/region/group/class/plate/well/ncount_computed/
#     nfeature_computed/ercc_fraction_computed/celltype_paper/seurat_cluster_paper。
#     诚实占位：donor=样本名（10x 一样本一供体），region=heart，class=singlet（通道无 doublet 标注），
#     plate=样本名，well=NA，celltype_paper=NA、seurat_cluster_paper=NA（GEO 无细胞级作者注释），
#     ncount/nfeature 从矩阵重算，ercc_fraction_computed=0（无 spike-in）。
#   var：var_names=Ensembl，index.name="gene"（母版 normalize_hvg 的 hvg_genes.tsv 首列名由此而来），
#     var['gene_symbol']=features 第二列（缺失记 NA），var['ercc']=全 False（无 spike-in，列照建）。
#     只保留 feature type == "Gene Expression" 的行。
#   uns：region_to_group/seed/source_counts_tar/source_gpl_soft/grouping_check 五键齐。
#   obs_names 一律加 "样本名_" 前缀（barcode 防跨样本碰撞）。
#
# 自校验（任一不过 fail() exit 1，不落盘）：外层成员命名可解析且样本集合与设计精确一致；
# 内层三件套齐；features 跨样本逐字节一致；matrix 维度 == features 行数 x barcodes 数；
# dtype 整数；无负值；barcode 唯一；加前缀后 cell id 全局唯一；obs/var 名唯一；
# 矩阵总计数与非零元与逐样本和对账；computed 列与重算一致；ercc 全 False 且 fraction 全 0；
# 契约 obs/var/uns 逐项在位；DCM 与 Ctrl 两组非空。
set -euo pipefail

seed="${BIOANALYS_SEED:-UNSET}"
if [ "$seed" = "UNSET" ]; then
  echo "BIOANALYS_SEED 未注入（引擎契约：seed 必须注入）" >&2
  exit 3
fi

BIO_PY="${BIO_PY:-/root/venvs/bio-py/bin/python3}"
if [ ! -x "$BIO_PY" ]; then
  echo "python 解释器不可执行: $BIO_PY（可用环境变量 BIO_PY 覆盖）" >&2
  exit 2
fi

declare -a INPUTS=()
declare -a OUTPUTS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --input) INPUTS+=("$2"); shift 2 ;;
    --output) OUTPUTS+=("$2"); shift 2 ;;
    --seed) shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

tar_file=""
soft_file=""
grouping_file=""
for path in "${INPUTS[@]:-}"; do
  [ -n "$path" ] || continue
  case "$path" in
    *grouping*) grouping_file="$path" ;;
    *.soft.gz|*soft) soft_file="$path" ;;
    *.tar.gz|*.tgz) echo "不支持直接喂内层包: $path（只吃外层 *RAW.tar）" >&2; exit 2 ;;
    *.tar) tar_file="$path" ;;
    *) echo "无法识别的输入文件: $path（需要外层 *.tar、*.soft.gz 与可选 *grouping*）" >&2; exit 2 ;;
  esac
done

if [ -z "$tar_file" ]; then
  echo "缺少必需输入：外层 GSE185100_RAW.tar 未提供" >&2
  exit 2
fi
if [ ! -f "$tar_file" ]; then
  echo "输入文件不存在: $tar_file" >&2
  exit 2
fi
if [ -n "$soft_file" ] && [ ! -f "$soft_file" ]; then
  echo "soft 文件不存在: $soft_file" >&2
  exit 2
fi

out_dir="."
if [ "${#OUTPUTS[@]}" -gt 0 ]; then
  out_dir="$(dirname "${OUTPUTS[0]}")"
fi
mkdir -p "$out_dir"

out_path() {
  local name="$1"
  local p
  for p in "${OUTPUTS[@]:-}"; do
    [ -n "$p" ] || continue
    if [ "$(basename "$p")" = "$name" ]; then
      printf '%s\n' "$p"
      return 0
    fi
  done
  printf '%s\n' "$out_dir/$name"
}

H5AD_OUT="$(out_path scrna_counts.h5ad)"
REPORT_OUT="$(out_path ingest_report.txt)"
rm -f "$H5AD_OUT" "$REPORT_OUT"

echo "step_executed=ingest_10x"
echo "bioanalys_seed=${seed}"
echo "input_tar=${tar_file}"
echo "input_soft=${soft_file:-NA}"
echo "input_grouping=${grouping_file:-NA}"

TAR_FILE="$tar_file" SOFT_FILE="$soft_file" GROUPING_FILE="$grouping_file" \
BIOANALYS_SEED="$seed" H5AD_OUT="$H5AD_OUT" REPORT_OUT="$REPORT_OUT" \
"$BIO_PY" - <<'PYSCRIPT'
import gzip
import hashlib
import io
import os
import re
import sys
import tarfile
import time
from collections import Counter

import numpy as np
import pandas as pd
import anndata as ad
import scipy.io as sio
from scipy.sparse import vstack

# pandas 3 与 2 的 infer_string 默认值不同，写 obs 字符串列会崩，显式关掉（坑 #107）。
ad.settings.allow_write_nullable_strings = False

START = time.time()


def fail(message):
    sys.stderr.write("ingest_10x 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)


def log(message):
    print(message, flush=True)


TAR_FILE = os.environ["TAR_FILE"]
SOFT_FILE = os.environ.get("SOFT_FILE", "")
GROUPING_FILE = os.environ.get("GROUPING_FILE", "")
SEED = os.environ["BIOANALYS_SEED"]
H5AD_OUT = os.environ["H5AD_OUT"]
REPORT_OUT = os.environ["REPORT_OUT"]

try:
    SEED_INT = int(SEED)
except ValueError:
    fail("BIOANALYS_SEED 不是整数: %s" % SEED)

# 用户设计分组（2026-11-05 定稿）：样本类别 -> (group, diagnosis)。
DESIGN = {"DCM": ("DCM", "DCM"), "Young": ("Ctrl", "NonDiseased"), "Fetal": ("Fetal", "Fetal")}
EXPECTED_SAMPLES = {"DCM1", "DCM2", "DCM3", "DCM4",
                    "Fetal1", "Fetal2", "Fetal3",
                    "Young1", "Young2", "Young3"}

MEMBER_RE = re.compile(r"^GSM\d+_(DCM|Fetal|Young)\d+_processed\.tar\.gz$")
INNER_NEED = ("barcodes.tsv.gz", "features.tsv.gz", "matrix.mtx.gz")

# --- 1. 外层 tar -> 内层三件套（全内存拼装，不写远端任何目录）---
samples = {}
feature_hashes = {}
outer_files = 0
outer_dirs = 0
with tarfile.open(TAR_FILE, "r:") as outer:
    for member in sorted(outer.getmembers(), key=lambda m: m.name):
        if not member.isfile():
            outer_dirs += 1
            continue
        outer_files += 1
        base = os.path.basename(member.name)
        match = MEMBER_RE.match(base)
        if not match:
            fail("外层 tar 成员名不符合 GSM<数字>_<DCM|Fetal|Young><序号>_processed.tar.gz: %s" % base)
        gsm_parts = base.split("_", 1)
        gsm = gsm_parts[0]
        sample = "%s%s" % (match.group(1), match.group(2))
        if sample not in EXPECTED_SAMPLES:
            fail("样本名 %s 不在用户设计（DCM1-4/Fetal1-3/Young1-3），不猜分组" % sample)
        if sample in samples:
            fail("样本重复: %s" % sample)
        inner_bytes = outer.extractfile(member).read()
        inner_blobs = {}
        with tarfile.open(fileobj=io.BytesIO(inner_bytes), mode="r:gz") as inner:
            for im in inner.getmembers():
                if not im.isfile():
                    continue
                ib = os.path.basename(im.name)
                if ib in INNER_NEED:
                    inner_blobs[ib] = inner.extractfile(im).read()
        missing = [n for n in INNER_NEED if n not in inner_blobs]
        if missing:
            fail("样本 %s 内层缺文件: %s" % (sample, missing))
        samples[sample] = {"gsm": gsm, "blobs": inner_blobs}
        feature_hashes[sample] = hashlib.sha256(inner_blobs["features.tsv.gz"]).hexdigest()

missing_samples = sorted(EXPECTED_SAMPLES - set(samples))
extra_samples = sorted(set(samples) - EXPECTED_SAMPLES)
if missing_samples or extra_samples:
    fail("样本集合与设计不符 missing=%s extra=%s" % (missing_samples, extra_samples))
if len(set(feature_hashes.values())) != 1:
    fail("跨样本 features.tsv.gz 不一致（基因空间应相同）")
log("outer_files=%d outer_dirs=%d samples=%d" % (outer_files, outer_dirs, len(samples)))

# --- 2. features：Ensembl | symbol | type，只保留 Gene Expression ---
feat = pd.read_csv(io.BytesIO(gzip.decompress(samples["DCM1"]["blobs"]["features.tsv.gz"])),
                   sep="\t", header=None, dtype=str,
                   names=["ensembl_id", "gene_symbol", "feature_type"])
feat["ensembl_id"] = feat["ensembl_id"].astype(str)
feat["gene_symbol"] = feat["gene_symbol"].fillna("NA").astype(str)
if feat["ensembl_id"].duplicated().any():
    fail("features 的 Ensembl ID 有重复")
type_counts = Counter(feat["feature_type"])
expr_mask = (feat["feature_type"] == "Gene Expression").to_numpy()
kept_index = np.flatnonzero(expr_mask)
dropped_types = {k: v for k, v in type_counts.items() if k != "Gene Expression"}
if len(kept_index) < 1000:
    fail("Gene Expression 行数 %d < 1000，疑似 feature type 解析错误" % len(kept_index))
log("features_rows=%d kept_gene_expression=%d dropped_types=%s"
    % (len(feat), len(kept_index), dropped_types if dropped_types else "无"))

# --- 3. 逐样本读三件套，拼 cell x gene ---
order = sorted(samples)
X_blocks, obs_frames, per_sample_stats = [], [], []
total_from_samples = 0
nnz_from_samples = 0
for sample in order:
    record = samples[sample]
    gsm = record["gsm"]
    blobs = record["blobs"]
    barcodes = [line.split("\t")[0].strip()
                for line in gzip.decompress(blobs["barcodes.tsv.gz"]).decode("utf-8").splitlines()
                if line.strip()]
    if len(barcodes) != len(set(barcodes)):
        fail("样本 %s barcode 不唯一（10x filtered 输出应唯一）" % sample)
    if any(("-1" not in b) for b in barcodes[:50]):
        fail("样本 %s barcode 命名不符合 10x（缺 -1 后缀）: %s" % (sample, barcodes[:3]))

    mat = sio.mmread(io.BytesIO(gzip.decompress(blobs["matrix.mtx.gz"])))  # gene x cell
    if mat.shape[0] != len(feat):
        fail("样本 %s matrix 行数 %d != features 行数 %d" % (sample, mat.shape[0], len(feat)))
    if mat.shape[1] != len(barcodes):
        fail("样本 %s matrix 列数 %d != barcodes 数 %d" % (sample, mat.shape[1], len(barcodes)))
    if not np.issubdtype(mat.dtype, np.integer):
        fail("样本 %s matrix dtype %s 非整数（Space Ranger 3.0.2 应给 integer）" % (sample, mat.dtype))
    if mat.data.size and mat.data.min() < 0:
        fail("样本 %s 矩阵含负计数" % sample)
    sub = mat.tocsr()[kept_index, :].T.tocsr()  # cell x gene，只保留 Gene Expression 行
    if not np.issubdtype(sub.data.dtype, np.integer):
        fail("样本 %s 裁剪后 dtype %s 非整数" % (sample, sub.data.dtype))
    if sub.data.size and sub.data.min() < 0:
        fail("样本 %s 裁剪后含负计数" % sample)

    sample_total = int(sub.data.sum())
    total_from_samples += sample_total
    nnz_from_samples += int(sub.nnz)
    X_blocks.append(sub)

    ncount = np.asarray(sub.sum(axis=1)).ravel().astype(np.int64)
    nfeature = np.asarray((sub > 0).sum(axis=1)).ravel().astype(np.int64)
    if np.any(ncount == 0):
        fail("样本 %s 有 %d 个零计数细胞（10x filtered 不应出现）" % (sample, int((ncount == 0).sum())))
    category = re.match(r"^(DCM|Fetal|Young)\d+$", sample).group(1)
    group, diagnosis = DESIGN[category]
    cell_ids = ["%s_%s" % (sample, b) for b in barcodes]
    if len(set(cell_ids)) != len(cell_ids):
        fail("样本 %s 加前缀后 cell id 仍不唯一" % sample)
    obs_frames.append(pd.DataFrame({
        "donor": sample,
        "diagnosis": diagnosis,
        "region": "heart",
        "group": group,
        "class": "singlet",
        "plate": sample,
        "well": "NA",
        "ncount_computed": ncount,
        "nfeature_computed": nfeature,
        "ercc_fraction_computed": np.zeros(sub.shape[0], dtype=float),
        "celltype_paper": "NA",
        "seurat_cluster_paper": "NA",
        "gsm": gsm,
        "sample": sample,
        "sample_category": category,
    }, index=cell_ids))
    per_sample_stats.append({
        "sample": sample, "gsm": gsm, "group": group, "cells": int(sub.shape[0]),
        "total_counts": sample_total, "nnz": int(sub.nnz),
        "median_ncount": float(np.median(ncount)), "median_nfeature": float(np.median(nfeature)),
        "min_ncount": int(ncount.min()), "max_ncount": int(ncount.max()),
        "min_nfeature": int(nfeature.min()), "max_nfeature": int(nfeature.max()),
    })
    log("sample=%s gsm=%s group=%s cells=%d counts=%d median_nfeature=%.0f"
        % (sample, gsm, group, sub.shape[0], sample_total, float(np.median(nfeature))))

adata = ad.AnnData(
    X=vstack(X_blocks, format="csr"),
    obs=pd.concat(obs_frames),
    var=feat.iloc[kept_index].copy().set_index("ensembl_id"),
)
adata.var["feature_type"] = adata.var["feature_type"].astype(str)
adata.var["gene_symbol"] = adata.var["gene_symbol"].astype(str)
adata.var["ercc"] = np.zeros(adata.shape[1], dtype=bool)  # 无 spike-in，列照建（母版契约）
adata.var_names = adata.var_names.astype(str)
adata.var_names.name = "gene"
adata.obs_names = adata.obs_names.astype(str)
adata.obs_names.name = "cell_id"
if not np.issubdtype(adata.X.dtype, np.integer):
    fail("拼接后 X dtype %s 非整数（下游 normalize_hvg 按整数计数校验）" % adata.X.dtype)

# --- 4. grouping 交叉核对（可选输入）---
grouping_check = "未提供 grouping 文件，分组按样本名派生（DCM1-4=DCM, Young1-3=Ctrl, Fetal1-3=Fetal）"
if GROUPING_FILE:
    try:
        raw_lines = open(GROUPING_FILE, encoding="utf-8").read().splitlines()
    except OSError as exc:
        fail("grouping 文件读取失败: %s" % exc)
    declared = {}
    for line in raw_lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = re.split(r"[\t,]", line)
        if len(parts) >= 2:
            declared[parts[0].strip()] = parts[1].strip()
    if not declared:
        fail("grouping 文件解析不出任何 样本->组 行: %s" % GROUPING_FILE)
    derived = {s["sample"]: s["group"] for s in per_sample_stats}
    mismatch = {k: (v, derived.get(k)) for k, v in declared.items() if k in derived and derived[k] != v}
    unknown = sorted(set(declared) - set(derived))
    if mismatch:
        fail("grouping 文件与样本名派生分组冲突: %s" % mismatch)
    grouping_check = ("grouping 文件核对通过：声明 %d 条全部与派生一致；未知样本=%s"
                      % (len(declared), unknown if unknown else "无"))
log(grouping_check)

# --- 5. 自校验（落盘前）---
if adata.obs_names.duplicated().any():
    fail("obs_names 存在重复")
if adata.var_names.duplicated().any():
    fail("var_names 存在重复")
if adata.X.data.size and adata.X.data.min() < 0:
    fail("拼接后矩阵含负计数")
total_in_matrix = int(adata.X.data.sum())
if total_in_matrix != total_from_samples:
    fail("总数对账失败：矩阵 %d != 逐样本和 %d" % (total_in_matrix, total_from_samples))
if adata.X.nnz != nnz_from_samples:
    fail("非零元对账失败：矩阵 %d != 逐样本和 %d" % (adata.X.nnz, nnz_from_samples))
nc_recalc = np.asarray(adata.X.sum(axis=1)).ravel().astype(np.int64)
nf_recalc = np.asarray((adata.X > 0).sum(axis=1)).ravel().astype(np.int64)
if not np.array_equal(nc_recalc, adata.obs["ncount_computed"].to_numpy(dtype=np.int64)):
    fail("ncount_computed 与矩阵重算不一致")
if not np.array_equal(nf_recalc, adata.obs["nfeature_computed"].to_numpy(dtype=np.int64)):
    fail("nfeature_computed 与矩阵重算不一致")
ercc_total = int(np.asarray(adata.X[:, adata.var["ercc"].to_numpy(dtype=bool)].sum(axis=1)).ravel().sum())
if ercc_total != 0 or not np.allclose(adata.obs["ercc_fraction_computed"].to_numpy(dtype=float), 0.0):
    fail("本数据集应无 ERCC，但 ercc 计数和=%d 或 fraction 非全 0" % ercc_total)
required_obs = ["donor", "diagnosis", "region", "group", "class", "plate", "well",
                "ncount_computed", "nfeature_computed", "ercc_fraction_computed",
                "celltype_paper", "seurat_cluster_paper"]
missing_obs = [c for c in required_obs if c not in adata.obs.columns]
if missing_obs:
    fail("obs 缺母版 qc_cells 要求列: %s" % missing_obs)
for col in ["ercc", "gene_symbol"]:
    if col not in adata.var.columns:
        fail("var 缺列: %s" % col)
group_counter = Counter(adata.obs["group"])
if group_counter.get("DCM", 0) == 0 or group_counter.get("Ctrl", 0) == 0:
    fail("DCM 或 Ctrl 组为空，主对比无法成立")
log("self_check 唯一性/维度/整数非负/总数对账/computed/契约 OK cells=%d genes=%d" % adata.shape)

# --- 6. uns 与落盘 ---
adata.uns["region_to_group"] = {"DCM": "DCM", "Young": "Ctrl", "Fetal": "Fetal",
                                "note": "键为样本类别（样本名去尾部编号），值为用户设计分组。"
                                        "母版语义是皮肤区域码 PP/PN/H，本线 region 恒为 heart，"
                                        "分组改由样本类别派生。"}
adata.uns["seed"] = SEED_INT
adata.uns["source_counts_tar"] = TAR_FILE
adata.uns["source_gpl_soft"] = SOFT_FILE if SOFT_FILE else "NA"
adata.uns["grouping_check"] = grouping_check
adata.uns["data_origin"] = {
    "geo_series": "GSE185100",
    "assay": "10x Genomics 3' v3 snRNA-seq (Space Ranger 3.0.2)",
    "matrix_layout": "内层 MatrixMarket integer gene x cell，本步转置为 cell x gene",
    "spike_in": "无（var['ercc'] 全 False）",
    "feature_types_dropped": dropped_types,
    "sample_prefix": "obs_names 加 样本名_ 前缀防跨样本碰撞",
}
adata.write_h5ad(H5AD_OUT)

# --- 7. 报告 ---
sample_cells = {s["sample"]: s["cells"] for s in per_sample_stats}
report_lines = [
    "step=ingest_10x",
    "seed=%s" % SEED,
    "input_tar=%s" % TAR_FILE,
    "input_soft=%s" % (SOFT_FILE if SOFT_FILE else "NA（未提供，仅影响溯源记录）"),
    "input_grouping=%s" % (GROUPING_FILE if GROUPING_FILE else "NA（按样本名派生）"),
    "grouping_check=%s" % grouping_check,
    "samples=%d (DCM1-4 / Fetal1-3 / Young1-3)" % len(order),
    "cells_after=%d genes_after=%d (gene_expression_rows=%d, dropped_feature_types=%s)"
    % (adata.shape[0], adata.shape[1], len(kept_index),
       dropped_types if dropped_types else "无"),
    "matrix_nnz=%d matrix_density=%.6f" % (adata.X.nnz, adata.X.nnz / float(adata.shape[0] * adata.shape[1])),
    "total_counts=%d（矩阵重算与逐样本和对账一致）" % total_in_matrix,
    "ercc_present=False（无 spike-in；ercc 全 False，ercc_fraction_computed 全 0）",
    "groups=%s" % dict(group_counter),
    "donor_cells=%s" % sample_cells,
    "fetal_note=Fetal1-3 保留在矩阵（obs group=Fetal），不进 DCM vs Ctrl 主对比；下游对比步按 group 过滤",
    "contract_note=obs 12 列按部署母版 qc_cells REQUIRED 清单给足；celltype_paper/seurat_cluster_paper=NA、"
    "class=singlet、well=NA 是诚实占位（10x 无作者细胞级注释、无 doublet 标注、无孔位概念）；"
    "母版 qc_cells 的 Smart-seq2 阈值（nCount>50000/nFeature>1500/ERCC<0.15）对核转录组不适用，由项目内 qc_nuclei.sh 替换",
    "per_sample:",
]
for stat in per_sample_stats:
    report_lines.append("  %s gsm=%s group=%s cells=%d total_counts=%d nnz=%d "
                        "median_ncount=%.0f median_nfeature=%.0f ncount_range=%d-%d nfeature_range=%d-%d"
                        % (stat["sample"], stat["gsm"], stat["group"], stat["cells"],
                           stat["total_counts"], stat["nnz"], stat["median_ncount"], stat["median_nfeature"],
                           stat["min_ncount"], stat["max_ncount"],
                           stat["min_nfeature"], stat["max_nfeature"]))
report_lines += [
    "limitation_note=1) 细胞核悬液 snRNA-seq，核内 mRNA 占比高、MT 比例与本底和单细胞不同，QC 用核口径阈值（见 qc_nuclei.sh）；"
    "2) celltype_paper=NA：GEO 侧无细胞级作者注释，注释完全依赖本项目 marker 打分（annotate_cardiac.sh）；"
    "3) 一样本一供体，样本名即 donor，供体级功效受 DCM 4 vs Ctrl 3 限制；"
    "4) 无 spike-in，ERCC 相关口径列恒为 0，仅为满足母版契约保留；"
    "5) soft 文件仅记录路径未参与分组派生（分组为项目内设计，非 GEO 字段）。",
    "elapsed_seconds=%.0f" % (time.time() - START),
    "outputs=%s, %s" % (H5AD_OUT, REPORT_OUT),
]
with open(REPORT_OUT, "w", encoding="utf-8") as fh:
    fh.write("\n".join(report_lines) + "\n")

for line in report_lines:
    log(line)

with open(H5AD_OUT, "rb") as _fh:
    _digest = hashlib.sha256(_fh.read()).hexdigest()
with open(REPORT_OUT, "a", encoding="utf-8") as _fh:
    _fh.write("scrna_counts.h5ad_sha256=%s\n" % _digest)
log("ingest_10x_done cells=%d genes=%d elapsed=%.1fs" % (adata.shape[0], adata.shape[1], time.time() - START))
PYSCRIPT

# sha256 产物台账后置补登：k40 通用脚本存在才调（本地静态验证环境自然跳过）。
if [ -x "/mnt/ssd/bio_data/ops/k40_step_sha_ledger.sh" ]; then
  "/mnt/ssd/bio_data/ops/k40_step_sha_ledger.sh" "$PWD" "$(basename "$REPORT_OUT")" > /dev/null 2>>"$0.ledger.err" \
  || echo "WARN sha256 ledger backfill failed, see $0.ledger.err" >&2
fi
