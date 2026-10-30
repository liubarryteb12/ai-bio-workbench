#!/usr/bin/env Rscript

usage <- function() {
  cat(
    "Usage: audit_figure_rds.R --contract-dir <dir> [--manifest <manifest.json>]\n",
    sep = ""
  )
}

fail <- function(code, message) {
  cat("ERR:", message, "\n", file = stderr())
  quit(status = code)
}

args <- commandArgs(trailingOnly = TRUE)
contract_dir <- NULL
manifest_path <- NULL
i <- 1L
while (i <= length(args)) {
  key <- args[[i]]
  if (key == "--contract-dir") {
    if (i == length(args)) fail(2, "missing value for --contract-dir")
    contract_dir <- args[[i + 1L]]
    i <- i + 2L
  } else if (key == "--manifest") {
    if (i == length(args)) fail(2, "missing value for --manifest")
    manifest_path <- args[[i + 1L]]
    i <- i + 2L
  } else if (key %in% c("-h", "--help")) {
    usage()
    quit(status = 0)
  } else {
    fail(2, paste("unknown argument:", key))
  }
}
if (is.null(contract_dir)) fail(2, "--contract-dir is required")
if (!dir.exists(contract_dir)) fail(2, paste("contract directory not found:", contract_dir))
if (is.null(manifest_path)) manifest_path <- file.path(contract_dir, "manifest.json")
if (!file.exists(manifest_path)) fail(2, paste("manifest not found:", manifest_path))
if (!requireNamespace("jsonlite", quietly = TRUE)) fail(2, "jsonlite is required")

manifest <- jsonlite::fromJSON(manifest_path, simplifyVector = FALSE)
figures <- manifest$figures
if (length(figures) == 0L) fail(2, "manifest has no figures")

failed <- 0L
for (entry in figures) {
  if (!identical(entry$object_kind, "rds")) next
  png_path <- file.path(contract_dir, entry$canonical_output)
  rds_path <- paste0(tools::file_path_sans_ext(png_path), "_plot.rds")
  label <- as.character(entry$template_id)
  issues <- character()
  if (!file.exists(rds_path)) {
    issues <- c(issues, "RDS missing")
  } else {
    object <- tryCatch(readRDS(rds_path), error = function(e) e)
    if (inherits(object, "error")) {
      issues <- c(issues, paste("RDS read failed:", conditionMessage(object)))
    } else if (inherits(object, "ggplot")) {
      title <- object$labels$title
      if (length(title) && nzchar(trimws(as.character(title)[1]))) {
        issues <- c(issues, paste0("non-empty plot title: ", title))
      }
      theme <- object$theme
      if (!inherits(theme$plot.title, "element_blank")) {
        issues <- c(issues, "plot.title is not element_blank")
      }
      angle <- theme$axis.text.x$angle
      if (is.null(angle)) angle <- 0
      if (is.numeric(angle) && length(angle) && abs(angle[[1]]) > 0.5) {
        issues <- c(issues, paste0("x tick rotation is ", angle[[1]], " degrees"))
      }
      legend_position <- theme$legend.position
      if (is.null(legend_position)) legend_position <- "right"
      if (is.numeric(legend_position)) {
        issues <- c(issues, "legend is positioned inside the axes")
      } else if (length(legend_position) &&
                 !(as.character(legend_position[[1]]) %in% c("right", "bottom", "top", "none"))) {
        issues <- c(issues, paste0("unsupported legend position: ", legend_position[[1]]))
      }
      axis_title_size <- theme$axis.title$size
      axis_text_size <- theme$axis.text$size
      if (is.null(axis_title_size) || is.na(axis_title_size) || axis_title_size > 7.01) {
        issues <- c(issues, "axis title size is not locked to 7 pt")
      }
      if (is.null(axis_text_size) || is.na(axis_text_size) || axis_text_size > 6.51) {
        issues <- c(issues, "axis text size is not locked to 6.5 pt")
      }
    } else if (!inherits(object, "recordedplot")) {
      issues <- c(issues, paste("unsupported R object class:", paste(class(object), collapse = "/")))
    }
  }
  if (length(issues)) {
    failed <- failed + 1L
    cat("[FAIL]", label, "\n")
    cat(paste0("  - ", issues, collapse = "\n"), "\n", sep = "")
  } else {
    cat("[PASS]", label, "\n")
  }
}

if (failed > 0L) quit(status = 1)
cat("SUMMARY: RDS layout audit passed\n")
