# Keep the verified R 4.5.3 shim ahead of the Termux R 4.6.1 fallback.
BIOANALYS_R_SHIM_DIR=/mnt/ssd/bio_data/tools/ops/layout_autoload/bin
PATH="${BIOANALYS_R_SHIM_DIR}:${PATH}"
export PATH
unset BIOANALYS_R_SHIM_DIR
