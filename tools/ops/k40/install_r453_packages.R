#!/usr/bin/env Rscript
args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 2L || args[[1L]] != "--output") {
  cat("usage: install_r453_packages.R --output <report-path>\n", file = stderr())
  quit(status = 2L)
}

report_path <- args[[2L]]
r_prefix <- "/opt/R/4.5.3"
site_library <- "/opt/R/4.5.3-site-library"
source_cache <- file.path(site_library, ".src")
cran_repo <- "https://mirrors.aliyun.com/CRAN/"
bioc_mirror <- "https://mirrors.ustc.edu.cn/bioc/"
bioc_version <- "3.23"
bioc_repos <- c(
  CRAN = cran_repo,
  BioCsoft = paste0(bioc_mirror, bioc_version, "/bioc"),
  BioCann = paste0(bioc_mirror, bioc_version, "/data/annotation"),
  BioCexp = paste0(bioc_mirror, bioc_version, "/data/experiment")
)

if (!file.exists(file.path(r_prefix, "bin", "Rscript"))) {
  stop("R 4.5.3 runtime is not installed")
}
if (!startsWith(normalizePath(.libPaths()[[1L]]), site_library)) {
  stop("site library is not first in .libPaths()")
}
dir.create(dirname(report_path), recursive = TRUE, showWarnings = FALSE)
dir.create(source_cache, recursive = TRUE, showWarnings = FALSE)

options(
  repos = c(CRAN = cran_repo),
  BioC_mirror = bioc_mirror,
  download.file.method = "libcurl",
  download.file.extra = NULL,
  Ncpus = 3L,
  timeout = 1800L,
  warn = 1L
)
Sys.setenv(
  OMP_NUM_THREADS = "3",
  OPENBLAS_NUM_THREADS = "3",
  MKL_NUM_THREADS = "3",
  VECLIB_MAXIMUM_THREADS = "3",
  NUMEXPR_NUM_THREADS = "3"
)

log_line <- function(...) {
  message <- sprintf(...)
  cat(message, "\n", sep = "")
  flush.console()
}

installed_version <- function(package) {
  if (requireNamespace(package, quietly = TRUE)) {
    as.character(utils::packageVersion(package))
  } else {
    NA_character_
  }
}

install_cran <- function(packages) {
  missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]
  if (length(missing) == 0L) {
    return(invisible(NULL))
  }
  log_line("Installing CRAN packages: %s", paste(missing, collapse = ", "))
  utils::install.packages(
    missing,
    repos = cran_repo,
    dependencies = c("Depends", "Imports", "LinkingTo"),
    Ncpus = 3L
  )
}

install_bioc <- function(packages) {
  missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]
  if (length(missing) == 0L) {
    return(invisible(NULL))
  }
  log_line("Installing Bioc 3.23 packages: %s", paste(missing, collapse = ", "))
  utils::install.packages(
    missing,
    repos = bioc_repos,
    dependencies = c("Depends", "Imports", "LinkingTo"),
    Ncpus = 3L
  )
}

download_source <- function(url, filename) {
  destination <- file.path(source_cache, filename)
  if (!file.exists(destination) || file.info(destination)$size <= 0) {
    status <- system2(
      "curl",
      c(
        "-fL",
        "--retry", "3",
        "--connect-timeout", "20",
        "--max-time", "1800",
        "-o", destination,
        url
      )
    )
    if (status != 0L) {
      stop(sprintf("download failed: %s", url))
    }
  }
  destination
}

install_local <- function(url, filename) {
  archive <- download_source(url, filename)
  log_line("Installing local source package: %s", filename)
  utils::install.packages(
    archive,
    repos = NULL,
    type = "source",
    dependencies = FALSE,
    Ncpus = 3L
  )
}

log_line("step_executed=install_r453_packages status=started")

