# Figure-Contract: width_mm=130; height_mm=100; dpi=300; column=medium
# Master-Source: src/figure_sources/fig_l3_sankey.R | Master-SHA256: fecd39ff2ad7c0cb1247c43db57a50dc0d283ca64541a710a5be0496500d4adc
# Catalog-ID: 328 | Catalog-Language: R | Source-Match: exact
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line1_bulk
# Adapt-Variable input_data: [object Object]
# Adapt-Variable module_col: [object Object]
adapt_vars <- list(
  input_data = 'data/line1_bulk/processed/wgcna_modules.tsv',
  module_col = 'module'
)

# Real-Data-Adapter: v1
# Project-Input: data/line1_bulk/processed/wgcna_modules.tsv
seed_value <- Sys.getenv("BIOANALYS_SEED", unset = "")
if (nchar(seed_value) == 0) quit(status = 3)
set.seed(as.integer(seed_value))
Sys.setenv(
  BIOANALYS_LAYOUT_PRESERVE_FIGSIZE = "1",
  BIOANALYS_LAYOUT_FIXED_CANVAS = "1"
)
input_data <- "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line1_bulk/processed/wgcna_modules.tsv"
output_file <- "figures/line1_bulk/L3_sankey_verified.png"
width_mm <- 130
height_mm <- 100
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

