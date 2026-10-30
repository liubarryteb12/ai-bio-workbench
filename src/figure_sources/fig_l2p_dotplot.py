# Catalog-ID: 414
# Catalog-Title: Basic Bubble Plot with matplotlib
# Catalog-Page: https://python-graph-gallery.com/270-basic-bubble-plot/
# Catalog-Language: Python
# Source-Match: analogous
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
# libraries
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

# create data
df = pd.DataFrame({
      'x': np.random.rand(40),
      'y': np.random.rand(40),
      'z': np.random.rand(40),
   })
df.head()

# ---- cell ----
plt.scatter(df['x'], df['y'], s=df['z']*1000, alpha=0.5)
plt.show()
