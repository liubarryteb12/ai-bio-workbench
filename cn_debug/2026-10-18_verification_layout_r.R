# R 端出图模板自动挂载验证（在服务器上跑）
#
# 由 R_PROFILE_USER 加载 layout_autoload/Rprofile 后，ggsave 应自动套用
# project.json 的 plot_layout_config。本脚本只负责出图，几何校验交给
# 同目录的 Python 验证脚本（统一用 PIL 量像素，避免两端各写一套判据）。
#
# 跑法：
#   BIOANALYS_PROJECT_JSON=<project.json> R_PROFILE_USER=<Rprofile> \
#     Rscript 2026-10-18_verification_layout_r.R <输出png>

args <- commandArgs(trailingOnly = TRUE)
out <- if (length(args) >= 1) args[1] else "/tmp/layout_r_test.png"

if (!requireNamespace("ggplot2", quietly = TRUE)) {
  cat("SKIP | 本机没有 ggplot2\n")
  quit(status = 0)
}
suppressPackageStartupMessages(library(ggplot2))

labels <- c("Non_Lesional_Ctrl", "Lesional_Week2", "Lesional_Week4",
            "Lesional_Week8", "Treated_Week2", "Treated_Week4")
df <- data.frame(group = factor(labels, levels = labels), n = seq_along(labels))

p <- ggplot(df, aes(x = group, y = n, fill = group)) +
  geom_col() +
  labs(title = "DEG counts by group", y = "Gene count", x = NULL) +
  theme(legend.position = "right")

# 不传 width/height：模板应自己定画幅（16:9）
ggsave(out, plot = p)
cat("saved", out, "\n")
