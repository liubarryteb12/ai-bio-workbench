# S3 摄入原型：验证 4988 个按细胞 count 文件 -> cell x gene 矩阵的可行性与完整性
# 一次性原型，scp 到服务器 /tmp 运行，不进生产。
import gzip
import io
import tarfile
import time

RAW = "/mnt/ssd/bio_data/line2_scrna/raw_data"
TAR = RAW + "/GSE254707_RAW.tar"
SOFT = RAW + "/GPL21697_family.soft.gz"

# --- 1. 解析 soft 元数据（本系列 GSM 范围 GSM8049207-GSM8054201）---
t0 = time.time()
meta = {}
cur = None
with gzip.open(SOFT, "rt", encoding="utf-8", errors="replace") as fh:
    for line in fh:
        if line.startswith("^SAMPLE = "):
            cur = line.strip().split("= ")[1]
            if cur not in meta:
                meta[cur] = {}
        elif line.startswith("!Sample_characteristics_ch1 = ") and cur is not None:
            body = line.strip().split("= ", 1)[1]
            if ": " in body:
                key, _, value = body.partition(": ")
                if key not in meta[cur]:
                    meta[cur][key] = value
print("soft_parse_seconds=%.1f samples=%d" % (time.time() - t0, len(meta)))
print("sample_meta_example=%s" % meta.get("GSM8049207"))

# --- 2. tar 成员清单 ---
t0 = time.time()
members = []
with tarfile.open(TAR, "r:") as tf:
    for m in tf:
        if m.isfile() and m.name.endswith(".txt.gz"):
            members.append(m.name)
print("tar_list_seconds=%.1f members=%d" % (time.time() - t0, len(members)))
probe = members[:100]
print("probe_first=%s probe_last=%s" % (probe[0], probe[-1]))

# --- 3. 解析前 100 个文件 ---
t0 = time.time()
gene_sets = {}
row_counts = {}
summary_rows = set()
nnz_total = 0
with tarfile.open(TAR, "r:") as tf:
    for name in probe:
        gsm = name.split("_", 1)[0]
        fh = tf.extractfile(name)
        raw = gzip.decompress(fh.read())
        text = raw.decode("utf-8")
        genes = []
        total = 0
        nnz = 0
        for line in text.splitlines():
            if not line:
                continue
            gene, _, count = line.partition("\t")
            if gene.startswith("__"):
                summary_rows.add(gene)
                continue
            genes.append(gene)
            value = int(count)
            total += value
            if value > 0:
                nnz += 1
        gene_sets[gsm] = genes
        row_counts[gsm] = (total, nnz, len(genes))
        nnz_total += nnz
elapsed = time.time() - t0
print("probe_parse_seconds=%.1f per_file_ms=%.0f nnz_total=%d" % (elapsed, elapsed / len(probe) * 1000, nnz_total))
print("summary_rows_seen=%s" % sorted(summary_rows))

# --- 4. 基因集一致性 ---
ref_gsm = probe[0].split("_", 1)[0]
ref_genes = gene_sets[ref_gsm]
ref_set = set(ref_genes)
same = all(gene_sets[n.split("_", 1)[0]] == ref_genes for n in probe)
print("gene_list_identical_across_probe=%s n_genes=%d dup_in_ref=%d" % (same, len(ref_genes), len(ref_genes) - len(ref_set)))

# --- 5. nCount/nFeature 与元数据对账 ---
mismatch = 0
checked = 0
for name in probe:
    gsm = name.split("_", 1)[0]
    total, nnz, ngenes = row_counts[gsm]
    mc = meta.get(gsm, {})
    exp_count = mc.get("ncount rna")
    exp_feat = mc.get("nfeature rna")
    if exp_count is None or exp_feat is None:
        continue
    checked += 1
    if abs(total - float(exp_count)) > max(1, 0.001 * float(exp_count)) or abs(nnz - float(exp_feat)) > max(1, 0.01 * float(exp_feat)):
        mismatch += 1
        if mismatch <= 3:
            print("MISMATCH %s computed=(%d,%d) meta=(%s,%s)" % (gsm, total, nnz, exp_count, exp_feat))
print("meta_check checked=%d mismatch=%d" % (checked, mismatch))

# --- 6. 全量外推 ---
per_file = elapsed / len(probe)
print("full_estimate_seconds=%.0f full_estimate_minutes=%.1f" % (per_file * len(members), per_file * len(members) / 60))
print("full_matrix_nnz_estimate=%d" % int(nnz_total / len(probe) * len(members)))
# 稀疏矩阵三列 int32：row+col+data = 12 字节/nnz
print("sparse_mem_estimate_mb=%.0f" % (nnz_total / len(probe) * len(members) * 12 / 1024 / 1024))

# --- 7. anndata 可用性 ---
try:
    import anndata
    import numpy
    import scipy
    print("anndata=%s numpy=%s scipy=%s" % (anndata.__version__, numpy.__version__, scipy.__version__))
except Exception as exc:
    print("anndata_import_failed=%s" % exc)
