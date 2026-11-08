# Master-Source: reference/05.可参考出图代码/_meta/R453_compat/L2_more_code.R | Master-SHA256: 0b5342dd0cac39eb87615aa1220d44c09c440b8801e93af288d9ab778f0c6c1d
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line1_bulk
# Adapt-Variable input_data: 项目本线只读输入文件路径，相对于本项目根目录
# Adapt-Variable group_col: 细胞或样本分组列名
adapt_vars <- list(
  input_data = 'data/line1_bulk/processed/pca_scores.tsv',
  group_col = 'group'
)

# Real-Data-Adapter: v1
# Project-Input: data/line1_bulk/processed/pca_scores.tsv
seed_value <- Sys.getenv("BIOANALYS_SEED", unset = "")
if (nchar(seed_value) == 0) quit(status = 3)
set.seed(as.integer(seed_value))
input_data <- "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line1_bulk/processed/pca_scores.tsv"
output_file <- "L2_pca_verified.png"
if (!file.exists(input_data)) stop(paste("real input missing:", input_data))
dir.create(dirname(output_file), recursive = TRUE, showWarnings = FALSE)

# Real-data PCA overlay
suppressPackageStartupMessages({library(ggplot2)})
pca_df <- read.delim(input_data, check.names = FALSE)
group_name <- if (is.null(adapt_vars$group_col) || !nzchar(adapt_vars$group_col)) "group" else adapt_vars$group_col
if (!all(c("PC1", "PC2", group_name) %in% names(pca_df))) {
  stop(paste("PCA input columns missing:", group_name, "PC1", "PC2"))
}
pca_df[[group_name]] <- factor(pca_df[[group_name]])
group_sizes <- table(pca_df[[group_name]])
pca_plot <- ggplot(pca_df, aes(x = PC1, y = PC2, colour = .data[[group_name]])) +
  geom_point(size = 1.8, alpha = 0.9) +
  labs(colour = group_name, x = "PC1", y = "PC2") +
  theme_classic(base_size = 8)
if (length(group_sizes) > 1 && all(group_sizes >= 3)) {
  pca_plot <- pca_plot + stat_ellipse(linewidth = 0.45, level = 0.95)
}
ggsave(output_file, pca_plot, width = 89, height = 80, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK pca rows=", nrow(pca_df), "
", sep = "")

quit(status = 0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
suppressPackageStartupMessages({library(ComplexHeatmap); library(viridis)})
set.seed(42)
m <- matrix(rnorm(30 * 8, 0, 1.5), nrow = 30, ncol = 8)
colnames(m) <- paste0("S", 1:8); rownames(m) <- paste0("GENE", 1:30)
grp <- rep(c("Ctrl", "Treat"), each = 4)
png("L2_heatmap_verified.png", width = 183/25.4, height = 120/25.4, units = "in", res = 300, type = "cairo")
draw(Heatmap(m, name = "Z", col = viridis(100), cluster_rows = TRUE, cluster_columns = TRUE,
             top_annotation = HeatmapAnnotation(Group = grp),
             row_title = NULL, column_title = NULL,
             heatmap_legend_param = list(title = "Z")))
dev.off()
cat("RENDER_OK heatmap_png\n")

# ---------- L2-04 UMAP / 降维嵌入图 ----------
suppressPackageStartupMessages({library(ggplot2); library(scales)})
set.seed(42)
k <- 5; per <- 260
emb <- data.frame(
  UMAP1 = c(rnorm(per, -3, 1), rnorm(per, 3, 1), rnorm(per, 0, 1.2), rnorm(per, -2, 1), rnorm(per, 2.5, 1.1)),
  UMAP2 = c(rnorm(per, 0, 1), rnorm(per, 0, 1), rnorm(per, 3, 1), rnorm(per, -3, 1), rnorm(per, 2, 1.3)),
  ct = rep(paste0("CellType_", 1:k), each = per)
)
pal8 <- c("#0072B2","#D55E00","#009E73","#CC79A7","#E69F00")
p <- ggplot(emb, aes(x = UMAP1, y = UMAP2, colour = ct)) +
  geom_point(size = 0.35, alpha = 0.9) +
  scale_colour_manual(values = pal8) +
  labs(x = "UMAP_1", y = "UMAP_2") +
  theme_classic(base_size = 7) +
  theme(legend.text = element_text(size = 6), legend.key.height = unit(0.4, "lines"))
ggsave("L2_umap_verified.pdf", p, width = 183, height = 90, units = "mm")
ggsave("L2_umap_verified.png", p, width = 183, height = 90, units = "mm", dpi = 300, device = png, type = "cairo")
cat("RENDER_OK umap\n")

# ---------- L2-05 PCA 图 ----------
set.seed(42)
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
ggsave("L2_pca_verified.pdf", p, width = 89, height = 80, units = "mm")
ggsave("L2_pca_verified.png", p, width = 89, height = 80, units = "mm", dpi = 300, device = png, type = "cairo")
cat("RENDER_OK pca\n")
