# Catalog-ID: 215
# Catalog-Title: Grouped, stacked and percent stacked barplot in ggplot2
# Catalog-Page: https://r-graph-gallery.com/48-grouped-barplot-with-ggplot2.html
# Catalog-Language: R
# Source-Match: exact
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
 # library
library(ggplot2)
 
# create a dataset
specie <- c(rep("sorgho" , 3) , rep("poacee" , 3) , rep("banana" , 3) , rep("triticum" , 3) )
condition <- rep(c("normal" , "stress" , "Nitrogen") , 4)
value <- abs(rnorm(12 , 0 , 15))
data <- data.frame(specie,condition,value)
 
# Grouped
ggplot(data, aes(fill=condition, y=value, x=specie)) + 
    geom_bar(position="dodge", stat="identity")
 

# ---- chunk ----
 # library
library(ggplot2)
 
# create a dataset
specie <- c(rep("sorgho" , 3) , rep("poacee" , 3) , rep("banana" , 3) , rep("triticum" , 3) )
condition <- rep(c("normal" , "stress" , "Nitrogen") , 4)
value <- abs(rnorm(12 , 0 , 15))
data <- data.frame(specie,condition,value)
 
# Stacked
ggplot(data, aes(fill=condition, y=value, x=specie)) + 
    geom_bar(position="stack", stat="identity")
 

# ---- chunk ----
 # library
library(ggplot2)
 
# create a dataset
specie <- c(rep("sorgho" , 3) , rep("poacee" , 3) , rep("banana" , 3) , rep("triticum" , 3) )
condition <- rep(c("normal" , "stress" , "Nitrogen") , 4)
value <- abs(rnorm(12 , 0 , 15))
data <- data.frame(specie,condition,value)
 
# Stacked + percent
ggplot(data, aes(fill=condition, y=value, x=specie)) + 
    geom_bar(position="fill", stat="identity")
 

# ---- chunk ----
# library
library(ggplot2)
library(viridis)
library(hrbrthemes)

# create a dataset
specie <- c(rep("sorgho" , 3) , rep("poacee" , 3) , rep("banana" , 3) , rep("triticum" , 3) )
condition <- rep(c("normal" , "stress" , "Nitrogen") , 4)
value <- abs(rnorm(12 , 0 , 15))
data <- data.frame(specie,condition,value)
 
# Small multiple
ggplot(data, aes(fill=condition, y=value, x=specie)) + 
    geom_bar(position="stack", stat="identity") +
    scale_fill_viridis(discrete = T) +
    ggtitle("Studying 4 species..") +
    theme_ipsum() +
    xlab("")

# ---- chunk ----
# library
library(ggplot2)
library(viridis)
library(hrbrthemes)

# create a dataset
specie <- c(rep("sorgho" , 3) , rep("poacee" , 3) , rep("banana" , 3) , rep("triticum" , 3) )
condition <- rep(c("normal" , "stress" , "Nitrogen") , 4)
value <- abs(rnorm(12 , 0 , 15))
data <- data.frame(specie,condition,value)
 
# Graph
ggplot(data, aes(fill=condition, y=value, x=condition)) + 
    geom_bar(position="dodge", stat="identity") +
    scale_fill_viridis(discrete = T, option = "E") +
    ggtitle("Studying 4 species..") +
    facet_wrap(~specie) +
    theme_ipsum() +
    theme(legend.position="none") +
    xlab("")
