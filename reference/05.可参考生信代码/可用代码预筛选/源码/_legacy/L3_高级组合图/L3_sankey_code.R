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
