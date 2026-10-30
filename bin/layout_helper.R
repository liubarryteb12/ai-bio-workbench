# layout_helper.R — 单图 SCI 排版外挂装饰器（R 端，reference/03出图规范 v3.0）
#
# 零重写原则：母版 ggplot 出图脚本不改绘图主干，画完 `p` 后调用本函数叠加主题层，
# 再 ggsave。与 Python 端 ops/layout_helper.py 的两档画幅同值，
# 差异只在"用什么方式表达"：ggplot 靠 theme() 图层，matplotlib 靠属性设置。
#
# 2026-10-19 用户拍板：客户端只保留 4:3 / 16:9 两档，原三套模板
# （nature_side / cell_wide / clinical_note）收敛为按画幅比驱动的两档；
# 旧 id 仍可读入并映射到新 id（见 LAYOUT_LEGACY_TEMPLATES），保证已交付项目的
# project.json 不改也能拿到逐字段相同的规则。
#
# 用法：
#   source("/mnt/ssd/bio_data/bin/layout_helper.R")
#   spec <- load_layout_spec_r(Sys.getenv("PROJECT_JSON"))
#   p <- apply_sci_plot_layout_r(p, spec,
#          footnote_text = "Wilcoxon test; adj p<0.05; n=16",
#          badge_text = "[Virtual KO - DR Genes]")
#   layout_save_r(p, "l1_01_pca.png", spec)
#
# 注意：分面（facet）图不要套用。统一搬图例会把各分面挤扁。

LAYOUT_TEMPLATES <- list(
  template_4x3 = list(
    aspect_ratio = "4:3",
    legend_position = "outside_right",
    legend_direction = "vertical",
    axis_style = "classic_L",
    x_label_rotation = "horizontal",
    show_footnote_panel = FALSE
  ),
  template_16x9 = list(
    aspect_ratio = "16:9",
    legend_position = "bottom_center",
    legend_direction = "horizontal",
    axis_style = "classic_L",
    x_label_rotation = "horizontal",
    show_footnote_panel = FALSE
  )
)

LAYOUT_DEFAULT_TEMPLATE <- "template_4x3"

# 旧 id 兼容：收敛成两档前 project.json 里落的是这三套 id。
# 旧 id 先映射到新 id 再查表——映射后规则逐字段相同，落盘图件必须字节级不变。
LAYOUT_LEGACY_TEMPLATES <- c(
  template_1_nature_side   = "template_4x3",
  template_2_cell_wide     = "template_16x9",
  template_3_clinical_note = "template_4x3"
)

# 画幅基准与 Python 端一致：默认单栏 88 mm，高按比例推。
# 参考图或项目显式给出双栏尺寸时，由 preserve 环境变量锁住脚本原尺寸。
LAYOUT_BASE_WIDTH_IN <- 88 / 25.4
LAYOUT_ASPECT <- list("4:3" = c(4, 3), "16:9" = c(16, 9),
                      "3:2" = c(3, 2), "1:1" = c(1, 1))

#' 归一化排版配置：接受 NULL / jsonlite 解析出的 list / 只有 template_id 的简写
#'
#' 旧 id（template_1_nature_side / template_2_cell_wide / template_3_clinical_note）
#' 先映射到新 id 再查表：已交付项目的 project.json 不改也能拿到逐字段相同的规则。
normalize_layout_spec_r <- function(spec = NULL) {
  spec <- if (is.list(spec)) spec else list()
  template_id <- spec$template_id
  if (is.null(template_id)) template_id <- spec$templateId
  template_id <- if (is.null(template_id)) "" else trimws(as.character(template_id)[1])
  if (template_id %in% names(LAYOUT_LEGACY_TEMPLATES)) {
    template_id <- unname(LAYOUT_LEGACY_TEMPLATES[[template_id]])
  }
  if (!(template_id %in% names(LAYOUT_TEMPLATES))) {
    template_id <- LAYOUT_DEFAULT_TEMPLATE
  }
  rules <- LAYOUT_TEMPLATES[[template_id]]
  incoming <- spec$theme_rules
  if (is.list(incoming)) {
    # 只接受已知键，外部配置不能往 theme() 里塞任意参数
    for (key in names(rules)) {
      if (!is.null(incoming[[key]])) rules[[key]] <- incoming[[key]]
    }
  }
  dpi <- spec$dpi
  if (is.null(dpi) || is.na(suppressWarnings(as.numeric(dpi)))) dpi <- 300
  list(template_id = template_id, dpi = as.numeric(dpi), theme_rules = rules)
}

#' 从 project.json 读 plot_layout_config；文件缺失或解析失败一律回落默认模板
load_layout_spec_r <- function(project_json_path = NULL) {
  empty <- normalize_layout_spec_r(NULL)
  if (is.null(project_json_path) || !nzchar(project_json_path)) return(empty)
  if (!file.exists(project_json_path)) return(empty)
  if (!requireNamespace("jsonlite", quietly = TRUE)) return(empty)
  project <- tryCatch(
    jsonlite::fromJSON(project_json_path, simplifyVector = FALSE),
    error = function(e) NULL
  )
  if (is.null(project)) return(empty)
  normalize_layout_spec_r(project$plot_layout_config)
}

