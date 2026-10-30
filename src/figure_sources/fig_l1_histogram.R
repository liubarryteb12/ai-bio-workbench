# Catalog-ID: 68
# Catalog-Title: Basic histogram with ggplot2
# Catalog-Page: https://r-graph-gallery.com/220-basic-ggplot2-histogram.html.html
# Catalog-Language: R
# Source-Match: exact
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
# library
library(ggplot2)
 
# dataset:
data=data.frame(value=rnorm(100))

# basic histogram
p <- ggplot(data, aes(x=value)) + 
  geom_histogram()

#p

# ---- chunk ----
# Libraries
library(tidyverse)
library(hrbrthemes)

# Load dataset from github
data <- read.table("https://raw.githubusercontent.com/holtzy/data_to_viz/master/Example_dataset/1_OneNum.csv", header=TRUE)

# plot
p <- data %>%
  filter( price<300 ) %>%
  ggplot( aes(x=price)) +
    geom_histogram( binwidth=3, fill="#69b3a2", color="#e9ecef", alpha=0.9) +
    ggtitle("Bin size = 3") +
    theme_ipsum() +
    theme(
      plot.title = element_text(size=15)
    )
#p

# ---- chunk ----
p

data %>%
  filter( price<300 ) %>%
  ggplot( aes(x=price)) +
    geom_histogram( binwidth=15, fill="#69b3a2", color="#e9ecef", alpha=0.9) +
    ggtitle("Bin size = 15") +
    theme_ipsum() +
    theme(
      plot.title = element_text(size=15)
    )

data %>%
  filter( price<300 ) %>%
  ggplot( aes(x=price)) +
    geom_histogram( binwidth=30, fill="#69b3a2", color="#e9ecef", alpha=0.9) +
    ggtitle("Bin size = 30") +
    theme_ipsum() +
    theme(
      plot.title = element_text(size=15)
    )

data %>%
  filter( price<300 ) %>%
  ggplot( aes(x=price)) +
    geom_histogram( binwidth=100, fill="#69b3a2", color="#e9ecef", alpha=0.9) +
    ggtitle("Bin size = 100") +
    theme_ipsum() +
    theme(
      plot.title = element_text(size=15)
    )
