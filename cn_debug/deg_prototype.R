# deg_limma 一次性原型：验证 limma 差异分析逻辑（LS vs NLS）
suppressPackageStartupMessages({library(data.table); library(limma); library(ggplot2)})

expr_file  <- "/mnt/ssd/bio_data/line1_bulk/processed/expr_genes.tsv"
group_file <- "/mnt/ssd/bio_data/line1_bulk/processed/group_map.tsv"
out_dir <- "/tmp/deg_proto"
dir.create(out_dir, showWarnings = FALSE)
seed <- "20261013"

fail <- function(message) {
  cat(sprintf("deg 自校验失败: %s\n", message), file = stderr())
  quit(status = 1)
}

expr <- fread(expr_file)
group_map <- fread(group_file)
samples <- setdiff(names(expr), "gene")
if (!setequal(samples, group_map$sample)) fail("样本集合与 group_map 不一致")
mat <- as.matrix(expr[, .SD, .SDcols = samples])
rownames(mat) <- expr$gene
groups <- factor(setNames(group_map$group, group_map$sample)[samples])
if (length(unique(groups)) != 2) fail("DEG 只支持两组比较")

set.seed(as.integer(seed))
design <- model.matrix(~ 0 + groups)
colnames(design) <- levels(groups)
fit <- lmFit(mat, design)
# 对照取字典序在后的组减前去的组：NLS - LS。log2FC 正 = NLS 高
contrast <- makeContrasts(contrasts = sprintf("%s-%s", levels(groups)[2], levels(groups)[1]), levels = design)
fit2 <- contrasts.fit(fit, contrast)
fit2 <- eBayes(fit2, trend = TRUE)
deg <- topTable(fit2, number = Inf, sort.by = "P")

deg_table <- data.table(
  gene = rownames(deg),
  log2FC = round(deg$logFC, 4),
  AveExpr = round(deg$AveExpr, 4),
  t = round(deg$t, 4),
  P.Value = signif(deg$P.Value, 4),
  adj_P_Val = signif(adj.P.Val_placeholder <- deg$adj.P.Val, 4)
)

logfc_cut <- 1
padj_cut <- 0.05
deg_table[, sig := abs(log2FC) > logfc_cut & adj_P_Val < padj_cut]
sig_table <- deg_table[sig == TRUE][order(adj_P_Val)]
fwrite(deg_table[, !"sig"], file.path(out_dir, "deg_all.tsv"), sep = "\t")
fwrite(sig_table[, !"sig"], file.path(out_dir, "deg_sig.tsv"), sep = "\t")

p <- ggplot(deg_table, aes(x = log2FC, y = -log10(P.Value))) +
  geom_point(aes(color = sig), alpha = 0.6, size = 1.2) +
  scale_color_manual(values = c("TRUE" = "#d62728", "FALSE" = "grey60")) +
  geom_vline(xintercept = c(-logfc_cut, logfc_cut), linetype = "dashed") +
  geom_hline(yintercept = -log10(padj_cut), linetype = "dashed") +
  labs(title = sprintf("Volcano: %s vs %s", levels(groups)[2], levels(groups)[1]),
       subtitle = sprintf("%d genes |log2FC|>%g & adj.P<%g", nrow(sig_table), logfc_cut, padj_cut)) +
  theme_classic(base_size = 12)
ggsave(file.path(out_dir, "deg_volcano.pdf"), p, width = 6, height = 5)

cat(sprintf("genes=%d sig=%d up=%d down=%d\n",
            nrow(deg_table), nrow(sig_table),
            sum(sig_table$log2FC > 0), sum(sig_table$log2FC < 0)))
cat(sprintf("top5: %s\n", paste(head(sig_table$gene, 5), collapse = ",")))
cat("volcano size:", file.info(file.path(out_dir, "deg_volcano.pdf"))$size, "\n")
print(head(sig_table, 10))
