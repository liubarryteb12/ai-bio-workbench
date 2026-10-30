# Figure-Contract: width_mm=88; height_mm=75; dpi=300; column=single
# Master-Source: src/figure_sources/fig_l1_scatter.R | Master-SHA256: 0df8bc4bf91f89032ef5e596a26667615de2dd400a81b05352c8242f490b8f5e
# Catalog-ID: 329 | Catalog-Language: R | Source-Match: exact
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line1_bulk
# Adapt-Variable input_data: [object Object]
# Adapt-Variable x_col: [object Object]
# Adapt-Variable y_col: [object Object]
# Adapt-Variable label_genes: [object Object]
adapt_vars <- list(
  input_data = 'data/line1_bulk/processed/ml_core_hub_genes.tsv',
  x_col = 'rf_importance',
  y_col = 'gbdt_importance',
  label_genes = c('CXCL16')
)

# Real-Data-Adapter: v1
# Project-Input: data/line1_bulk/processed/ml_core_hub_genes.tsv
seed_value <- Sys.getenv("BIOANALYS_SEED", unset = "")
if (nchar(seed_value) == 0) quit(status = 3)
set.seed(as.integer(seed_value))
Sys.setenv(
  BIOANALYS_LAYOUT_PRESERVE_FIGSIZE = "1",
  BIOANALYS_LAYOUT_FIXED_CANVAS = "1"
)
input_data <- "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line1_bulk/processed/ml_core_hub_genes.tsv"
output_file <- "figures/line1_bulk/L1_scatter_verified.png"
width_mm <- 88
height_mm <- 75
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

# Real-data model-importance scatter overlay
suppressPackageStartupMessages({library(ggplot2); library(ggrepel)})
hub <- read.delim(input_data, check.names = FALSE)
x_col <- if (is.null(adapt_vars$x_col) || !nzchar(adapt_vars$x_col)) "rf_importance" else adapt_vars$x_col
y_col <- if (is.null(adapt_vars$y_col) || !nzchar(adapt_vars$y_col)) "gbdt_importance" else adapt_vars$y_col
required <- c("gene", x_col, y_col, "p_value", "importance_rank")
if (!all(required %in% names(hub))) stop(paste("scatter input columns missing:", paste(required, collapse = " / ")))
hub[[x_col]] <- as.numeric(hub[[x_col]])
hub[[y_col]] <- as.numeric(hub[[y_col]])
hub$p_value <- as.numeric(hub$p_value)
hub$importance_rank <- as.numeric(hub$importance_rank)
hub <- hub[
  is.finite(hub[[x_col]]) & is.finite(hub[[y_col]]) &
    is.finite(hub$p_value) & is.finite(hub$importance_rank),
  ,
  drop = FALSE
]
if (nrow(hub) < 2) stop("scatter input has insufficient finite rows")
hub$score <- -log10(pmax(as.numeric(hub$p_value), 1e-300))
label_genes <- unique(c(as.character(adapt_vars$label_genes), head(hub$gene[order(hub$importance_rank)], 8)))
labels <- hub[hub$gene %in% label_genes, , drop = FALSE]
labels <- labels[!duplicated(labels$gene), , drop = FALSE]
plot <- ggplot(hub, aes(x = .data[[x_col]], y = .data[[y_col]], colour = score)) +
  geom_point(size = 1.1, alpha = 0.82, stroke = 0) +
  geom_text_repel(
    data = labels, aes(label = gene), size = 6.5 / 2.845276,
    min.segment.length = 0, max.overlaps = 30, seed = as.integer(seed_value),
    box.padding = 0.3, point.padding = 0.2, show.legend = FALSE
  ) +
  scale_colour_viridis_c(name = "-log10(P)") +
  labs(x = x_col, y = y_col) +
  bioanalys_theme_single() +
  theme(legend.position = "right")
