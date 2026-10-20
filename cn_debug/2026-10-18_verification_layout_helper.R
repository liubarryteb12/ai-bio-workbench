# layout_helper.R 三模板验证（在 k40-ubuntu 上跑，本机无 R）
#
# 判据与 Python 端验证一致：模板承诺的图例位置、X 轴倾斜、脚注、角标
# 都能从 ggplot 对象的 theme 字段读回来，不需要看图。
#
# 跑法：Rscript 2026-10-18_verification_layout_helper.R <layout_helper.R 路径> <输出目录>

args <- commandArgs(trailingOnly = TRUE)
helper_path <- if (length(args) >= 1) args[1] else "bin/layout_helper.R"
out_dir <- if (length(args) >= 2) args[2] else tempdir()

failed <- 0
check <- function(label, cond, detail = "") {
  ok <- isTRUE(cond)
  if (!ok) failed <<- failed + 1
  cat(sprintf("%s | %s%s\n", if (ok) "PASS" else "FAIL", label,
              if (nzchar(detail)) paste0(" | ", detail) else ""))
}

if (!requireNamespace("ggplot2", quietly = TRUE)) {
  cat("SKIP | 本机没有 ggplot2，无法验证 R 端装饰器\n")
  quit(status = 0)
}
suppressPackageStartupMessages(library(ggplot2))
source(helper_path)

# ---------- 1. 配置归一化 ----------
check("默认模板", normalize_layout_spec_r(NULL)$template_id == "template_1_nature_side")
check("非法模板回落默认",
      normalize_layout_spec_r(list(template_id = "nope"))$template_id == "template_1_nature_side")
check("camelCase 模板 id 可识别",
      normalize_layout_spec_r(list(templateId = "template_2_cell_wide"))$template_id == "template_2_cell_wide")
check("dpi 缺省 300", normalize_layout_spec_r(list())$dpi == 300)
check("读不存在的 project.json 不抛错",
      load_layout_spec_r("/tmp/no_such_project.json")$template_id == "template_1_nature_side")
check("theme_rules 只接受已知键",
      is.null(normalize_layout_spec_r(list(
        templateId = "template_1_nature_side",
        theme_rules = list(evil_key = "boom")))$theme_rules$evil_key))

# ---------- 2. 三模板叠加 + 真落盘 ----------
make_plot <- function() {
  labels <- c("Non_Lesional_Ctrl", "Lesional_Week2", "Lesional_Week4",
              "Lesional_Week8", "Treated_Week2", "Treated_Week4",
              "Treated_Week8", "Recurrence")
  df <- data.frame(group = factor(labels, levels = labels), n = seq_along(labels))
  ggplot(df, aes(x = group, y = n, fill = group)) +
    geom_col() +
    labs(title = "DEG counts by group", y = "Gene count", x = NULL) +
    theme(legend.position = "right")
}

for (tid in names(LAYOUT_TEMPLATES)) {
  p <- apply_sci_plot_layout_r(
    make_plot(), list(template_id = tid),
    footnote_text = "Wilcoxon rank-sum; adj p<0.05; n=16",
    badge_text = if (tid == "template_3_clinical_note") "[Virtual KO - DR Genes]" else NULL)

  size <- layout_figsize_r(list(template_id = tid))
  check(sprintf("%s 画幅 %.2f", tid, size[1] / size[2]),
        abs(size[1] / size[2] - (if (tid == "template_2_cell_wide") 16 / 9 else 4 / 3)) < 0.02,
        sprintf("%.2f x %.2f", size[1], size[2]))

  if (tid == "template_2_cell_wide") {
    check("模板2 图例在底部", identical(p$theme$legend.position, "bottom"))
    check("模板2 图例横向", identical(p$theme$legend.direction, "horizontal"))
    check("模板2 X 轴 45°", isTRUE(p$theme$axis.text.x$angle == 45))
    check("模板2 有脚注", !is.null(p$labels$caption))
  } else if (tid == "template_1_nature_side") {
    check("模板1 图例在右侧", identical(p$theme$legend.position, "right"))
    check("模板1 长标签触发 45°", isTRUE(p$theme$axis.text.x$angle == 45))
    check("模板1 无脚注", is.null(p$labels$caption))
  } else {
    check("模板3 图例在右侧", identical(p$theme$legend.position, "right"))
    check("模板3 X 轴水平", isTRUE(p$theme$axis.text.x$angle == 0))
    check("模板3 有脚注", !is.null(p$labels$caption))
    check("模板3 有角标", identical(p$labels$tag, "[Virtual KO - DR Genes]"))
  }

  out <- file.path(out_dir, sprintf("verify_%s.png", tid))
  layout_save_r(p, out, list(template_id = tid))
  check(sprintf("%s 落盘成功", tid), file.exists(out) && file.size(out) > 10000,
        sprintf("%d bytes", if (file.exists(out)) file.size(out) else 0))
}

# ---------- 3. 无标题 / 无脚注不崩 ----------
p_min <- ggplot(data.frame(x = 1:2, y = 2:1), aes(x, y)) + geom_point()
p_min <- apply_sci_plot_layout_r(p_min, NULL)
check("最小图不抛错", inherits(p_min, "ggplot"))

cat(sprintf("\n%s\n", if (failed == 0) "全部符合预期" else sprintf("%d 条不符合预期", failed)))
quit(status = if (failed == 0) 0 else 1)
