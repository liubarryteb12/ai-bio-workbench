#!/usr/bin/env bash
set -euo pipefail

EXPECTED_VERSION="4.5.3"
PREFIX="/opt/R/${EXPECTED_VERSION}"
SITE_LIBRARY="/opt/R/${EXPECTED_VERSION}-site-library"
SOURCE_DIR="/opt/R/src"
ARCHIVE="${SOURCE_DIR}/R-${EXPECTED_VERSION}.tar.gz"
SOURCE_URL="https://cran.r-project.org/src/base/R-4/R-${EXPECTED_VERSION}.tar.gz"
REPORT="/opt/R/R-${EXPECTED_VERSION}-install-report.txt"
FORCE="0"

fail() {
  printf 'step_executed=install_r453 status=fail reason=%s\n' "$1" >&2
  exit "${2:-1}"
}

case "${1:-}" in
  "")
    ;;
  "--force")
    FORCE="1"
    ;;
  *)
    fail "unknown argument: ${1}" 2
    ;;
esac

if [[ "$(id -u)" -ne 0 ]]; then
  fail "install_r453 must run as root" 2
fi

export OMP_NUM_THREADS=3
export OPENBLAS_NUM_THREADS=3
export MKL_NUM_THREADS=3
export VECLIB_MAXIMUM_THREADS=3
export NUMEXPR_NUM_THREADS=3

install_dependencies() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends \
    -o Dpkg::Options::=--force-confold \
    ca-certificates \
    curl \
    gcc \
    g++ \
    gfortran \
    make \
    pkg-config \
    libreadline-dev \
    libpcre2-dev \
    zlib1g-dev \
    libbz2-dev \
    liblzma-dev \
    libcurl4-openssl-dev \
    libssl-dev \
    libxml2-dev \
    libcairo2-dev \
    libpng-dev \
    libjpeg-dev \
    libtiff-dev \
    libicu-dev \
    libfontconfig1-dev \
    libfreetype-dev \
    libopenblas-dev
}

download_source() {
  mkdir -p "${SOURCE_DIR}"
  if [[ -f "${ARCHIVE}" ]] && gzip -t "${ARCHIVE}" 2>/dev/null; then
    return
  fi
  rm -f "${ARCHIVE}" "${ARCHIVE}.part"
  curl -fL \
    --retry 3 \
    --connect-timeout 20 \
    --max-time 1800 \
    --output "${ARCHIVE}.part" \
    "${SOURCE_URL}"
  mv "${ARCHIVE}.part" "${ARCHIVE}"
}

verify_source() {
  gzip -t "${ARCHIVE}" || fail "source archive failed gzip validation"
  local source_version
  source_version="$(tar -xOzf "${ARCHIVE}" "R-${EXPECTED_VERSION}/VERSION")"
  [[ "${source_version}" == "${EXPECTED_VERSION}" ]] ||
    fail "source VERSION mismatch: ${source_version}"
}

if [[ -x "${PREFIX}/bin/Rscript" && "${FORCE}" != "1" ]]; then
  installed_version="$("${PREFIX}/bin/Rscript" --version 2>&1 | head -n 1)"
  if [[ "${installed_version}" == *"${EXPECTED_VERSION}"* ]]; then
    mkdir -p "${SITE_LIBRARY}"
    printf 'step_executed=install_r453 status=already_installed version=%s\n' \
      "${EXPECTED_VERSION}"
    exit 0
  fi
fi

printf 'step_executed=install_r453 status=started version=%s\n' "${EXPECTED_VERSION}"
install_dependencies
download_source
verify_source

if [[ "${FORCE}" == "1" && -d "${SOURCE_DIR}/R-${EXPECTED_VERSION}" ]]; then
  resolved_source="$(realpath "${SOURCE_DIR}/R-${EXPECTED_VERSION}")"
  [[ "${resolved_source}" == "${SOURCE_DIR}/R-${EXPECTED_VERSION}" ]] ||
    fail "refusing to remove unexpected source path"
  rm -rf "${resolved_source}"
fi

if [[ ! -d "${SOURCE_DIR}/R-${EXPECTED_VERSION}" ]]; then
  tar -xzf "${ARCHIVE}" -C "${SOURCE_DIR}"
fi

cd "${SOURCE_DIR}/R-${EXPECTED_VERSION}"
if [[ "${FORCE}" == "1" || ! -f Makefile ]]; then
  ./configure \
    --prefix="${PREFIX}" \
    --enable-R-shlib \
    --disable-BLAS-shlib \
    --with-blas=-lopenblas \
    --with-lapack=-lopenblas \
    --with-x=no \
    --with-tcltk=no \
    --with-cairo \
    --with-libpng \
    --with-jpeglib \
    --with-libtiff \
    > configure.log 2>&1 || {
      tail -n 80 configure.log >&2
      fail "configure failed"
    }
fi

make -j3 > make.log 2>&1 || {
  tail -n 100 make.log >&2
  fail "make failed"
}
make install > install.log 2>&1 || {
  tail -n 100 install.log >&2
  fail "make install failed"
}

mkdir -p "${SITE_LIBRARY}"
chmod 755 "${SITE_LIBRARY}"

rscript_version="$("${PREFIX}/bin/Rscript" --version 2>&1 | head -n 1)"
[[ "${rscript_version}" == *"${EXPECTED_VERSION}"* ]] ||
  fail "installed Rscript version mismatch: ${rscript_version}"

archive_sha256="$(sha256sum "${ARCHIVE}" | awk '{print $1}')"
cat > "${REPORT}" <<EOF
step_executed=install_r453
status=pass
version=${EXPECTED_VERSION}
prefix=${PREFIX}
site_library=${SITE_LIBRARY}
source_url=${SOURCE_URL}
source_sha256=${archive_sha256}
configure_flags=--enable-R-shlib --disable-BLAS-shlib --with-blas=-lopenblas --with-lapack=-lopenblas --with-x=no --with-tcltk=no --with-cairo --with-libpng --with-jpeglib --with-libtiff
rscript_version=${rscript_version}
EOF

cat "${REPORT}"
