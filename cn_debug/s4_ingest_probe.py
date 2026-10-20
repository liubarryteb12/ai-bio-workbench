# s4_ingest_probe.py：S4 line3_spatial 步骤 1 一次性数据形态探针（2026-10-13）
# 目的：确认 GSE192741 各样本 h5 矩阵结构、positions 对齐、基因组、ADT 文件形态，
# 为 ingest_spatial 生产脚本定口径。探针只读，不写任何数据面文件。
import gzip
import sys
import tarfile
from collections import Counter

import h5py
import numpy as np

TAR = "/mnt/ssd/bio_data/line3_spatial/raw_data/GSE192741_RAW.tar"

# (gsm, shortfilename) 全部 15 个样本
SAMPLES = [
    ("GSM5764414", "JBO001"), ("GSM5764415", "JBO002"), ("GSM5764416", "JBO003"),
    ("GSM5764417", "JBO004"), ("GSM5764418", "CAP002"), ("GSM5764419", "JBO006"),
    ("GSM5764420", "JBO009"), ("GSM5764421", "JBO010"), ("GSM5764422", "JBO012"),
    ("GSM5764423", "BH001"), ("GSM5764424", "JBO014"), ("GSM5764425", "JBO015"),
    ("GSM5764426", "JBO018"), ("GSM5764427", "JBO019"), ("GSM5764428", "JBO022"),
]


def read_positions(tf, gsm, sf):
    name = "%s_tissue_positions_list_%s.csv.gz" % (gsm, sf)
    handle = tf.extractfile(name)
    if handle is None:
        return None
    rows = []
    with gzip.open(handle, "rt") as fh:
        for line in fh:
            parts = line.strip().split(",")
            if len(parts) == 6:
                rows.append(parts)
    return rows


def main():
    with tarfile.open(TAR, "r:") as tf:
        print("gsm\tshortfile\tshape\tgenome\tfeat_type\tbc_n\tpos_n\tin_tissue\tjoin\t"
              "sym_dup\tid_dup\tnnz\tcps_med\ttps_med")
        for gsm, sf in SAMPLES:
            h5name = "%s_filtered_feature_bc_matrix_%s.h5" % (gsm, sf)
            handle = tf.extractfile(h5name)
            if handle is None:
                print("%s %s MISSING h5" % (gsm, sf))
                continue
            import io
            with h5py.File(io.BytesIO(handle.read()), "r") as f:
                m = f["matrix"]
                shape = list(m["shape"][:])
                bc = [x.decode() for x in m["barcodes"][:]]
                genome = Counter(x.decode() for x in m["features/genome"][:])
                feat = Counter(x.decode() for x in m["features/feature_type"][:])
                genes = [x.decode() for x in m["features/name"][:]]
                ids = [x.decode() for x in m["features/id"][:]]
                sym_dup = len([g for g, c in Counter(genes).items() if c > 1])
                id_dup = len([g for g, c in Counter(ids).items() if c > 1])
                data = m["data"][:]
                indptr = m["indptr"][:]
                nnz = int(data.shape[0])
                cps = np.diff(indptr)
                totals = np.add.reduceat(np.concatenate([data, [0]]), indptr[:-1])[: len(bc)]
                attrs = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in f.attrs.items()}
            pos = read_positions(tf, gsm, sf)
            pos_n = len(pos) if pos else -1
            in_tissue = sum(1 for r in pos if r[1] == "1") if pos else -1
            join_n = len(set(bc) & set(r[0] for r in pos)) if pos else -1
            print("%s\t%s\t%s\t%s\t%s\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d" % (
                gsm, sf, shape, dict(genome), dict(feat), len(bc), pos_n, in_tissue,
                join_n, sym_dup, id_dup, nnz, int(np.median(cps)), int(np.median(totals))))
            sys.stdout.flush()

        # ADT 文件形态
        adt_handle = tf.extractfile("GSM5764423_counts_ADT_BH001.csv.gz")
        if adt_handle is not None:
            import io
            raw = gzip.decompress(adt_handle.read()).decode("utf-8")
            lines = raw.splitlines()
            print("ADT lines=%d" % len(lines))
            for line in lines[:3]:
                print("ADT head: %s" % line[:120])
            # 第二列是 barcode 还是行是 antibody？
            print("ADT first cell field: %s" % lines[0].split(",")[0][:60])


if __name__ == "__main__":
    main()
