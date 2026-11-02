#!/usr/bin/env Rscript
# L1 P0 门面四件套（一次进程出 3 张验证图）
#
# 设计（2026-11-02，4 Argon 第十一轮第 2 节批次 A 裁定）：
#   - 仿 L1_rest_code.R 的「1 runner 出多图」既有范式，摊薄 proot 里 R 冷启动与
#     包加载开销（ggridges / UpSetR / VennDiagram 三包加载约 6 秒，分三次跑要付三遍）；
#   - 三张图各自独立纯函数，每张前清空设备，单图崩盘不连坐其余两张；
#   - 确定性：单一 seed 派生合成数据，不读外部文件，跨机可复现；
#   - 落盘后逐一校验存在且 >4KB，任一缺失即非零退出（防「runner 成功但图没出」的静默假绿）；
#   - VennDiagram 默认会在当前目录生成 VennDiagram.<timestamp>.log，污染工作区并可能
#     触发 git status 脏检查（4 Argon 第十一轮点名的坑），调用前必须关掉它的日志。

SEED <- as.integer(Sys.getenv("BIOANALYS_SEED", "20261013"))
set.seed(SEED)

suppressPackageStartupMessages({
  library(ggplot2)
  library(ggridges)
  library(UpSetR)
  library(VennDiagram)
  library(futile.logger)
})

# VennDiagram 的日志文件开关：必须在任何 venn.diagram() 调用之前关掉
flog.threshold(ERROR, name = "VennDiagramLogger")

FIG_W_MM <- 89
FIG_H_MM <- 75

failures <- character(0)

check_artifact <- function(path, label) {
  if (!file.exists(path)) {
    failures[[length(failures) + 1]] <<- sprintf("%s: missing %s", label, path)
    return(FALSE)
  }
  bytes <- file.info(path)$size
  if (is.na(bytes) || bytes <= 4096) {
    failures[[length(failures) + 1]] <<- sprintf("%s: artifact too small (%sB)", label, bytes)
    return(FALSE)
  }
  cat(sprintf("RENDER_OK %s file=%s bytes=%d\n", label, path, bytes))
  TRUE
}

# ── 图 1：GSEA NES 分布山脊图（绑 l1_enrich_bulk / enrichment_gsea_go.tsv）──
# 合成形态：每个对比组一条 NES 密度脊，正负两侧对称，便于肉眼核对门面效果
render_ridgeline <- function(out) {
  n_sets <- 240
  contrasts <- c("Ctrl_vs_Treat", "Treat_vs_Resist", "Early_vs_Late", "Mut_vs_WT")
  nes <- do.call(rbind, lapply(seq_along(contrasts), function(i) {
    data.frame(
      contrast = contrasts[i],
      nes = rnorm(n_sets, mean = c(0.15, -0.35, 0.42, 0.05)[i], sd = 0.75),
      stringsAsFactors = FALSE
    )
  }))
  p <- ggplot(nes, aes(x = nes, y = contrast, fill = contrast)) +
    geom_density_ridges(scale = 1.6, rel_min_height = 0.02, alpha = 0.72,
                        colour = "grey25", linewidth = 0.35) +
    scale_fill_manual(values = c("#0072B2", "#D55E00", "#009E73", "#CC79A7")) +
    geom_vline(xintercept = 0, linetype = "dashed", linewidth = 0.4, colour = "grey40") +
    labs(x = "Normalized enrichment score (NES)", y = NULL,
         title = "GSEA NES distribution by contrast") +
    theme_classic(base_size = 7) +
    theme(legend.position = "none",
          plot.title = element_text(size = 7.5))
  ggsave(out, p, width = FIG_W_MM, height = FIG_H_MM, units = "mm",
         dpi = 300, device = png, type = "cairo")
  check_artifact(out, "ridgeline")
}

# ── 图 2：多对比组 DEG 交集 UpSet（绑 l1_de_limma / deg_sig.tsv）──
render_upset <- function(out) {
  n_universe <- 320
  universe <- sprintf("GENE%03d", 1:n_universe)
  contrasts <- c("T1", "T2", "T3", "T4", "T5")
  core <- sample(universe, 28)  # 共享核心，制造多组交集
  deg_sets <- setNames(lapply(seq_along(contrasts), function(i) {
    unique(c(sample(universe, 62), core))
  }), paste0(contrasts, "_vs_Ctrl"))

  # UpSetR 吃 list of gene vectors 比吃 0/1 data.frame 稳：overlap 由它自己算
  # upset() 返回的是一个 upset 对象，不会自己画。直接调用会画到当前设备外，
  # 落盘只剩空白画布（实测 1018B）。必须显式 print()（探针实测 378B -> 6873B）。
  png(out, width = FIG_W_MM, height = FIG_H_MM, units = "mm", res = 300, type = "cairo")
  up <- upset(fromList(deg_sets), nsets = length(deg_sets), nintersects = 20,
              order.by = "freq", keep.order = TRUE,
              main.bar.color = "#0072B2", sets.bar.color = "#D55E00",
              matrix.color = "#333333", shade.color = "#EEEEEE",
              text.scale = c(1.1, 1.0, 1.0, 0.9, 1.0, 0.9),
              mainbar.y.label = "Intersection size",
              sets.x.label = "DEGs per contrast")
  print(up)
  invisible(grDevices::dev.off())
  check_artifact(out, "upset")
}