# Real-data WGCNA module flow overlay
modules <- read.delim(input_data, check.names = FALSE)
module_col <- if (is.null(adapt_vars$module_col) || !nzchar(adapt_vars$module_col)) "module" else adapt_vars$module_col
if (!all(c("gene", module_col) %in% names(modules))) stop(paste("sankey input columns missing:", module_col, "gene"))
flow <- aggregate(list(count = rep(1, nrow(modules))), by = list(module = modules[[module_col]]), FUN = sum)
flow <- flow[order(flow$count, decreasing = TRUE), , drop = FALSE]
flow <- head(flow, min(10, nrow(flow)))
flow$left_y <- rev(seq(0.12, 0.88, length.out = nrow(flow)))
flow$right_y <- seq(0.12, 0.88, length.out = nrow(flow))
flow$width <- flow$count / max(flow$count) * 0.08
draw_flow <- function() {
  graphics::par(mar = c(2.5, 2.5, 2.0, 2.0), family = "sans", cex.axis = 0.58, cex.lab = 0.58)
  graphics::plot.new()
  graphics::plot.window(xlim = c(0, 1), ylim = c(0, 1))
  graphics::segments(
    0.20, flow$left_y, 0.80, flow$right_y,
    col = grDevices::adjustcolor(bioanalys_colors[["sky"]], alpha.f = 0.32),
    lwd = pmax(0.75, flow$count / max(flow$count) * 10)
  )
  graphics::rect(0.12, flow$left_y - flow$width, 0.20, flow$left_y + flow$width,
                 col = bioanalys_colors[["blue"]], border = NA)
  graphics::rect(0.80, flow$right_y - flow$width, 0.88, flow$right_y + flow$width,
                 col = bioanalys_colors[["vermillion"]], border = NA)
  graphics::text(0.19, flow$left_y, flow$module, adj = c(1, 0.5), cex = 0.58)
  graphics::text(0.81, flow$right_y, paste0("n=", flow$count), adj = c(0, 0.5), cex = 0.58)
  graphics::mtext("WGCNA module", side = 1, line = 1.2, cex = 0.58)
  graphics::mtext("Gene count", side = 2, line = 1.2, cex = 0.58)
}
bioanalys_export_device(
  draw_flow, output_file,
  width_mm = width_mm, height_mm = height_mm, dpi = dpi,
  template_id = "fig_l3_sankey",
  dims = paste0("data_dimensions=rows=", nrow(flow), ";categories=", nrow(flow)),
  stats = "threshold=max_modules=10;method=wgcna_module_flow"
)
cat("ADAPT_REAL_INPUT_OK sankey modules=", nrow(flow), "
", sep = "")

quit(status = 0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
# Catalog-ID: 328
# Catalog-Title: Sankey Bump Chart in R with ggplot2 and ggsankey
# Catalog-Page: https://r-graph-gallery.com/web-sankey-diagram-with-highlight.html
# Catalog-Language: R
# Source-Match: exact
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
knitr::opts_chunk$set(
   warning = FALSE,
   message = FALSE,
   fig.align = "center"
)

# ---- chunk ----
library(tidyverse)
library(ggsankey)
library(shadowtext)

# ---- chunk ----
library(readr)

path <- "https://github.com/holtzy/R-graph-gallery/blob/master/DATA/summer_movie_genres.csv?raw=true"
path <- "DATA/summer_movie_genres.csv"
summer_movie_genres <- read_csv(path)

path <- "https://github.com/holtzy/R-graph-gallery/blob/master/DATA/summer_movies.csv?raw=true"
path <- "DATA/summer_movies.csv"
summer_movies <- read_csv(path)

# ---- chunk ----
summer_genres <- summer_movies %>%
   filter(title_type == "movie") %>%
   select(tconst, primary_title, year, runtime_minutes, average_rating) %>%
   mutate(decade = factor(year %/% 10 * 10)) %>%
   left_join(summer_movie_genres) %>%
   group_by(decade) %>%
   mutate(decade_n = n()) %>%
   ungroup() %>%
   group_by(decade, genres) %>%
   summarise(
      score = median(average_rating, na.rm = TRUE),
      n = n(),
      decade_n,
      prop = n / decade_n
   ) %>%
   ungroup() %>%
   distinct() %>%
   filter(!is.na(decade) & !is.na(genres) & !is.na(score))

# ---- chunk ----
p <- ggplot(summer_genres, aes(x = decade, node = genres, fill = genres, value = prop, label = genres)) +
   geom_sankey_bump() +
   theme_minimal() +
   theme(
      legend.position = "bottom",
      plot.background = element_rect(fill = "grey99", color = NA)
   )
p

# ---- chunk ----
g_labs_start <- ggplot_build(p) %>%
   .$data %>%
   .[[1]] %>%
   group_by(label) %>%
   filter(x == min(x)) %>%
   reframe(
      x,
      y = mean(y)
   ) %>%
   left_join(summer_genres %>% group_by(genres) %>% filter(as.numeric(decade) == min(as.numeric(decade))), by = c("label" = "genres"))

g_labs_end <- ggplot_build(p) %>%
   .$data %>%
   .[[1]] %>%
   group_by(label) %>%
   filter(x == max(x)) %>%
   reframe(
      x,
      y = mean(y)
   ) %>%
   left_join(summer_genres %>% group_by(genres) %>% filter(as.numeric(decade) == max(as.numeric(decade))), by = c("label" = "genres"))

# ---- chunk ----
# Colors
pal <- c(
   "#FDA638",
   "#459395",
   "#EB7C69"
)

na_col <- "#866f85"

plot <- ggplot() +
   geom_sankey_bump(data = summer_genres, aes(x = decade, node = genres, fill = if_else(genres %in% c("Drama", "Comedy", "Romance"), genres, NA), value = prop)) +
   geom_shadowtext(data = g_labs_start, aes(x, y, label = paste(label, "·", n), color = if_else(label %in% c("Drama", "Comedy", "Romance"), label, NA)), hjust = 1, nudge_x = -0.1, bg.color = "grey99", fontface = "bold") +
   geom_shadowtext(data = g_labs_end, aes(x, y, label = paste(label, "·", n), color = if_else(label %in% c("Drama", "Comedy", "Romance"), label, NA)), hjust = 0, nudge_x = 0.1, bg.color = "grey99") +
   scale_fill_manual(values = pal, na.value = na_col) +
   scale_color_manual(values = pal, na.value = na_col) +
   coord_cartesian(clip = "off") +
   theme_minimal() +
   labs(
      title = "What 'summer' movies are made of: drama, comedy, and romance",
      subtitle = str_wrap("The chart shows the genre distribution of IMDb-listed movies with 'summer' in their titles, by decade. Only movies with at least 10 votes are included. Each film can have up to three genre tags. Line thickness represents the proportion of genre occurrences within each decade. The numbers at each end of a line show the genre count in the first and last decades it appears.", 140),
      caption = "Source: IMDB · Graphic: Georgios Karamanis"
   ) +
   theme(
      legend.position = "none",
      plot.background = element_rect(fill = "grey99", color = NA),
      axis.title = element_blank(),
      axis.text.y = element_blank(),
      panel.grid.major.y = element_blank(),
      panel.grid.minor.y = element_blank(),
      plot.title = element_text(face = "bold", size = 16),
      plot.subtitle = element_text(lineheight = 1),
      plot.caption = element_text(margin = margin(10, 0, 0, 0), hjust = 0),
      plot.margin = margin(10, 40, 10, 20)
   )

plot
