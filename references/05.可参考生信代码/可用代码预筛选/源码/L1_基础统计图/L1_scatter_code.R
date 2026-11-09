#!/usr/bin/env Rscript
# 图型：散点图
# 用途：展示两个连续变量的关系，并用线性回归趋势与置信区间辅助判断。
# 输入数据契约：data.frame 至少包含 x 与 y 两个连续变量；本脚本内置可复现示例数据。
# 关键函数：ggplot2::geom_point()、ggplot2::geom_smooth() 与 ggsave()。
set.seed(42)
suppressPackageStartupMessages(library(ggplot2))

x <- rnorm(120, 5, 2)
y <- 1.5 * x + rnorm(120, 0, 3)

p <- ggplot(data.frame(x, y), aes(x = x, y = y)) +
  geom_point(colour = "#0072B2", size = 1.2, alpha = 0.8) +
  geom_smooth(method = "lm", colour = "#D55E00", linewidth = 0.6, se = TRUE) +
  labs(x = "x", y = "y") +
  theme_classic(base_size = 7)

ggsave("L1_scatter_verified.pdf", plot = p, width = 89, height = 60, units = "mm")
ggsave(
  "L1_scatter_verified.png",
  plot = p,
  width = 89,
  height = 60,
  units = "mm",
  dpi = 300,
  device = png,
  type = "cairo"
)
cat("RENDER_OK scatter\n")
