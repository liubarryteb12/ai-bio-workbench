# Catalog-ID: 683
# Catalog-Title: Scatterplot with labels and text repel in Matplotlib
# Catalog-Page: https://python-graph-gallery.com/web-text-repel-with-matplotlib/
# Catalog-Language: Python
# Source-Match: analogous
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
import matplotlib.pyplot as plt
import numpy as np

from adjustText import adjust_text
from faker import Faker
from palmerpenguins import load_penguins

# ---- cell ----
penguins = load_penguins()
penguins.head()

# ---- cell ----
penguins = penguins.dropna()

# ---- cell ----
# Colors
BG_WHITE = "#fbf9f4"
GREY_LIGHT = "#b4aea9"
GREY50 = "#7F7F7F"
GREY30 = "#4d4d4d"
BLUE_DARK = "#1B2838"
BLUE = "#2a475e"
COLORS = ["#386cb0", "#fdb462", "#7fc97f" ] # A color for each species

# A list with the species names
SPECIES = sorted(penguins["species"].unique())

# Horizontal lines
HLINES = [40, 50, 60]

# Vertical and horizontal tick marks
YTICKS = [40, 50, 60]
XTICKS = [160, 170, 180, 190, 200, 210, 220, 230, 240]

# List of random names
# Generate Faker instance and set seed or reproducibility
faker = Faker()
# Set seed for reproducibility of the random names
faker.seed_instance(11) 
NAMES = [faker.first_name() for i in range(len(penguins))]

# The markers we use in the scatterplot
MARKERS = ["o", "^", "s"] # circle, triangle, square

# ---- cell ----
# Initialize layout ----------------------------------------------
fig, ax = plt.subplots(figsize= (14, 10))

# Background color
fig.patch.set_facecolor(BG_WHITE)
ax.set_facecolor(BG_WHITE)

# Horizontal lines in the background
for h in HLINES:
    ax.axhline(h, color=GREY50, ls=(0, (5, 5)), alpha=0.8, zorder=0)

# Add scatterplot  -----------------------------------------------
# Loop through species, colors, and markers.
# Each species receives a different combination of color and marker.
for species, color, marker  in zip(SPECIES, COLORS, MARKERS):
    data = penguins[penguins["species"] == species]
    ax.scatter(
        "flipper_length_mm", "bill_length_mm", s=50, color=color, 
        marker=marker, alpha=0.8, data=data
    )

# ---- cell ----
# Add name labels ------------------------------------------------
# Only names that start with the letter "C" are added.
# `ax.text()` outputs are appended to the `TEXTS` list. 
# This list is passed to `adjust_text()` to repel the labels and add arrows.
TEXTS = []
for i in range(len(penguins)):
    if NAMES[i].startswith("C"):
        x = penguins["flipper_length_mm"].iloc[i]
        y = penguins["bill_length_mm"].iloc[i]
        text = NAMES[i]
        TEXTS.append(ax.text(x, y, text, color=GREY30, fontsize=14, fontname="Poppins"))


# Adjust text position and add arrows ----------------------------
# 'expand_points' is a tuple with two multipliers by which to expand
# the bounding box of texts when repelling them from points

# 'arrowprops' receives a dictionary with all the properties we want
# for the arrows
adjust_text(
    TEXTS, 
    expand_points=(2, 2),
    arrowprops=dict(
        arrowstyle="->", 
        color=GREY50, 
        lw=2
    ),
    ax=fig.axes[0]
)
fig

# ---- cell ----
# Add title and subtitle -----------------------------------------
# Title
fig.suptitle(
    "Palmer Penguins Data Visualization",
    x = 0.122,
    y = 0.975,
    ha="left",
    fontsize=32,
    fontname="Lobster Two",
    color=BLUE,
    weight="bold",    
)

# Subtitle
ax.set_title(
    "Scatter plot of flipper length vs bill length",
    loc="left",
    ha="left",
    fontsize=24,
    fontname="Lobster Two",
    color=BLUE_DARK,
    weight="bold",
    pad=10
)

# Add legend -----------------------------------------------------

# We store the result of `ax.legend()` for further customizations
legend = ax.legend(
    loc=(0.85, 0.025), # bottom-right
    labelspacing=1.5,  # add space between labels
    markerscale=1.5,   # increase marker size
    frameon=False      # don't put a frame
)

# Iterate through text elements and species names
for text, species in zip(legend.get_texts(), SPECIES):
    text.set_text(species)       # Set species name
    text.set_fontname("Roboto")  # Change default font 
    text.set_fontsize(16)        # Change default font size

# Grab title and customize its appearence.
legend.set_title("Species")
legend_title = legend.get_title()
legend_title.set_fontname("Roboto")
legend_title.set_fontweight("bold")
legend_title.set_fontsize(18)
legend_title.set_ha("left")

# Customize layout -----------------------------------------------
# Hide spines
ax.spines["right"].set_color("none")
ax.spines["top"].set_color("none")

# Customize spines color
ax.spines["left"].set_color(GREY_LIGHT)
ax.spines["left"].set_linewidth(2)
ax.spines["bottom"].set_color(GREY_LIGHT)
ax.spines["bottom"].set_linewidth(2)

# Customize labels and ticks
ax.tick_params(length=0)

ax.set_yticks(YTICKS)
ax.set_yticklabels(YTICKS, fontname="Lobster Two", size=15)
ax.set_ylabel("bill Length (mm)", fontname="Lobster Two", size=18, weight="bold")

ax.set_xticks(XTICKS)
ax.set_xticklabels(XTICKS, fontname="Lobster Two", size=15)
ax.set_xlabel("flip length (mm)", fontname="Lobster Two", size=18, weight="bold")

fig
