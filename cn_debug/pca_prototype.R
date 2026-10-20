# pca_matrix 一次性原型：验证 PCA 逻辑（高变基因筛选 / prcomp / 方差解释 / PDF 出图）
suppressPackageStartupMessages({library(data.table); library(ggplot2)})

expr_file  <- "/mnt/ssd/bio_data/line1_bulk/processed/expr_genes.tsv"
group_file <- "/mnt/ssd/bio_data/line1_bulk/processed/group_map.tsv"
out_dir <- "/tmp/pca_proto"
dir.create(out_dir, showWarnings = FALSE)

fail <- function(message) {
  cat(sprintf("pca 自校验失败: %s\n", message), file = stderr())
  quit(status = 1)
}

expr <- fread(expr_file)
group_map <- fread(group_file)
samples <- setdiff(names(expr), "gene")
if (!setequal(samples, group_map$sample)) fail("样本集合与 group_map 不一致")
mat <- as.matrix(expr[, .SD, .SDcols = samples])
rownames(mat) <- expr$gene
groups <- setNames(group_map$group, group_map$sample)[samples]

# 高变基因 top 2000（按 SD）：全量基因 PCA 会被持家基因稀释，固定个数写进报告可复现
top_n <- min(2000, nrow(mat))
gene_sd <- matrixStats::rowSds(mat)
top_genes <- order(gene_sd, decreasing = TRUE)[seq_len(top_n)]
pca <- prcomp(t(mat[top_genes, , drop = FALSE]), center = TRUE, scale. = TRUE)
var_explained <- summary(pca)$importance[2, ] * 100

scores <- data.table(
  sample = rownames(pca$x),
  group = unname(groups[rownames(pca$x)]),
  PC1 = round(pca$x[, 1], 4),
  PC2 = round(pca$x[, 2], 4),
  PC3 = round(pca$x[, 3], 4),
  PC4 = round(pca$x[, 4], 4),
  PC5 = round(pca$x[, 5], 4)
)
fwrite(scores, file.path(out_dir, "pca_scores.tsv"), sep = "\t")

p <- ggplot(scores, aes(x = PC1, y = PC2, color = group)) +
  geom_point(size = 3) +
  stat_ellipse(aes(color = group), type = "norm") +
  labs(title = sprintf("PCA (top %d variable genes)", top_n),
       subtitle = sprintf("PC1: %.1f%%   PC2: %.1f%%", var_explained[1], var_explained[2])) +
  theme_classic(base_size = 12)
ggsave(file.path(out_dir, "pca_plot.pdf"), p, width = 6, height = 5)

report <- c(
  sprintf("top_variable_genes=%d", top_n),
  sprintf("variance_explained=%s", paste(sprintf("PC%d:%.1f%%", seq_along(var_explained)[1:5], var_explained[1:5]), collapse = " "))
)
writeLines(report, file.path(out_dir, "pca_report.txt"))
cat(report, sep = "\n")
cat("\nPC1 range:", sprintf("%.2f - %.2f", min(scores$PC1), max(scores$PC1)), "\n")
cat("PDF size:", file.info(file.path(out_dir, "pca_plot.pdf"))$size, "bytes\n")
print(scores[order(group, sample)])