bioanalys_export_ggplot(
  plot, output_file,
  width_mm = width_mm, height_mm = height_mm, dpi = dpi,
  template_id = "fig_l1_scatter",
  dims = paste0("data_dimensions=rows=", nrow(hub), ";columns=", ncol(hub)),
  stats = "threshold=top_labels<=8;method=importance_correlation_scatter"
)
cat("ADAPT_REAL_INPUT_OK scatter rows=", nrow(hub), "
", sep = "")

quit(status = 0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
# Catalog-ID: 329
# Catalog-Title: Scatterplot with automatic text repel
# Catalog-Page: https://r-graph-gallery.com/web-scatterplot-with-text-repel-ggrepel.html
# Catalog-Language: R
# Source-Match: exact
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
knitr::opts_chunk$set(
  warning = FALSE, 
  message = FALSE
)

# ---- chunk ----
library(ggrepel)
library(palmerpenguins)
library(randomNames)
library(tidyverse)

# ---- chunk ----
## Generate random names
# The results of set.seed may depends on R version.
set.seed(2021+03+27)
name_vector <- randomNames(nrow(penguins), which.names = "first")

## Create 'highlight' indicator variable
penguins <- penguins %>% 
  mutate(
    name = name_vector,
    highlight = case_when(
      str_starts(name, "C") ~ name,
      TRUE ~ ""
      )
    ) 

# ---- chunk ----
# Note `color = species` and s`hape = species`.
# This means each species will have BOTH  a different color and shape.
plt <- ggplot(penguins, aes(x = flipper_length_mm, y = bill_length_mm)) +
  geom_point(
    aes(color = species, shape = species),
    size = 1.5, 
    alpha = 0.8 # It's nice to add some transparency because there may be overlap.
  ) +
  # Use custom colors
  scale_color_manual(
    values = c("#386cb0", "#fdb462", "#7fc97f")
  )

# ---- chunk ----
ggsave(
  filename = here::here("img", "fromTheWeb", "web-scatterplot-and-ggrepel-preview1.png"),
  width = 6,
  height = 6,
  plot = plt
)

# ---- chunk ----
plt <- plt + 
  geom_text_repel(
    aes(label = highlight),
    family = "Poppins",
    size = 3,
    min.segment.length = 0, 
    seed = 42, 
    box.padding = 0.5,
    max.overlaps = Inf,
    arrow = arrow(length = unit(0.010, "npc")),
    nudge_x = .15,
    nudge_y = .5,
    color = "grey50"
  )

# ---- chunk ----
ggsave(
  filename = here::here("img", "fromTheWeb", "web-scatterplot-and-ggrepel-preview2.png"),
  plot = plt,
  width = 6,
  height = 6,
  device = "png"
)

# ---- chunk ----
plt <- plt + 
  # Add axes labels, title, and subtitle
  labs(
    title = "Palmer Penguins Data Visualization",
    subtitle = "Scatter plot of flipper lenth vs bill length",
    x = "flip length (mm)",
    y = "bill length (mm)"
  ) +  
  theme(
    # The default font when not explicitly specified
    text = element_text(family = "Lobster Two", size = 8, color = "black"),
    
    # Customize legend text, position, and background.
    legend.text = element_text(size = 9, family = "Roboto"),
    legend.title = element_text(face = "bold", size=12, family = "Roboto"),
    legend.position = c(1, 0),
    legend.justification = c(1, 0),
    legend.background = element_blank(),
    # This one removes the background behind each key in the legend
    legend.key = element_blank(),
    
    # Customize title and subtitle font/size/color
    plot.title = element_text(
      family = "Lobster Two", 
      size = 20,
      face = "bold", 
      color = "#2a475e"
    ),
    plot.subtitle = element_text(
      family = "Lobster Two", 
      size = 15, 
      face = "bold", 
      color = "#1b2838"
    ),
    plot.title.position = "plot",
    
    # Adjust axis parameters such as size and color.
    axis.text = element_text(size = 10, color = "black"),
    axis.title = element_text(size = 12),
    axis.ticks = element_blank(),
    # Axis lines are now lighter than default
    axis.line = element_line(colour = "grey50"),
    
    # Only keep y-axis major grid lines, with a grey color and dashed type.
    panel.grid.minor = element_blank(),
    panel.grid.major.x = element_blank(),
    panel.grid.major.y = element_line(color = "#b4aea9", linetype ="dashed"),
    
    # Use a light color for the background of the plot and the panel.
    panel.background = element_rect(fill = "#fbf9f4", color = "#fbf9f4"),
    plot.background = element_rect(fill = "#fbf9f4", color = "#fbf9f4")
  )

# ---- chunk ----
ggsave(
  filename = here::here("img", "fromTheWeb", "web-scatterplot-and-ggrepel.png"),
  plot = plt,
  width = 6,
  height = 6,
  device = "png"
)

# ---- chunk ----
# Correlation | Ranking | Evolution.. 
htmltools::includeHTML("htmlChunkRelatedRanking.html")
