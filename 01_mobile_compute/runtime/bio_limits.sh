#!/usr/bin/env bash
# ==============================================================================
# File: 01_mobile_compute/runtime/bio_limits.sh
# Purpose: Redmi K40 (Snapdragon 870, ARM64) 算力硬约束与分区红线守卫
# ==============================================================================
set -euo pipefail

# 1. 强制锁死所有科学计算底层库的并发线程数（默认 3，可显式覆盖）
TARGET_THREADS="${BIO_MAX_THREADS:-3}"
export OMP_NUM_THREADS="${TARGET_THREADS}"
export OPENBLAS_NUM_THREADS="${TARGET_THREADS}"
export MKL_NUM_THREADS="${TARGET_THREADS}"
export VECLIB_MAXIMUM_THREADS="${TARGET_THREADS}"
export NUMEXPR_NUM_THREADS="${TARGET_THREADS}"
export BIOCPARALLEL_WORKER_NUMBER="${TARGET_THREADS}"
export SCANPY_N_JOBS="${TARGET_THREADS}"

# 2. 锁定全局随机种子与确定性哈希
export BIO_GLOBAL_SEED=20261013
export PYTHONHASHSEED=20261013
export R_DEFAULT_PACKAGES="datasets,utils,grDevices,graphics,stats,methods"

# 3. 强制 Tailscale 专网直连，绕过任何残留代理变量
export NO_PROXY="100.64.0.0/10,127.0.0.1,localhost"
export no_proxy="100.64.0.0/10,127.0.0.1,localhost"
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy || true

# 4. 严禁写入 /sdcard 分区红线检查
export BIO_WORK_ROOT="${BIO_WORK_ROOT:-/var/lib/bio_workspace}"
export TMPDIR="${BIO_WORK_ROOT}/tmp"
mkdir -p "${TMPDIR}"

check_no_sdcard_path() {
    local target_path="$1"
    local real_p
    real_p="$(realpath -m "${target_path}")"
    if [[ "${real_p}" == /sdcard* ]] || [[ "${real_p}" == /storage/emulated* ]] || [[ "${real_p}" == /mnt/shared* ]]; then
        echo "[FATAL][BIO_LIMITS] 触发 00_最高纲领红线：严禁在 /sdcard 或 FUSE 分区执行生信读写 (${real_p})" >&2
        exit 91
    fi
}

check_no_sdcard_path "${BIO_WORK_ROOT}"

# 5. 设定单进程组虚拟内存软硬熔断上限 (默认约 5.8GB = 5939200 KB，保护 Android 宿主不触发 LMK)
MAX_VMEM_KB="${BIO_MAX_VMEM_KB:-5939200}"
ulimit -S -v "${MAX_VMEM_KB}" 2>/dev/null || true
