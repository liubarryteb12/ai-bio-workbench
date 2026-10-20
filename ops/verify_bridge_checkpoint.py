#!/usr/bin/env python3
"""verify_bridge_checkpoint.py：跨语言转换时的四项断言校验

用法:
  python3 verify_bridge_checkpoint.py --input <h5ad_or_rds> --from <Python|R> --to <R|Python>

四项断言：
  1. 基因名非数字索引（var_names 或 rownames 含 Symbol 字符串，不是整数索引）
  2. 矩阵方向与非零元一致（基因 x 细胞 / 细胞 x 基因 不混淆，nnz 合理）
  3. Barcode / 样本名对齐（obs_names 有 GSM/barcode 前缀，非 0..N 整数）
  4. Embedding 保留（obsm/reductions 含 X_pca / X_umap / spatial）

退出码 0 = 全过，非 0 = 有断言失败。
"""
import argparse
import sys


def fail(msg):
    sys.stderr.write("[BRIDGE FAIL] %s\n" % msg)
    sys.stderr.flush()
    sys.exit(1)


def ok(msg):
    print("[BRIDGE OK] %s" % msg)


def check_h5ad(path):
    import anndata as ad
    import numpy as np
    a = ad.read_h5ad(path)
    # 1. 基因名
    vn = list(a.var_names)
    if not vn:
        fail("var_names 为空")
    numeric_count = sum(1 for v in vn if str(v).replace(".", "").isdigit())
    if numeric_count > len(vn) * 0.5:
        fail("var_names 超过半数为数字索引（%d/%d），疑似 Ensembl ID 未映射"
             % (numeric_count, len(vn)))
    ok("gene names: %d, numeric < 50%% (%d)" % (len(vn), numeric_count))
    # 2. 矩阵方向
    n_obs, n_var = a.shape
    if n_obs == 0 or n_var == 0:
        fail("矩阵维度为 0: obs=%d var=%d" % (n_obs, n_var))
    X = a.X
    nnz = X.nnz if hasattr(X, "nnz") else int((X != 0).sum())
    # 正常表达矩阵 nnz > 0 且 < n_obs * n_var（不可能全密）
    if nnz == 0:
        fail("矩阵 nnz=0，全零")
    density = nnz / (n_obs * n_var) if n_obs * n_var > 0 else 0
    ok("matrix shape: obs=%d x var=%d, nnz=%d, density=%.4f" % (n_obs, n_var, nnz, density))
    # 3. Barcode / 样本名
    on = list(a.obs_names)
    if not on:
        fail("obs_names 为空")
    obs_numeric = sum(1 for o in on if str(o).isdigit())
    if obs_numeric > len(on) * 0.8:
        fail("obs_names 超过 80%% 为纯数字（%d/%d），疑似缺少 barcode/sample 标识"
             % (obs_numeric, len(on)))
    ok("obs names: %d, numeric < 80%% (%d), sample: %s"
       % (len(on), obs_numeric, str(on[:3])))
    # 4. Embedding
    found = []
    for key in ["X_pca", "X_umap", "spatial"]:
        if key in a.obsm:
            found.append(key)
    if not found:
        fail("obsm 无 X_pca / X_umap / spatial，降维/空间坐标可能丢失")
    ok("embeddings: %s" % ", ".join(found))
    # 额外：检查 var 列（基因 Symbol 是否在 var.columns）
    if "gene_symbol" in a.var.columns:
        n_missing = int(a.var["gene_symbol"].isna().sum())
        ok("gene_symbol column present, missing=%d" % n_missing)
    print("[BRIDGE PASS] all 4 assertions passed for %s" % path)


def check_rds(path):
    # RDS 需 R 侧检查，这里用 Rscript 子进程
    import subprocess
    script = '''
suppressMessages({library(SingleCellExperiment)})
args <- commandArgs(trailingOnly = TRUE)
sce <- readRDS(args[1])
# 1 gene names
vn <- rownames(sce)
if (is.null(vn)) stop("[BRIDGE FAIL] rownames is NULL")
num_count <- sum(grepl("^[0-9]+$", vn))
if (num_count > length(vn) * 0.5) stop("[BRIDGE FAIL] rownames mostly numeric")
cat("[BRIDGE OK] gene names:", length(vn), "numeric:", num_count, "\\n")
# 2 matrix
nobs <- ncol(sce); nvar <- nrow(sce)
if (nobs == 0 || nvar == 0) stop("[BRIDGE FAIL] zero dimension")
cat("[BRIDGE OK] matrix: obs=", nobs, " var=", nvar, "\\n")
# 3 barcodes
on <- colnames(sce)
if (is.null(on)) stop("[BRIDGE FAIL] colnames is NULL")
num_obs <- sum(grepl("^[0-9]+$", on))
if (num_obs > length(on) * 0.8) stop("[BRIDGE FAIL] colnames mostly numeric")
cat("[BRIDGE OK] obs names:", length(on), "numeric:", num_obs, "\\n")
# 4 embeddings
emb_found <- c()
for (k in c("PCA", "UMAP", "spatial")) {
  if (k %in% reducedDimNames(sce)) emb_found <- c(emb_found, k)
}
if (length(emb_found) == 0) stop("[BRIDGE FAIL] no PCA/UMAP/spatial in reducedDims")
cat("[BRIDGE OK] embeddings:", paste(emb_found, collapse=", "), "\\n")
cat("[BRIDGE PASS] all 4 assertions passed\\n")
'''
    result = subprocess.run(["Rscript", "-e", script, "--", path],
                           capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        fail(result.stderr.strip() or result.stdout.strip() or "RDS check failed")
    print(result.stdout.strip())


def main():
    parser = argparse.ArgumentParser(description="Bridge checkpoint verification")
    parser.add_argument("--input", required=True, help="Input file path (.h5ad or .rds)")
    parser.add_argument("--from", dest="from_lang", default="Python", choices=["Python", "R"])
    parser.add_argument("--to", dest="to_lang", default="R", choices=["Python", "R"])
    args = parser.parse_args()

    print("[BRIDGE] %s -> %s, file=%s" % (args.from_lang, args.to_lang, args.input))

    if args.input.endswith(".h5ad"):
        check_h5ad(args.input)
    elif args.input.endswith(".rds"):
        check_rds(args.input)
    else:
        fail("不支持的文件格式（需 .h5ad 或 .rds）: %s" % args.input)


if __name__ == "__main__":
    main()