#' 按模板算 ggsave 尺寸（英寸）
layout_figsize_r <- function(spec = NULL) {
  rules <- normalize_layout_spec_r(spec)$theme_rules
  ratio <- rules$aspect_ratio
  if (is.null(ratio) || !(ratio %in% names(LAYOUT_ASPECT))) ratio <- "4:3"
  units <- LAYOUT_ASPECT[[ratio]]
  c(LAYOUT_BASE_WIDTH_IN, round(LAYOUT_BASE_WIDTH_IN * units[2] / units[1], 3))
}

#' 从已构建的 ggplot 里取 x 轴标签文本；取不到返回 character(0)
layout_x_labels <- function(p) {
  labels <- tryCatch({
    built <- ggplot2::ggplot_build(p)
    panel <- built$layout$panel_params[[1]]
    if (!is.null(panel$x$get_labels)) panel$x$get_labels() else panel$x$breaks
  }, error = function(e) character(0))
  as.character(labels)
}

#' 主入口：对 ggplot 对象叠加模板主题层
#'
#' @param p ggplot 对象（单坐标轴图）
#' @param layout_spec project.json 的 plot_layout_config，或 NULL
#' @param footnote_text 脚注（统计方法 / 阈值 / 样本量）
#' @param badge_text 业务强角标，如 "[Virtual KO - DR Genes]"
#' @param title 覆盖标题（NULL 时保留原图标题）
apply_sci_plot_layout_r <- function(p, layout_spec = NULL, footnote_text = NULL,
                                    badge_text = NULL, title = NULL) {
  if (!requireNamespace("ggplot2", quietly = TRUE)) {
    stop("layout_helper.R 需要 ggplot2")
  }
  normalized <- normalize_layout_spec_r(layout_spec)
  rules <- normalized$theme_rules

  position <- rules$legend_position
  if (identical(position, "bottom_center")) {
    legend_position <- "bottom"
    legend_direction <- "horizontal"
    legend_box <- "horizontal"
  } else {
    # 右侧外挂：ggplot 的 legend.position="right" 本身就在面板外，
    # 不需要像 matplotlib 那样手动算 bbox
    legend_position <- "right"
    legend_direction <- "vertical"
    legend_box <- "vertical"
  }

  # 单图规范禁止 45 度刻度标签；长名称交给换行或横向条形图。
  angle <- 0
  hjust <- 0.5
  rotation_mode <- rules$x_label_rotation
  if (identical(rotation_mode, "45") || identical(rotation_mode, "auto_45")) {
    angle <- 0
    hjust <- 0.5
  }

  if (identical(rules$axis_style, "classic_L")) {
    p <- p + ggplot2::theme_classic()
  } else {
    p <- p + ggplot2::theme_bw()
  }

  p <- p + ggplot2::theme(
    legend.position = legend_position,
    legend.direction = legend_direction,
    legend.box = legend_box,
    legend.title = ggplot2::element_text(size = 7),
    legend.text = ggplot2::element_text(size = 6.5),
    legend.key = ggplot2::element_blank(),
    legend.key.size = ggplot2::unit(3, "mm"),
    axis.text.x = ggplot2::element_text(angle = angle, hjust = hjust, vjust = 0.5, size = 6.5),
    axis.text.y = ggplot2::element_text(size = 6.5),
    axis.title = ggplot2::element_text(size = 7),
    plot.title = ggplot2::element_blank(),
    plot.subtitle = ggplot2::element_blank(),
    axis.line = ggplot2::element_line(linewidth = 0.5 / 2.845276),
    axis.ticks = ggplot2::element_line(linewidth = 0.5 / 2.845276),
    axis.ticks.length = ggplot2::unit(1.4, "mm"),
    panel.grid = ggplot2::element_blank(),
    plot.background = ggplot2::element_blank(),
    panel.background = ggplot2::element_blank(),
    plot.margin = ggplot2::margin(2, 2, 2, 2, unit = "mm")
  )

  if (identical(position, "bottom_center")) {
    # 底部预留图例空间，固定画布不靠 tight bbox 扩边。
    p <- p + ggplot2::theme(plot.margin = ggplot2::margin(2, 2, 8, 2, unit = "mm"))
  }

  if (!is.null(title)) {
    p <- p + ggplot2::labs(title = title)
  }

  # 单图图注写入 06_report 元数据，不画进画布。

  if (!is.null(badge_text) && nzchar(as.character(badge_text))) {
    p <- p + ggplot2::labs(tag = as.character(badge_text)) +
      ggplot2::theme(
        plot.tag = ggplot2::element_text(size = 7, face = "bold", colour = "#B22222"),
        plot.tag.position = c(1, 1)
      )
  }
  p
}

#' 便捷落盘：按模板尺寸与 dpi 保存，保持固定画布
layout_save_r <- function(p, filename, layout_spec = NULL, ...) {
  normalized <- normalize_layout_spec_r(layout_spec)
  size <- layout_figsize_r(normalized)
  ggplot2::ggsave(filename, plot = p, width = size[1], height = size[2],
                  dpi = normalized$dpi, bg = "white", ...)
}
