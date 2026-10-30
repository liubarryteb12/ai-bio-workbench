# Catalog-ID: 472
# Catalog-Title: Violin plot with Beeswarm
# Catalog-Page: https://python-graph-gallery.com/502-violinplot-and-swarmplot/
# Catalog-Language: Python
# Source-Match: exact
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
# libraries & dataset
import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt

# ---- cell ----
path = 'https://raw.githubusercontent.com/holtzy/The-Python-Graph-Gallery/master/static/data/sqa_data.csv'
data = pd.read_csv(path)

# ---- cell ----
# Palettes for the areas and the datapoints 
# Light colors for the dots
swarmplot_palette = {'Sqa_par':'#8f96bf', 'Sqa_bif':'#ebb0e5', 'Sqa_zz':'#9feed3'}

# Dark colors for the violin
violin_palette = {'Sqa_par':'#333c70', 'Sqa_bif':'#90367c', 'Sqa_zz':'#34906c'}

# ---- cell ----
# create figure and seaborn context
sns.set_context('notebook', font_scale=1.2)
fig, ax = plt.subplots(figsize=(8,4))

# Plot the violin
ax = sns.violinplot(y="dist", 
                    x="name", 
                    data=data,
                    palette=violin_palette,
                    scale='count',
                    inner=None
              )

plt.show()

# ---- cell ----
# create figure and seaborn context
sns.set_context('notebook', font_scale=1.2)
fig, ax = plt.subplots(figsize=(8,5))

# Plot the violin
ax = sns.violinplot(y="dist", 
                    x="name", 
                    data=data,
                    palette=violin_palette,
                    scale='count',
                    inner=None
              )

# Plot the swarmplot on top 
ax = sns.swarmplot(y="dist",
                   x="name",
                   data=data, 
                   color="white", 
                   edgecolor="gray",
                   s=6, # Circle size
                   palette=swarmplot_palette
             )

# Change axis labels, ticks and title
ax.set_xticks([0, 1, 2], ['Parallel','Bifurcated','Zig-zag'])
ax.set_xlabel('Squaramide CCSD systems')
ax.set_ylabel(r'$HB distance\ (\AA)$')
plt.ylim(1.5, 3.5)

# Add horizontal grid
ax.grid(axis='y')
ax.set_axisbelow(True)

plt.show()
