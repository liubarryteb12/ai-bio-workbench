# S3 诊断二：验证 nCount/nFeature 差值 = ERCC spike-in 假设
import gzip
import tarfile

RAW = "/mnt/ssd/bio_data/line2_scrna/raw_data"
TAR = RAW + "/GSE254707_RAW.tar"
SOFT = RAW + "/GPL21697_family.soft.gz"

import time
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
print("soft_parse_seconds=%.1f" % (time.time() - t0))

# 取 24 个文件：前 8 + 中段 8 + 末段 8，覆盖不同供体
members = []
with tarfile.open(TAR, "r:") as tf:
    for m in tf:
        if m.isfile() and m.name.endswith(".txt.gz"):
            members.append(m.name)
probe = members[:8] + members[2490:2498] + members[-8:]

ok_count = ok_feat = ok_ercc = 0
n = 0
with tarfile.open(TAR, "r:") as tf:
    for name in probe:
        gsm = name.split("_", 1)[0]
        raw = gzip.decompress(tf.extractfile(name).read()).decode("utf-8")
        total = nnz = ercc_total = ercc_nnz = 0
        for line in raw.splitlines():
            if not line:
                continue
            gene, _, count = line.partition("\t")
            if gene.startswith("__"):
                continue
            value = int(count)
            total += value
            if value > 0:
                nnz += 1
            if gene.startswith("ERCC"):
                ercc_total += value
                if value > 0:
                    ercc_nnz += 1
        mc = meta[gsm]
        meta_count = float(mc["ncount rna"])
        meta_feat = float(mc["nfeature rna"])
        meta_ercc = float(mc["percent.ercc"])
        c_ok = abs((total - ercc_total) - meta_count) <= 1
        f_ok = (nnz - ercc_nnz) == meta_feat
        e_ok = abs(ercc_total / total - meta_ercc) < 1e-6 if total else False
        ok_count += c_ok
        ok_feat += f_ok
        ok_ercc += e_ok
        n += 1
        if n <= 6 or not (c_ok and f_ok and e_ok):
            print("%s donor=%s region=%s class=%s | total=%d nnz=%d ercc_total=%d ercc_nnz=%d | meta_count=%d meta_feat=%d meta_ercc=%.6f | c_ok=%s f_ok=%s e_ok=%s"
                  % (gsm, mc.get("donor"), mc.get("region"), mc.get("class"),
                     total, nnz, ercc_total, ercc_nnz, meta_count, meta_feat, meta_ercc, c_ok, f_ok, e_ok))
print("checked=%d count_ok=%d feat_ok=%d ercc_ok=%d" % (n, ok_count, ok_feat, ok_ercc))

# 附带：mt- 基因与 ERCC 基因名样例
mt = []
ercc_names = []
with tarfile.open(TAR, "r:") as tf:
    raw = gzip.decompress(tf.extractfile(members[0]).read()).decode("utf-8")
    for line in raw.splitlines():
        gene, _, count = line.partition("\t")
        if gene.startswith("__"):
            continue
        if gene.startswith("ERCC"):
            ercc_names.append(gene)
        if gene.startswith("mt-") or gene.startswith("MT-"):
            mt.append(gene)
print("ercc_genes_in_file=%d sample=%s" % (len(ercc_names), ercc_names[:5]))
print("mt_genes_in_file=%d sample=%s" % (len(mt), mt[:8]))
