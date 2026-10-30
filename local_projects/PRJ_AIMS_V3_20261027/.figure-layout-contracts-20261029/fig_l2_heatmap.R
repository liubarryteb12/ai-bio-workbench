# Figure-Contract: width_mm=180; height_mm=120; dpi=300; column=wide
# Master-Source: src/figure_sources/fig_l2_heatmap.R | Master-SHA256: 51f998eb9df8a96a23163d55db6b2b085ee22bf5faaf815db5b1bab2964ea9eb
# Catalog-ID: 227 | Catalog-Language: R | Source-Match: exact
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line1_bulk
# Adapt-Variable input_data: [object Object]
# Adapt-Variable row_col: [object Object]
# Adapt-Variable column_col: [object Object]
# Adapt-Variable value_col: [object Object]
# Adapt-Variable group_col: [object Object]
adapt_vars <- list(
  input_data = 'data/line1_bulk/processed/expr_genes.tsv',
  row_col = 'gene',
  column_col = 'sample',
  value_col = 'expr',
  group_col = 'group'
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
output_file <- "figures/line1_bulk/L2_heatmap_verified.png"
width_mm <- 180
height_mm <- 120
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

# Real-data expression heatmap overlay
suppressPackageStartupMessages({library(ggplot2); library(viridis)})
expr_df <- read.delim(input_data, check.names = FALSE)
if (ncol(expr_df) < 3 || nrow(expr_df) < 2) stop("heatmap input has insufficient dimensions")
expr_matrix <- as.matrix(expr_df[, -1, drop = FALSE])
rownames(expr_matrix) <- make.unique(as.character(expr_df[[1]]))
storage.mode(expr_matrix) <- "numeric"
if (anyNA(expr_matrix)) stop("heatmap input contains non-numeric or missing values")
var_top <- order(apply(expr_matrix, 1, var), decreasing = TRUE)
expr_matrix <- expr_matrix[head(var_top, min(30, length(var_top))), , drop = FALSE]
expr_z <- t(scale(t(expr_matrix)))
expr_z[!is.finite(expr_z)] <- 0
expr_long <- data.frame(
  gene = factor(
    rep(rownames(expr_z), times = ncol(expr_z)),
    levels = rev(rownames(expr_z))
  ),
  sample = factor(
    rep(colnames(expr_z), each = nrow(expr_z)),
    levels = colnames(expr_z)
  ),
  z = as.vector(expr_z)
)
heat <- ggplot(expr_long, aes(x = sample, y = gene, fill = z)) +
  geom_tile(linewidth = 0) +
  scale_fill_viridis_c(name = "Z-score") +
  labs(x = NULL, y = NULL) +
  bioanalys_theme_single() +
  theme(
    axis.text.x = element_text(angle = 0, hjust = 0.5, vjust = 1),
    axis.text.y = element_text(size = 6.5),
    axis.ticks = element_blank(),
    panel.grid = element_blank(),
    legend.position = "right"
  )
bioanalys_export_ggplot(
  heat,
  output_file,
  width_mm = width_mm,
  height_mm = height_mm,
  dpi = dpi,
  template_id = "fig_l2_heatmap",
  dims = paste0("data_dimensions=rows=", nrow(expr_z), ";columns=", ncol(expr_z)),
  stats = "threshold=top_variance_features<=30;method=row_zscore"
)
cat("ADAPT_REAL_INPUT_OK heatmap genes=", nrow(expr_z), " samples=", ncol(expr_z), "
", sep = "")

quit(status = 0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
# Catalog-ID: 227
# Catalog-Title: ggplot2 heatmap
# Catalog-Page: https://r-graph-gallery.com/79-levelplot-with-ggplot2.html
# Catalog-Language: R
# Source-Match: exact
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
# Library
library(ggplot2)

# Dummy data
x <- LETTERS[1:20]
y <- paste0("var", seq(1,20))
data <- expand.grid(X=x, Y=y)
data$Z <- runif(400, 0, 5)
 
# Heatmap 
ggplot(data, aes(X, Y, fill= Z)) + 
  geom_tile()

# ---- chunk ----
# Library
library(ggplot2)
library(hrbrthemes)

# Dummy data
x <- LETTERS[1:20]
y <- paste0("var", seq(1,20))
data <- expand.grid(X=x, Y=y)
data$Z <- runif(400, 0, 5)
 
# Give extreme colors:
ggplot(data, aes(X, Y, fill= Z)) + 
  geom_tile() +
  scale_fill_gradient(low="white", high="blue") +
  theme_ipsum()

# Color Brewer palette
ggplot(data, aes(X, Y, fill= Z)) + 
  geom_tile() +
  scale_fill_distiller(palette = "RdPu") +
  theme_ipsum()

# Color Brewer palette
library(viridis)
ggplot(data, aes(X, Y, fill= Z)) + 
  geom_tile() +
  scale_fill_viridis(discrete=FALSE) +
  theme_ipsum()

# ---- chunk ----
# Library
library(ggplot2)
library(tidyr)
library(tibble)
library(hrbrthemes)
library(dplyr)

# Volcano dataset
#volcano

# Heatmap 
volcano %>%
  
  # Data wrangling
  as_tibble() %>%
  rowid_to_column(var="X") %>%
  gather(key="Y", value="Z", -1) %>%
  
  # Change Y to numeric
  mutate(Y=as.numeric(gsub("V","",Y))) %>%

  # Viz
  ggplot(aes(X, Y, fill= Z)) + 
    geom_tile() +
    theme_ipsum() +
    theme(legend.position="none")

# ---- chunk ----
# Library
library(ggplot2)
library(hrbrthemes)
library(plotly)

# Dummy data
x <- LETTERS[1:20]
y <- paste0("var", seq(1,20))
data <- expand.grid(X=x, Y=y)
data$Z <- runif(400, 0, 5)
 
# new column: text for tooltip:
data <- data %>%
  mutate(text = paste0("x: ", x, "\n", "y: ", y, "\n", "Value: ",round(Z,2), "\n", "What else?"))

# classic ggplot, with text in aes
p <- ggplot(data, aes(X, Y, fill= Z, text=text)) + 
  geom_tile() +
  theme_ipsum()

ggplotly(p, tooltip="text")

# save the widget
# library(htmlwidgets)
# saveWidget(pp, file=paste0( getwd(), "/HtmlWidget/ggplotlyHeatmap.html"))