cran_packages <- c(
  "fracdiff",
  "fastcluster",
  "dynamicTreeCut",
  "tidyr",
  "dplyr",
  "zoo",
  "rlang",
  "rbibutils",
  "urca",
  "SparseM",
  "S7",
  "plyr",
  "data.table",
  "ggplot2",
  "matrixStats",
  "jsonlite",
  "glmnet",
  "survival",
  "rms",
  "pROC",
  "pheatmap",
  "patchwork",
  "ggrepel",
  "ggExtra",
  "ggpmisc",
  "ggpubr",
  "ggtext",
  "rstatix",
  "hrbrthemes",
  "FactoMineR",
  "factoextra",
  "ggfortify",
  "ggalluvial",
  "gridExtra",
  "scales",
  "viridis",
  "circlize"
)
install_cran(cran_packages)

bioc_packages <- c(
  "limma",
  "clusterProfiler",
  "org.Hs.eg.db",
  "org.Mm.eg.db",
  "org.Rn.eg.db",
  "ComplexHeatmap",
  "ggtree",
  "enrichplot",
  "fgsea",
  "DOSE",
  "GOSemSim",
  "aplot",
  "ReactomePA",
  "BiocParallel",
  "SingleCellExperiment",
  "sparseMatrixStats",
  "DelayedArray",
  "DelayedMatrixStats",
  "HDF5Array",
  "BiocSingular",
  "AnnotationDbi",
  "Biobase",
  "SummarizedExperiment",
  "S4Vectors",
  "IRanges",
  "graph",
  "GO.db",
  "GSEABase",
  "impute",
  "preprocessCore"
)
install_bioc(bioc_packages)

if (!identical(installed_version("WGCNA"), "1.74")) {
  install_local(
    "https://mirrors.aliyun.com/CRAN/src/contrib/WGCNA_1.74.tar.gz",
    "WGCNA_1.74.tar.gz"
  )
}

if (!identical(installed_version("GSVA"), "1.50.5")) {
  if (requireNamespace("GSVA", quietly = TRUE)) {
    utils::remove.packages("GSVA")
  }
  install_local(
    "https://bioconductor.org/packages/3.18/bioc/src/contrib/GSVA_1.50.5.tar.gz",
    "GSVA_1.50.5.tar.gz"
  )
}

required_packages <- c(
  "fracdiff",
  "fastcluster",
  "dynamicTreeCut",
  "tidyr",
  "dplyr",
  "zoo",
  "rlang",
  "rbibutils",
  "urca",
  "SparseM",
  "S7",
  "plyr",
  "data.table",
  "limma",
  "ggplot2",
  "matrixStats",
  "WGCNA",
  "jsonlite",
  "clusterProfiler",
  "org.Hs.eg.db",
  "glmnet",
  "survival",
  "rms",
  "GSVA",
  "GSEABase",
  "ComplexHeatmap",
  "ggtree",
  "enrichplot",
  "fgsea",
  "DOSE",
  "GOSemSim",
  "aplot",
  "ReactomePA",
  "pROC",
  "pheatmap",
  "patchwork",
  "ggrepel",
  "ggExtra",
  "ggpmisc",
  "ggpubr",
  "ggtext",
  "rstatix",
  "hrbrthemes",
  "FactoMineR",
  "factoextra",
  "ggfortify",
  "ggalluvial",
  "gridExtra",
  "scales",
  "viridis",
  "circlize"
)

load_ok <- vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)
failed <- required_packages[!load_ok]
versions <- vapply(required_packages, installed_version, character(1))
version_lines <- sprintf("%s=%s", required_packages, versions)

status <- if (length(failed) == 0L) "pass" else "fail"
lines <- c(
  "step_executed=install_r453_packages",
  sprintf("status=%s", status),
  sprintf("r_version=%s", R.version.string),
  sprintf("site_library=%s", .libPaths()[[1L]]),
  sprintf("bioconductor_repository=%s", bioc_version),
  version_lines
)
if (length(failed) > 0L) {
  lines <- c(lines, sprintf("failed=%s", paste(failed, collapse = ",")))
}
writeLines(lines, con = report_path, useBytes = TRUE)
cat(paste(lines, collapse = "\n"), "\n", sep = "")

if (length(failed) > 0L) {
  quit(status = 1L)
}
