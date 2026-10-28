#!/usr/bin/env Rscript

output_path <- Sys.getenv("BIO_FIGURE_OUTPUT")
if (!nzchar(output_path)) {
  message("BIO_FIGURE_OUTPUT is required")
  quit(save = "no", status = 2L)
}

source_path <- commandArgs(trailingOnly = TRUE)
if (length(source_path) != 1L || !file.exists(source_path[[1]])) {
  message("exactly one existing source script is required")
  quit(save = "no", status = 2L)
}
source_path <- normalizePath(source_path[[1]], winslash = "/", mustWork = TRUE)
output_path <- normalizePath(output_path, winslash = "/", mustWork = FALSE)
output_dir <- dirname(output_path)
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

png(
  filename = output_path,
  width = 2400,
  height = 1800,
  res = 240,
  bg = "white",
  type = "cairo"
)

exit_code <- 0L
plot_env <- new.env(parent = globalenv())
result <- tryCatch(
  {
    exprs <- parse(source_path, encoding = "UTF-8")
    withCallingHandlers(
      eval(exprs, envir = plot_env, enclos = plot_env),
      message = function(message) {
        conditionMessage(message)
        invokeRestart("muffleMessage")
      }
    )
  },
  error = function(error) {
    exit_code <<- 1L
    message(paste0("adapter_render_error: ", conditionMessage(error)))
    NULL
  }
)

if (exit_code == 0L && !is.null(result)) {
  print_result <- tryCatch(
    print.eval(result),
    error = function(error) {
      exit_code <<- 1L
      message(paste0("adapter_print_error: ", conditionMessage(error)))
      NULL
    }
  )
}
dev.off()

if (exit_code != 0L || !file.exists(output_path) || file.size(output_path) == 0) {
  if (file.exists(output_path)) unlink(output_path)
  message("single figure output failed")
  quit(save = "no", status = if (exit_code != 0L) exit_code else 1L)
}

cat("single_figure_output=", output_path, "\n", sep = "")
cat("catalog_seed=", Sys.getenv("BIOANALYS_SEED"), "\n", sep = "")
quit(save = "no", status = 0L)
