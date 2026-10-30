# Figure-Contract: width_mm=88; height_mm=60; dpi=300; column=single
# Master-Source: src/figure_sources/fig_l1_histogram.R | Master-SHA256: 934710e51d1e48820341bb65a155fc1c0b361b1b8b4c7f42733c733fee69106d
# Catalog-ID: 68 | Catalog-Language: R | Source-Match: exact
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line1_bulk
# Adapt-Variable input_data: [object Object]
adapt_vars <- list(
  input_data = 'data/line1_bulk/processed/expr_genes.tsv'
)

# Real-Data-Adapter: v1
# Project-Input: data/line1_bulk/processed/expr_genes.tsv
seed_value <- Sys.getenv("BIOANALYS_SEED", unset = "")
if (nchar(seed_value) == 0) quit(status = 3)
set.seed(as.integer(seed_value))
Sys.setenv(
  BIOANALYS_LAYOUT_PRESERVE_FIGSIZE = "1",
  BIOANALYS_LAYOUT_FIXED_CANVAS = "1"
)
input_data <- "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line1_bulk/processed/expr_genes.tsv"
output_file <- "figures/line1_bulk/L1_histogram_verified.png"
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

# Real-data expression histogram overlay
suppressPackageStartupMessages({library(ggplot2)})
expr <- read.delim(input_data, check.names = FALSE)
if (ncol(expr) < 2 || nrow(expr) < 2) stop("histogram input has insufficient dimensions")
mat <- as.matrix(expr[, -1, drop = FALSE])
storage.mode(mat) <- "numeric"
values <- as.vector(mat)
expanded_values <- length(values)
values <- values[is.finite(values)]
if (!length(values)) stop("histogram input has no finite values")
if (length(values) > 120000) values <- values[seq(1, length(values), length.out = 120000)]
bins <- 60L
stopifnot(length(values) > 0L, length(values) <= expanded_values, bins == 60L)
hist_df <- data.frame(value = values)
plot <- ggplot(hist_df, aes(x = value)) +
  geom_histogram(bins = bins, fill = bioanalys_colors[["blue"]],
                 colour = "white", linewidth = 0.15) +
  labs(x = "Expression", y = "Count") +
  bioanalys_theme_single()
bioanalys_export_ggplot(
  plot, output_file,
  width_mm = width_mm, height_mm = height_mm, dpi = dpi,
  template_id = "fig_l1_histogram",
  dims = paste0("data_dimensions=values=", length(values), ";expanded=", expanded_values, ";bins=", bins),
  stats = "threshold=max_values=120000;method=frequency_histogram"
)
cat("ADAPT_REAL_INPUT_OK histogram values=", length(values),
    " expanded=", expanded_values, " bins=", bins, "
", sep = "")

quit(status = 0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
# Catalog-ID: 68
# Catalog-Title: Basic histogram with ggplot2
# Catalog-Page: https://r-graph-gallery.com/220-basic-ggplot2-histogram.html.html
# Catalog-Language: R
# Source-Match: exact
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
# library
library(ggplot2)
 
# dataset:
data=data.frame(value=rnorm(100))

# basic histogram
p <- ggplot(data, aes(x=value)) + 
  geom_histogram()

#p

# ---- chunk ----
# Libraries
library(tidyverse)
library(hrbrthemes)

# Load dataset from github
data <- read.table("https://raw.githubusercontent.com/holtzy/data_to_viz/master/Example_dataset/1_OneNum.csv", header=TRUE)

# plot
p <- data %>%
  filter( price<300 ) %>%
  ggplot( aes(x=price)) +
    geom_histogram( binwidth=3, fill="#69b3a2", color="#e9ecef", alpha=0.9) +
    ggtitle("Bin size = 3") +
    theme_ipsum() +
    theme(
      plot.title = element_text(size=15)
    )
#p

# ---- chunk ----
p

data %>%
  filter( price<300 ) %>%
  ggplot( aes(x=price)) +
    geom_histogram( binwidth=15, fill="#69b3a2", color="#e9ecef", alpha=0.9) +
    ggtitle("Bin size = 15") +
    theme_ipsum() +
    theme(
      plot.title = element_text(size=15)
    )

data %>%
  filter( price<300 ) %>%
  ggplot( aes(x=price)) +
    geom_histogram( binwidth=30, fill="#69b3a2", color="#e9ecef", alpha=0.9) +
    ggtitle("Bin size = 30") +
    theme_ipsum() +
    theme(
      plot.title = element_text(size=15)
    )

data %>%
  filter( price<300 ) %>%
  ggplot( aes(x=price)) +
    geom_histogram( binwidth=100, fill="#69b3a2", color="#e9ecef", alpha=0.9) +
    ggtitle("Bin size = 100") +
    theme_ipsum() +
    theme(
      plot.title = element_text(size=15)
    )
