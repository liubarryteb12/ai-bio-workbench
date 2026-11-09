library(ggplot2); library(dplyr); library(ggalluvial)
set.seed(42)
d2 <- as.data.frame(Titanic) %>% filter(Freq > 0)
# 出图规范 v2.2：颜色编码分类必须给图例，且图例一律在轴框外（横版放轴框下方）；
# 标题与副标题禁用，改 caption() 一条一行置于轴框外；图内字号下限 8pt（约 2.8mm）。
p <- ggplot(d2, aes(y = Freq, axis1 = Class, axis2 = Sex, axis3 = Age)) +
  geom_alluvium(aes(fill = Survived), width = 0, knot.pos = 0.4, alpha = 0.8) +
  geom_stratum(width = 1/8, fill = "grey90", colour = "grey30", linewidth = 0.3) +
  geom_label(stat = "stratum", aes(label = after_stat(stratum)), size = 2.8,
             label.size = 0, fill = "white") +
  scale_x_discrete(limits = c("Class", "Sex", "Age"), expand = c(0.05, 0.05)) +
  scale_fill_manual(values = c("No" = "#EE0000", "Yes" = "#3B4992"),
                    labels = c(No = "No (died)", Yes = "Yes (survived)"), name = NULL) +
  labs(y = "Passengers",
       caption = paste("line: master sankey (Titanic benchmark)",
                       "ribbon width = real passenger count",
                       "stages: class -> sex -> age",
                       "red = died, blue = survived", sep = "\n")) +
  theme_classic(base_size = 8) +
  theme(legend.position = "bottom",
        legend.direction = "horizontal",
        legend.frame = element_blank(),
        legend.text = element_text(size = 8),
        axis.text = element_text(size = 8),
        axis.line.y = element_blank(),
        axis.ticks.y = element_blank(),
        plot.caption.position = "plot",
        plot.caption = element_text(hjust = 0, size = 8))
ggsave("L3_sankey_verified.pdf", p, width = 120, height = 100, units = "mm")
ggsave("L3_sankey_verified.png", p, width = 120, height = 100, units = "mm", dpi = 300, device = png, type = "cairo")
cat("RENDER_OK sankey\n")
