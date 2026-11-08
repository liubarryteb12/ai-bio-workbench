# Master-Source: reference/05.可参考出图代码/L3_高级组合图/L3_multipanel_code.R | Master-SHA256: 2d57dfd823386971dfdd423af101da48a4c3db6d100729e428e4190e080213c1
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line1_bulk
# Adapt-Variable input_data: 项目本线只读输入文件路径，相对于本项目根目录
# Adapt-Variable group_col: 真实标签列名
# Adapt-Variable value_col: 预测概率列名
adapt_vars <- list(
  input_data = 'data/line1_bulk/processed/external_validation_preds.tsv',
  group_col = 'true',
  value_col = 'prob_LS'
)

# Real-Data-Adapter: v1
# Project-Input: data/line1_bulk/processed/external_validation_preds.tsv
seed_value <- Sys.getenv("BIOANALYS_SEED", unset = "")
if (nchar(seed_value) == 0) quit(status = 3)
set.seed(as.integer(seed_value))
input_data <- "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line1_bulk/processed/external_validation_preds.tsv"
output_file <- "L3_multipanel_verified.png"
if (!file.exists(input_data)) stop(paste("real input missing:", input_data))
dir.create(dirname(output_file), recursive = TRUE, showWarnings = FALSE)

# Real-data external-validation multi-panel overlay
suppressPackageStartupMessages({library(ggplot2); library(patchwork)})
pred <- read.delim(input_data, check.names = FALSE)
required <- c("true", "pred", "prob_LS")
if (!all(required %in% names(pred))) stop(paste("multipanel input columns missing:", paste(required, collapse = " / ")))
pred$true <- factor(pred$true)
pred$pred <- factor(pred$pred)
pred$prob_LS <- as.numeric(pred$prob_LS)
pred$truth_num <- as.numeric(as.character(pred$true))
pred <- pred[is.finite(pred$prob_LS), , drop = FALSE]
panel_a <- ggplot(pred, aes(x = true, y = prob_LS, fill = true)) +
  geom_boxplot(width = 0.55, outlier.size = 0.4) +
  labs(title = "A Risk by truth", x = "truth", y = "risk") +
  theme_classic(base_size = 7) + theme(legend.position = "none")
panel_b <- ggplot(pred, aes(x = true, y = pred)) +
  geom_jitter(width = 0.2, height = 0.12, size = 0.8, alpha = 0.7) +
  labs(title = "B Prediction", x = "truth", y = "pred") +
  theme_classic(base_size = 7)
pred$risk_bin <- cut(pred$prob_LS, breaks = seq(0, 1, by = 0.2), include.lowest = TRUE)
cal <- aggregate(cbind(prob_LS, truth_num) ~ risk_bin, data = pred, FUN = mean)
panel_c <- ggplot(cal, aes(x = prob_LS, y = truth_num)) +
  geom_abline(linetype = "dashed", linewidth = 0.3, colour = "grey55") +
  geom_point(size = 1.2, colour = "#0072B2") +
  labs(title = "C Calibration", x = "mean risk", y = "observed") +
  theme_classic(base_size = 7)
pred$rank <- rank(-pred$prob_LS, ties.method = "first")
panel_d <- ggplot(pred, aes(x = rank, y = prob_LS, colour = true)) +
  geom_point(size = 0.9, alpha = 0.8) +
  labs(title = "D Ranked risk", x = "sample rank", y = "risk") +
  theme_classic(base_size = 7) + theme(legend.position = "top")
figure <- (panel_a | panel_b) / (panel_c | panel_d)
ggsave(output_file, figure, width = 183, height = 120, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK multipanel rows=", nrow(pred), "
", sep = "")

quit(status = 0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
#!/usr/bin/env Rscript
# Candidate restoration of the four-panel reference figure. Reproduces the
# README layout. K40 verification is still required before release.

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
  fail(3L, "BIOANALYS_SEED must be a non-negative integer")
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

png_file <- file.path(output_dir, "L3_multipanel_verified.png")
pdf_file <- file.path(output_dir, "L3_multipanel_verified.pdf")

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
  "R=", ifelse(is.null(getRversion()), "<unknown>", toString(getRversion())), "\n",
  "ggplot2=", as.character(packageVersion("ggplot2")), "\n",
  "patchwork=", as.character(packageVersion("patchwork")), "\n",
  "width_mm=183\n",
  "height_mm=120\n",
  "units=mm\n",
  "dpi=300\n",
  "png_device=cairo\n",
  "pdf_device=pdf\n",
  "output_png_name=L3_multipanel_verified.png\n",
  "output_pdf_name=L3_multipanel_verified.pdf\n",
  "RENDER_OK=multipanel\n",
  sep = "", file = report_file
)

cat("step_executed=L3_multipanel|report=L3_multipanel_report.txt\n")
