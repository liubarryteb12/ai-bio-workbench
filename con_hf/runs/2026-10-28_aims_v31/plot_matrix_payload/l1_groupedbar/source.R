#!/usr/bin/env Rscript
# 图型：分组柱状图
# 用途：比较不同处理在各时间点或类别上的均值，并显示误差范围。
# 输入数据契约：data.frame 至少包含 g（分组）、t（类别）、m（均值）与 s（误差）四列。
# 关键函数：ggplot2::geom_col()、ggplot2::geom_errorbar() 与 ggsave()。
set.seed(42)
suppressPackageStartupMessages(library(ggplot2))

d <- data.frame(
  g = rep(c("Ctrl", "Treat"), each = 3),
  t = rep(c("T1", "T2", "T3"), 2),
  m = c(5, 7, 9, 6, 9, 12),
  s = c(0.8, 1.0, 1.2, 0.9, 1.1, 1.4)
)

p <- ggplot(d, aes(x = t, y = m, fill = g)) +
  geom_col(
    position = position_dodge(0.8),
    width = 0.7,
    colour = "grey20",
    linewidth = 0.3
  ) +
  geom_errorbar(
    aes(ymin = m - s, ymax = m + s),
    position = position_dodge(0.8),
    width = 0.2,
    linewidth = 0.4
  ) +
  scale_fill_manual(values = c("Ctrl" = "#0072B2", "Treat" = "#D55E00")) +
  labs(x = NULL, y = "mean") +
  theme_classic(base_size = 7)

ggsave("L1_groupedbar_verified.pdf", plot = p, width = 89, height = 60, units = "mm")
ggsave(
  "L1_groupedbar_verified.png",
  plot = p,
  width = 89,
  height = 60,
  units = "mm",
  dpi = 300,
  device = png,
  type = "cairo"
)
cat("RENDER_OK groupedbar\n")
