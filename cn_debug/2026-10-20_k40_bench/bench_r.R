#!/usr/bin/env Rscript
# bench_r.R — R 侧效率基准 v2（dgemm 吞吐，固定 seed）
# v2 背景：v1 用 limma 5000x50（reference BLAS 单线程 ~0.032s/次）无区分度；
#   R 链接 reference BLAS（docs/k40_cpu_affinity.md §3），OPENBLAS_* 对 R 无效，
#   故 R 侧基准直接测 dgemm 吞吐 —— 这也是将来 openblas A/B 的对比基准。
# 用法: Rscript bench_r.R --cpus <spec|none> --threads N --tag T --round R
args <- commandArgs(trailingOnly = TRUE)
parse_args <- function(x) {
  vals <- list(); i <- 1
  while (i <= length(x)) {
    if (startsWith(x[i], "--")) {
      key <- sub("^--", "", x[i])
      if (i < length(x) && !startsWith(x[i + 1], "--")) { i <- i + 1; vals[[key]] <- x[i] }
      else vals[[key]] <- "TRUE"
    }
    i <- i + 1
  }
  vals
}
a <- parse_args(args)
cpus    <- if (is.null(a$cpus)) "none" else a$cpus
threads <- if (is.null(a$threads)) 3L else as.integer(a$threads)
tag     <- if (is.null(a$tag)) "x" else a$tag
round   <- if (is.null(a$round)) 1L else as.integer(a$round)
seed <- 20261013L   # aims 契约 seed
N <- 1500L          # dgemm 规模（单线程 reference BLAS ~5-10s/配置）

set.seed(seed)
M <- matrix(rnorm(N * N), nrow = N, ncol = N)
invisible(M %*% M)                       # 预热，不计时
t0 <- proc.time()[["elapsed"]]
n_rep <- 3
for (i in seq_len(n_rep)) C <- M %*% M
w <- proc.time()[["elapsed"]] - t0
gflops <- n_rep * 2 * N^3 / (w * 1e9)
cat(sprintf("R_DONE cpus=%s threads=%d tag=%s round=%d wall=%.3f per_rep=%.3f gflops=%.2f checksum=%.4f\n",
            cpus, threads, tag, round, w, w / n_rep, gflops, sum(C)))
