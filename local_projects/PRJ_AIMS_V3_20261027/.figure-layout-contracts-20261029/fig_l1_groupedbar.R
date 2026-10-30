# Figure-Contract: width_mm=88; height_mm=60; dpi=300; column=single
# Master-Source: src/figure_sources/fig_l1_groupedbar.R | Master-SHA256: 015718932853bf38e7c4981275fa5f13b19f3115218687bd2b23976b075a51e1
# Catalog-ID: 215 | Catalog-Language: R | Source-Match: exact
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line1_bulk
# Adapt-Variable input_data: [object Object]
# Adapt-Variable x_col: [object Object]
# Adapt-Variable value_col: [object Object]
# Adapt-Variable group_col: [object Object]
adapt_vars <- list(
  input_data = 'data/line1_bulk/processed/enrichment_gsea_go.tsv',
  x_col = 'Description',
  value_col = 'NES',
  group_col = 'ont'
)

# Real-Data-Adapter: v1
# Project-Input: data/line1_bulk/processed/enrichment_gsea_go.tsv
seed_value <- Sys.getenv("BIOANALYS_SEED", unset = "")
if (nchar(seed_value) == 0) quit(status = 3)
set.seed(as.integer(seed_value))
Sys.setenv(
  BIOANALYS_LAYOUT_PRESERVE_FIGSIZE = "1",
  BIOANALYS_LAYOUT_FIXED_CANVAS = "1"
)
input_data <- "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line1_bulk/processed/enrichment_gsea_go.tsv"
output_file <- "figures/line1_bulk/L1_groupedbar_verified.png"
width_mm <- 88
height_mm <- 60
dpi <- 300
if (!file.exists(input_data)) stop(paste("real input missing:", input_data))
dir.create(dirname(output_file), recursive = TRUE, showWarnings = FALSE)

bioanalys_colors <- c(
  blue = "#0072B2", vermillion = "#D55E00", green = "#009E73",
  orange = "#E69F00", sky = "#56B4E9", purple = "#CC79A7",
  yellow = "#F0E442", grey = "#999999"
)

bioanalys_theme_single <- function(base_size = 7) {
  ggplot2::theme_classic(base_size = base_size, base_family = "sans") +
    ggplot2::theme(
      plot.title = ggplot2::element_blank(),
      plot.subtitle = ggplot2::element_blank(),
      text = ggplot2::element_text(colour = "black"),
      axis.title = ggplot2::element_text(size = 7, colour = "black"),
      axis.text = ggplot2::element_text(size = 6.5, colour = "black"),
      axis.line = ggplot2::element_line(linewidth = 0.5 / 2.845276, colour = "black"),
      axis.ticks = ggplot2::element_line(linewidth = 0.5 / 2.845276, colour = "black"),
      axis.ticks.length = ggplot2::unit(1.4, "mm"),
      legend.title = ggplot2::element_text(size = 7, colour = "black"),
      legend.text = ggplot2::element_text(size = 6.5, colour = "black"),
      legend.key.size = ggplot2::unit(3, "mm"),
      legend.background = ggplot2::element_blank(),
      legend.key = ggplot2::element_blank(),
      panel.background = ggplot2::element_blank(),
      plot.background = ggplot2::element_blank(),
      panel.grid = ggplot2::element_blank(),
      plot.margin = ggplot2::unit(c(2, 2, 2, 2), "mm")
    )
}

bioanalys_output_paths <- function(path) {
  stem <- sub("\\.png$", "", basename(path), ignore.case = TRUE)
  list(
    png = path,
    pdf = file.path(dirname(path), paste0(stem, ".pdf")),
    rds = file.path(dirname(path), paste0(stem, "_plot.rds")),
    report = file.path(dirname(path), paste0(stem, "_report.txt"))
  )
}

