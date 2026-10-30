# Catalog-ID: 227
# Catalog-Title: ggplot2 heatmap
# Catalog-Page: https://r-graph-gallery.com/79-levelplot-with-ggplot2.html
# Catalog-Language: R
# Source-Match: exact
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
# Library
library(ggplot2)

# Dummy data
x <- LETTERS[1:20]
y <- paste0("var", seq(1,20))
data <- expand.grid(X=x, Y=y)
data$Z <- runif(400, 0, 5)
 
# Heatmap 
ggplot(data, aes(X, Y, fill= Z)) + 
  geom_tile()

# ---- chunk ----
# Library
library(ggplot2)
library(hrbrthemes)

# Dummy data
x <- LETTERS[1:20]
y <- paste0("var", seq(1,20))
data <- expand.grid(X=x, Y=y)
data$Z <- runif(400, 0, 5)
 
# Give extreme colors:
ggplot(data, aes(X, Y, fill= Z)) + 
  geom_tile() +
  scale_fill_gradient(low="white", high="blue") +
  theme_ipsum()

# Color Brewer palette
ggplot(data, aes(X, Y, fill= Z)) + 
  geom_tile() +
  scale_fill_distiller(palette = "RdPu") +
  theme_ipsum()

# Color Brewer palette
library(viridis)
ggplot(data, aes(X, Y, fill= Z)) + 
  geom_tile() +
  scale_fill_viridis(discrete=FALSE) +
  theme_ipsum()

# ---- chunk ----
# Library
library(ggplot2)
library(tidyr)
library(tibble)
library(hrbrthemes)
library(dplyr)

# Volcano dataset
#volcano

# Heatmap 
volcano %>%
  
  # Data wrangling
  as_tibble() %>%
  rowid_to_column(var="X") %>%
  gather(key="Y", value="Z", -1) %>%
  
  # Change Y to numeric
  mutate(Y=as.numeric(gsub("V","",Y))) %>%

  # Viz
  ggplot(aes(X, Y, fill= Z)) + 
    geom_tile() +
    theme_ipsum() +
    theme(legend.position="none")

# ---- chunk ----
# Library
library(ggplot2)
library(hrbrthemes)
library(plotly)

# Dummy data
x <- LETTERS[1:20]
y <- paste0("var", seq(1,20))
data <- expand.grid(X=x, Y=y)
data$Z <- runif(400, 0, 5)
 
# new column: text for tooltip:
data <- data %>%
  mutate(text = paste0("x: ", x, "\n", "y: ", y, "\n", "Value: ",round(Z,2), "\n", "What else?"))

# classic ggplot, with text in aes
p <- ggplot(data, aes(X, Y, fill= Z, text=text)) + 
  geom_tile() +
  theme_ipsum()

ggplotly(p, tooltip="text")

# save the widget
# library(htmlwidgets)
# saveWidget(pp, file=paste0( getwd(), "/HtmlWidget/ggplotlyHeatmap.html"))
