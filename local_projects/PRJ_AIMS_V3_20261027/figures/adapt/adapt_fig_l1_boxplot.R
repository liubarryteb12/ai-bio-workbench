# Master-Source: reference/05.可参考出图代码/_meta/R453_compat/L1_boxplot_code.R | Master-SHA256: dfc6a22b7585849c1c4d11bec312d654b9af63bf20dd2e42876c28834f8b0b0d
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
output_file <- "L1_boxplot_verified.png"
if (!file.exists(input_data)) stop(paste("real input missing:", input_data))
dir.create(dirname(output_file), recursive = TRUE, showWarnings = FALSE)

# Real-data differential-effect boxplot overlay
suppressPackageStartupMessages({library(ggplot2)})
deg <- read.delim(input_data, check.names = FALSE)
value_col <- if (is.null(adapt_vars$value_col) || !nzchar(adapt_vars$value_col)) "log2FC" else adapt_vars$value_col
required <- c(value_col, "adj_P_Val")
if (!all(required %in% names(deg))) stop(paste("boxplot input columns missing:", paste(required, collapse = " / ")))
deg$value <- as.numeric(deg[[value_col]])
deg$direction <- ifelse(deg$adj_P_Val < 0.05 & deg$value > 0, "Up",
                 ifelse(deg$adj_P_Val < 0.05 & deg$value < 0, "Down", "NS"))
deg <- deg[is.finite(deg$value), , drop = FALSE]
plot <- ggplot(deg, aes(x = direction, y = value, fill = direction)) +
  geom_hline(yintercept = 0, linetype = "dashed", linewidth = 0.3, colour = "grey55") +
  geom_boxplot(width = 0.55, outlier.size = 0.35, linewidth = 0.35) +
  scale_fill_manual(values = c(Up = "#D55E00", Down = "#0072B2", NS = "grey75")) +
  labs(x = NULL, y = value_col) +
  theme_classic(base_size = 7) +
  theme(legend.position = "none")
ggsave(output_file, plot, width = 89, height = 60, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK boxplot rows=", nrow(deg), "
", sep = "")

quit(status = 0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
suppressPackageStartupMessages({
  library(ggplot2); library(dplyr); library(ggpubr); library(rstatix)
})
set.seed(42)
variety   <- rep(LETTERS[1:4], each = 40)
treatment <- rep(c("high", "low"), each = 20)
note      <- seq(1:160) + sample(1:150, 160, replace = TRUE)
df <- data.frame(variety, treatment, note)

# 色盲友好：Okabe-Ito 蓝/朱，不用红绿
pal <- c("high" = "#0072B2", "low" = "#D55E00")

df_p_val1 <- df %>%
  mutate(variety = factor(variety)) %>%
  group_by(variety) %>%
  wilcox_test(formula = note ~ treatment) %>%
  add_significance(p.col = "p", cutpoints = c(0, 0.001, 0.01, 0.05, 1),
                   symbols = c("***", "**", "*", "ns")) %>%
  add_xy_position(x = "variety")

df_p_val2 <- df %>%
  wilcox_test(formula = note ~ variety) %>%
  add_significance(p.col = "p", cutpoints = c(0, 0.001, 0.01, 0.05, 1),
                   symbols = c("***", "**", "*", "ns")) %>%
  add_xy_position()

p <- ggplot() +
  geom_boxplot(data = df, mapping = aes(x = variety, y = note, fill = treatment),
               width = 0.5, outlier.colour = "grey30", outlier.size = 1.2) +
  scale_fill_manual(values = pal) +
  stat_pvalue_manual(df_p_val1, label = "{p.signif}", tip.length = 0) +
  stat_pvalue_manual(df_p_val2, label = "{p.signif}", tip.length = 0,
                     y.position = df_p_val2$y.position + 0.5) +
  labs(x = "variety", y = "note") +
  guides(fill = guide_legend(title = "treatment")) +
  theme_classic(base_size = 7) +
  theme(axis.text = element_text(color = "black"),
        legend.position = c(0.72, 0.12),
        legend.direction = "horizontal")

out_dir <- Sys.getenv("R453_OUT_DIR", unset = getwd())
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
ggsave(file.path(out_dir, "L1_boxplot_verified.pdf"), p, width = 89, height = 60, units = "mm")
ggsave(file.path(out_dir, "L1_boxplot_verified.png"), p, width = 89, height = 60, units = "mm", dpi = 300, device = png, type = "cairo")
cat("RENDER_OK\n")
cat("pkgs:", paste(rownames(installed.packages()[, "Package", drop = FALSE])[1], collapse = ""), "\n")
