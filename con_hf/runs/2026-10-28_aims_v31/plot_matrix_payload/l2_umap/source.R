#!/usr/bin/env Rscript
# 图型：UMAP 嵌入图
# 用途：展示单细胞或样本在二维嵌入空间中的聚类分离与批次结构。
# 输入数据契约：data.frame 至少包含 UMAP1、UMAP2 与 ct（细胞类型或聚类标签）三列。
# 关键函数：ggplot2::geom_point()、scale_colour_manual() 与 ggsave()。
set.seed(42)
suppressPackageStartupMessages({
  library(ggplot2)
  library(scales)
})

k <- 5
per <- 260
emb <- data.frame(
  UMAP1 = c(
    rnorm(per, -3, 1),
    rnorm(per, 3, 1),
    rnorm(per, 0, 1.2),
    rnorm(per, -2, 1),
    rnorm(per, 2.5, 1.1)
  ),
  UMAP2 = c(
    rnorm(per, 0, 1),
    rnorm(per, 0, 1),
    rnorm(per, 3, 1),
    rnorm(per, -3, 1),
    rnorm(per, 2, 1.3)
  ),
  ct = rep(paste0("CellType_", seq_len(k)), each = per)
)
palette5 <- c("#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00")

p <- ggplot(emb, aes(x = UMAP1, y = UMAP2, colour = ct)) +
  geom_point(size = 0.35, alpha = 0.9) +
  scale_colour_manual(values = palette5) +
  labs(x = "UMAP_1", y = "UMAP_2") +
  theme_classic(base_size = 7) +
  theme(
    legend.text = element_text(size = 6),
    legend.key.height = unit(0.4, "lines")
  )

ggsave("L2_umap_verified.pdf", plot = p, width = 183, height = 90, units = "mm")
ggsave(
  "L2_umap_verified.png",
  plot = p,
  width = 183,
  height = 90,
  units = "mm",
  dpi = 300,
  device = png,
  type = "cairo"
)
cat("RENDER_OK umap\n")
