set.seed(42)
suppressPackageStartupMessages({library(ggplot2); library(ggrepel)})

# ---------- L2-01 火山图 ----------
# 黄金数据集：合成基准必须同时含上调、下调与不显著三档点，否则红蓝两色在图上
# 永远不会出现（纯 runif 的 p 经 BH 校正后最小值约 0.54，一个显著点都没有）。
# 因此显式注入 240 个确定性显著基因，再交给 BH 校正，让三档点都真实落在图上。
set.seed(42)
n <- 4000
n_up <- 120L
n_down <- 120L
de <- data.frame(
  gene = paste0("GENE", seq_len(n)),
  log2FC = rnorm(n, 0, 1.2),
  pvalue = runif(n)
)
de$log2FC[seq_len(n_up)] <- runif(n_up, 1.6, 3.2)
de$log2FC[n_up + seq_len(n_down)] <- -runif(n_down, 1.5, 3.0)
de$pvalue[seq_len(n_up + n_down)] <- 10^runif(n_up + n_down, -8, -3)
de$padj <- p.adjust(de$pvalue, method = "BH")
fc_cut <- 1
p_cut <- 0.05
de$sig <- ifelse(de$padj < p_cut & de$log2FC > fc_cut, "Up",
          ifelse(de$padj < p_cut & de$log2FC < -fc_cut, "Down", "NS"))
de$sig <- factor(de$sig, levels = c("Up", "NS", "Down"))
sig_counts <- table(de$sig)
legend_labels <- c(
  Up = sprintf("Up (n=%d)", as.integer(sig_counts[["Up"]])),
  NS = sprintf("NS (n=%d)", as.integer(sig_counts[["NS"]])),
  Down = sprintf("Down (n=%d)", as.integer(sig_counts[["Down"]]))
)
# 标注取显著基因里最显著的 4 个上调 + 4 个下调，避免全挤在同一簇导致标签互压
top_up <- head(de[de$sig == "Up", ][order(de$padj), ], 3)
top_down <- head(de[de$sig == "Down", ][order(de$padj), ], 3)
top <- rbind(top_up, top_down)
n_sig <- sum(de$sig != "NS")
y_max <- max(-log10(de$pvalue), na.rm = TRUE)
x_span <- diff(range(de$log2FC, na.rm = TRUE))
p <- ggplot(de, aes(x = log2FC, y = -log10(pvalue))) +
  geom_point(aes(colour = sig), size = 0.9, alpha = 0.72) +
  scale_colour_manual(values = c(Up = "#EE0000", NS = "#BEBEBE", Down = "#3B4992"),
                      labels = legend_labels, drop = FALSE, name = NULL) +
  scale_y_continuous(expand = expansion(mult = c(0.02, 0.32))) +
  geom_vline(xintercept = c(-fc_cut, fc_cut), linetype = "dashed", linewidth = 0.4, colour = "grey35") +
  geom_hline(yintercept = -log10(p_cut), linetype = "dashed", linewidth = 0.4, colour = "grey35") +
  annotate("text", x = min(de$log2FC, na.rm = TRUE) + 0.02 * x_span,
           y = -log10(p_cut) + 0.04 * y_max, label = sprintf("adj p=%g", p_cut),
           hjust = 0, vjust = 0, size = 2.8) +
  annotate("text", x = fc_cut, y = y_max * 1.30, label = sprintf("log2FC=%g", fc_cut),
           angle = 90, hjust = 1, vjust = 0, size = 2.8) +
  annotate("text", x = -fc_cut, y = y_max * 1.30, label = sprintf("log2FC=-%g", fc_cut),
           angle = 90, hjust = 1, vjust = 0, size = 2.8) +
  # 基因名向点簇外侧（上调向右、下调向左）偏置后再避让，避免标签压在点云与阈值标注上
  geom_text_repel(data = top, aes(label = gene), size = 2.8, max.overlaps = Inf,
                  nudge_x = ifelse(top$sig == "Up", 2.1, -2.1), nudge_y = 0.8,
                  direction = "both", box.padding = 0.5, point.padding = 0.3,
                  min.segment.length = 0, seed = 42,
                  segment.size = 0.3, segment.colour = "grey55", force = 2) +
  labs(x = "log2(Fold Change)", y = "-log10(adjusted P)",
       caption = paste("line: master volcano (golden data)",
                       sprintf("threshold |log2FC|>%g & adj p<%g", fc_cut, p_cut),
                       sprintf("%d genes, %d significant", nrow(de), n_sig),
                       "red = up, blue = down, grey = NS", sep = "\n")) +
  theme_classic(base_size = 8) +
  theme(legend.position = "right",
        legend.frame = element_blank(),
        legend.text = element_text(size = 8),
        legend.title = element_blank(),
        plot.caption.position = "plot",
        plot.caption = element_text(hjust = 0, size = 8))
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
