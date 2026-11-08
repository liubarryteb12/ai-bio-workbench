# -*- coding: utf-8 -*-
"""line3_spatial 双细胞打分（独立作业，不进主管线）。

为什么不放进 qc_spots（2026-11-06 实测教训）：
    qc_spots 主进程要持有约 2.7 GB 输入与约 2.2 GB 过滤副本，再起 scrublet
    子进程（约 1 GB），写 2.7 GB 输出时可用内存跌破 600 MB，
    Android 的 low-memory-killer 会杀掉整个 Termux（当天实测 5 次，SSH 全断，
    只能靠 adb 重启 Termux 恢复）。因此把 scrublet 拆成独立作业：
    本脚本逐样本用 h5py 只读该样本的行块，峰值约 1.5 GB，跑完即退出；
    qc_spots 只按 row_index 读表应用判定。

口径（必须随结果一起交付）：
    Visium spot 直径约 55um，本身就可能包含多个细胞，
    因此这里的 doublet 指「表达谱像两群混合」的 spot（多细胞 / 粘连 / ambient RNA），
    不等同于单细胞意义上的真双细胞（一次捕获里进了两个完整细胞）。

用法：
    python3 tools/reporting/doublet_score.py <spatial_counts_<sp>.h5ad> <输出.tsv> [最大基因数]

输出列：row_index  sample_id  doublet_score  predicted_doublet
"""
import gc
import os
import sys

import anndata as ad
import h5py
import numpy as np
import scanpy as sc
from scipy.sparse import csr_matrix

SEED = int(os.environ.get("BIOANALYS_SEED", "20261013"))
RATE = float(os.environ.get("BIO_DOUBLET_RATE", "0.06"))
DEFAULT_CAP = 1500


def main():
    path = sys.argv[1]
    out = sys.argv[2]
    cap = int(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_CAP

    rows = []
    with h5py.File(path, "r") as f:
        sid = f["obs"]["sample_id"]
        cats = [c.decode() if isinstance(c, bytes) else str(c)
                for c in sid["categories"][:]]
        codes = sid["codes"][:]
        n_vars = int(f["X"].attrs["shape"][1])
        for ci, name in enumerate(cats):
            idx = np.where(codes == ci)[0]
            if idx.size == 0:
                continue
            i0, i1 = int(idx[0]), int(idx[-1]) + 1
            if idx.size != i1 - i0:
                raise SystemExit("样本 %s 在 h5ad 内不是连续块，无法按行切片" % name)
            ptr = f["X"]["indptr"][i0:i1 + 1]
            lo, hi = int(ptr[0]), int(ptr[-1])
            X = csr_matrix(
                (f["X"]["data"][lo:hi], f["X"]["indices"][lo:hi], ptr - lo),
                shape=(i1 - i0, n_vars))
            a = ad.AnnData(X)
            hits = np.bincount(a.X.indices, minlength=a.n_vars)
            use = min(cap, a.n_vars)
            keep_g = np.sort(np.argsort(hits)[::-1][:use])
            a = a[:, keep_g].copy()
            sc.pp.scrublet(a, expected_doublet_rate=RATE, n_prin_comps=10,
                           sim_doublet_ratio=1.5, random_state=SEED, verbose=False)
            pred = np.asarray(a.obs["predicted_doublet"], bool)
            score = np.asarray(a.obs["doublet_score"], float)
            for j in range(idx.size):
                rows.append((int(idx[j]), name, float(score[j]), int(pred[j])))
            print("%-12s spots=%5d genes_used=%4d predicted=%d (%.3f%%)"
                  % (name, idx.size, a.n_vars, int(pred.sum()),
                     float(pred.mean()) * 100), flush=True)
            del a, X
            gc.collect()

    with open(out, "w", encoding="utf-8") as fh:
        fh.write("row_index\tsample_id\tdoublet_score\tpredicted_doublet\n")
        for r in rows:
            fh.write("%d\t%s\t%.6f\t%d\n" % r)
    print("WROTE %s rows=%d predicted_total=%d"
          % (out, len(rows), sum(r[3] for r in rows)), flush=True)


if __name__ == "__main__":
    main()