bioanalys_report <- function(paths, template_id, width_mm, height_mm, dpi, dims, stats = "") {
  lines <- c(
    "step_executed=adapt_figure",
    paste0("template_id=", template_id),
    paste0("seed=", Sys.getenv("BIOANALYS_SEED")),
    paste0("input_data=", input_data),
    paste0("line_id=", Sys.getenv("BIO_LINE_ID", unset = "unknown")),
    paste0("width_mm=", width_mm),
    paste0("height_mm=", height_mm),
    paste0("dpi=", dpi),
    dims,
    if (nzchar(stats)) stats else character(0),
    "palette=Okabe-Ito",
    "legend_position=outside",
    paste0("artifact_png=", basename(paths$png)),
    paste0("artifact_pdf=", basename(paths$pdf)),
    paste0("artifact_object=", basename(paths$rds))
  )
  writeLines(lines, paths$report)
  invisible(paths)
}

bioanalys_export_ggplot <- function(plot_obj, path, width_mm, height_mm, dpi = 300,
                                    template_id = "unknown", dims = "", stats = "") {
  paths <- bioanalys_output_paths(path)
  dir.create(dirname(paths$pdf), recursive = TRUE, showWarnings = FALSE)
  grDevices::cairo_pdf(paths$pdf, width = width_mm / 25.4, height = height_mm / 25.4, onefile = TRUE)
  print(plot_obj)
  grDevices::dev.off()
  ggplot2::ggsave(paths$png, plot_obj, width = width_mm, height = height_mm, units = "mm",
                  dpi = dpi, device = png, type = "cairo", bg = "white")
  saveRDS(plot_obj, paths$rds, compress = "xz")
  bioanalys_report(paths, template_id, width_mm, height_mm, dpi, dims, stats)
  invisible(paths)
}

bioanalys_export_device <- function(draw_fn, path, width_mm, height_mm, dpi = 300,
                                    template_id = "unknown", dims = "", stats = "") {
  paths <- bioanalys_output_paths(path)
  dir.create(dirname(paths$pdf), recursive = TRUE, showWarnings = FALSE)
  grDevices::cairo_pdf(paths$pdf, width = width_mm / 25.4, height = height_mm / 25.4, onefile = TRUE)
  draw_fn()
  recorded_plot <- grDevices::recordPlot()
  grDevices::dev.off()
  grDevices::png(paths$png, width = width_mm, height = height_mm, units = "mm",
                 res = dpi, type = "cairo", bg = "white")
  draw_fn()
  grDevices::dev.off()
  saveRDS(recorded_plot, paths$rds, compress = "xz")
  bioanalys_report(paths, template_id, width_mm, height_mm, dpi, dims, stats)
  invisible(paths)
}

