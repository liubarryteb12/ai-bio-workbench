#!/usr/bin/env Rscript
args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 2L || args[[1L]] != "--output") {
  cat("usage: phase6_install_clusterprofiler.R --output <report-path>\n", file = stderr())
  quit(status = 2L)
}

report_path <- args[[2L]]
dir.create(dirname(report_path), recursive = TRUE, showWarnings = FALSE)

options(
  repos = c(CRAN = "https://cloud.r-project.org"),
  BioC_mirror = "https://bioconductor.org",
  Ncpus = 4L,
  timeout = 600L
)

status <- "pass"
error_message <- ""
tryCatch(
  {
    if (!requireNamespace("BiocManager", quietly = TRUE)) {
      stop("BiocManager is not installed")
    }
    BiocManager::install(
      "clusterProfiler",
      ask = FALSE,
      update = FALSE,
      Ncpus = 4L
    )
  },
  error = function(exc) {
    status <<- "fail"
    error_message <<- conditionMessage(exc)
  }
)

available <- requireNamespace("clusterProfiler", quietly = TRUE)
if (!available) {
  status <- "fail"
}
if (!available && error_message == "") {
  error_message <- paste(
    "dependency resolution did not produce an installable",
    "clusterProfiler package"
  )
}

version <- if (available) {
  as.character(utils::packageVersion("clusterProfiler"))
} else {
  "unavailable"
}

lines <- c(
  "step_executed=k40_phase6_clusterprofiler_install",
  paste0("status=", status),
  paste0("r_version=", R.version.string),
  paste0("bioconductor_version=", as.character(BiocManager::version())),
  paste0("clusterprofiler_version=", version),
  paste0("error=", error_message)
)
writeLines(lines, con = report_path, useBytes = TRUE)
cat(paste(lines, collapse = "\n"), "\n", sep = "")

if (status != "pass") {
  quit(status = 1L)
}
