#!/usr/bin/env Rscript
# 图型：富集气泡图
# 用途：展示通路或功能条目的基因比例、命中数量与校正后显著性。
# 输入数据契约：data.frame 至少包含 term、geneRatio、Count 与 padj 四列。
# 关键函数：ggplot2::geom_point()、连续色标 scale_colour_gradientn() 与 ggsave()。
set.seed(42)
suppressPackageStartupMessages(library(ggplot2))

k <- 15
en <- data.frame(
  term = paste0("PATHWAY_", seq_len(k)),
  geneRatio = runif(k, 0.05, 0.45),
  Count = sample(5:120, k),
  padj = 10^runif(k, -6, -1)
)

p <- ggplot(
  en,
  aes(x = geneRatio, y = reorder(term, geneRatio), size = Count, colour = padj)
) +
  geom_point(alpha = 0.85) +
  scale_colour_gradientn(
    colours = c("#0072B2", "#56B4E9", "#E69F00", "#D55E00"),
    trans = "log10",
    name = "adj.P"
  ) +
  labs(x = "Gene ratio", y = NULL) +
  theme_classic(base_size = 7)

ggsave("L2_enrichment_verified.pdf", plot = p, width = 89, height = 85, units = "mm")
ggsave(
  "L2_enrichment_verified.png",
  plot = p,
  width = 89,
  height = 85,
  units = "mm",
  dpi = 300,
  device = png,
  type = "cairo"
)
cat("RENDER_OK enrichment\n")
