#!/usr/bin/env bash
# tools/ops/wipe_remote.sh
# 运行在 K40 proot 容器内部。
# 仅在 Windows 端返回 100% 校验通过回执令牌后才允许调用。
# 彻底废除 /mnt/ssd/ 硬编码，改用 BIO_REMOTE_RUNS_ROOT 动态注入。
set -euo pipefail

TARGET_DIR="${1:-}"
TOKEN="${2:-}"

# 1. 严格参数校验
if [[ -z "$TARGET_DIR" || -z "$TOKEN" ]]; then
  echo "[WIPE_ERROR] 缺少必要参数: 目标路径或回执令牌" >&2
  exit 1
fi

if [[ "$TOKEN" != VERIFIED_AT_* ]]; then
  echo "[WIPE_ERROR] 非法回执令牌: '$TOKEN'，必须以 'VERIFIED_AT_' 开头，拒绝删除！" >&2
  exit 2
fi

# 2. 绝对路径受控沙箱断言（防范 rm -rf / 与根目录意外擦除）
RESOLVED_DIR=$(readlink -f "$TARGET_DIR" 2>/dev/null || realpath "$TARGET_DIR" 2>/dev/null || echo "$TARGET_DIR")
# runs 根的单一真源来自环境变量；默认取 Termux home 下的 workspace/runs
# （proot 容器内没有 /workspace，那是早期文档里的示意路径）。
RUNS_BASE="${BIO_REMOTE_RUNS_ROOT:-/data/data/com.termux/files/home/workspace/runs}"
RUNS_BASE="${RUNS_BASE%/}"

# 路径安全强断言：必须位于 runs 根之下，且目标本身不能是 runs 目录或根目录
if [[ "$RESOLVED_DIR" != "$RUNS_BASE"/* ]]; then
  echo "[SECURITY_ALERT] 目标路径 '$RESOLVED_DIR' 不在受控 runs 根 '$RUNS_BASE' 之下，拒绝擦除！" >&2
  exit 3
fi

TARGET_BASENAME=$(basename "$RESOLVED_DIR")
if [[ "$TARGET_BASENAME" == "runs" || "$TARGET_BASENAME" == "workspace" || "$TARGET_BASENAME" == "/" ]]; then
  echo "[SECURITY_ALERT] 目标路径指向根或工作区本身 ('$RESOLVED_DIR')，拒绝擦除！" >&2
  exit 3
fi

if [[ ! "$TARGET_BASENAME" =~ ^[a-zA-Z0-9_.-]+$ ]]; then
  echo "[SECURITY_ALERT] 目标目录名包含非法字符: '$TARGET_BASENAME'，拒绝擦除！" >&2
  exit 3
fi

if [[ ! -d "$RESOLVED_DIR" ]]; then
  echo "[WIPE_WARN] 目标目录已不存在或已被清理: $RESOLVED_DIR"
  exit 0
fi

# 3. 执行物理抹除
echo "[WIPE_START] 正在彻底擦除 K40 端任务目录: $RESOLVED_DIR (凭证: $TOKEN)"
rm -rf "$RESOLVED_DIR"

if [[ ! -d "$RESOLVED_DIR" ]]; then
  echo "[WIPE_SUCCESS] 远端项目沙箱已物理彻底抹除，算力端零留存目标达成。"
  exit 0
else
  echo "[WIPE_FAILED] 目录擦除异常未完全清空: $RESOLVED_DIR" >&2
  exit 4
fi
