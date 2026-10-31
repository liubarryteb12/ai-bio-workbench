#!/usr/bin/env Rscript
# 图型：密度图
# 用途：比较连续变量在组间的概率密度，适合分布差异和批次效应初筛。
# 输入数据契约：data.frame 至少包含 x（连续值）与 g（分组）两列；本脚本内置可复现示例数据。
# 关键函数：ggplot2::geom_density() 与 ggsave()。
set.seed(42)
suppressPackageStartupMessages(library(ggplot2))

df <- data.frame(x = rnorm(500, 0, 1), g = rep(c("A", "B"), each = 250))

p <- ggplot(df, aes(x = x, fill = g)) +
  geom_density(alpha = 0.55, colour = "grey20", linewidth = 0.4) +
  scale_fill_manual(values = c("A" = "#0072B2", "B" = "#D55E00")) +
  labs(x = "value", y = "density") +
  theme_classic(base_size = 7) +
  theme(legend.position = "none")

ggsave("L1_density_verified.pdf", plot = p, width = 89, height = 60, units = "mm")
ggsave(
  "L1_density_verified.png",
  plot = p,
  width = 89,
  height = 60,
  units = "mm",
  dpi = 300,
  device = png,
  type = "cairo"
)
cat("RENDER_OK density\n")
