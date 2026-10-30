# Figure-Contract: width_mm=88; height_mm=80; dpi=300; column=single
# Master-Source: src/figure_sources/fig_l2_pca.py | Master-SHA256: d27bba5db5a8cbf66578e41d6b1454fa6cc3c5b4d1ba18e204a9caf6bcb85583
# Catalog-ID: 484 | Catalog-Language: Python | Source-Match: analogous
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line1_bulk
# Adapt-Variable input_data: [object Object]
# Adapt-Variable group_col: [object Object]
adapt_vars <- list(
  input_data = 'data/line1_bulk/processed/pca_scores.tsv',
  group_col = 'group'
)

# Real-Data-Adapter: v1
# Project-Input: data/line1_bulk/processed/pca_scores.tsv
seed_value <- Sys.getenv("BIOANALYS_SEED", unset = "")
if (nchar(seed_value) == 0) quit(status = 3)
set.seed(as.integer(seed_value))
Sys.setenv(
  BIOANALYS_LAYOUT_PRESERVE_FIGSIZE = "1",
  BIOANALYS_LAYOUT_FIXED_CANVAS = "1"
)
input_data <- "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line1_bulk/processed/pca_scores.tsv"
output_file <- "figures/line1_bulk/L2_pca_verified.png"
width_mm <- 88
height_mm <- 80
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

# Real-data PCA overlay
suppressPackageStartupMessages({library(ggplot2)})
pca_df <- read.delim(input_data, check.names = FALSE)
group_name <- if (is.null(adapt_vars$group_col) || !nzchar(adapt_vars$group_col)) "group" else adapt_vars$group_col
if (!all(c("PC1", "PC2", group_name) %in% names(pca_df))) {
  stop(paste("PCA input columns missing:", group_name, "PC1", "PC2"))
}
pca_df[[group_name]] <- factor(pca_df[[group_name]])
group_sizes <- table(pca_df[[group_name]])
pc_cols <- grep("^PC[0-9]+$", names(pca_df), value = TRUE)
pc_cols <- pc_cols[order(as.integer(sub("PC", "", pc_cols)))]
pc_variance <- vapply(pca_df[pc_cols], stats::var, numeric(1), na.rm = TRUE)
pc_pct <- 100 * pc_variance / sum(pc_variance, na.rm = TRUE)
x_label <- if (length(pc_cols) >= 3) sprintf("PC1 (%.1f%% of shown PCs)", pc_pct[["PC1"]]) else "PC1"
y_label <- if (length(pc_cols) >= 3) sprintf("PC2 (%.1f%% of shown PCs)", pc_pct[["PC2"]]) else "PC2"
pca_plot <- ggplot(pca_df, aes(x = PC1, y = PC2, colour = .data[[group_name]], shape = .data[[group_name]])) +
  geom_point(size = 1.7, alpha = 0.9, stroke = 0.25) +
  labs(colour = group_name, shape = group_name, x = x_label, y = y_label) +
  bioanalys_theme_single() +
  theme(legend.position = "right")
if (length(group_sizes) > 1 && all(group_sizes >= 3)) {
  pca_plot <- pca_plot + stat_ellipse(linewidth = 0.45, level = 0.95)
}
bioanalys_export_ggplot(
  pca_plot, output_file,
  width_mm = width_mm, height_mm = height_mm, dpi = dpi,
  template_id = "fig_l2_pca",
  dims = paste0("data_dimensions=rows=", nrow(pca_df), ";columns=", ncol(pca_df)),
  stats = paste0(
    "threshold=group_count>=3_for_ellipse;",
    "method=principal_component_scatter;ellipse_level=0.95"
  )
)
cat("ADAPT_REAL_INPUT_OK pca rows=", nrow(pca_df), "
", sep = "")

quit(status = 0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
# Catalog-ID: 484
# Catalog-Title: Visualise principal component analysis with Matplotlib
# Catalog-Page: https://python-graph-gallery.com/515-intro-pca-graph-python/
# Catalog-Language: Python
# Source-Match: analogous
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
# Libraries
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

# ---- cell ----
# Create our variables
sample_size = 100
random1 = np.random.uniform(30, 20, sample_size)
random2 = random1*3 + np.random.normal(10, 30, sample_size)
random3 = random2*-3 + np.random.normal(10, 100, sample_size)
random4 = random3*2 + np.random.normal(10, 500, sample_size)

df = pd.DataFrame({'variable1': random1,
                   'variable2': random2,
                   'variable3': random3,
                   'variable4': random4,})

# Scale our data using z-score normalization
scaler = StandardScaler()
data_scaled = scaler.fit_transform(df)
df = pd.DataFrame(data_scaled, columns=df.columns)

# ---- cell ----
# Init a PCA object where we will only keep the 2 first principal components
pca = PCA()

# Use the `fit_transform` method from this object to our dataframe
pca_results = pca.fit_transform(df)

# ---- cell ----
# Get the explained variance ratio for each principal component
explained_variance = pca.explained_variance_ratio_

# Set figsize
plt.figure(figsize=(10, 6))

# Create a scree plot to visualize the explained variance
plt.plot(range(1, len(explained_variance) + 1), # x-axis
         explained_variance*100, # convert explained variance in percentage
         marker='o', # add a marker at each value
        )

# Add title and axis label
plt.title('Scree Plot of Explained Variance for Principal Components')
plt.xlabel('Principal Component')
plt.ylabel('Explained Variance (in %)')

# Add label to x-axis
plt.xticks(range(1, len(explained_variance) + 1))

# Add grid in the background
plt.grid(True)

# Display the chart
plt.show()

# ---- cell ----
# Get the explained variance ratios for the selected components
explained_variances = pca.explained_variance_ratio_

# Get the principal component vectors (also known as loadings)
loadings = pca.components_.T * np.sqrt(explained_variances)

# Set figsize and other layout parameters
plt.figure(figsize=(8, 8))
plt.title('Correlation Circle Plot')
plt.xlabel('Principal Component 1')
plt.ylabel('Principal Component 2')

# Add variable labels to the plot
for i, feature in enumerate(df.columns):

    # Add the name of the variable near the arrow
    plt.annotate(feature, # variable name
                 (loadings[i, 0],
                  loadings[i, 1]),
                 color='red')
    
    # Add an arrow representing the variable on the new axis
    plt.arrow(0, 0,
              loadings[i, 0],
              loadings[i, 1],
              color='black',
              alpha=0.7, 
              width=0.01,
             )

# Fix x-axis between -1 and 1 is important for better visualization
plt.xlim(-1,1)
plt.ylim(-1,1)

# Add grid in the background
plt.grid(True)

# Display the chart
plt.show()

# ---- cell ----
# Create a scatter plot to visualize the observations in the 2D PCA space
plt.figure(figsize=(10, 6))
plt.scatter(pca_results[:, 0], # position on the first principal component of the observations
            pca_results[:, 1], alpha=0.7) # position on the second principal component of the observations

# Add title and axis label
plt.title('Scatter Plot of Observations in 2D PCA Space')
plt.xlabel('Principal Component 1')
plt.ylabel('Principal Component 2')

# (optionally) Add labels to each point based on their index in the original dataframe
for i, txt in enumerate(df.index):
    plt.annotate(txt, (pca_results[i, 0], pca_results[i, 1]), fontsize=8)
    # This might be useful when doing outlier detection

# Add grid in the background
plt.grid(True)

# Display the chart
plt.show()
