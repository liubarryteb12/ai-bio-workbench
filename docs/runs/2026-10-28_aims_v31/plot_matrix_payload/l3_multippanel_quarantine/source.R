#!/usr/bin/env Rscript
# Candidate restoration of the four-panel reference figure. Reproduces the
# README layout. Not certified until K40 verification.

suppressPackageStartupMessages({
  library(ggplot2)
  library(patchwork)
})

fail <- function(code, message) {
  cat(message, "\n", file = stderr())
  quit(save = "no", status = code)
}

# The seed is externally owned: require an exact non-negative integer.
seed_text <- Sys.getenv("BIOANALYS_SEED")
if (seed_text == "") {
  fail(3L, "BIOANALYS_SEED is required")
}
if (!grepl("^[0-9]+$", seed_text)) {
  fail(2L, "BIOANALYS_SEED must be a non-negative integer")
}
seed_value <- suppressWarnings(as.integer(seed_text))
if (is.na(seed_value) || seed_value < 0L) {
  fail(2L, "BIOANALYS_SEED exceeds the supported integer range")
}
set.seed(seed_value)

parse_script_dir <- function(args) {
  args <- grep("^--file=", args, value = TRUE)
  if (length(args) != 1L) {
    fail(2L, "unable to resolve script directory from Rscript arguments")
  }
  normalizePath(dirname(sub("^--file=", "", args[1])), mustWork = TRUE)
}

output_dir <- parse_script_dir(commandArgs(trailingOnly = FALSE))
input_path <- file.path(output_dir, "input_data.csv")
if (!file.exists(input_path)) {
  fail(2L, "input_data.csv is missing from the script directory")
}
input_path <- normalizePath(input_path, mustWork = TRUE)
panel_data <- tryCatch(read.csv(input_path, stringsAsFactors = FALSE), error = function(e) {
  fail(2L, paste("cannot read input_data.csv:", conditionMessage(e)))
})

required_columns <- c("panel", "group", "value")
if (!all(required_columns %in% names(panel_data))) {
  fail(2L, "input_data.csv missing required columns: panel, group, value")
}
if (nrow(panel_data) == 0L) {
  fail(2L, "input_data.csv has no data rows")
}
if (!is.numeric(panel_data$value)) {
  fail(2L, "input_data.csv value column must be numeric")
}
if (any(!is.finite(panel_data$value))) {
  fail(2L, "input_data.csv value column must contain only finite numbers")
}

# Require a closed reference contract: exactly pa/pb by Ctrl/Treat.
observed_keys <- paste(panel_data$panel, panel_data$group, sep = "|")
expected_keys <- c("pa|Ctrl", "pa|Treat", "pb|Ctrl", "pb|Treat")
if (length(observed_keys) != 4L) {
  fail(2L, "input_data.csv must provide four closed panel-group combinations")
}
if (anyDuplicated(observed_keys)) {
  fail(2L, "input_data.csv contains duplicate panel-group combinations")
}
if (!setequal(observed_keys, expected_keys)) {
  fail(2L, "input_data.csv must contain pa and pb by Ctrl and Treat")
}

plot_data <- panel_data[order(panel_data$panel, panel_data$group), , drop = FALSE]
palette <- c("Ctrl" = "#3B4992", "Treat" = "#EE0000")

pa <- ggplot(plot_data[plot_data$panel == "pa", , drop = FALSE],
             aes(x = group, y = value, fill = group)) +
  geom_col(width = 0.62, colour = "grey22", linewidth = 0.25) +
  scale_fill_manual(values = palette) +
  labs(title = "Panel A", x = NULL, y = "value") +
  theme_classic(base_size = 8) +
  theme(legend.position = "none")

pb <- ggplot(plot_data[plot_data$panel == "pb", , drop = FALSE],
             aes(x = group, y = value, fill = group)) +
  geom_col(width = 0.62, colour = "grey22", linewidth = 0.25) +
  scale_fill_manual(values = palette) +
  labs(title = "Panel B", x = NULL, y = "value") +
  theme_classic(base_size = 8) +
  theme(legend.position = "none")

