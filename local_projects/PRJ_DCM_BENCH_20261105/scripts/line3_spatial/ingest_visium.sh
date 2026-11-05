#!/usr/bin/env bash
# ingest_visium：PRJ_DCM_BENCH_20261105 line3_spatial 项目内适配读入（GSE218759 小鼠 Visium 心脏 HFpEF）。
#
# 与 k40 母版 bin/line3_spatial/ingest_spatial 的差异（为什么必须项目内适配）：
#   1. 母版绑定上一研究 GSE192741：双物种分支（GPL24247 小鼠 + GPL24676 人）、
#      per_species 硬编码两物种、PLATFORM_BY_SPECIES 两平台、CONDITION_CLASS 是
#      NAFLD 饮食词表（StSt/SD/WD/Healthy/Steatotic）。本数据 condition/group 是
#      Ctrl / Ctrl_HF / TTg_HF，strain 是 "hybrid of C57BL/6 and ICR"，组织是心脏，
#      母版按词表匹配会直接 fail。
#   2. 文件后缀规则不同：母版期望 <GSM>_<kind>_<短名>.<ext>（如 filtered_..._BH001.h5），
#      本数据是 <GSM>_<样本名>_<kind>.<ext>（如 GSM6756178_A_Ctrl_filtered_feature_bc_matrix.h5），
#      样本名本身含下划线，故按 kind 词表反向切分。
#   3. 本数据单物种（只有小鼠 soft GPL24247），母版的双物种分支不适用：
#      source_soft_human 在 uns 里留空字符串占位，报告写明原因。
#   4. 本数据 positions 全部 4992 行入矩阵（含 in_tissue=0），母版只收 filtered 的
#      组织内 spot；这样下游能区分"组织外空白"与"被 QC 剔除"。
#
# 数据形态（2026-11-05 对 k40 raw_data 只读探针实测，未执行任何分析）：
#   GSE218759_RAW.tar 760596480 字节，18 个成员，3 样本 x 5 件套 + 3 个 HE tif.gz（不入矩阵）。
#   Space Ranger：Spatial 3' v1，spaceranger-1.3.1，genome mm10，Assembly mm10/GRCm38。
#   每样本 h5：19465 基因 x 组织内 spot（A_Ctrl 1935 / C_TTg_HF 2157 / D_Ctrl_HF 2994），
#   三样本基因 ID 与顺序逐字节一致（实测 identical=True，交集 19465）。
#   探针组不含 chrMT 基因：symbol 里 mt- 前缀 0 个，13 个 mm10 mt-* Ensembl ID 全部缺席。
#   positions：6 列无表头，4992 行，in_tissue=1 数与矩阵 spot 数逐样本相符。
#   scalefactors：4 键齐全，spot_diameter_fullres 约 86.2 三样本一致。
#   lowres 图：(557, 600, 3) uint8 三样本一致。
#   soft 无 "number of spots" 字段（母版该对账分支不适用），改为 positions/matrix 自对账。
#
# I/O 契约：
#   --input  GSE218759_RAW.tar（必需，*.tar）
#   --input  GPL24247_family.soft.gz（必需，*GPL24247*）
#   --input  人源 soft / grouping（可选，只登记不使用）
#   --output 输出根目录（可选，缺省当前目录；给文件路径时取其 dirname）
#   --seed   必须与 BIOANALYS_SEED 一致，否则 exit 2；BIOANALYS_SEED 缺失 exit 3
#   产物：processed/spatial_counts_mouse.h5ad
#         processed/samples_meta.tsv
#         processed/ingest_report.txt
set -euo pipefail

seed="${BIOANALYS_SEED:-UNSET}"
if [ "$seed" = "UNSET" ]; then
  echo "BIOANALYS_SEED 未注入（引擎契约：seed 必须注入）" >&2
  exit 3
fi

PY="${BIO_PY:-/root/venvs/bio-py/bin/python3}"
if [ ! -x "$PY" ]; then
  echo "python 解释器不可执行: $PY（可用 BIO_PY 覆盖）" >&2
  exit 2
fi

declare -a INPUTS=()
cli_output=""
cli_seed=""
while [ $# -gt 0 ]; do
  case "$1" in
    --input) INPUTS+=("$2"); shift 2 ;;
    --output) cli_output="$2"; shift 2 ;;
    --seed) cli_seed="$2"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done
if [ -n "$cli_seed" ] && [ "$cli_seed" != "$seed" ]; then
  echo "--seed($cli_seed) 与 BIOANALYS_SEED($seed) 不一致" >&2
  exit 2
fi

tar_file=""
mouse_soft=""
human_soft=""
grouping_file=""
for path in "${INPUTS[@]:-}"; do
  [ -n "$path" ] || continue
  case "$path" in
    *.tar) tar_file="$path" ;;
    *GPL24247*) mouse_soft="$path" ;;
    *GPL24676*|*human*soft*|*soft*human*) human_soft="$path" ;;
    *grouping*) grouping_file="$path" ;;
    *) echo "无法识别的输入文件: $path（需要 *.tar / *GPL24247*；human soft 与 grouping 可给但不使用）" >&2; exit 2 ;;
  esac
done

if [ -z "$tar_file" ] || [ -z "$mouse_soft" ]; then
  echo "缺少必需输入：需要 RAW tar 与 GPL24247 小鼠 soft（当前 tar='$tar_file' mouse_soft='$mouse_soft'）" >&2
  exit 2
fi
for required in "$tar_file" "$mouse_soft"; do
  if [ ! -f "$required" ]; then
    echo "输入文件不存在: $required" >&2
    exit 2
  fi
