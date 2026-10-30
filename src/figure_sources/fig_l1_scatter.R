# Catalog-ID: 329
# Catalog-Title: Scatterplot with automatic text repel
# Catalog-Page: https://r-graph-gallery.com/web-scatterplot-with-text-repel-ggrepel.html
# Catalog-Language: R
# Source-Match: exact
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
knitr::opts_chunk$set(
  warning = FALSE, 
  message = FALSE
)

# ---- chunk ----
library(ggrepel)
library(palmerpenguins)
library(randomNames)
library(tidyverse)

# ---- chunk ----
## Generate random names
# The results of set.seed may depends on R version.
set.seed(2021+03+27)
name_vector <- randomNames(nrow(penguins), which.names = "first")

## Create 'highlight' indicator variable
penguins <- penguins %>% 
  mutate(
    name = name_vector,
    highlight = case_when(
      str_starts(name, "C") ~ name,
      TRUE ~ ""
      )
    ) 

# ---- chunk ----
# Note `color = species` and s`hape = species`.
# This means each species will have BOTH  a different color and shape.
plt <- ggplot(penguins, aes(x = flipper_length_mm, y = bill_length_mm)) +
  geom_point(
    aes(color = species, shape = species),
    size = 1.5, 
    alpha = 0.8 # It's nice to add some transparency because there may be overlap.
  ) +
  # Use custom colors
  scale_color_manual(
    values = c("#386cb0", "#fdb462", "#7fc97f")
  )

# ---- chunk ----
ggsave(
  filename = here::here("img", "fromTheWeb", "web-scatterplot-and-ggrepel-preview1.png"),
  width = 6,
  height = 6,
  plot = plt
)

# ---- chunk ----
plt <- plt + 
  geom_text_repel(
    aes(label = highlight),
    family = "Poppins",
    size = 3,
    min.segment.length = 0, 
    seed = 42, 
    box.padding = 0.5,
    max.overlaps = Inf,
    arrow = arrow(length = unit(0.010, "npc")),
    nudge_x = .15,
    nudge_y = .5,
    color = "grey50"
  )

# ---- chunk ----
ggsave(
  filename = here::here("img", "fromTheWeb", "web-scatterplot-and-ggrepel-preview2.png"),
  plot = plt,
  width = 6,
  height = 6,
  device = "png"
)

# ---- chunk ----
plt <- plt + 
  # Add axes labels, title, and subtitle
  labs(
    title = "Palmer Penguins Data Visualization",
    subtitle = "Scatter plot of flipper lenth vs bill length",
    x = "flip length (mm)",
    y = "bill length (mm)"
  ) +  
  theme(
    # The default font when not explicitly specified
    text = element_text(family = "Lobster Two", size = 8, color = "black"),
    
    # Customize legend text, position, and background.
    legend.text = element_text(size = 9, family = "Roboto"),
    legend.title = element_text(face = "bold", size=12, family = "Roboto"),
    legend.position = c(1, 0),
    legend.justification = c(1, 0),
    legend.background = element_blank(),
    # This one removes the background behind each key in the legend
    legend.key = element_blank(),
    
    # Customize title and subtitle font/size/color
    plot.title = element_text(
      family = "Lobster Two", 
      size = 20,
      face = "bold", 
      color = "#2a475e"
    ),
    plot.subtitle = element_text(
      family = "Lobster Two", 
      size = 15, 
      face = "bold", 
      color = "#1b2838"
    ),
    plot.title.position = "plot",
    
    # Adjust axis parameters such as size and color.
    axis.text = element_text(size = 10, color = "black"),
    axis.title = element_text(size = 12),
    axis.ticks = element_blank(),
    # Axis lines are now lighter than default
    axis.line = element_line(colour = "grey50"),
    
    # Only keep y-axis major grid lines, with a grey color and dashed type.
    panel.grid.minor = element_blank(),
    panel.grid.major.x = element_blank(),
    panel.grid.major.y = element_line(color = "#b4aea9", linetype ="dashed"),
    
    # Use a light color for the background of the plot and the panel.
    panel.background = element_rect(fill = "#fbf9f4", color = "#fbf9f4"),
    plot.background = element_rect(fill = "#fbf9f4", color = "#fbf9f4")
  )

# ---- chunk ----
ggsave(
  filename = here::here("img", "fromTheWeb", "web-scatterplot-and-ggrepel.png"),
  plot = plt,
  width = 6,
  height = 6,
  device = "png"
)

# ---- chunk ----
# Correlation | Ranking | Evolution.. 
htmltools::includeHTML("htmlChunkRelatedRanking.html")
