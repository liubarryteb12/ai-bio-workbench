# Catalog-ID: 484
# Catalog-Title: Visualise principal component analysis with Matplotlib
# Catalog-Page: https://python-graph-gallery.com/515-intro-pca-graph-python/
# Catalog-Language: Python
# Source-Match: analogous
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
# Libraries
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

# ---- cell ----
# Create our variables
sample_size = 100
random1 = np.random.uniform(30, 20, sample_size)
random2 = random1*3 + np.random.normal(10, 30, sample_size)
random3 = random2*-3 + np.random.normal(10, 100, sample_size)
random4 = random3*2 + np.random.normal(10, 500, sample_size)

df = pd.DataFrame({'variable1': random1,
                   'variable2': random2,
                   'variable3': random3,
                   'variable4': random4,})

# Scale our data using z-score normalization
scaler = StandardScaler()
data_scaled = scaler.fit_transform(df)
df = pd.DataFrame(data_scaled, columns=df.columns)

# ---- cell ----
# Init a PCA object where we will only keep the 2 first principal components
pca = PCA()

# Use the `fit_transform` method from this object to our dataframe
pca_results = pca.fit_transform(df)

# ---- cell ----
# Get the explained variance ratio for each principal component
explained_variance = pca.explained_variance_ratio_

# Set figsize
plt.figure(figsize=(10, 6))

# Create a scree plot to visualize the explained variance
plt.plot(range(1, len(explained_variance) + 1), # x-axis
         explained_variance*100, # convert explained variance in percentage
         marker='o', # add a marker at each value
        )

# Add title and axis label
plt.title('Scree Plot of Explained Variance for Principal Components')
plt.xlabel('Principal Component')
plt.ylabel('Explained Variance (in %)')

# Add label to x-axis
plt.xticks(range(1, len(explained_variance) + 1))

# Add grid in the background
plt.grid(True)

# Display the chart
plt.show()

# ---- cell ----
# Get the explained variance ratios for the selected components
explained_variances = pca.explained_variance_ratio_

# Get the principal component vectors (also known as loadings)
loadings = pca.components_.T * np.sqrt(explained_variances)

# Set figsize and other layout parameters
plt.figure(figsize=(8, 8))
plt.title('Correlation Circle Plot')
plt.xlabel('Principal Component 1')
plt.ylabel('Principal Component 2')

# Add variable labels to the plot
for i, feature in enumerate(df.columns):

    # Add the name of the variable near the arrow
    plt.annotate(feature, # variable name
                 (loadings[i, 0],
                  loadings[i, 1]),
                 color='red')
    
    # Add an arrow representing the variable on the new axis
    plt.arrow(0, 0,
              loadings[i, 0],
              loadings[i, 1],
              color='black',
              alpha=0.7, 
              width=0.01,
             )

# Fix x-axis between -1 and 1 is important for better visualization
plt.xlim(-1,1)
plt.ylim(-1,1)

# Add grid in the background
plt.grid(True)

# Display the chart
plt.show()

# ---- cell ----
# Create a scatter plot to visualize the observations in the 2D PCA space
plt.figure(figsize=(10, 6))
plt.scatter(pca_results[:, 0], # position on the first principal component of the observations
            pca_results[:, 1], alpha=0.7) # position on the second principal component of the observations

# Add title and axis label
plt.title('Scatter Plot of Observations in 2D PCA Space')
plt.xlabel('Principal Component 1')
plt.ylabel('Principal Component 2')

# (optionally) Add labels to each point based on their index in the original dataframe
for i, txt in enumerate(df.index):
    plt.annotate(txt, (pca_results[i, 0], pca_results[i, 1]), fontsize=8)
    # This might be useful when doing outlier detection

# Add grid in the background
plt.grid(True)

# Display the chart
plt.show()
