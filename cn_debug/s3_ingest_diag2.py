# S3 诊断三：残差是否藏在 __ 汇总行
import gzip
import tarfile

TAR = "/mnt/ssd/bio_data/line2_scrna/raw_data/GSE254707_RAW.tar"
SOFT = "/mnt/ssd/bio_data/line2_scrna/raw_data/GPL21697_family.soft.gz"

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

targets = ["GSM8049209", "GSM8049211", "GSM8049207", "GSM8051697", "GSM8054195"]
name_by_gsm = {}
with tarfile.open(TAR, "r:") as tf:
    for m in tf:
        if m.isfile() and m.name.endswith(".txt.gz"):
            gsm = m.name.split("_", 1)[0]
            if gsm in targets:
                name_by_gsm[gsm] = m.name

for gsm in targets:
    with tarfile.open(TAR, "r:") as tf:
        raw = gzip.decompress(tf.extractfile(name_by_gsm[gsm]).read()).decode("utf-8")
    total = ercc_total = 0
    nnz = ercc_nnz = 0
    summary = {}
    for line in raw.splitlines():
        if not line:
            continue
        gene, _, count = line.partition("\t")
        value = int(count)
        if gene.startswith("__"):
            summary[gene] = value
            continue
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
    resid_count = meta_count - (total - ercc_total)
    resid_feat = meta_feat - (nnz - ercc_nnz)
    print("%s: resid_count=%+d resid_feat=%+d | ambiguous=%s no_feature=%s too_low=%s not_aligned=%s uniq=%s"
          % (gsm, resid_count, resid_feat,
             summary.get("__ambiguous"), summary.get("__no_feature"),
             summary.get("__too_low_aQual"), summary.get("__not_aligned"),
             summary.get("__alignment_not_unique")))