pc <- ggplot(plot_data, aes(x = group, y = value, colour = panel, group = panel)) +
  geom_line(linewidth = 0.5) +
  geom_point(size = 1.5, shape = 16) +
  scale_colour_manual(values = c("pa" = unname(palette[1]), "pb" = unname(palette[2])),
                      labels = c("pa", "pb")) +
  labs(title = "Panel C", x = NULL, y = "value", colour = "source") +
  theme_classic(base_size = 8) +
  theme(legend.title = element_text(size = 8), legend.text = element_text(size = 8))

pd <- ggplot(plot_data, aes(x = group, y = panel, fill = value)) +
  geom_tile(colour = "white", linewidth = 0.4) +
  scale_fill_viridis_c(option = "viridis", name = "value") +
  labs(title = "Panel D", x = NULL, y = NULL, fill = "value") +
  theme_classic(base_size = 8) +
  theme(legend.title = element_text(size = 8), legend.text = element_text(size = 8))

figure <- (pa | pb) / (pc | pd) + plot_annotation(tag_levels = "a") &
  theme(plot.tag = element_text(size = 8, face = "bold"))

png_file <- file.path(output_dir, "L3_multippanel_verified.png")
pdf_file <- file.path(output_dir, "L3_multippanel_verified.pdf")

png(png_file, width = 183, height = 120, units = "mm", res = 300, type = "cairo")
print(figure)
dev.off()

ggsave(pdf_file, figure, width = 183, height = 120, units = "mm", device = pdf)

png_size <- file.info(png_file)$size
pdf_size <- file.info(pdf_file)$size
if (is.na(png_size) || png_size == 0L || is.na(pdf_size) || pdf_size == 0L) {
  fail(1L, "render output file is missing or empty")
}

png_magic <- readBin(png_file, "raw", n = 8L)
pdf_magic <- readBin(pdf_file, "raw", n = 5L)
if (length(png_magic) == 8L &&
    png_magic[1] == as.raw(0x89) &&
    png_magic[2] == as.raw(0x50) &&
    png_magic[3] == as.raw(0x4e) &&
    png_magic[4] == as.raw(0x47) &&
    png_magic[5] == as.raw(0x0d) &&
    png_magic[6] == as.raw(0x0a) &&
    png_magic[7] == as.raw(0x1a) &&
    png_magic[8] == as.raw(0x0a)) {
} else {
  fail(1L, "output PNG signature is invalid")
}

if (length(pdf_magic) == 5L &&
    pdf_magic[1] == as.raw(0x25) &&
    pdf_magic[2] == as.raw(0x50) &&
    pdf_magic[3] == as.raw(0x44) &&
    pdf_magic[4] == as.raw(0x46) &&
    pdf_magic[5] == as.raw(0x2d)) {
} else {
  fail(1L, "output PDF signature is invalid")
}

report_file <- file.path(output_dir, "L3_multipanel_report.txt")
checksums <- tools::md5sum(c(input_path, png_file, pdf_file))
cat(
  "ALGORITHM=MD5\n",
  "seed=", seed_text, "\n",
  "input_data_md5=", checksums[1], "\n",
  "output_png_md5=", checksums[2], "\n",
  "output_pdf_md5=", checksums[3], "\n",
  "width_mm=", 183, "\n",
  "height_mm=", 120, "\n",
  "units=mm\n",
  "dpi=300\n",
  "device=png:cairo\n",
  "output_png_name=L3_multippanel_verified.png\n",
  "output_pdf_name=L3_multippanel_verified.pdf\n",
  "width_mm=183\n",
  "height_mm=120\n",
  "units=mm\n",
  "dpi=300\n",
  "device=png:cairo\n",
  "R=", ifelse(is.null(getRversion()), "<unknown>", toString(getRversion())), "\n",
  "ggplot2=", as.character(packageVersion("ggplot2")), "\n",
  "patchwork=", as.character(packageVersion("patchwork")), "\n",
  "RENDER_OK=multipanel\n",
  sep = "", file = report_file
)

cat("step_executed=L3_multipanel|report=L3_multippanel_report.txt\n")