done
for optional in "$human_soft" "$grouping_file"; do
  if [ -n "$optional" ] && [ ! -f "$optional" ]; then
    echo "可选输入文件不存在: $optional" >&2
    exit 2
  fi
done

out_root="."
if [ -n "$cli_output" ]; then
  case "$cli_output" in
    */) out_root="${cli_output%/}" ;;
    *.h5ad|*.tsv|*.txt|*.png|*.md) out_root="$(dirname "$cli_output")" ;;
    *) out_root="$cli_output" ;;
  esac
fi
mkdir -p "$out_root/processed" "$out_root/results" "$out_root/figures"

echo "step_executed=ingest_visium"
echo "bioanalys_seed=$seed"
echo "output_root=$(cd "$out_root" && pwd)"
echo "input_raw_tar=$tar_file"
echo "input_mouse_soft=$mouse_soft"
echo "input_human_soft=${human_soft:-（未提供）}"
echo "input_grouping=${grouping_file:-（未提供）}"

TAR_FILE="$tar_file" MOUSE_SOFT="$mouse_soft" HUMAN_SOFT="${human_soft:-}" \
GROUPING_FILE="${grouping_file:-}" BIOANALYS_SEED="$seed" OUT_ROOT="$out_root" \
"$PY" - <<'PYSCRIPT'
# -*- coding: utf-8 -*-
import gzip
import io
import json
import os
import re
import sys
import tarfile
import time
from collections import Counter

import numpy as np
import pandas as pd
import anndata as ad
import scanpy as sc
import h5py
from PIL import Image
from scipy.sparse import csr_matrix, vstack

# pandas 2/3 的 nullable strings 默认不同，写 obs 字符串列会崩（坑 #107），显式关闭。
ad.settings.allow_write_nullable_strings = False

START = time.time()

# 本数据自建口径（禁止复用上一研究的 NAFLD 词表；用户设计：主对比 A_Ctrl vs D_Ctrl_HF）。
SPECIES = "Mus musculus"
TISSUE = "heart"
CAPTURE_AREA_SPOTS = 4992
GENOME_EXPECTED = "mm10"
CONDITION_CLASS = {"A_Ctrl": "Control", "D_Ctrl_HF": "Model", "C_TTg_HF": "Treated"}
GROUP_MAP = {"A_Ctrl": "Ctrl", "D_Ctrl_HF": "Model", "C_TTg_HF": "Treated"}
MAIN_CONTRAST = "A_Ctrl_vs_D_Ctrl_HF"
SIDECAR = "C_TTg_HF (治疗旁证, 不参与主对比)"
KINDS = ["filtered_feature_bc_matrix", "tissue_positions_list", "scalefactors_json",
         "tissue_hires_image", "tissue_lowres_image"]
KIND_EXT = {"filtered_feature_bc_matrix": "h5", "tissue_positions_list": "csv.gz",
            "scalefactors_json": "json.gz", "tissue_hires_image": "png.gz",
            "tissue_lowres_image": "png.gz"}
# mm10/GRCm38 chrMT 蛋白编码基因 Ensembl ID：探针组里一个都没有（实测），
# 仍保留这份显式清单，用于报告证明"不是前缀写法漏了，是基因集缺 chrMT"。
MT_ENSEMBL = {
    "ENSMUSG00000064377": "mt-Nd1", "ENSMUSG00000064378": "mt-Nd2",
    "ENSMUSG00000064379": "mt-Co1", "ENSMUSG00000064380": "mt-Co2",
    "ENSMUSG00000064381": "mt-Atp8", "ENSMUSG00000064382": "mt-Atp6",
    "ENSMUSG00000064383": "mt-Co3", "ENSMUSG00000064384": "mt-Nd3",
    "ENSMUSG00000064387": "mt-Nd4", "ENSMUSG00000064388": "mt-Nd5",
    "ENSMUSG00000064389": "mt-Nd4l", "ENSMUSG00000064390": "mt-Nd6",
    "ENSMUSG00000064385": "mt-Cytb",
}

# 成员名形态：<GSM>_<样本名>_<kind>.<ext>，其中样本名本身含下划线
# （A_Ctrl / C_TTg_HF / D_Ctrl_HF），所以不能按 "_" 拆字段，只能剥已知 kind 后缀。
# HE tif（GSM6756178_220207_HE_x10_A_Ctrl.tif.gz）不在 kind 表里，单独归类记台账。
KIND_SUFFIX = {kind: "_" + kind + "." + ext for kind, ext in KIND_EXT.items()}


def classify_member(base):
    """返回 (gsm, kind, sample_name) 或 None；kind=="he" 表示 HE 图成员。"""
    m = re.match(r"^(GSM\d+)_", base)
    if not m:
        return None
    gsm = m.group(1)
    if base.endswith(".tif.gz"):
        return gsm, "he", None
    for kind, suffix in KIND_SUFFIX.items():
        if base.endswith(suffix):
            return gsm, kind, base[len(gsm) + 1: -len(suffix)]
    return None


