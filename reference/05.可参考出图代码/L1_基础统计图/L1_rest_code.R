set.seed(42)
library(ggplot2)
df <- data.frame(x = rnorm(500, 0, 1), g = rep(c("A","B"), each = 250))
# L1-03 直方图
p <- ggplot(df, aes(x = x, fill = g)) +
  geom_histogram(bins = 30, position = "identity", alpha = 0.6, colour = "grey20", linewidth = 0.3) +
  scale_fill_manual(values = c("A" = "#0072B2", "B" = "#D55E00")) +
  labs(x = "value", y = "count") + theme_classic(base_size = 7) + theme(legend.position = "none")
ggsave("L1_histogram_verified.pdf", p, width = 89, height = 60, units = "mm")
ggsave("L1_histogram_verified.png", p, width = 89, height = 60, units = "mm", dpi = 300, device = png, type = "cairo")
cat("RENDER_OK hist\n")

# L1-04 密度图
p <- ggplot(df, aes(x = x, fill = g)) +
  geom_density(alpha = 0.55, colour = "grey20", linewidth = 0.4) +
  scale_fill_manual(values = c("A" = "#0072B2", "B" = "#D55E00")) +
  labs(x = "value", y = "density") + theme_classic(base_size = 7) + theme(legend.position = "none")
ggsave("L1_density_verified.pdf", p, width = 89, height = 60, units = "mm")
ggsave("L1_density_verified.png", p, width = 89, height = 60, units = "mm", dpi = 300, device = png, type = "cairo")
cat("RENDER_OK density\n")

# L1-05 散点图 + 回归
set.seed(42)
x <- rnorm(120, 5, 2); y <- 1.5 * x + rnorm(120, 0, 3)
p <- ggplot(data.frame(x, y), aes(x = x, y = y)) +
  geom_point(colour = "#0072B2", size = 1.2, alpha = 0.8) +
  geom_smooth(method = "lm", colour = "#D55E00", linewidth = 0.6, se = TRUE) +
  labs(x = "x", y = "y") + theme_classic(base_size = 7)
ggsave("L1_scatter_verified.pdf", p, width = 89, height = 60, units = "mm")
ggsave("L1_scatter_verified.png", p, width = 89, height = 60, units = "mm", dpi = 300, device = png, type = "cairo")
cat("RENDER_OK scatter\n")

# L1-06 分组柱状图 + 误差棒
set.seed(42)
d <- data.frame(
  g = rep(c("Ctrl", "Treat"), each = 3),
  t = rep(c("T1", "T2", "T3"), 2),
  m = c(5, 7, 9, 6, 9, 12), s = c(0.8, 1.0, 1.2, 0.9, 1.1, 1.4)
)
p <- ggplot(d, aes(x = t, y = m, fill = g)) +
  geom_col(position = position_dodge(0.8), width = 0.7, colour = "grey20", linewidth = 0.3) +
  geom_errorbar(aes(ymin = m - s, ymax = m + s), position = position_dodge(0.8), width = 0.2, linewidth = 0.4) +
  scale_fill_manual(values = c("Ctrl" = "#0072B2", "Treat" = "#D55E00")) +
  labs(x = NULL, y = "mean") + theme_classic(base_size = 7)
ggsave("L1_groupedbar_verified.pdf", p, width = 89, height = 60, units = "mm")
ggsave("L1_groupedbar_verified.png", p, width = 89, height = 60, units = "mm", dpi = 300, device = png, type = "cairo")
cat("RENDER_OK groupedbar\n")
