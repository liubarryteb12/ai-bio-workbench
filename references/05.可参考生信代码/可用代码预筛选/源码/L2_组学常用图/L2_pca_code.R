#!/usr/bin/env Rscript
# 图型：PCA 图
# 用途：展示样本在主成分空间中的分组分离，并用置信椭圆概括组内离散度。
# 输入数据契约：data.frame 至少包含 PC1、PC2 与 g（样本分组）三列。
# 关键函数：ggplot2::geom_point()、ggplot2::stat_ellipse() 与 ggsave()。
set.seed(42)
suppressPackageStartupMessages(library(ggplot2))

pc <- data.frame(
  PC1 = c(rnorm(80, -2, 1), rnorm(80, 2, 1)),
  PC2 = c(rnorm(80, 0.5, 1), rnorm(80, -0.5, 1)),
  g = rep(c("Ctrl", "Treat"), each = 80)
)

p <- ggplot(pc, aes(x = PC1, y = PC2, colour = g)) +
  geom_point(size = 1.2, alpha = 0.85) +
  stat_ellipse(linewidth = 0.5) +
  scale_colour_manual(values = c("Ctrl" = "#0072B2", "Treat" = "#D55E00")) +
  labs(x = "PC1 (28.4%)", y = "PC2 (16.1%)") +
  theme_classic(base_size = 7)

ggsave("L2_pca_verified.pdf", plot = p, width = 89, height = 80, units = "mm")
ggsave(
  "L2_pca_verified.png",
  plot = p,
  width = 89,
  height = 80,
  units = "mm",
  dpi = 300,
  device = png,
  type = "cairo"
)
cat("RENDER_OK pca\n")
