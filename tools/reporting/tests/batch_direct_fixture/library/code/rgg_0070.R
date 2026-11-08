# Catalog-ID: rgg_0070
if (Sys.getenv('BIOANALYS_SEED') == '') quit(status = 3)
set.seed(as.integer(Sys.getenv('BIOANALYS_SEED')))