# ── 图 3：前 3 组对比韦恩图（绑 l1_de_limma / deg_sig.tsv）──
render_venn <- function(out) {
  universe <- sprintf("GENE%03d", 1:320)
  g1 <- sample(universe, 96)
  g2 <- sample(universe, 84)
  g3 <- sample(universe, 72)
  # 让三组共享一段核心，避免纯随机导致的空交集
  core <- sample(universe, 30)
  g1 <- unique(c(g1, core))
  g2 <- unique(c(g2, core))
  g3 <- unique(c(g3, core))

  png(out, width = FIG_W_MM, height = FIG_H_MM, units = "mm", res = 300, type = "cairo")
  grid::grid.newpage()
  venn.plot <- venn.diagram(
    x = list(T1_vs_Ctrl = g1, T2_vs_Ctrl = g2, T3_vs_Ctrl = g3),
    filename = NULL,
    fill = c("#0072B2", "#D55E00", "#009E73"),
    alpha = 0.55,
    cex = 1.1,
    cat.cex = 0.9,
    cat.col = c("#0072B2", "#D55E00", "#009E73"),
    margin = 0.08,
    disable.logging = TRUE
  )
  grid::grid.draw(venn.plot)
  invisible(grDevices::dev.off())
  check_artifact(out, "venn")
}

# ── 图 4：样本相关性矩阵（合成版，供 verified preview；真实版在适配器里）──
render_correlogram <- function(out) {
  suppressPackageStartupMessages({library(corrplot)})
  n_sample <- 16
  n_gene <- 400
  base <- matrix(rnorm(n_gene * n_sample), nrow = n_gene)
  group_shift <- rep(seq(-1.2, 1.2, length.out = n_sample), each = 1)
  base <- base + matrix(rep(group_shift, each = n_gene), nrow = n_gene)
  colnames(base) <- sprintf("S%02d", 1:n_sample)
  cor_mat <- stats::cor(base)
  png(out, width = 120, height = 110, units = "mm", res = 300, type = "cairo")
  corrplot::corrplot(cor_mat, method = "color", type = "upper", order = "hclust",
                     hclust.method = "ward.D2", addrect = 3, rect.col = "#333333",
                     tl.col = "#333333", tl.cex = 0.5, tl.srt = 45,
                     col = colorRampPalette(c("#0072B2", "white", "#D55E00"))(200))
  invisible(grDevices::dev.off())
  check_artifact(out, "correlogram")
}

# ── 图 5：DEG 多维气泡图（合成版，供 verified preview）──
render_bubble <- function(out) {
  suppressPackageStartupMessages({library(ggplot2); library(ggrepel)})
  n_gene <- 300
  fc <- rng_fc <- stats::rnorm(n_gene, 0, 1.4)
  pval <- stats::runif(n_gene, 1e-6, 0.9)
  expr <- stats::runif(n_gene, 4, 12)
  df <- data.frame(gene = sprintf("GENE%03d", 1:n_gene), fc = fc, p = pval, expr = expr)
  df$tier <- ifelse(df$fc < -1 | df$fc > 1, "significant", "ns")
  lab <- head(df[order(abs(df$fc), decreasing = TRUE), ], 12)
  p <- ggplot(df, aes(x = fc, y = -log10(p))) +
    geom_point(aes(size = expr, colour = tier), alpha = 0.6) +
    geom_text_repel(data = lab, aes(label = gene), size = 1.8, max.overlaps = 20,
                    min.segment.length = 0.2, segment.size = 0.2) +
    scale_colour_manual(values = c(significant = "#D55E00", ns = "#9E9E9E")) +
    scale_size_continuous(range = c(0.3, 3.2), guide = "none") +
    labs(x = "log2(fold change)", y = "-log10(p)", colour = NULL) +
    theme_classic(base_size = 8) + theme(legend.position = "none")
  ggsave(out, p, width = 89, height = 75, units = "mm", dpi = 300,
         device = png, type = "cairo", bg = "white")
  check_artifact(out, "bubble")
}

JOBS <- list(
  list("ridgeline", "L1_ridgeline_verified.png", render_ridgeline),
  list("upset", "L1_upset_verified.png", render_upset),
  list("venn", "L1_venn_verified.png", render_venn),
  list("correlogram", "L1_correlogram_verified.png", render_correlogram),
  list("bubble", "L1_bubble_verified.png", render_bubble)
)

main <- function() {
  for (job in JOBS) {
    label <- job[[1]]
    filename <- job[[2]]
    fn <- job[[3]]
    tryCatch(
      fn(filename),
      error = function(e) {
        failures[[length(failures) + 1]] <<- sprintf("%s: %s", label, conditionMessage(e))
      }
    )
  }
  # 兜底：关掉可能残留的 VennDiagram 日志文件
  junk <- list.files(pattern = "^VennDiagram_.*\\.log$")
  if (length(junk)) {
    file.remove(junk)
    cat(sprintf("CLEANED venn logs: %d\n", length(junk)))
  }
  if (length(failures)) {
    cat("L1_P0_GALLERY_FAIL ", paste(failures, collapse = " | "), "\n", sep = "", file = stderr())
    return(1L)
  }
  cat(sprintf("L1_P0_GALLERY_OK seed=%d figures=%d\n", SEED, length(JOBS)))
  0L
}

quit(status = main())
