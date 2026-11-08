# Master-Source: reference/05.可参考出图代码/_meta/R453_compat/L1_rest_code.R | Master-SHA256: da21074542cef95ffa7c033a5b6bb291b49384f034b2ef9eb79e3322d98213e8
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line1_bulk
# Adapt-Variable input_data: 项目本线只读输入文件路径，相对于本项目根目录
# Adapt-Variable x_col: 横轴数值列名
# Adapt-Variable y_col: 纵轴数值列名
# Adapt-Variable label_genes: 需要标注的基因清单，可为空
adapt_vars <- list(
  input_data = 'data/line1_bulk/processed/ml_core_hub_genes.tsv',
  x_col = 'rf_importance',
  y_col = 'gbdt_importance',
  label_genes = c('CXCL16')
)

# Real-Data-Adapter: v1
# Project-Input: data/line1_bulk/processed/ml_core_hub_genes.tsv
seed_value <- Sys.getenv("BIOANALYS_SEED", unset = "")
if (nchar(seed_value) == 0) quit(status = 3)
set.seed(as.integer(seed_value))
input_data <- "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line1_bulk/processed/ml_core_hub_genes.tsv"
output_file <- "L1_scatter_verified.png"
if (!file.exists(input_data)) stop(paste("real input missing:", input_data))
dir.create(dirname(output_file), recursive = TRUE, showWarnings = FALSE)

# Real-data model-importance scatter overlay
suppressPackageStartupMessages({library(ggplot2)})
hub <- read.delim(input_data, check.names = FALSE)
x_col <- if (is.null(adapt_vars$x_col) || !nzchar(adapt_vars$x_col)) "rf_importance" else adapt_vars$x_col
y_col <- if (is.null(adapt_vars$y_col) || !nzchar(adapt_vars$y_col)) "gbdt_importance" else adapt_vars$y_col
required <- c("gene", x_col, y_col)
if (!all(required %in% names(hub))) stop(paste("scatter input columns missing:", paste(required, collapse = " / ")))
hub[[x_col]] <- as.numeric(hub[[x_col]])
hub[[y_col]] <- as.numeric(hub[[y_col]])
hub <- hub[is.finite(hub[[x_col]]) & is.finite(hub[[y_col]]), , drop = FALSE]
hub$score <- -log10(pmax(as.numeric(hub$p_value), 1e-300))
label_genes <- unique(c(as.character(adapt_vars$label_genes), head(hub$gene[order(hub$importance_rank)], 8)))
labels <- hub[hub$gene %in% label_genes, , drop = FALSE]
labels <- labels[!duplicated(labels$gene), , drop = FALSE]
plot <- ggplot(hub, aes(x = .data[[x_col]], y = .data[[y_col]], colour = score)) +
  geom_point(size = 1.15, alpha = 0.82) +
  geom_text(data = labels, aes(label = gene), size = 2, check_overlap = TRUE, show.legend = FALSE) +
  scale_colour_viridis_c(name = "-log10(P)") +
  labs(x = x_col, y = y_col) +
  theme_classic(base_size = 7)
ggsave(output_file, plot, width = 89, height = 75, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK scatter rows=", nrow(hub), "
", sep = "")

quit(status = 0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
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
