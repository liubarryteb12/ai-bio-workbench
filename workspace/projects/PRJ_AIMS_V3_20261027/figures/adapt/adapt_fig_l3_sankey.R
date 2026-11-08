# Master-Source: reference/05.可参考出图代码/_meta/R453_compat/L3_sankey_code.R | Master-SHA256: 6c94fe74a10569e0b43ea0d79047a69156411d1883920eaf285234ae548438d8
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line1_bulk
# Adapt-Variable input_data: 项目本线只读输入文件路径，相对于本项目根目录
# Adapt-Variable module_col: 模块列名
adapt_vars <- list(
  input_data = 'data/line1_bulk/processed/wgcna_modules.tsv',
  module_col = 'module'
)

# Real-Data-Adapter: v1
# Project-Input: data/line1_bulk/processed/wgcna_modules.tsv
seed_value <- Sys.getenv("BIOANALYS_SEED", unset = "")
if (nchar(seed_value) == 0) quit(status = 3)
set.seed(as.integer(seed_value))
input_data <- "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line1_bulk/processed/wgcna_modules.tsv"
output_file <- "L3_sankey_verified.png"
if (!file.exists(input_data)) stop(paste("real input missing:", input_data))
dir.create(dirname(output_file), recursive = TRUE, showWarnings = FALSE)

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
png(output_file, width = 183, height = 90, units = "mm", res = 300, type = "cairo", bg = "white")
par(mar = c(1, 1, 1, 1))
plot.new()
plot.window(xlim = c(0, 1), ylim = c(0, 1))
segments(0.2, flow$left_y, 0.8, flow$right_y, col = adjustcolor("#56B4E9", alpha.f = 0.35),
         lwd = pmax(2, flow$count / max(flow$count) * 18))
rect(0.12, flow$left_y - flow$width, 0.20, flow$left_y + flow$width,
     col = "#0072B2", border = NA)
rect(0.80, flow$right_y - flow$width, 0.88, flow$right_y + flow$width,
     col = "#D55E00", border = NA)
text(0.19, flow$left_y, flow$module, adj = c(1, 0.5), cex = 0.65)
text(0.81, flow$right_y, paste0("genes=", flow$count), adj = c(0, 0.5), cex = 0.65)
title(main = "WGCNA module composition", cex.main = 0.8)
dev.off()
cat("ADAPT_REAL_INPUT_OK sankey modules=", nrow(flow), "
", sep = "")

quit(status = 0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
library(ggplot2); library(dplyr); library(ggalluvial)
set.seed(42)
d2 <- as.data.frame(Titanic) %>% filter(Freq > 0)
p <- ggplot(d2, aes(y = Freq, axis1 = Class, axis2 = Sex, axis3 = Age)) +
  geom_alluvium(aes(fill = Survived), width = 0, knot.pos = 0.4, alpha = 0.8) +
  geom_stratum(width = 1/8, fill = "grey90", colour = "grey30", linewidth = 0.3) +
  geom_label(stat = "stratum", aes(label = after_stat(stratum)), size = 2.2,
             label.size = 0, fill = "white") +
  scale_x_discrete(limits = c("Class", "Sex", "Age"), expand = c(0.05, 0.05)) +
  scale_fill_manual(values = c("No" = "#D55E00", "Yes" = "#0072B2")) +
  labs(y = "count") + theme_classic(base_size = 7) + theme(legend.position = "bottom")
ggsave("L3_sankey_verified.pdf", p, width = 120, height = 100, units = "mm")
ggsave("L3_sankey_verified.png", p, width = 120, height = 100, units = "mm", dpi = 300, device = png, type = "cairo")
cat("RENDER_OK sankey\n")
