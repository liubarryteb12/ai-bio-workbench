suppressPackageStartupMessages({
  library(ggplot2); library(dplyr); library(ggpubr); library(rstatix)
})
set.seed(42)
variety   <- rep(LETTERS[1:4], each = 40)
treatment <- rep(c("high", "low"), each = 20)
note      <- seq(1:160) + sample(1:150, 160, replace = TRUE)
df <- data.frame(variety, treatment, note)

# 色盲友好：Okabe-Ito 蓝/朱，不用红绿
pal <- c("high" = "#0072B2", "low" = "#D55E00")

df_p_val1 <- df %>%
  mutate(variety = factor(variety)) %>%
  group_by(variety) %>%
  wilcox_test(formula = note ~ treatment) %>%
  add_significance(p.col = "p", cutpoints = c(0, 0.001, 0.01, 0.05, 1),
                   symbols = c("***", "**", "*", "ns")) %>%
  add_xy_position(x = "variety")

df_p_val2 <- df %>%
  wilcox_test(formula = note ~ variety) %>%
  add_significance(p.col = "p", cutpoints = c(0, 0.001, 0.01, 0.05, 1),
                   symbols = c("***", "**", "*", "ns")) %>%
  add_xy_position()

p <- ggplot() +
  geom_boxplot(data = df, mapping = aes(x = variety, y = note, fill = treatment),
               width = 0.5, outlier.colour = "grey30", outlier.size = 1.2) +
  scale_fill_manual(values = pal) +
  stat_pvalue_manual(df_p_val1, label = "{p.signif}", tip.length = 0) +
  stat_pvalue_manual(df_p_val2, label = "{p.signif}", tip.length = 0,
                     y.position = df_p_val2$y.position + 0.5) +
  labs(x = "variety", y = "note") +
  guides(fill = guide_legend(title = "treatment")) +
  theme_classic(base_size = 7) +
  theme(axis.text = element_text(color = "black"),
        legend.position = c(0.72, 0.12),
        legend.direction = "horizontal")

out_dir <- Sys.getenv("R453_OUT_DIR", unset = getwd())
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
ggsave(file.path(out_dir, "L1_boxplot_verified.pdf"), p, width = 89, height = 60, units = "mm")
ggsave(file.path(out_dir, "L1_boxplot_verified.png"), p, width = 89, height = 60, units = "mm", dpi = 300, device = png, type = "cairo")
cat("RENDER_OK\n")
cat("pkgs:", paste(rownames(installed.packages()[, "Package", drop = FALSE])[1], collapse = ""), "\n")
