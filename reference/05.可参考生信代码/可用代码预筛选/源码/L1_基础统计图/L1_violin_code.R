# L1-02 小提琴图：组间分布对比（Bizard Distribution/ViolinPlot 骨架，工作台配色改造）
# 用途：比较多组连续变量的分布形态与中位数，比箱线图多一层密度信息；适合 QC 指标、表达量分组比较。
suppressPackageStartupMessages({library(ggplot2); library(dplyr)})
set.seed(42)
n <- 200
df <- data.frame(
  group = rep(c("Control", "Treat"), each = n),
  value = c(rnorm(n, 10, 2), rnorm(n, 12, 2.5))
)
p <- ggplot(df, aes(x = group, y = value, fill = group)) +
  geom_violin(trim = FALSE, alpha = 0.85, colour = "grey20", linewidth = 0.4) +
  geom_boxplot(width = 0.12, fill = "white", outlier.size = 0.8, linewidth = 0.4) +
  scale_fill_manual(values = c("Control" = "#0072B2", "Treat" = "#D55E00")) +
  labs(x = NULL, y = "value") +
  theme_classic(base_size = 7) +
  theme(legend.position = "none")
ggsave("L1_violin_verified.pdf", p, width = 89, height = 60, units = "mm")
ggsave("L1_violin_verified.png", p, width = 89, height = 60, units = "mm", dpi = 300, device = png, type = "cairo")
cat("RENDER_OK violin\n")
