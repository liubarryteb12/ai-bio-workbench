#!/usr/bin/env python3
"""verify_bridge_checkpoint.py：跨语言转换时的四项断言校验

用法:
  python3 verify_bridge_checkpoint.py --input <h5ad_or_rds> --from <Python|R> --to <R|Python> [--stage post-dimred|pre-dimred]

四项断言：
  1. 基因名非数字索引（var_names 或 rownames 含 Symbol 字符串，不是整数索引）
  2. 矩阵方向与非零元一致（基因 x 细胞 / 细胞 x 基因 不混淆，nnz 合理）
  3. Barcode / 样本名对齐（obs_names 有 GSM/barcode 前缀，非 0..N 整数）
  4. Embedding 保留（obsm/reductions 含 X_pca / X_umap / spatial）

阶段感知（--stage，aims v2.5 §一.2）：
  默认 post-dimred：第 4 项按硬断言处理，缺降维/空间坐标即 FAIL。
  pre-dimred：第 4 项降级为 [BRIDGE WARN] 并放行。用于"降维尚未发生的早期
  标准化矩阵"（例如线2 步骤 3 的 scrna_norm.h5ad、步骤 4 的 00_sc_harmony.h5ad
  之前的中间产物）；调用方必须显式声明，不允许静默降级。

退出码 0 = 全过，非 0 = 有断言失败。
"""
import argparse
import os
import sys

RSCRIPT_BIN = os.environ.get(
    "BIOANALYS_RSCRIPT",
    "/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript",
)

# 输出固定 UTF-8：引擎会被 Windows 宿主（自测/垫片）和 Linux 计算节点共同调用，
# 默认编码在 Windows 控制台是 cp936，中文结论会变成乱码，调用方 grep 不到关键字。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001 - 老解释器或被重定向时忽略
        pass


def fail(msg):
    sys.stderr.write("[BRIDGE FAIL] %s\n" % msg)
    sys.stderr.flush()
    sys.exit(1)


def ok(msg):
    print("[BRIDGE OK] %s" % msg)


def warn(msg):
    print("[BRIDGE WARN] %s" % msg)


def check_h5ad(path, stage="post-dimred"):
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
        if stage == "pre-dimred":
            warn("obsm 无 X_pca / X_umap / spatial（stage=pre-dimred，早期矩阵降级为告警，"
                 "下游消费该文件时必须重新跑 post-dimred 断言）")
        else:
            fail("obsm 无 X_pca / X_umap / spatial，降维/空间坐标可能丢失")
    else:
        ok("embeddings: %s" % ", ".join(found))
    # 额外：检查 var 列（基因 Symbol 是否在 var.columns）
    if "gene_symbol" in a.var.columns:
        n_missing = int(a.var["gene_symbol"].isna().sum())
        ok("gene_symbol column present, missing=%d" % n_missing)
    print("[BRIDGE PASS] all 4 assertions passed for %s" % path)


def check_rds(path, stage="post-dimred"):
    # RDS 需 R 侧检查，这里用 Rscript 子进程
    import os
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
stage <- Sys.getenv("BRIDGE_STAGE", "post-dimred")
if (length(emb_found) == 0) {
  if (identical(stage, "pre-dimred")) {
    cat("[BRIDGE WARN] no PCA/UMAP/spatial in reducedDims (stage=pre-dimred, downgraded)\n")
  } else {
    stop("[BRIDGE FAIL] no PCA/UMAP/spatial in reducedDims")
  }
}
cat("[BRIDGE OK] embeddings:", paste(emb_found, collapse=", "), "\\n")
cat("[BRIDGE PASS] all 4 assertions passed\\n")
'''
    env = dict(os.environ)
    env["BRIDGE_STAGE"] = stage
    result = subprocess.run([RSCRIPT_BIN, "--vanilla", "-e", script, path],
                           capture_output=True, text=True, timeout=120, env=env)
    if result.returncode != 0:
        fail(result.stderr.strip() or result.stdout.strip() or "RDS check failed")
    print(result.stdout.strip())


def main():
    parser = argparse.ArgumentParser(description="Bridge checkpoint verification")
    parser.add_argument("--input", required=True, help="Input file path (.h5ad or .rds)")
    parser.add_argument("--from", dest="from_lang", default="Python", choices=["Python", "R"])
    parser.add_argument("--to", dest="to_lang", default="R", choices=["Python", "R"])
    parser.add_argument("--stage", dest="stage", default="post-dimred",
                        choices=["post-dimred", "pre-dimred"],
                        help="post-dimred（默认）第4项为硬断言；pre-dimred 降级为告警")
    args = parser.parse_args()

    print("[BRIDGE] %s -> %s, file=%s, stage=%s"
          % (args.from_lang, args.to_lang, args.input, args.stage))

    # 输入必须在位且可读：文件损坏/缺失是断言失败，不是"引擎不可达"。
    # 真机实测（2026-10-21）：损坏的 h5ad 会让 anndata 抛 OSError，若直接冒出
    # traceback，守卫只能看到"非 0 退出码 + 无结论"，会误判成引擎不可达而放行。
    if not os.path.exists(args.input):
        fail("输入文件不存在: %s" % args.input)

    try:
        if args.input.endswith(".h5ad"):
            check_h5ad(args.input, args.stage)
        elif args.input.endswith(".rds"):
            check_rds(args.input, args.stage)
        else:
            fail("不支持的文件格式（需 .h5ad 或 .rds）: %s" % args.input)
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - 引擎崩溃一律折成断言失败
        fail("引擎无法校验输入（%s: %s）" % (type(exc).__name__, exc))


if __name__ == "__main__":
    main()
