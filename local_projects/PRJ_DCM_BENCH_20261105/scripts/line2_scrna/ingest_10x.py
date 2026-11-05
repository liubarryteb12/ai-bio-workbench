#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ingest_10x：GSE185100 心脏 snRNA-seq（10x v3 三件套）读入与旧链契约适配。

输入：GSE185100_RAW.tar（外层纯 tar，10 个内层 GSM*_样本_processed.tar.gz，
每个内层包是 10x v3 三件套 barcodes/features/matrix .tsv.gz）。

输出（写到当前工作目录）：
- processed/scrna_counts.h5ad：cell x gene 稀疏整数计数矩阵；
- ingest_report.txt：口径、逐样本计数、自校验结果、limitation_note。

obs 契约刻意与旧研究母版（GSE254707 Smart-seq2 链）对齐，使本产物经 qc_nuclei
之后 normalize_hvg / integrate_harmony / cluster_umap 三个母版可原样复用：
- donor=sample_title=plate=样本名（DCM1..Young3）；diagnosis=DCM/NonDiseased/Fetal；
- group=DCM/Ctrl/Fetal（实验设计：DCM1-4 病例、Young1-3 合并对照、Fetal 单列）；
- class 一律 singlet（本数据无 doublet 标注，诚实记录：qc 的 doublet 排除为空操作）；
- region=heart、well=NA（占位非测量）；
- ncount/nfeature_computed 从矩阵重算；ercc_fraction_computed 恒 0（10x 无 spike-in）；
- celltype_paper/seurat_cluster_paper=NA（无作者细胞级注释，paper 对照审计不适用）。
var：index=Ensembl ID，gene_symbol=symbol，ercc 全 False。

