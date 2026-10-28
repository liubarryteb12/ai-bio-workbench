#!/usr/bin/env bash
set -euo pipefail

R_PREFIX="/opt/R/4.5.3"
SITE_LIBRARY="/opt/R/4.5.3-site-library"
R_SCRIPT="${R_SCRIPT:-/data/data/com.termux/files/home/k40_validation/install_r453_packages.R}"
REPORT="${REPORT:-/mnt/ssd/bio_data/system_logs/r453_packages_report.txt}"

if [[ ! -x "${R_PREFIX}/bin/Rscript" ]]; then
  printf 'step_executed=install_r453_packages status=fail reason=R453_MISSING\n' >&2
  exit 2
fi
if [[ ! -f "${R_SCRIPT}" ]]; then
  printf 'step_executed=install_r453_packages status=fail reason=R_SCRIPT_MISSING\n' >&2
  exit 2
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  -o Dpkg::Options::=--force-confold \
  cmake \
  libcurl4-openssl-dev \
  libglpk-dev \
  libgsl-dev \
  libhdf5-dev \
  libnetcdf-dev \
  libnlopt-dev \
  libnsl-dev \
  libtirpc-dev \
  libuv1-dev \
  libxml2-dev \
  libcairo2-dev \
  libfontconfig1-dev \
  libfreetype-dev \
  libpng-dev \
  libjpeg-dev \
  libtiff-dev

mkdir -p "${SITE_LIBRARY}" "$(dirname "${REPORT}")"
export PATH="${R_PREFIX}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export R_LIBS_USER="${SITE_LIBRARY}"
export LANG="C.UTF-8"
export LC_ALL="C.UTF-8"
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
export OMP_NUM_THREADS=3
export OPENBLAS_NUM_THREADS=3
export MKL_NUM_THREADS=3
export VECLIB_MAXIMUM_THREADS=3
export NUMEXPR_NUM_THREADS=3

Rscript --vanilla "${R_SCRIPT}" --output "${REPORT}"