# Real-data enrichment grouped bar overlay
suppressPackageStartupMessages({library(ggplot2)})
enrich <- read.delim(input_data, check.names = FALSE)
x_col <- if (is.null(adapt_vars$x_col) || !nzchar(adapt_vars$x_col)) "Description" else adapt_vars$x_col
value_col <- if (is.null(adapt_vars$value_col) || !nzchar(adapt_vars$value_col)) "NES" else adapt_vars$value_col
group_col <- if (is.null(adapt_vars$group_col) || !nzchar(adapt_vars$group_col)) "ont" else adapt_vars$group_col
required <- c(x_col, value_col, group_col)
if (!all(required %in% names(enrich))) stop(paste("groupedbar input columns missing:", paste(required, collapse = " / ")))
enrich[[value_col]] <- as.numeric(enrich[[value_col]])
enrich <- enrich[is.finite(enrich[[value_col]]), , drop = FALSE]
enrich <- head(enrich[order(abs(enrich[[value_col]]), decreasing = TRUE), , drop = FALSE], 15)
wrap_label <- function(x, width = 30) {
  vapply(as.character(x), function(value) {
    paste(strwrap(value, width = width), collapse = "
")
  }, character(1))
}
enrich$label <- wrap_label(enrich[[x_col]], width = 30)
enrich$label <- factor(enrich$label, levels = rev(unique(enrich$label)))
group_levels <- unique(as.character(enrich[[group_col]]))
group_colors <- setNames(
  rep(unname(bioanalys_colors), length.out = length(group_levels)),
  group_levels
)
plot <- ggplot(
  enrich,
  aes(x = label, y = .data[[value_col]], fill = .data[[group_col]])
) +
  geom_hline(yintercept = 0, linewidth = 0.35, colour = "grey55") +
  geom_col(position = position_dodge(width = 0.78), width = 0.68,
           colour = "grey20", linewidth = 0.18) +
  scale_fill_manual(values = group_colors) +
  coord_flip() +
  labs(x = NULL, y = value_col, fill = group_col) +
  bioanalys_theme_single() +
  theme(
    legend.position = "right",
    legend.direction = "vertical"
  )
bioanalys_export_ggplot(
  plot, output_file,
  width_mm = width_mm, height_mm = height_mm, dpi = dpi,
  template_id = "fig_l1_groupedbar",
  dims = paste0("data_dimensions=rows=", nrow(enrich), ";columns=", ncol(enrich)),
  stats = "threshold=top_terms<=15;method=enrichment_value_bar"
)
cat("ADAPT_REAL_INPUT_OK groupedbar rows=", nrow(enrich), "
", sep = "")

quit(status = 0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
# Catalog-ID: 215
# Catalog-Title: Grouped, stacked and percent stacked barplot in ggplot2
# Catalog-Page: https://r-graph-gallery.com/48-grouped-barplot-with-ggplot2.html
# Catalog-Language: R
# Source-Match: exact
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
 # library
library(ggplot2)
 
# create a dataset
specie <- c(rep("sorgho" , 3) , rep("poacee" , 3) , rep("banana" , 3) , rep("triticum" , 3) )
condition <- rep(c("normal" , "stress" , "Nitrogen") , 4)
value <- abs(rnorm(12 , 0 , 15))
data <- data.frame(specie,condition,value)
 
# Grouped
ggplot(data, aes(fill=condition, y=value, x=specie)) + 
    geom_bar(position="dodge", stat="identity")
 

# ---- chunk ----
 # library
library(ggplot2)
 
# create a dataset
specie <- c(rep("sorgho" , 3) , rep("poacee" , 3) , rep("banana" , 3) , rep("triticum" , 3) )
condition <- rep(c("normal" , "stress" , "Nitrogen") , 4)
value <- abs(rnorm(12 , 0 , 15))
data <- data.frame(specie,condition,value)
 
# Stacked
ggplot(data, aes(fill=condition, y=value, x=specie)) + 
    geom_bar(position="stack", stat="identity")
 

# ---- chunk ----
 # library
library(ggplot2)
 
# create a dataset
specie <- c(rep("sorgho" , 3) , rep("poacee" , 3) , rep("banana" , 3) , rep("triticum" , 3) )
condition <- rep(c("normal" , "stress" , "Nitrogen") , 4)
value <- abs(rnorm(12 , 0 , 15))
data <- data.frame(specie,condition,value)
 
# Stacked + percent
ggplot(data, aes(fill=condition, y=value, x=specie)) + 
    geom_bar(position="fill", stat="identity")
 

# ---- chunk ----
# library
library(ggplot2)
library(viridis)
library(hrbrthemes)

# create a dataset
specie <- c(rep("sorgho" , 3) , rep("poacee" , 3) , rep("banana" , 3) , rep("triticum" , 3) )
condition <- rep(c("normal" , "stress" , "Nitrogen") , 4)
value <- abs(rnorm(12 , 0 , 15))
data <- data.frame(specie,condition,value)
 
# Small multiple
ggplot(data, aes(fill=condition, y=value, x=specie)) + 
    geom_bar(position="stack", stat="identity") +
    scale_fill_viridis(discrete = T) +
    ggtitle("Studying 4 species..") +
    theme_ipsum() +
    xlab("")

# ---- chunk ----
# library
library(ggplot2)
library(viridis)
library(hrbrthemes)

# create a dataset
specie <- c(rep("sorgho" , 3) , rep("poacee" , 3) , rep("banana" , 3) , rep("triticum" , 3) )
condition <- rep(c("normal" , "stress" , "Nitrogen") , 4)
value <- abs(rnorm(12 , 0 , 15))
data <- data.frame(specie,condition,value)
 
# Graph
ggplot(data, aes(fill=condition, y=value, x=condition)) + 
    geom_bar(position="dodge", stat="identity") +
    scale_fill_viridis(discrete = T, option = "E") +
    ggtitle("Studying 4 species..") +
    facet_wrap(~specie) +
    theme_ipsum() +
    theme(legend.position="none") +
    xlab("")
