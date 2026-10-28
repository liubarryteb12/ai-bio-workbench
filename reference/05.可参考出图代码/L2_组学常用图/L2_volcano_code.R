#!/usr/bin/env Rscript
# 图型：火山图
# 用途：同时展示差异表达倍数与显著性，区分上调、下调和不显著基因。
# 输入数据契约：data.frame 至少包含 gene、log2FC、pvalue 三列；本脚本内置可复现示例数据。
# 关键函数：ggplot2::geom_point()、ggplot2::geom_text_repel() 与 ggsave()。
set.seed(42)
suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
})

n <- 4000
de <- data.frame(
  gene = paste0("GENE", seq_len(n)),
  log2FC = rnorm(n, 0, 1.2),
  pvalue = runif(n)
)
de$padj <- p.adjust(de$pvalue, method = "BH")
de$sig <- ifelse(
  de$padj < 0.05 & de$log2FC > 1,
  "Up",
  ifelse(de$padj < 0.05 & de$log2FC < -1, "Down", "NS")
)
top <- de[order(de$padj), ][seq_len(8), ]

p <- ggplot(de, aes(x = log2FC, y = -log10(pvalue))) +
  geom_point(aes(colour = sig), size = 0.9, alpha = 0.7) +
  scale_colour_manual(values = c("Up" = "#D55E00", "Down" = "#0072B2", "NS" = "grey70")) +
  geom_vline(
    xintercept = c(-1, 1),
    linetype = "dashed",
    linewidth = 0.4,
    colour = "grey30"
  ) +
  geom_hline(
    yintercept = -log10(0.05),
    linetype = "dashed",
    linewidth = 0.4,
    colour = "grey30"
  ) +
  geom_text_repel(
    data = top,
    aes(label = gene),
    size = 2.2,
    max.overlaps = 20,
    box.padding = 0.4,
    segment.size = 0.3
  ) +
  labs(x = "log2(Fold Change)", y = "-log10(P)") +
  theme_classic(base_size = 7) +
  theme(legend.position = "none")

ggsave("L2_volcano_verified.pdf", plot = p, width = 89, height = 75, units = "mm")
ggsave(
  "L2_volcano_verified.png",
  plot = p,
  width = 89,
  height = 75,
  units = "mm",
  dpi = 300,
  device = png,
  type = "cairo"
)
cat("RENDER_OK volcano\n")
