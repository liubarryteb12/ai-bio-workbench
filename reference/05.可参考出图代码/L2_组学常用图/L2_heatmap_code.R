#!/usr/bin/env Rscript
# 图型：差异热图
# 用途：展示基因乘样本表达矩阵的聚类结构，并用分组注释对照样本类别。
# 输入数据契约：数值矩阵 m（行为基因、列为样本）与长度等于列数的分组向量 grp。
# 关键函数：ComplexHeatmap::Heatmap()、draw()、pdf()、png(type = "cairo")。
set.seed(42)
suppressPackageStartupMessages({
  library(ComplexHeatmap)
  library(viridis)
  library(circlize)
})

m <- matrix(rnorm(30 * 8, 0, 1.5), nrow = 30, ncol = 8)
colnames(m) <- paste0("S", seq_len(8))
rownames(m) <- paste0("GENE", seq_len(30))
grp <- rep(c("Ctrl", "Treat"), each = 4)

make_heatmap <- function() {
  Heatmap(
    m,
    name = "Z",
    col = viridis(100),
    cluster_rows = TRUE,
    cluster_columns = TRUE,
    top_annotation = HeatmapAnnotation(Group = grp),
    row_title = NULL,
    column_title = NULL,
    heatmap_legend_param = list(title = "Z")
  )
}

pdf("L2_heatmap_verified.pdf", width = 183 / 25.4, height = 120 / 25.4)
draw(make_heatmap())
dev.off()

png(
  "L2_heatmap_verified.png",
  width = 183 / 25.4,
  height = 120 / 25.4,
  units = "in",
  res = 300,
  type = "cairo"
)
draw(make_heatmap())
dev.off()

cat("RENDER_OK heatmap\n")