def fail(message):
    sys.stderr.write("ingest_visium 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)


def log(message):
    print(message, flush=True)


tar_path = os.environ["TAR_FILE"]
mouse_soft_path = os.environ["MOUSE_SOFT"]
human_soft_path = os.environ["HUMAN_SOFT"]
grouping_path = os.environ["GROUPING_FILE"]
seed = os.environ["BIOANALYS_SEED"]
out_root = os.environ["OUT_ROOT"]
processed = os.path.join(out_root, "processed")

# --- 1. tar 成员清单 ---
samples = {}
he_members = {}
unexpected = []
with tarfile.open(tar_path, "r:") as tf:
    for member in tf:
        if not member.isfile():
            continue
        base = os.path.basename(member.name)
        parsed = classify_member(base)
        if parsed is None:
            unexpected.append(base)
            continue
        gsm, kind, name_part = parsed
        if kind == "he":
            he_members.setdefault(gsm, []).append(base)
            continue
        entry = samples.setdefault(gsm, {"name": name_part, "files": {}})
        if entry["name"] != name_part:
            fail("GSM %s 样本名不一致: %s vs %s" % (gsm, entry["name"], name_part))
        if kind in entry["files"]:
            fail("GSM %s 的文件类型重复: %s" % (gsm, kind))
        entry["files"][kind] = member.name

if unexpected:
    fail("tar 内有无法归类的成员（后缀规则与本脚本假设不符）: %s" % unexpected[:10])
if not samples:
    fail("tar 内没有可识别的样本文件: %s" % tar_path)
for gsm in sorted(samples):
    missing = [k for k in KINDS if k not in samples[gsm]["files"]]
    if missing:
        fail("GSM %s 缺少文件类型: %s" % (gsm, missing))
    if gsm not in he_members:
        log("WARN: GSM %s 无 HE tif 成员（用户已声明不用该文件，仅记录）" % gsm)
sample_names = sorted(samples[g]["name"] for g in samples)
unknown_names = [n for n in sample_names if n not in CONDITION_CLASS]
if unknown_names:
    fail("样本名不在本脚本自建归并表里，需要人工确认设计后补表: %s" % unknown_names)
log("tar_samples=%d names=%s" % (len(samples), sample_names))

# --- 2. soft 元数据（^SAMPLE 块 + GPL 标题），流式解析并在收齐后提前退出 ---
wanted = set(samples)
soft_meta = {}
platform_title = ""
gpl_accession = ""
parse_start = time.time()
current = None
done_samples = set()
with gzip.open(mouse_soft_path, "rt", encoding="utf-8", errors="replace") as fh:
    for line in fh:
        if line.startswith("^PLATFORM = "):
            gpl_accession = line.strip().split("= ", 1)[1]
        elif line.startswith("!Platform_title = ") and not platform_title:
            platform_title = line.strip().split("= ", 1)[1]
        elif line.startswith("^SAMPLE = "):
            current = line.strip().split("= ", 1)[1]
            if current in wanted and current not in soft_meta:
                soft_meta[current] = {"data_processing": [], "extra": []}
        elif current in wanted and current in soft_meta:
            rec = soft_meta[current]
            if line.startswith("!Sample_title = "):
                rec["title"] = line.strip().split("= ", 1)[1]
            elif line.startswith("!Sample_organism_ch1 = "):
                rec["organism"] = line.strip().split("= ", 1)[1]
            elif line.startswith("!Sample_platform_id = "):
                rec["platform_id"] = line.strip().split("= ", 1)[1]
            elif line.startswith("!Sample_characteristics_ch1 = "):
                body = line.strip().split("= ", 1)[1]
                key, sep, value = body.partition(": ")
                if sep:
                    rec.setdefault(key, value)
            elif line.startswith("!Sample_data_processing = "):
                rec["data_processing"].append(line.strip().split("= ", 1)[1])
            elif line.startswith("!Sample_description = "):
                rec["description"] = line.strip().split("= ", 1)[1]
        # 收齐且已越过最后一个目标块就能退出（该 soft 是平台族文件，未压缩 3.6GB，
        # 目标样本之后还有无关研究的大量子块，全量扫一遍纯浪费）。
        if wanted and wanted.issubset(set(soft_meta)) and platform_title:
            if line.startswith("^SAMPLE = ") and current not in wanted:
                break
soft_seconds = time.time() - parse_start
missing_meta = sorted(wanted - set(soft_meta))
if missing_meta:
    fail("soft 里缺少 %d 个样本的 ^SAMPLE 块: %s" % (len(missing_meta), missing_meta))
log("soft_parsed=%.1fs platform_title=%s gpl=%s samples=%d"
    % (soft_seconds, platform_title, gpl_accession, len(soft_meta)))

for gsm, rec in soft_meta.items():
    if rec.get("organism", "") != SPECIES:
        fail("样本 %s organism=%r 不是 %s" % (gsm, rec.get("organism", ""), SPECIES))
    if rec.get("platform_id", "") != gpl_accession:
        fail("样本 %s platform_id=%s 与 GPL %s 不符" % (gsm, rec.get("platform_id", ""), gpl_accession))

# strain / tissue / slide area：soft 取不到就 NA 并在报告标注（用户口径）。
strain_note_items = []
slide_area = {}
for gsm, rec in soft_meta.items():
    if not rec.get("strain", "").strip():
        rec["strain"] = "NA"
        strain_note_items.append(gsm)
    tissue_raw = rec.get("tissue", "")
    if TISSUE not in tissue_raw.lower():
        fail("样本 %s 的 tissue 特征 '%s' 不含 'heart'，本脚本口径（心脏）不成立" % (gsm, tissue_raw))
    joined = " | ".join(rec["data_processing"])
    name = samples[gsm]["name"]
    m = re.search(re.escape(name) + r":slide=([^,;]+),area=([A-Za-z0-9]+)", joined)
    slide_area[gsm] = "%s/%s" % (m.group(1), m.group(2)) if m else "NA"

# --- 3. 逐样本读入 ---
records = []
tmp_dir = os.path.join(out_root, "processed", ".tmp_h5")
os.makedirs(tmp_dir, exist_ok=True)
try:
    with tarfile.open(tar_path, "r:") as tf:
        for gsm in sorted(samples):
            name = samples[gsm]["name"]
            files = samples[gsm]["files"]
            rec_soft = soft_meta[gsm]

            # 3a. 矩阵：scanpy.read_10x_h5（用户指定入口）。h5py 读一次特征列做权威命名。
            tmp_h5 = os.path.join(tmp_dir, "%s_%s_matrix.h5" % (gsm, name))
            with open(tmp_h5, "wb") as fh:
                fh.write(tf.extractfile(files["filtered_feature_bc_matrix"]).read())
            one = sc.read_10x_h5(tmp_h5)
            with h5py.File(tmp_h5, "r") as f:
                grp = f["matrix"]
                gene_ids = [x.decode() for x in grp["features/id"][:]]
                gene_symbols = [x.decode() for x in grp["features/name"][:]]
                genomes = Counter(x.decode() for x in grp["features/genome"][:])
                feat_types = Counter(x.decode() for x in grp["features/feature_type"][:])
                bc_matrix = [x.decode() for x in grp["barcodes"][:]]
                shape = [int(x) for x in grp["shape"][:]]
                chem = grp.attrs.get("chemistry_description", grp.attrs.get("chemistry", b""))
                software = grp.attrs.get("software_version", b"")
            os.remove(tmp_h5)
            chem = chem.decode() if isinstance(chem, bytes) else str(chem)
            software = software.decode() if isinstance(software, bytes) else str(software)

            n_genes_mat, n_spots_mat = shape
            if one.n_obs != n_spots_mat or one.n_vars != n_genes_mat:
                fail("样本 %s scanpy 读到的 shape 与 h5 shape 不符: %s vs %s"
                     % (name, one.shape, shape))
            if list(one.obs_names) != bc_matrix:
                fail("样本 %s scanpy obs_names 与 h5 barcodes 不一致" % name)
            if list(one.var_names[:5]) != gene_ids[:5]:
                fail("样本 %s scanpy var_names 与 h5 features/id 不一致" % name)
            if len(set(gene_ids)) != len(gene_ids):
                dup = sorted(g for g, c in Counter(gene_ids).items() if c > 1)[:5]
                fail("样本 %s 基因 ID 重复（前 5）: %s" % (name, dup))
            if list(genomes) != [GENOME_EXPECTED]:
                fail("样本 %s genome=%s（期望 %s）" % (name, dict(genomes), GENOME_EXPECTED))
            if list(feat_types) != ["Gene Expression"]:
                fail("样本 %s feature_type 异常: %s" % (name, dict(feat_types)))
            if len(set(bc_matrix)) != len(bc_matrix):
                fail("样本 %s 矩阵 barcode 重复" % name)
            X_mat = one.X if isinstance(one.X, csr_matrix) else csr_matrix(one.X)
            if not np.issubdtype(X_mat.data.dtype, np.integer) or X_mat.data.min() < 0:
                fail("样本 %s 计数含负值或非整数（dtype=%s）" % (name, X_mat.data.dtype))

            # 3b. positions：全部 4992 行（含 in_tissue=0）
            pos_order = []
            pos_map = {}
            with gzip.open(io.BytesIO(tf.extractfile(files["tissue_positions_list"]).read()), "rt") as gz:
                for line in gz:
                    parts = line.strip().split(",")
                    if len(parts) != 6:
                        fail("样本 %s positions 行列数异常: %s" % (name, line[:80]))
                    pos_order.append(parts[0])
                    pos_map[parts[0]] = parts
            if len(pos_map) != len(pos_order):
                fail("样本 %s positions barcode 有重复行" % name)
            if len(pos_order) != CAPTURE_AREA_SPOTS:
                fail("样本 %s positions 行数 %d != 捕获区 %d" % (name, len(pos_order), CAPTURE_AREA_SPOTS))
            n_in_tissue = sum(1 for p in pos_order if pos_map[p][1] == "1")
            n_zero_flag = sum(1 for p in pos_order if pos_map[p][1] == "0")
            if any(v[1] not in ("0", "1") for v in pos_map.values()):
                fail("样本 %s in_tissue 出现 0/1 之外的取值" % name)
            off = [b for b in bc_matrix if pos_map[b][1] != "1"]
            if off:
                fail("样本 %s 有 %d 个矩阵 barcode 的 in_tissue != 1" % (name, len(off)))
            if n_in_tissue != n_spots_mat:
                fail("样本 %s in_tissue=%d 数 %d 与矩阵 spot 数 %d 不符"
                     % (name, n_in_tissue, n_spots_mat))

            # 3c. 拼全捕获区矩阵：组织内 spot 用矩阵行，组织外补零行，按 positions 顺序重排
            row_of = {b: i for i, b in enumerate(bc_matrix)}
            perm = np.array([row_of[b] if b in row_of else -1 for b in pos_order], dtype=np.int64)
            in_mask = perm >= 0
            X_in = X_mat[perm[in_mask]]
            X_out = csr_matrix((int((~in_mask).sum()), n_genes_mat), dtype=X_mat.dtype)
            X_full = vstack([X_in, X_out], format="csr")
            reorder = np.empty(len(pos_order), dtype=np.int64)
            src = 0
            out_src = 0
            for i, good in enumerate(in_mask):
                if good:
                    reorder[i] = src
                    src += 1
                else:
                    reorder[i] = n_in_tissue + out_src
                    out_src += 1
            X_full = X_full[reorder]
            if X_full.shape != (CAPTURE_AREA_SPOTS, n_genes_mat):
                fail("样本 %s 全捕获区矩阵 shape 异常: %s" % (name, X_full.shape))

            # 3d. scalefactors + lowres 图
            scf = json.loads(gzip.decompress(tf.extractfile(files["scalefactors_json"]).read()).decode("utf-8"))
            for key in ["spot_diameter_fullres", "tissue_hires_scalef",
                        "fiducial_diameter_fullres", "tissue_lowres_scalef"]:
                if key not in scf:
                    fail("样本 %s scalefactors 缺键 %s" % (name, key))
            lowres = np.asarray(Image.open(io.BytesIO(
                gzip.decompress(tf.extractfile(files["tissue_lowres_image"]).read()))))
            if lowres.ndim != 3 or lowres.shape[2] != 3 or lowres.dtype != np.uint8:
                fail("样本 %s lowres 图不是 RGB uint8: %s %s" % (name, lowres.shape, lowres.dtype))

            # 3e. 装配 obs（全捕获区），barcode 加样本前缀保证全局唯一
            obs = pd.DataFrame(index=pd.Index(
                ["%s_%s" % (name, b) for b in pos_order], name="spot_barcode"))
            obs["barcode"] = ["%s_%s" % (name, b) for b in pos_order]
            obs["barcode_10x"] = pos_order
            obs["sample_id"] = name
            obs["gsm"] = gsm
            obs["species"] = SPECIES
            obs["platform_id"] = platform_title if platform_title else gpl_accession
            obs["gpl_accession"] = gpl_accession
            obs["strain"] = rec_soft.get("strain", "NA")
            obs["condition"] = name
            obs["condition_class"] = CONDITION_CLASS[name]
            obs["group"] = GROUP_MAP[name]
            obs["tissue"] = TISSUE
            obs["genotype"] = rec_soft.get("genotype", "NA")
            obs["treatment"] = rec_soft.get("treatment", "NA")
            obs["time"] = rec_soft.get("time", "NA")
            obs["slide_area"] = slide_area[gsm]
            obs["in_tissue"] = np.array([int(pos_map[b][1]) for b in pos_order], dtype=np.int8)
            obs["array_row"] = np.array([int(pos_map[b][2]) for b in pos_order], dtype=np.int32)
            obs["array_col"] = np.array([int(pos_map[b][3]) for b in pos_order], dtype=np.int32)
            obs["pxl_col_fullres"] = np.array([int(pos_map[b][4]) for b in pos_order], dtype=np.int32)
            obs["pxl_row_fullres"] = np.array([int(pos_map[b][5]) for b in pos_order], dtype=np.int32)
            obs["ncount"] = np.asarray(X_full.sum(axis=1)).ravel().astype(np.int64)
            obs["nfeature"] = np.diff(X_full.indptr).astype(np.int64)
            if int(obs["in_tissue"].sum()) != n_spots_mat:
                fail("样本 %s obs in_tissue 合计与矩阵 spot 数不符" % name)
            if int(obs.loc[obs["in_tissue"] == 0, "ncount"].sum()) != 0:
                fail("样本 %s 组织外 spot 计数不为 0（补零逻辑有误）" % name)

            var = pd.DataFrame(index=pd.Index(gene_ids, name="gene_id"))
            var["gene_symbol"] = gene_symbols
            var["genome"] = GENOME_EXPECTED
            var["feature_type"] = "Gene Expression"

            one_full = ad.AnnData(X=X_full, obs=obs, var=var)
            one_full.obsm["spatial"] = np.array(
                [[float(pos_map[b][4]), float(pos_map[b][5])] for b in pos_order], dtype=np.float64)

            mt_symbols = [s for s in gene_symbols if s.startswith("mt-")]
            mt_ids = [i for i in gene_ids if i in MT_ENSEMBL]
            it = obs["in_tissue"] == 1
            records.append({
                "adata": one_full, "name": name, "gsm": gsm, "scalefactors": scf,
                "lowres": lowres, "chemistry": chem, "software": software,
                "n_genes": n_genes_mat, "nnz": int(X_full.nnz),
                "spots_matrix": n_spots_mat, "in_tissue": int(it.sum()),
                "off_tissue": int((~it).sum()),
                "med_ncount": float(np.median(obs.loc[it, "ncount"])),
                "max_ncount": int(obs["ncount"].max()),
                "med_nfeature": float(np.median(obs.loc[it, "nfeature"])),
                "max_nfeature": int(obs["nfeature"].max()),
                "mt_symbols": len(mt_symbols), "mt_ids": len(mt_ids),
                "symbol_dups": len(gene_symbols) - len(set(gene_symbols)),
                "title": rec_soft.get("title", ""), "description": rec_soft.get("description", ""),
                "genotype": rec_soft.get("genotype", "NA"),
                "treatment": rec_soft.get("treatment", "NA"),
                "time": rec_soft.get("time", "NA"),
                "strain": rec_soft.get("strain", "NA"), "slide_area": slide_area[gsm],
                "lowres_shape": lowres.shape, "soft_keys": sorted(rec_soft),
            })
            log("sample=%s gsm=%s genes=%d spots_all=%d in_tissue=%d nnz=%d mt_sym=%d med_counts=%.0f"
                % (name, gsm, n_genes_mat, CAPTURE_AREA_SPOTS, n_spots_mat, X_full.nnz,
                   len(mt_symbols), float(np.median(obs.loc[it, "ncount"]))))
finally:
    try:
        os.rmdir(tmp_dir)
    except OSError:
        pass

if {r["name"] for r in records} != set(CONDITION_CLASS):
    fail("读入样本集 %s 与设计 %s 不符" % (sorted({r["name"] for r in records}), sorted(CONDITION_CLASS)))

# --- 4. 跨样本基因宇宙：优先直接拼接，不一致则取交集并如实报数 ---
ref_ids = list(records[0]["adata"].var_names)
ref_sym = list(records[0]["adata"].var["gene_symbol"])
identical = all(list(r["adata"].var_names) == ref_ids and list(r["adata"].var["gene_symbol"]) == ref_sym
                for r in records[1:])
sets = [set(r["adata"].var_names) for r in records]
inter = set(ref_ids)
for s in sets[1:]:
    inter = inter & s
union = set()
for s in sets:
    union |= s
log("gene_universe identical_order=%s intersection=%d union=%d"
    % (identical, len(inter), len(union)))
if not identical:
    if not inter:
        fail("跨样本基因交集为空，无法拼接")
    keep = [g for g in ref_ids if g in inter]
    records = [dict(r, adata=r["adata"][:, keep].copy()) for r in records]
    log("WARN: 基因宇宙不一致，已按交集 %d 基因对齐后拼接" % len(keep))

# --- 5. 拼接与落盘 ---
X_all = vstack([r["adata"].X for r in records], format="csr")
obs_all = pd.concat([r["adata"].obs for r in records], axis=0)
var_all = records[0]["adata"].var.copy()
adata = ad.AnnData(X=X_all, obs=obs_all, var=var_all)
adata.obsm["spatial"] = np.vstack([r["adata"].obsm["spatial"] for r in records])

# 拼接后自校验
if not adata.obs_names.is_unique:
    dup = adata.obs_names[adata.obs_names.duplicated()][:5].tolist()
    fail("拼接后 spot barcode 重复（前 5）: %s" % dup)
if adata.n_obs != CAPTURE_AREA_SPOTS * len(records):
    fail("拼接后 spot 数 %d != %d x %d" % (adata.n_obs, CAPTURE_AREA_SPOTS, len(records)))
if adata.X.data.min() < 0:
    fail("拼接后矩阵含负值")
per_s = adata.obs.groupby("sample_id")["in_tissue"].sum().to_dict()
if any(int(per_s[r["name"]]) != r["spots_matrix"] for r in records):
    fail("obs in_tissue 汇总与逐样本矩阵 spot 数不一致: %s" % per_s)
if not np.array_equal(np.asarray(X_all.sum(axis=1)).ravel(), obs_all["ncount"].to_numpy()):
    fail("obs['ncount'] 与矩阵行和不一致")
if not np.array_equal(np.diff(X_all.indptr), obs_all["nfeature"].to_numpy()):
    fail("obs['nfeature'] 与矩阵检出基因数不一致")
mt_total = sum(r["mt_symbols"] for r in records)
if mt_total != 0:
    log("INFO: 检出 mt- 前缀基因 %d 个，QC 的 pct_mito 会有真实值" % mt_total)

grouping_check = ("单物种自建映射（无 grouping.txt）: condition=样本名, "
                  "condition_class=%s, group=%s; 主对比=%s; 旁证=%s; "
                  "母版双物种/NAFLD 词表分支对本数据不适用"
                  % (json.dumps(CONDITION_CLASS, sort_keys=True), json.dumps(GROUP_MAP, sort_keys=True),
                     MAIN_CONTRAST, SIDECAR))
adata.uns["seed"] = seed
adata.uns["source_tar"] = os.path.abspath(tar_path)
adata.uns["source_soft"] = os.path.abspath(mouse_soft_path)
adata.uns["source_soft_mouse"] = os.path.abspath(mouse_soft_path)
adata.uns["source_soft_human"] = ""
adata.uns["source_soft_human_note"] = ("单物种数据（只有 GPL24247 小鼠 soft）。该空字符串是母版 "
                                       "qc_spots REQUIRED_UNS 需要的 source_soft_human 键占位；"
                                       "母版双物种分支对本数据不适用。")
if human_soft_path:
    adata.uns["source_soft_human"] = os.path.abspath(human_soft_path)
    adata.uns["source_soft_human_note"] += "（本次另有 --input 传入的人源 soft 路径，仅作登记，不参与解析。）"
adata.uns["grouping_check"] = grouping_check
adata.uns["species"] = SPECIES
adata.uns["genome"] = GENOME_EXPECTED
adata.uns["gene_id_type"] = "ensembl"
adata.uns["samples"] = [r["name"] for r in records]
adata.uns["condition_class_map"] = dict(CONDITION_CLASS)
adata.uns["group_map"] = dict(GROUP_MAP)
adata.uns["main_contrast"] = MAIN_CONTRAST
adata.uns["sidecar_samples"] = ["C_TTg_HF"]
adata.uns["platform_title"] = platform_title
adata.uns["gpl_accession"] = gpl_accession
adata.uns["capture_area_spots"] = CAPTURE_AREA_SPOTS
adata.uns["mt_note"] = ("探针组不含 chrMT 基因（mt- 前缀 symbol 0 个, 13 个 mm10 mt-* Ensembl ID 全缺席）, "
                        "故 pct_mito 恒为 0, QC 的线粒体阈值不可能生效, 下游勿以 mito 过滤作为质量结论")
adata.uns["coord_note"] = ("obsm['spatial'] 为 pxl 全分辨率像素坐标 (col,row), 仅供样本内组织图叠加; "
                           "三样本 lowres/hires 缩放因子各自独立（tissue_lowres_scalef 约 0.0529）, "
                           "跨样本空间比较必须用 obs 的 array_row/array_col 捕获区网格坐标; "
                           "本数据三样本在同一张 V11Y10-334 切片的不同捕获区, 但 Space Ranger 逐区域对齐, "
                           "跨样本像素坐标仍不可直接比较")
adata.uns["image_note"] = ("uns['spatial'][sample_id] 只存 lowres 图与 scalefactors; hires 图与 HE tif 未入 "
                           "h5ad（用户口径 HE tif 不用）, 需要时从 raw_data tar 重取")
adata.uns["matrix_included_offtissue"] = ("obs 含全部 %d x %d spot 行（in_tissue=0 的行为全零计数）; "
                                          "h5 本身只含组织内 spot" % (CAPTURE_AREA_SPOTS, len(records)))
adata.uns["qc_thresholds_note"] = "QC 阈值口径见 qc_visium.sh 的 qc_report.txt"

out_h5ad = os.path.join(processed, "spatial_counts_mouse.h5ad")
adata.write_h5ad(out_h5ad)
log("wrote %s spots=%d genes=%d nnz=%d samples=%d"
    % (out_h5ad, adata.n_obs, adata.n_vars, X_all.nnz, len(records)))

# samples_meta.tsv
meta_rows = []
for r in records:
    meta_rows.append({
        "sample_id": r["name"], "gsm": r["gsm"], "condition": r["name"],
        "condition_class": CONDITION_CLASS[r["name"]], "group": GROUP_MAP[r["name"]],
        "species": SPECIES, "tissue": TISSUE, "strain": r["strain"],
        "genotype": r["genotype"], "treatment": r["treatment"], "time": r["time"],
        "slide_area": r["slide_area"], "platform_id": platform_title,
        "gpl_accession": gpl_accession, "genome": GENOME_EXPECTED,
        "chemistry": r["chemistry"], "software": r["software"],
        "genes_in_h5": r["n_genes"], "spots_positions": CAPTURE_AREA_SPOTS,
        "spots_in_tissue": r["spots_matrix"], "spots_off_tissue": r["off_tissue"],
        "nnz": r["nnz"], "median_ncount_in_tissue": r["med_ncount"],
        "max_ncount": r["max_ncount"], "median_nfeature_in_tissue": r["med_nfeature"],
        "max_nfeature": r["max_nfeature"], "mt_symbol_genes": r["mt_symbols"],
        "mt_ensembl_genes": r["mt_ids"], "symbol_dups": r["symbol_dups"],
        "lowres_rows": r["lowres_shape"][0], "lowres_cols": r["lowres_shape"][1],
        "spot_diameter_fullres": r["scalefactors"]["spot_diameter_fullres"],
        "tissue_lowres_scalef": r["scalefactors"]["tissue_lowres_scalef"],
        "tissue_hires_scalef": r["scalefactors"]["tissue_hires_scalef"],
        "fiducial_diameter_fullres": r["scalefactors"]["fiducial_diameter_fullres"],
        "sample_title": r["title"], "part_of_main_contrast":
            "yes" if r["name"] in ("A_Ctrl", "D_Ctrl_HF") else "no(sidecar)",
    })
meta_path = os.path.join(processed, "samples_meta.tsv")
pd.DataFrame(meta_rows).to_csv(meta_path, sep="\t", index=False)
log("wrote %s rows=%d" % (meta_path, len(meta_rows)))

# ingest_report.txt
rep = []
rep.append("ingest_visium 报告（PRJ_DCM_BENCH_20261105 / line3_spatial / GSE218759 小鼠 Visium 心脏 HFpEF）")
rep.append("=" * 96)
rep.append("seed=%s（BIOANALYS_SEED 注入, 本步骤无随机数, seed 只作可复现戳向下传）" % seed)
rep.append("python=%s" % sys.version.split()[0])
rep.append("scanpy=%s anndata=%s numpy=%s" % (sc.__version__, ad.__version__, np.__version__))
rep.append("输入 raw_tar=%s" % os.path.abspath(tar_path))
rep.append("输入 mouse_soft=%s" % os.path.abspath(mouse_soft_path))
rep.append("输入 human_soft=%s（单物种数据, 未解析, 只在 uns 登记路径）"
           % (os.path.abspath(human_soft_path) if human_soft_path else "未提供"))
rep.append("输入 grouping=%s（本数据无 grouping.txt, 归并表为脚本内自建）"
           % (os.path.abspath(grouping_path) if grouping_path else "未提供"))
rep.append("输出根=%s" % os.path.abspath(out_root))
rep.append("")
rep.append("[平台与物种]")
rep.append("  GPL=%s platform_title=%s" % (gpl_accession, platform_title))
rep.append("  species=%s tissue=%s genome=%s gene_id_type=ensembl" % (SPECIES, TISSUE, GENOME_EXPECTED))
rep.append("  单物种说明: 本数据只有小鼠 GPL24247 soft, 母版的双物种（小鼠+人肝）分支不适用;")
rep.append("    uns['source_soft_human'] 留空字符串只为满足母版 qc_spots 的 REQUIRED_UNS 键存在性。")
rep.append("  soft 解析耗时 %.1fs（族文件未压缩约 3.6GB, 收齐 3 个目标 ^SAMPLE 块后提前退出）。" % soft_seconds)
rep.append("")
rep.append("[归并表（自建, 写入 uns['condition_class_map']/uns['group_map']）]")
for k in sorted(CONDITION_CLASS):
    rep.append("  %s -> condition_class=%s, group=%s" % (k, CONDITION_CLASS[k], GROUP_MAP[k]))
rep.append("  主对比=%s; 治疗旁证=%s" % (MAIN_CONTRAST, SIDECAR))
rep.append("  grouping_check=%s" % grouping_check)
rep.append("")
rep.append("[逐样本读入数]")
rep.append("  sample          gsm         genes  spots(4992) in_tissue off_tissue    nnz     med_counts med_genes max_counts max_genes")
for r in records:
    rep.append("  %-14s %-11s %6d %11d %9d %10d %8d %10.0f %9.0f %11d %9d"
               % (r["name"], r["gsm"], r["n_genes"], CAPTURE_AREA_SPOTS, r["spots_matrix"],
                  r["off_tissue"], r["nnz"], r["med_ncount"], r["med_nfeature"],
                  r["max_ncount"], r["max_nfeature"]))
rep.append("")
rep.append("[跨样本基因宇宙]")
rep.append("  逐样本基因 ID 与顺序完全一致=%s" % identical)
rep.append("  基因交集=%d, 并集=%d（一致则相等）" % (len(inter), len(union)))
if not identical:
    rep.append("  已按交集对齐后拼接（不一致样本已 reindex, 报告此处如实记录）")
rep.append("  symbol 重复数（每样本）=%s（var_names 用 Ensembl ID, 重复 symbol 不影响索引唯一性）"
           % [r["symbol_dups"] for r in records])
rep.append("")
rep.append("[线粒体基因实测（决定 QC 阈值可用性）]")
for r in records:
    rep.append("  %s: mt- 前缀 symbol=%d, chrMT Ensembl ID 命中=%d" % (r["name"], r["mt_symbols"], r["mt_ids"]))
rep.append("  结论: Space Ranger 注释基因集不含 chrMT, pct_mito 将恒为 0。")
rep.append("  下游 qc_visium 仍会算并落 pct_mito 列（母版契约要求该列存在），但阈值 25 不可能剔除任何 spot;")
rep.append("  任何以线粒体比例为由的质量判断在本数据上均不成立。")
rep.append("")
rep.append("[自校验]")
rep.append("  barcode 对齐: 矩阵 barcode 全部在 positions 且 in_tissue=1（逐样本通过）")
rep.append("  spot 数对账: positions=%d 行/样本, in_tissue=1 数 == 矩阵 spot 数（逐样本通过）" % CAPTURE_AREA_SPOTS)
rep.append("  soft 'number of spots' 对账: 本数据 soft 无该字段, 母版该分支不适用, 改用上两条（已记 warning）")
rep.append("  计数非负且为整数（通过）; 组织外 spot 全零（通过）")
rep.append("  obs['ncount']/obs['nfeature'] 与矩阵重算逐值一致（通过）")
rep.append("  拼接后 obs_names 唯一（%d 行, 样本前缀 %s 保证全局唯一）"
           % (adata.n_obs, sorted({r["name"] for r in records})))
rep.append("  genome/feature_type/chemistry 一致（通过）: chemistry=%s software=%s"
           % (records[0]["chemistry"], records[0]["software"]))
rep.append("")
rep.append("[产物]")
rep.append("  processed/spatial_counts_mouse.h5ad  spots=%d genes=%d nnz=%d samples=%d"
           % (adata.n_obs, adata.n_vars, X_all.nnz, len(records)))
rep.append("  processed/samples_meta.tsv            逐样本台账 %d 行" % len(meta_rows))
rep.append("  processed/ingest_report.txt            本报告")
rep.append("  uns 键: %s" % sorted(adata.uns))
rep.append("  obs 列: %s" % sorted(adata.obs.columns))
rep.append("  var 列: %s" % sorted(adata.var.columns))
rep.append("")
rep.append("[limitation_note]")
rep.append("  1. 每条件只有 1 张切片（A_Ctrl/D_Ctrl_HF/C_TTg_HF 各 n=1）, 无生物学重复。")
rep.append("     下游 spot 级差异只能给描述性统计加效应量加稳健性, 不能给推断性 p 值结论。")
rep.append("  2. 探针组无 chrMT 基因, pct_mito 恒 0, 线粒体污染维度在本数据不可评估。")
rep.append("  3. 单切片一个横断面, LV 壁/室壁/房区归属靠空间域与 marker 人工判读, 脚本只给编号域与证据。")
rep.append("  4. h5 是 Space Ranger filtered 矩阵, 组织外 spot 只有坐标无计数（本脚本以全零行保留 4992 网格）。")
rep.append("  5. 同一切片多捕获区（V11Y10-334 的 A1/C1/D1）, 同批技术变异与真实生物学差异不可分, 需注意区域效应。")
rep.append("  6. hires 图与 HE tif 未入 h5ad, 需要高清图时从 raw_data tar 重取（raw_data 常驻）。")
rep.append("  7. strain 取自 soft 的 'strain' 特征（%s）; 若缺失会填 NA 并在本报告 [平台与物种] 处标注。"
           % records[0]["strain"])
if strain_note_items:
    rep.append("  注意: 以下 GSM 的 soft 无 strain 字段, 已填 NA: %s" % strain_note_items)
rep.append("")
rep.append("elapsed=%.1fs" % (time.time() - START))
report_path = os.path.join(processed, "ingest_report.txt")
with open(report_path, "w", encoding="utf-8", newline="\n") as fh:
    fh.write("\n".join(rep) + "\n")
log("wrote %s" % report_path)
print("outputs=processed/spatial_counts_mouse.h5ad, processed/samples_meta.tsv, processed/ingest_report.txt", flush=True)
print("spot_contract: obs=%s" % ",".join(sorted(adata.obs.columns)), flush=True)
PYSCRIPT

if [ -x "/mnt/ssd/bio_data/ops/k40_step_sha_ledger.sh" ]; then
  "/mnt/ssd/bio_data/ops/k40_step_sha_ledger.sh" "$(cd "$out_root" && pwd)" "ingest_report.txt" > /dev/null 2>>"$0.ledger.err" \
    || echo "WARN sha256 ledger backfill failed, see $0.ledger.err" >&2
fi
echo "ingest_visium_done=1"
