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
