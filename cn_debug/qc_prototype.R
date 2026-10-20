# qc_matrix 一次性原型：验证 QC 逻辑（样本检出 / 组内相关性 / 离群 flag）
# 正式脚本 src/line1_bulk/scripts/qc_matrix 定稿后本文件即废弃
suppressPackageStartupMessages(library(data.table))

expr_file  <- "/mnt/ssd/bio_data/line1_bulk/processed/expr_genes.tsv"
group_file <- "/mnt/ssd/bio_data/line1_bulk/processed/group_map.tsv"

fail <- function(message) {
  cat(sprintf("qc 自校验失败: %s\n", message), file = stderr())
  quit(status = 1)
}

expr <- fread(expr_file)
group_map <- fread(group_file)
if (names(expr)[1] != "gene") fail("expr 首列不是 gene")
samples <- setdiff(names(expr), "gene")
if (!setequal(samples, group_map$sample)) {
  fail(sprintf("样本集合与 group_map 不一致: expr=%s group_map=%s",
               paste(setdiff(samples, group_map$sample), collapse = ","),
               paste(setdiff(group_map$sample, samples), collapse = ",")))
}
if (any(duplicated(expr$gene))) fail("基因名有重复")
mat <- as.matrix(expr[, .SD, .SDcols = samples])
if (any(is.na(mat))) fail("表达矩阵含 NA")
groups <- setNames(group_map$group, group_map$sample)[samples]

# 组内逐样本 Spearman 相关中位数：离群样本与同组其他人的profile不像
cor_mat <- cor(mat, method = "spearman")
median_cor <- sapply(samples, function(s) {
  same <- samples[groups == groups[[s]] & samples != s]
  median(cor_mat[s, same])
})
outlier_cutoff <- mean(median_cor) - 3 * stats::sd(median_cor)
outliers <- names(which(median_cor < outlier_cutoff))

sample_qc <- data.table(
  sample = samples,
  group = unname(groups),
  genes_detected = colSums(mat > 0),
  median_expr = round(apply(mat, 2, median), 3),
  median_within_group_cor = round(as.numeric(median_cor), 4),
  outlier = samples %in% outliers
)

cat("samples=", length(samples), "\n", sep = "")
cat("groups=", paste(sprintf("%s:%d", names(table(groups)), as.integer(table(groups))), collapse = " "), "\n", sep = "")
cat("cor_range=", sprintf("%.4f - %.4f", min(cor_mat[lower.tri(cor_mat)]), max(cor_mat[lower.tri(cor_mat)])), "\n", sep = "")
cat("outlier_cutoff=", sprintf("%.4f", outlier_cutoff), "\n", sep = "")
cat("outliers=", if (length(outliers) == 0) "无" else paste(outliers, collapse = ","), "\n", sep = "")
print(sample_qc[order(group, sample)])
