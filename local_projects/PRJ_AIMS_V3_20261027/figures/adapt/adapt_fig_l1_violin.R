# Master-Source: reference/05.可参考出图代码/_meta/R453_compat/L1_violin_code.R | Master-SHA256: 9470bc63b49396ee5fc0fe0725063254849047e37e2482799db7ba54979e259a
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line1_bulk
# Adapt-Variable input_data: 项目本线只读输入文件路径，相对于本项目根目录
# Adapt-Variable value_col: 效应量列名
adapt_vars <- list(
  input_data = 'data/line1_bulk/processed/deg_all.tsv',
  value_col = 'log2FC'
)

# Real-Data-Adapter: v1
# Project-Input: data/line1_bulk/processed/deg_all.tsv
seed_value <- Sys.getenv("BIOANALYS_SEED", unset = "")
if (nchar(seed_value) == 0) quit(status = 3)
set.seed(as.integer(seed_value))
input_data <- "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line1_bulk/processed/deg_all.tsv"
output_file <- "L1_violin_verified.png"
if (!file.exists(input_data)) stop(paste("real input missing:", input_data))
dir.create(dirname(output_file), recursive = TRUE, showWarnings = FALSE)

# Real-data differential-effect violin overlay
suppressPackageStartupMessages({library(ggplot2)})
deg <- read.delim(input_data, check.names = FALSE)
value_col <- if (is.null(adapt_vars$value_col) || !nzchar(adapt_vars$value_col)) "log2FC" else adapt_vars$value_col
required <- c(value_col, "adj_P_Val")
if (!all(required %in% names(deg))) stop(paste("violin input columns missing:", paste(required, collapse = " / ")))
deg$value <- as.numeric(deg[[value_col]])
deg$direction <- ifelse(deg$adj_P_Val < 0.05 & deg$value > 0, "Up",
                 ifelse(deg$adj_P_Val < 0.05 & deg$value < 0, "Down", "NS"))
deg <- deg[is.finite(deg$value), , drop = FALSE]
plot <- ggplot(deg, aes(x = direction, y = value, fill = direction)) +
  geom_hline(yintercept = 0, linetype = "dashed", linewidth = 0.3, colour = "grey55") +
  geom_violin(width = 0.75, scale = "width", linewidth = 0.3) +
  geom_boxplot(width = 0.12, outlier.shape = NA, linewidth = 0.25, fill = "white") +
  scale_fill_manual(values = c(Up = "#D55E00", Down = "#0072B2", NS = "grey75")) +
  labs(x = NULL, y = value_col) +
  theme_classic(base_size = 7) +
  theme(legend.position = "none")
ggsave(output_file, plot, width = 89, height = 60, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK violin rows=", nrow(deg), "
", sep = "")

quit(status = 0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
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