自校验内建（任一不过 exit 1，不产出半成品）：每样本 barcode 唯一、矩阵维度与
barcodes/features 一致、triplet 数与 mtx 头一致、无 0/负计数（稀疏存储语义）、
整数 dtype、全局细胞 ID 唯一、总细胞数=10 样本之和、按 seed 抽查 ncount 重算一致。
"""
import array
import gzip
import io
import json
import os
import re
import sys
import tarfile
import time

import numpy as np
import pandas as pd
import anndata as ad
from scipy.sparse import csr_matrix, vstack

ad.settings.allow_write_nullable_strings = False

START = time.time()


def fail(message):
    sys.stderr.write("ingest_10x 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)


def log(message):
    print(message, flush=True)


tar_file = os.environ["TAR_FILE"]
soft_file = os.environ.get("SOFT_FILE", "").strip()
seed = os.environ["BIOANALYS_SEED"]


def read_soft_meta(path, want_accs):
    """从 GPL family soft 的 ^SAMPLE 块取指定 GSM 的 title/sex/age/disease state。

    该平台上还有别的研究的样本（ccRCC 系列等），只取 want_accs 里的 accession。
    元数据是权威来源：tar 成员名（Young1-3）与 GEO 正式标题（Non-diseased1-3）不一致，
    分组核对与报告都要以 soft 为准，命名差异如实留痕不静默统一。
    """
    want = set(want_accs)
    found = {}
    cur = None
    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.rstrip()
            if line.startswith("^SAMPLE ="):
                acc = line.split("=", 1)[1].strip()
                cur = [] if acc in want else None
                if cur is not None:
                    found[acc] = cur
            elif cur is not None and line.startswith("!Sample_"):
                cur.append(line)

    def pick(block, key):
        """取 characteristics 的冒号后值：'Sex: M' -> 'M'，'disease state: X' -> 'X'。

        按已知 key 前缀精确剥离（不用"键里有没有空格"这类启发式），
        值本身含冒号时也不会被切错。
        """
        for entry in block:
            if key in entry:
                value = entry.split("=", 1)[1].strip()
                prefix = key.rstrip(":")
                if value.lower().startswith(prefix.lower()):
                    value = value[len(prefix):].lstrip(":").strip()
                return value
        return ""

    out = {}
    for acc, block in found.items():
        out[acc] = {
            "geo_title": pick(block, "!Sample_title"),
            "sex": pick(block, "Sex:") or pick(block, "sex:"),
            "age": pick(block, "age:"),
            "disease_state": pick(block, "disease state:"),
            "organism": pick(block, "!Sample_organism"),
        }
    missing = sorted(want - set(out))
    if missing:
        fail("GPL soft 里缺这些 GSM 的样本块: %s" % ",".join(missing))
    return out

# --- 0. 分组真源（写死，不许看结果调）---
# 样本前缀 -> (diagnosis, group)。GEO 系列标题语义：DCM=扩张型心肌病，
# Young=健康年轻对照（用户设计合并为 Ctrl），Fetal=胎儿对照（单列，不参与 DCM vs Ctrl）。
PREFIX_MAP = {"DCM": ("DCM", "DCM"), "Young": ("NonDiseased", "Ctrl"), "Fetal": ("Fetal", "Fetal")}

if not os.path.isfile(tar_file):
    fail("输入 tar 不存在: %s" % tar_file)

# --- 1. 外层 tar：拆 10 个内层包（r: 直读不压缩，逐个 extractfile 取字节）---
with tarfile.open(tar_file, "r:") as tf:
    outer_files = [m.name for m in tf.getmembers() if m.isfile()]
if len(outer_files) != 10:
    fail("外层 tar 应有 10 个内层成员，实际 %d: %s" % (len(outer_files), outer_files))

samples = []
for name in sorted(outer_files):
    base = os.path.basename(name)
    m = re.match(r"^(GSM\d+)_([A-Za-z]+\d+)_processed\.tar\.gz$", base)
    if not m:
        fail("内层成员命名不可解析: %s" % base)
    gsm, sample = m.group(1), m.group(2)
    prefix = re.match(r"^([A-Za-z]+)", sample).group(1)
    if prefix not in PREFIX_MAP:
        fail("样本 %s 前缀 %s 不在分组真源" % (sample, prefix))
    diagnosis, group = PREFIX_MAP[prefix]
    samples.append({"gsm": gsm, "sample": sample, "member": name,
                    "diagnosis": diagnosis, "group": group})
if len({s["sample"] for s in samples}) != 10 or len({s["gsm"] for s in samples}) != 10:
    fail("样本/GSM 不唯一")

# --- 1b. 权威元数据（soft 可用时）：交叉核对前缀分组，并补 sex/age ---
soft_meta = {}
if soft_file and os.path.isfile(soft_file):
    soft_meta = read_soft_meta(soft_file, [s["gsm"] for s in samples])
    for s in samples:
        m = soft_meta.get(s["gsm"], {})
        s["geo_title"] = m.get("geo_title", "")
        s["sex"] = m.get("sex", "NA")
        s["age"] = m.get("age", "NA")
        s["disease_state"] = m.get("disease_state", "")
        # 前缀映射与 GEO disease state 必须自洽：DCM 侧要写明心肌病，对照侧要写明 healthy
        want_kw = "cardiomyopathy" if s["group"] == "DCM" else "healthy"
        if s["disease_state"] and want_kw.lower() not in s["disease_state"].lower():
            fail("样本 %s 的 GEO disease state（%s）与前缀分组 %s 不自洽"
                 % (s["sample"], s["disease_state"], s["group"]))
        s["group_source"] = "gpl_soft_crosschecked"
elif soft_file:
    fail("指定的 GPL soft 不存在: %s" % soft_file)
else:
    for s in samples:
        s["geo_title"] = ""
        s["sex"] = "NA"
        s["age"] = "NA"
        s["disease_state"] = ""
        s["group_source"] = "sample_prefix_only"
naming_diffs = [
    "%s: tar=%s geo_title=%s" % (s["gsm"], s["sample"], s["geo_title"])
    for s in samples
    if s["geo_title"] and s["geo_title"].lower() != s["sample"].lower()
]

# --- 2. 逐样本读三件套 ---
# 实测形态（本数据集 10 个内层包不一致，必须双形态兼容）：
#   DCM1-4 与 Young3：barcodes/features/matrix 都是 *.gz（gzip）
#   Fetal1-3 与 Young1-2：同名成员是**未压缩明文**（matrix.mtx 明文 177-470MB）
# 判定按内容 magic 而非扩展名：扩展名与内容不符时以内容为准，并留痕进报告。
# 明文 matrix 不能整块读进内存（470MB 原文 + 30M 三元组的 Python list 会顶破
# 7.5GB RLIMIT），所以 matrix 走流式逐行 + array.array 紧凑累积（30M×3×4B≈360MB）。
GZIP_MAGIC = b"\x1f\x8b"
compression_notes = []   # 逐样本记录实际压缩形态，写进报告


class _PrefixStream(io.RawIOBase):
    """把已窥探的前 2 字节接回流首，其余继续从底层 tar 流读（不整块驻留）。"""

    def __init__(self, prefix, stream):
        self._prefix = prefix
        self._stream = stream
        self._pos = 0

    def readable(self):
        return True

    def readinto(self, buffer):
        want = len(buffer)
        if self._pos < len(self._prefix):
            chunk = self._prefix[self._pos:self._pos + want]
            self._pos += len(chunk)
            buffer[:len(chunk)] = chunk
            return len(chunk)
        data = self._stream.read(want)
        if not data:
            return 0
        buffer[:len(data)] = data
        return len(data)


def open_text(stream):
    """按内容 magic 打开文本流，返回 (文本流, 是否 gzip)。magic 判定不靠扩展名。"""
    head = stream.read(2)
    is_gzip = head == GZIP_MAGIC
    body = _PrefixStream(head, stream)
    wrapped = gzip.GzipFile(fileobj=body) if is_gzip else body
    return io.TextIOWrapper(wrapped, encoding="utf-8"), is_gzip


def read_matrix(stream, sample):
    """MatrixMarket coordinate/integer/general -> (rows, cols, vals, dims, is_gzip)，流式解析。"""
    header = None
    dims = None
    rows = array.array("i")
    cols = array.array("i")
    vals = array.array("i")
    fh, is_gzip = open_text(stream)
    with fh:
        for line in fh:
            line = line.rstrip("\n")
            if line.startswith("%%MatrixMarket"):
                header = line
                continue
            if line.startswith("%"):
                continue  # 注释行（含 metadata_json）
            parts = line.split()
            if dims is None:
                if len(parts) != 3:
                    fail("样本 %s mtx 维度行异常: %s" % (sample, line))
                dims = (int(parts[0]), int(parts[1]), int(parts[2]))
                continue
            gi, ci, vi = int(parts[0]) - 1, int(parts[1]) - 1, int(parts[2])
            if vi <= 0:
                fail("样本 %s mtx 出现非正计数 %d（稀疏存储不该有 0/负值）" % (sample, vi))
            rows.append(gi)
            cols.append(ci)
            vals.append(vi)
    if not header or not all(word in header for word in ("matrix", "coordinate", "integer", "general")):
        fail("样本 %s mtx 头不是 MatrixMarket matrix coordinate integer general: %s" % (sample, header))
    return rows, cols, vals, dims, is_gzip


per_sample = []
features_ref = None
with tarfile.open(tar_file, "r:") as tf:
    for s in samples:
        raw_outer = tf.extractfile(s["member"]).read()
        names = {}
        with tarfile.open(fileobj=io.BytesIO(raw_outer), mode="r:*") as probe:
            for member in probe.getmembers():
                if not member.isfile():
                    continue
                stem = os.path.basename(member.name)
                if "barcodes" in stem:
                    key = "barcodes"
                elif "features" in stem:
                    key = "features"
                elif "matrix" in stem:
                    key = "matrix"
                else:
                    fail("样本 %s 内层包出现意外成员: %s" % (s["sample"], stem))
                if key in names:
                    fail("样本 %s 三件套成员重复: %s" % (s["sample"], key))
                names[key] = (member, stem, member.size)
        for need in ("barcodes", "features", "matrix"):
            if need not in names:
                fail("样本 %s 缺少三件套成员 %s（实际 %s）" % (s["sample"], need, sorted(names)))

        # 小成员整读（barcodes/features 明文最大 1.4MB），matrix 走流式（明文最大 470MB）
        with tarfile.open(fileobj=io.BytesIO(raw_outer), mode="r:*") as itf:
            # barcodes/features 体积小（明文最大 1.4MB）整读；matrix 明文可达 470MB，必须流式
            bar_fh, bar_gz = open_text(io.BytesIO(itf.extractfile(names["barcodes"][0]).read()))
            with bar_fh:
                barcodes = [ln.split("\t")[0].strip() for ln in bar_fh if ln.strip()]
            feat_fh, feat_gz = open_text(io.BytesIO(itf.extractfile(names["features"][0]).read()))
            with feat_fh:
                feat_lines = [ln.rstrip("\n") for ln in feat_fh if ln.strip()]
            rows, cols, vals, dims, mat_gz = read_matrix(
                itf.extractfile(names["matrix"][0]), s["sample"])
        # 逐成员记录实际压缩形态；成员名与内容不符（*.gz 实为明文）要留痕，这是本数据集的真实形态
        for key, member_name, is_gz in (
                ("barcodes", names["barcodes"][1], bar_gz),
                ("features", names["features"][1], feat_gz),
                ("matrix", names["matrix"][1], mat_gz)):
            claims_gz = member_name.endswith(".gz")
            if claims_gz != is_gz:
                compression_notes.append("%s/%s: 成员名 %s 声称 %s，内容实际 %s（按内容读）" % (
                    s["sample"], key, member_name,
                    "gzip" if claims_gz else "明文", "gzip" if is_gz else "明文"))

        ensembl = [ln.split("\t")[0] for ln in feat_lines]
        symbols = [ln.split("\t")[1] for ln in feat_lines]
        if len(feat_lines) and len(feat_lines[0].split("\t")) < 3:
            fail("样本 %s features 不是 3 列（Ensembl|symbol|type）" % s["sample"])
        if features_ref is None:
            features_ref = (ensembl, symbols)
        elif features_ref[0] != ensembl:
            fail("样本 %s Ensembl 列表与首样本不一致（10x 三件套应共享参考）" % s["sample"])
        n_genes_m, n_bars_m, n_vals_m = dims
        if len(rows) != n_vals_m:
            fail("样本 %s triplet 数 %d != 头声明 %d" % (s["sample"], len(rows), n_vals_m))
        if len(barcodes) != n_bars_m:
            fail("样本 %s barcodes 行数 %d != mtx 列 %d" % (s["sample"], len(barcodes), n_bars_m))
        if n_genes_m != len(ensembl):
            fail("样本 %s features 行数 %d != mtx 行 %d" % (s["sample"], len(ensembl), n_genes_m))
        if len(set(barcodes)) != len(barcodes):
            fail("样本 %s barcode 不唯一" % s["sample"])

        # mtx 是 gene x cell；转置成 cell x gene
        mat = csr_matrix((vals, (rows, cols)), shape=(n_genes_m, n_bars_m), dtype=np.int32).T.tocsr()
        per_sample.append({"s": s, "mat": mat, "barcodes": barcodes})
        log("loaded sample=%s cells=%d genes=%d nnz=%d" % (s["sample"], n_bars_m, n_genes_m, mat.nnz))

# --- 3. 纵向拼接 + obs/var 装配 ---
n_genes = len(features_ref[0])
X = vstack([p["mat"] for p in per_sample]).tocsr()
# 手机 7.5GB RLIMIT：拼接完成后逐样本矩阵立即释放，不留第二份全矩阵驻留
_sample_shapes = [(p["s"]["sample"], int(p["mat"].shape[0]), int(p["mat"].nnz)) for p in per_sample]
for p in per_sample:
    p["mat"] = None
import gc as _gc
_gc.collect()

cell_ids = []
obs_rows = {"sample_title": [], "donor": [], "diagnosis": [], "region": [], "group": [],
            "class": [], "plate": [], "well": [], "gsm": [],
            "celltype_paper": [], "seurat_cluster_paper": [],
            "geo_title": [], "sex": [], "age": [], "disease_state": []}
for p in per_sample:
    s = p["s"]
    n = len(p["barcodes"])
    cell_ids.extend("%s__%s" % (s["sample"], bc) for bc in p["barcodes"])
    obs_rows["sample_title"].extend([s["sample"]] * n)
    obs_rows["donor"].extend([s["sample"]] * n)
    obs_rows["diagnosis"].extend([s["diagnosis"]] * n)
    obs_rows["region"].extend(["heart"] * n)
    obs_rows["group"].extend([s["group"]] * n)
    obs_rows["class"].extend(["singlet"] * n)
    obs_rows["plate"].extend([s["sample"]] * n)
    obs_rows["well"].extend(["NA"] * n)
    obs_rows["gsm"].extend([s["gsm"]] * n)
    obs_rows["celltype_paper"].extend(["NA"] * n)
    obs_rows["seurat_cluster_paper"].extend(["NA"] * n)
    # 权威元数据（GPL soft）：geo_title 与 tar 成员名可以不同（Young vs Non-diseased），
    # 两者都留痕；sex/age 来自 soft，缺失记 NA 不猜
    obs_rows["geo_title"].extend([s["geo_title"] or "NA"] * n)
    obs_rows["sex"].extend([s["sex"] or "NA"] * n)
    obs_rows["age"].extend([s["age"] or "NA"] * n)
    obs_rows["disease_state"].extend([s["disease_state"] or "NA"] * n)
if len(set(cell_ids)) != len(cell_ids):
    fail("全局细胞 ID 不唯一（跨样本 barcode 撞名？）")

obs = pd.DataFrame(obs_rows, index=pd.Index(cell_ids, name="cell_id"))
obs["ncount_computed"] = np.asarray(X.sum(axis=1)).ravel().astype(np.int64)
obs["nfeature_computed"] = np.asarray((X > 0).sum(axis=1)).ravel().astype(np.int64)
obs["ercc_fraction_computed"] = np.zeros(X.shape[0], dtype=float)

var = pd.DataFrame({"gene_symbol": features_ref[1],
                    "ercc": [False] * n_genes},
                   index=pd.Index(features_ref[0], name="gene"))

adata = ad.AnnData(X=X.astype(np.int32), obs=obs, var=var)

# --- 4. 落盘前自校验 ---
total_cells = sum(cells for _name, cells, _nnz in _sample_shapes)
if adata.shape != (total_cells, n_genes):
    fail("总维度 %s 与逐样本之和 (%d, %d) 不一致" % (adata.shape, total_cells, n_genes))
if X.data.size and X.data.min() < 0:
    fail("矩阵含负计数")
if not np.issubdtype(X.dtype, np.integer):
    fail("矩阵 dtype 非整数: %s" % X.dtype)
group_counts = obs["group"].value_counts().to_dict()
donor_counts = obs["donor"].value_counts().to_dict()
sample_cells = {name: cells for name, cells, _nnz in _sample_shapes}
if len(donor_counts) != 10:
    fail("donor 数 != 10")
if not group_counts.get("DCM") or not group_counts.get("Ctrl"):
    fail("DCM/Ctrl 组存在空组: %s" % group_counts)
rng = np.random.default_rng(int(seed))
for ci in rng.choice(adata.shape[0], size=3, replace=False):
    if int(X[int(ci)].sum()) != int(obs["ncount_computed"].iloc[int(ci)]):
        fail("抽查 ncount 与矩阵不一致: cell=%s" % obs.index[int(ci)])

# --- 5. 落盘 ---
os.makedirs("processed", exist_ok=True)
adata.uns["region_to_group"] = {"heart": "all"}  # region 恒为 heart，无区分度；分组键见 prefix 映射（报告）
adata.uns["seed"] = seed
adata.uns["source_counts_tar"] = tar_file
adata.uns["source_gpl_soft"] = soft_file if soft_file else "NA（未提供 GPL soft）"
adata.uns["grouping_check"] = (
    "gpl_soft_crosschecked（分组由样本名前缀映射，并与 GPL soft 的 disease state 逐样本交叉核对）"
    if soft_meta else "from_sample_prefix_no_grouping_file（分组由样本名前缀映射，无 soft 可核对）")
# 逐样本权威元数据表（GEO title/sex/age/disease state），报告与复核都用它
# anndata 的 uns 写不了 list-of-dict（vlen string 转换器会 TypeError），
# 这里落 JSON 字符串：可读、可被下游 json.loads 还原，且不引入新依赖。
adata.uns["sample_meta"] = json.dumps(
    [{"gsm": s["gsm"], "tar_sample": s["sample"], "geo_title": s["geo_title"],
      "sex": s["sex"], "age": s["age"], "disease_state": s["disease_state"],
      "diagnosis": s["diagnosis"], "group": s["group"]}
     for s in sorted(samples, key=lambda x: x["gsm"])],
    ensure_ascii=False)
adata.write_h5ad(os.path.join("processed", "scrna_counts.h5ad"))

report = [
    "step=ingest_10x",
    "seed=%s" % seed,
    "source_counts_tar=%s" % tar_file,
    "cells=%d" % adata.shape[0],
    "genes=%d (ercc=0)" % adata.shape[1],
    "matrix_nnz=%d" % X.nnz,
    "samples=10",
    "sample_cells=%s" % sample_cells,
    "group_counts=%s" % group_counts,
    "donor_counts=%s" % donor_counts,
    "prefix_map=%s" % {k: "diagnosis=%s group=%s" % v for k, v in PREFIX_MAP.items()},
    "member_form_mismatches=%d%s" % (len(compression_notes),
        (" | " + " ; ".join(compression_notes)) if compression_notes else ""),
    "median_ncount=%.0f" % float(np.median(obs["ncount_computed"])),
    "median_nfeature=%.0f" % float(np.median(obs["nfeature_computed"])),
    "soft_meta=%s" % ("GPL soft 已解析并逐样本交叉核对 disease state" if soft_meta else "未提供 GPL soft，分组仅由前缀映射"),
    "naming_diffs=%d %s" % (len(naming_diffs), naming_diffs if naming_diffs else "无"),
    "sex_by_group=%s" % ({g: sorted({s["sex"] for s in samples if s["group"] == g}) for g in sorted({s["group"] for s in samples})}),
    "self_check=barcode唯一/维度一致/triplet数一致/无0负计数/整数dtype/全局ID唯一/总数=样本和/抽查ncount OK",
    "limitation_note=class 全部记 singlet：本数据无 doublet 标注，qc 的 doublet 排除为空操作；"
    "ercc 全 False：10x 无 spike-in，ercc_fraction_computed 恒 0 是契约占位不是测量；"
    "well=NA 占位；celltype_paper/seurat_cluster_paper=NA：无作者细胞级注释，paper 对照审计不适用；"
    "分组由样本名前缀映射（DCM1-4 病例 / Young1-3→Ctrl / Fetal1-3 单列），"
    "soft 可用时与 GEO disease state 逐样本交叉核对；tar 成员名 Young1-3 与 GEO 正式标题 "
    "Non-diseased1-3 不一致，两者都保留在 obs（donor=tar 名，geo_title=GEO 标题），不静默统一；"
    "主对比 DCM 为 1M/3F、Ctrl 为 2M/1F，样本级性别构成有差但 n 极小，仅作 limitation 陈述；"
    "region 恒 heart 使旧链的 region 维度在本数据无信息量，仅为契约兼容保留。",
    "elapsed_seconds=%.0f" % (time.time() - START),
    "outputs=processed/scrna_counts.h5ad, ingest_report.txt",
]
with open("ingest_report.txt", "w", encoding="utf-8") as fh:
    fh.write("\n".join(report) + "\n")
for line in report:
    log(line)
log("ingest_10x OK")
