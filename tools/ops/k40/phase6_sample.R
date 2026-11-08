#!/usr/bin/env Rscript
args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 2L || args[[1L]] != "--output") {
  cat("usage: phase6_sample.R --output <output-directory>\n", file = stderr())
  quit(status = 2L)
}

step_name <- "k40_phase6_r_sample"
fail <- function(message, status = 1L) {
  cat(
    sprintf("step_executed=%s status=fail reason=%s\n", step_name, message),
    file = stderr()
  )
  quit(status = status)
}

raw_seed <- Sys.getenv("BIOANALYS_SEED", unset = "")
if (raw_seed == "") {
  fail("BIOANALYS_SEED is required", 3L)
}
seed <- suppressWarnings(as.integer(raw_seed))
if (is.na(seed)) {
  fail("BIOANALYS_SEED must be an integer", 3L)
}

output_dir <- args[[2L]]
if (dir.exists(output_dir)) {
  fail(sprintf("output already exists: %s", output_dir), 2L)
}
dir.create(dirname(output_dir), recursive = TRUE, showWarnings = FALSE)

suppressPackageStartupMessages({
  library(DESeq2)
  library(edgeR)
  library(limma)
})

n_genes <- 500L
n_samples <- 12L
group <- factor(
  rep(c("control", "case"), each = 6L),
  levels = c("control", "case")
)
set.seed(seed)

base_mean <- stats::runif(n_genes, min = 25, max = 400)
group_effect <- rep(1, n_genes)
group_effect[1:30] <- 2.2
sample_effect <- stats::runif(n_samples, min = 0.75, max = 1.25)
counts <- matrix(
  NA_integer_,
  nrow = n_genes,
  ncol = n_samples,
  dimnames = list(
    sprintf("GENE_%04d", seq_len(n_genes)),
    sprintf("SAMPLE_%03d", seq_len(n_samples))
  )
)
for (sample_index in seq_len(n_samples)) {
  group_multiplier <- if (group[[sample_index]] == "case") group_effect else 1
  counts[, sample_index] <- stats::rnbinom(
    n_genes,
    mu = base_mean * group_multiplier * sample_effect[[sample_index]],
    size = 10
  )
}

col_data <- data.frame(
  sample_id = colnames(counts),
  group = group,
  row.names = colnames(counts)
)

started <- proc.time()[["elapsed"]]
cat(sprintf("step_executed=%s status=started seed=%d\n", step_name, seed))
flush.console()

temp_dir <- tempfile(
  pattern = paste0(".", basename(output_dir), "."),
  tmpdir = dirname(output_dir)
)
dir.create(temp_dir, recursive = TRUE)
on.exit(unlink(temp_dir, recursive = TRUE, force = TRUE), add = TRUE)

