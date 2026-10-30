# Catalog-ID: 505
# Catalog-Title: Scatter plot with a grouping variable with Pandas
# Catalog-Page: https://python-graph-gallery.com/537-scatter-plots-grouped-by-color-with-pandas/
# Catalog-Language: Python
# Source-Match: analogous
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
import pandas as pd
import numpy as np # data generation
import matplotlib.pyplot as plt

# ---- cell ----
# Generate a sample of 100 observations
sample_size = 200
first_variable = np.random.uniform(30, 20, sample_size)
second_variable = first_variable * 10 + np.random.normal(0, 10, sample_size)
categorical_variable = ['Group1' if i < 25 else 'Group2' for i in first_variable]

# Put the data into a pandas df
df = pd.DataFrame({'variable1': first_variable,
                   'variable2': second_variable,
                   'categorical_variable': categorical_variable}
                 )

# ---- cell ----
df.plot.scatter('variable1', # x-axis
                'variable2', # y-axis
                grid=True, # Add a grid in the background
               )
plt.show()

# ---- cell ----
# Get color for each data point
colors = {'Group1': 'orange', 'Group2': 'purple'}
color_list = [colors[group] for group in df['categorical_variable']]

# Create a scatter plot with color-coding based on 'categorical_variable'
ax = df.plot.scatter('variable1',
                'variable2',
                c=color_list,
                grid=True)

# Create legend handles, labels for each group and add legend to the plot
import matplotlib.patches as mpatches
legend_handles = [
    mpatches.Patch(color=colors['Group1'], label='Group1'),
    mpatches.Patch(color=colors['Group2'], label='Group2'), # add as many as needed
]
ax.legend(handles=legend_handles,
          loc='upper left')

plt.show()

# ---- cell ----
# Get color for each data point
colors = {'Group1': 'orange', 'Group2': 'purple'}
color_list = [colors[group] for group in df['categorical_variable']]

# Create a scatter plot with color-coding based on 'categorical_variable'
ax = df.plot.scatter('variable1',
                'variable2',
                c=color_list,
                grid=True,
                figsize=(7,6))

# Create legend handles, labels for each group and add legend to the plot
import matplotlib.patches as mpatches
legend_handles = [
    mpatches.Patch(color=colors['Group1'], label='Group1'),
    mpatches.Patch(color=colors['Group2'], label='Group2'), # add as many as needed
]
ax.legend(handles=legend_handles,
          loc='upper left')

# Add title and labels ('\n' allow us to jump rows)
ax.set_title('Scatter plot\nwith pandas',
             weight='bold')
ax.set_xlabel('Life Expectancy')
ax.set_ylabel('GDP per capita')

plt.show()
