#!/bin/bash
# wipe_project_sandbox.sh：项目交付后的物理擦除（Gemini P1 裁定）。
# 用法：bash wipe_project_sandbox.sh <project_id> [VERIFIED_AT_xxx]
# 只在项目沙箱内删除，保留 1KB 墓碑，输出 WIPE_VERIFIED '<path>' <bytes>。
set -euo pipefail

PROJECT_ID="${1:-}"
TOKEN="${2:-WIPE_ON_SIGN}"
BASE="/mnt/ssd/bio_data/projects"

if [[ ! "$PROJECT_ID" =~ ^[A-Za-z0-9._-]{3,64}$ ]]; then
  echo "[WIPE_ERROR] 非法 project_id: '$PROJECT_ID'" >&2
  exit 2
fi

TARGET="$BASE/$PROJECT_ID"
if [ ! -d "$TARGET" ]; then
  echo "[WIPE_ERROR] 项目沙箱不存在: $TARGET" >&2
  exit 3
fi

RESOLVED=$(readlink -f "$TARGET")
if [[ "$RESOLVED" != "$BASE"/* ]]; then
  echo "[WIPE_ERROR] 目标越出项目根: $RESOLVED" >&2
  exit 4
fi

# 清理可能残留的句柄与临时验证目录
fuser -k "$TARGET"/* 2>/dev/null || true
rm -rf "/tmp/bio_val_${PROJECT_ID}" "/tmp/bio_adapt/${PROJECT_ID}" 2>/dev/null || true

# 只保留墓碑，其余全部清空
find "$TARGET" -mindepth 1 -maxdepth 1 ! -name 'WIPE_TOMBSTONE.json' -exec rm -rf {} +

STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > "$TARGET/WIPE_TOMBSTONE.json" <<EOF
{
  "schema_version": "wipe_tombstone/v1",
  "project_id": "$PROJECT_ID",
  "wiped_at": "$STAMP",
  "token": "$TOKEN",
  "scope": "project_sandbox",
  "retained": ["WIPE_TOMBSTONE.json"]
}
EOF

BYTES=$(wc -c < "$TARGET/WIPE_TOMBSTONE.json")
echo "WIPE_VERIFIED '$TARGET' $BYTES"