tryCatch(
  {
    edgeR_object <- edgeR::DGEList(counts = counts, group = group)
    edgeR_object <- edgeR::calcNormFactors(edgeR_object)
    design <- stats::model.matrix(~ group)
    voom_object <- limma::voom(edgeR_object, design = design)
    limma_fit <- limma::lmFit(voom_object, design)
    limma_fit <- limma::eBayes(limma_fit)
    limma_result <- limma::topTable(
      limma_fit,
      coef = "groupcase",
      number = Inf,
      sort.by = "P"
    )

    deseq_data <- DESeq2::DESeqDataSetFromMatrix(
      countData = counts,
      colData = col_data,
      design = ~ group
    )
    deseq_data <- DESeq2::DESeq(deseq_data, quiet = TRUE)
    deseq_result <- as.data.frame(
      DESeq2::results(
        deseq_data,
        contrast = c("group", "case", "control")
      )
    )
    deseq_result$gene <- rownames(deseq_result)
    deseq_result <- deseq_result[
      order(deseq_result$pvalue, deseq_result$padj, na.last = TRUE),
      c("gene", setdiff(names(deseq_result), "gene"))
    ]

    counts_path <- file.path(temp_dir, "synthetic_counts.tsv")
    limma_path <- file.path(temp_dir, "limma_voom_results.tsv")
    deseq_path <- file.path(temp_dir, "deseq2_results.tsv")
    plot_path <- file.path(temp_dir, "deseq2_volcano.png")

    write.table(
      data.frame(gene = rownames(counts), counts, check.names = FALSE),
      counts_path,
      sep = "\t",
      quote = FALSE,
      row.names = FALSE
    )
    write.table(
      data.frame(gene = rownames(limma_result), limma_result),
      limma_path,
      sep = "\t",
      quote = FALSE,
      row.names = FALSE
    )
    write.table(
      deseq_result,
      deseq_path,
      sep = "\t",
      quote = FALSE,
      row.names = FALSE,
      na = "NA"
    )

    finite_limma <- limma_result$P.Value[
      is.finite(limma_result$P.Value)
    ]
    finite_deseq <- deseq_result$pvalue[
      is.finite(deseq_result$pvalue)
    ]
    if (!identical(dim(counts), c(n_genes, n_samples))) {
      fail("unexpected count matrix dimensions")
    }
    if (any(counts < 0L) || any(!is.finite(counts))) {
      fail("count matrix contains invalid values")
    }
    if (nrow(limma_result) != n_genes || nrow(deseq_result) != n_genes) {
      fail("result row count mismatch")
    }
    if (length(finite_limma) == 0L || length(finite_deseq) == 0L) {
      fail("no finite p-values in results")
    }
    if (any(finite_limma < 0 | finite_limma > 1)) {
      fail("limma p-values outside [0, 1]")
    }
    if (any(finite_deseq < 0 | finite_deseq > 1)) {
      fail("DESeq2 p-values outside [0, 1]")
    }

    grDevices::png(plot_path, width = 1000, height = 700, res = 120)
    plot(
      deseq_result$log2FoldChange,
      -log10(pmax(deseq_result$pvalue, .Machine$double.xmin)),
      pch = 19,
      col = ifelse(
        !is.na(deseq_result$padj) & deseq_result$padj < 0.05,
        "#C74634",
        "#6E7B8B"
      ),
      xlab = "log2 fold change",
      ylab = "-log10 p-value",
      main = "DESeq2 differential expression"
    )
    grDevices::dev.off()

    artifacts <- c(counts_path, limma_path, deseq_path, plot_path)
    if (any(!file.exists(artifacts)) || any(file.info(artifacts)$size <= 0)) {
      fail("missing or empty artifacts")
    }
    png_header <- readBin(plot_path, what = "raw", n = 8L)
    if (!identical(as.integer(png_header), c(137L, 80L, 78L, 71L, 13L, 10L, 26L, 10L))) {
      fail("volcano plot is not a valid PNG")
    }

    sha256 <- function(path) {
      output <- system2(
        "sha256sum",
        shQuote(path),
        stdout = TRUE,
        stderr = FALSE
      )
      strsplit(output[[1L]], " ", fixed = TRUE)[[1L]][[1L]]
    }
    status_path <- "/proc/self/status"
    status_lines <- readLines(status_path, warn = FALSE)
    peak_line <- grep("^VmHWM:", status_lines, value = TRUE)
    peak_memory_kb <- if (length(peak_line) == 1L) {
      sub("^VmHWM:\\s+([0-9]+).*$", "\\1", peak_line)
    } else {
      "unavailable"
    }
    thermal_files <- Sys.glob("/sys/class/thermal/thermal_zone*/temp")
    thermal_values <- suppressWarnings(vapply(
      thermal_files,
      function(path) {
        value <- tryCatch(
          {
            raw_value <- readLines(path, warn = FALSE, n = 1L)
            if (length(raw_value) != 1L) {
              NA_real_
            } else {
              as.numeric(raw_value) / 1000
            }
          },
          error = function(exc) NA_real_
        )
        value
      },
      numeric(1L)
    ))
    thermal_values <- thermal_values[
      is.finite(thermal_values) & thermal_values > 0 & thermal_values < 150
    ]
    max_temp <- if (length(thermal_values) > 0L) {
      sprintf("%.1f", max(thermal_values))
    } else {
      "unavailable"
    }

    elapsed <- proc.time()[["elapsed"]] - started
    report_path <- file.path(temp_dir, "phase6_report.txt")
    report_lines <- c(
      sprintf("step_executed=%s", step_name),
      "status=pass",
      sprintf("seed=%d", seed),
      sprintf("r_version=%s", R.version.string),
      sprintf("limma=%s", as.character(packageVersion("limma"))),
      sprintf("edgeR=%s", as.character(packageVersion("edgeR"))),
      sprintf("DESeq2=%s", as.character(packageVersion("DESeq2"))),
      sprintf("matrix_shape=%dx%d", nrow(counts), ncol(counts)),
      sprintf("control_samples=%d", sum(group == "control")),
      sprintf("case_samples=%d", sum(group == "case")),
      sprintf("limma_top_gene=%s", rownames(limma_result)[[1L]]),
      sprintf("limma_top_p_value=%.8g", limma_result$P.Value[[1L]]),
      sprintf("deseq2_top_gene=%s", deseq_result$gene[[1L]]),
      sprintf("deseq2_top_p_value=%.8g", deseq_result$pvalue[[1L]]),
      sprintf("elapsed_seconds=%.3f", elapsed),
      sprintf("peak_rss_kb=%s", peak_memory_kb),
      sprintf("max_temp_c=%s", max_temp),
      sprintf("counts_sha256=%s", sha256(counts_path)),
      sprintf("limma_results_sha256=%s", sha256(limma_path)),
      sprintf("deseq2_results_sha256=%s", sha256(deseq_path)),
      sprintf("volcano_sha256=%s", sha256(plot_path))
    )
    writeLines(report_lines, con = report_path, useBytes = TRUE)
    if (!file.rename(temp_dir, output_dir)) {
      fail("could not publish output directory")
    }
    on.exit(NULL, add = FALSE)
    cat(
      sprintf(
        "step_executed=%s status=pass output=%s\n",
        step_name,
        output_dir
      )
    )
    cat(readLines(file.path(output_dir, "phase6_report.txt")), sep = "\n")
    cat("\n")
  },
  error = function(exc) {
    call_text <- paste(deparse(conditionCall(exc)), collapse = " ")
    fail(
      sprintf("%s [call=%s]", conditionMessage(exc), call_text),
      1L
    )
  }
)
