# SCI Single Plot Style Standard (reference/03出图规范 v3.0).
# Pure single-plot styling and export module for R ggplot2/Bioconductor pipelines.

WIDTHS_MM <- c(
  small = 58,
  single = 88,
  medium = 130,
  wide = 180
)

get_palette <- function() {
  list(
    okabe_ito = c(
      blue = "#0072B2",
      vermillion = "#D55E00",
      green = "#009E73",
      orange = "#E69F00",
      sky = "#56B4E9",
      purple = "#CC79A7",
      yellow = "#F0E442",
      grey = "#999999"
    ),
    deg = c(
      Down = "#0072B2",
      ns = "#BFBFBF",
      Up = "#D55E00"
    )
  )
}

theme_single_plot <- function(base_size = 7, base_family = "DejaVu Sans") {
  pt_to_mm <- 1 / 2.845276
  ggplot2::theme_classic(base_size = base_size, base_family = base_family) +
    ggplot2::theme(
      plot.title = ggplot2::element_blank(),
      plot.subtitle = ggplot2::element_blank(),
      text = ggplot2::element_text(colour = "black"),
      axis.title = ggplot2::element_text(size = base_size, colour = "black"),
      axis.text = ggplot2::element_text(size = base_size - 0.5, colour = "black"),
      axis.line = ggplot2::element_line(linewidth = 0.5 * pt_to_mm, colour = "black"),
      axis.ticks = ggplot2::element_line(linewidth = 0.5 * pt_to_mm, colour = "black"),
      axis.ticks.length = ggplot2::unit(1.2, "mm"),
      legend.title = ggplot2::element_text(size = base_size, colour = "black"),
      legend.text = ggplot2::element_text(size = base_size - 0.5, colour = "black"),
      legend.key.size = ggplot2::unit(3, "mm"),
      legend.background = ggplot2::element_blank(),
      legend.key = ggplot2::element_blank(),
      panel.background = ggplot2::element_blank(),
      plot.background = ggplot2::element_blank(),
      panel.grid = ggplot2::element_blank(),
      plot.margin = ggplot2::unit(c(2, 2, 2, 2), "mm")
    )
}

export_single_fig <- function(plot_obj, name, size_preset = "single", height_mm = 75,
                              out_dir = "figures", version = "v01", dpi = 300,
                              metadata = list()) {
  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
  width_mm <- unname(WIDTHS_MM[size_preset])
  if (is.na(width_mm)) width_mm <- 88

  stem <- if (nzchar(version)) paste0(name, "_", version) else name
  pdf_path <- file.path(out_dir, paste0(stem, ".pdf"))
  png_path <- file.path(out_dir, paste0(stem, ".png"))
  rds_path <- file.path(out_dir, paste0(stem, "_plot.rds"))
  report_path <- file.path(out_dir, paste0(stem, "_report.txt"))

  # Vector PDF with cairo
  grDevices::cairo_pdf(pdf_path, width = width_mm / 25.4, height = height_mm / 25.4, onefile = TRUE)
  print(plot_obj)
  grDevices::dev.off()

  # PNG at 300 DPI
  ggplot2::ggsave(
    png_path, plot_obj,
    width = width_mm, height = height_mm, units = "mm",
    dpi = dpi, device = grDevices::png, type = "cairo", bg = "white"
  )

  # RDS object
  saveRDS(plot_obj, rds_path, compress = "xz")

  # Audit metadata report
  lines <- c(
    "step_executed=export_single_fig",
    paste0("artifact_name=", name),
    paste0("size_preset=", size_preset),
    paste0("width_mm=", width_mm),
    paste0("height_mm=", height_mm),
    paste0("dpi=", dpi),
    paste0("artifact_png=", basename(png_path)),
    paste0("artifact_pdf=", basename(pdf_path)),
    paste0("artifact_object=", basename(rds_path)),
    paste0("seed=", Sys.getenv("BIOANALYS_SEED", unset = ""))
  )
  if (length(metadata) > 0) {
    for (k in names(metadata)) {
      lines <- c(lines, paste0(k, "=", metadata[[k]]))
    }
  }
  writeLines(lines, report_path)

  invisible(list(pdf = pdf_path, png = png_path, rds = rds_path, report = report_path))
}

with_cairo_pdf <- function(name, expr, size_preset = "wide", height_mm = 120,
                           out_dir = "figures", version = "v01", dpi = 300,
                           metadata = list()) {
  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
  width_mm <- unname(WIDTHS_MM[size_preset])
  if (is.na(width_mm)) width_mm <- 180

  stem <- if (nzchar(version)) paste0(name, "_", version) else name
  pdf_path <- file.path(out_dir, paste0(stem, ".pdf"))
  png_path <- file.path(out_dir, paste0(stem, ".png"))
  report_path <- file.path(out_dir, paste0(stem, "_report.txt"))

  grDevices::cairo_pdf(pdf_path, width = width_mm / 25.4, height = height_mm / 25.4, onefile = TRUE)
  force(expr)
  recorded <- grDevices::recordPlot()
  grDevices::dev.off()

  grDevices::png(png_path, width = width_mm, height = height_mm, units = "mm",
                 res = dpi, type = "cairo", bg = "white")
  grDevices::replayPlot(recorded)
  grDevices::dev.off()

  rds_path <- file.path(out_dir, paste0(stem, "_plot.rds"))
  saveRDS(recorded, rds_path, compress = "xz")

  lines <- c(
    "step_executed=with_cairo_pdf",
    paste0("artifact_name=", name),
    paste0("size_preset=", size_preset),
    paste0("width_mm=", width_mm),
    paste0("height_mm=", height_mm),
    paste0("dpi=", dpi),
    paste0("artifact_png=", basename(png_path)),
    paste0("artifact_pdf=", basename(pdf_path)),
    paste0("artifact_object=", basename(rds_path)),
    paste0("seed=", Sys.getenv("BIOANALYS_SEED", unset = ""))
  )
  writeLines(lines, report_path)

  invisible(list(pdf = pdf_path, png = png_path, rds = rds_path, report = report_path))
}
