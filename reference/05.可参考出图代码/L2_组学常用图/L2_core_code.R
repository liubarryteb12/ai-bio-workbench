set.seed(42)
suppressPackageStartupMessages({library(ggplot2); library(ggrepel)})

# ---------- L2-01 火山图 ----------
n <- 4000
de <- data.frame(
  gene = paste0("GENE", 1:n),
  log2FC = rnorm(n, 0, 1.2),
  pvalue = runif(n)
)
de$padj <- p.adjust(de$pvalue, method = "BH")
de$sig <- ifelse(de$padj < 0.05 & de$log2FC > 1, "Up",
          ifelse(de$padj < 0.05 & de$log2FC < -1, "Down", "NS"))
top <- de[order(de$padj), ][1:8, ]
p <- ggplot(de, aes(x = log2FC, y = -log10(pvalue))) +
  geom_point(aes(colour = sig), size = 0.9, alpha = 0.7) +
  scale_colour_manual(values = c("Up" = "#D55E00", "Down" = "#0072B2", "NS" = "grey70")) +
  geom_vline(xintercept = c(-1, 1), linetype = "dashed", linewidth = 0.4, colour = "grey30") +
  geom_hline(yintercept = -log10(0.05), linetype = "dashed", linewidth = 0.4, colour = "grey30") +
  geom_text_repel(data = top, aes(label = gene), size = 2.2, max.overlaps = 20,
                  box.padding = 0.4, segment.size = 0.3) +
  labs(x = "log2(Fold Change)", y = "-log10(P)") +
  theme_classic(base_size = 7) + theme(legend.position = "none")
ggsave("L2_volcano_verified.pdf", p, width = 89, height = 75, units = "mm")
ggsave("L2_volcano_verified.png", p, width = 89, height = 75, units = "mm", dpi = 300, device = png, type = "cairo")
cat("RENDER_OK volcano\n")

# ---------- L2-02 富集气泡图 ----------
set.seed(42)
k <- 15
en <- data.frame(
  term = paste0("PATHWAY_", 1:k),
  geneRatio = runif(k, 0.05, 0.45),
  Count = sample(5:120, k),
  padj = 10^runif(k, -6, -1)
)
p <- ggplot(en, aes(x = geneRatio, y = reorder(term, geneRatio), size = Count, colour = padj)) +
  geom_point(alpha = 0.85) +
  scale_colour_gradientn(colours = c("#0072B2", "#56B4E9", "#E69F00", "#D55E00"),
                         trans = "log10", name = "adj.P") +
  labs(x = "Gene ratio", y = NULL) + theme_classic(base_size = 7)
ggsave("L2_enrichment_verified.pdf", p, width = 89, height = 85, units = "mm")
ggsave("L2_enrichment_verified.png", p, width = 89, height = 85, units = "mm", dpi = 300, device = png, type = "cairo")
cat("RENDER_OK enrichment\n")

# ---------- L2-03 差异热图（ComplexHeatmap，viridis 连续色） ----------
suppressPackageStartupMessages({library(ComplexHeatmap); library(viridis); library(circlize)})
set.seed(42)
m <- matrix(rnorm(30 * 8, 0, 1.5), nrow = 30, ncol = 8)
colnames(m) <- paste0("S", 1:8)
rownames(m) <- paste0("GENE", 1:30)
grp <- rep(c("Ctrl", "Treat"), each = 4)
pdf("L2_heatmap_verified.pdf", width = 183/25.4, height = 120/25.4)
ht <- Heatmap(m, name = "Z", col = viridis(100),
              cluster_rows = TRUE, cluster_columns = TRUE,
              top_annotation = HeatmapAnnotation(Group = grp),
              row_title = NULL, column_title = NULL,
              heatmap_legend_param = list(title = "Z"))
draw(ht)
dev.off()
cat("RENDER_OK heatmap\n")
