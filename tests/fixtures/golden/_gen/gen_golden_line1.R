#!/usr/bin/env Rscript
# gen_golden_line1.R —— Line1 黄金矩阵生成器（Argon 配方，2026-11-02）
# 120 基因 x 12 样本（6 Ctrl vs 6 Case）：
#   - 基础表达 mu 100~500（防 DESeq2 独立过滤误杀），NB size=20（dispersion=0.05，组内方差极小）
#   - GENE_UP_1..12：Case 均值 x4（log2FC~2.0）；GENE_DOWN_1..12：x0.25（log2FC~-2.0）
#   - 其余 96 背景基因分 3 个共表达模块（带协方差梯度，供 WGCNA 成块不报方差 0）
set.seed(42)
setwd(dirname(sub('^--file=', '', grep('^--file=', commandArgs(trailingOnly=FALSE), value=TRUE)[1])))
out_dir <- commandArgs(trailingOnly=TRUE)[1]
if (is.na(out_dir)) out_dir <- '.'
dir.create(out_dir, recursive=TRUE, showWarnings=FALSE)

n_genes <- 120; n_ctrl <- 6; n_case <- 6
groups <- c(rep('Ctrl', n_ctrl), rep('Case', n_case))
mu_base <- sort(runif(n_genes, min=100, max=500))
size <- 20

# 背景 3 模块：每模块 32 基因共享一个样本级潜在因子（协方差梯度 0.9/0.6/0.3）
lambda <- mu_base
lambda[1:12]   <- mu_base[1:12]            # UP 组基线
lambda[13:24]  <- mu_base[13:24]
module_load <- rep(0, n_genes)
module_load[25:56]  <- 0.9; module_load[57:88] <- 0.6; module_load[89:120] <- 0.3
latent <- rnorm(n_ctrl + n_case)
counts <- matrix(0L, nrow=n_genes, ncol=n_ctrl + n_case)
for (i in seq_len(n_genes)) {
  mu_i <- lambda[i] * (1 + module_load[i] * latent * 0.15)
  counts[i, ] <- rnbinom(n_ctrl + n_case, mu=pmax(mu_i, 1), size=size)
}
# 差异：UP 12 个在 Case x4，DOWN 12 个在 Case x0.25
case_cols <- which(groups == 'Case')
for (i in 1:12)     counts[i, case_cols] <- rnbinom(n_case, mu=lambda[i]*4,    size=size)
for (i in 13:24)    counts[i, case_cols] <- rnbinom(n_case, mu=lambda[i]*0.25, size=size)

gene_ids <- c(paste0('GENE_UP_', 1:12), paste0('GENE_DOWN_', 1:12), paste0('GENE_BG_', 1:96))
sample_ids <- paste0('SAMPLE_', sprintf('%02d', seq_len(n_ctrl + n_case)))
rownames(counts) <- gene_ids; colnames(counts) <- sample_ids
write.csv(counts, file.path(out_dir, 'counts.csv'), quote=FALSE)
meta <- data.frame(sample_id=sample_ids, group=groups, stringsAsFactors=FALSE)
write.csv(meta, file.path(out_dir, 'metadata.csv'), row.names=FALSE, quote=FALSE)
cat('GENE_UP_1 case mean =', mean(counts['GENE_UP_1', case_cols]), 'ctrl mean =', mean(counts['GENE_UP_1', -case_cols]), '\n')
cat('GOLDEN_LINE1_OK\n')