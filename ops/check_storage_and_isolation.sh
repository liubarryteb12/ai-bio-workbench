#!/bin/bash
# check_storage_and_isolation.sh：容器侧存储水位门禁 + FUSE 红线 + 跨线隔离静态扫描
# 用法: bash /mnt/ssd/bio_data/ops/check_storage_and_isolation.sh <line_id> <script_path>
# 与本地 02_check_isolation.ps1 形成双保险：本地在提交前扫，容器在执行前再扫
# pipefail 是硬要求：df 失败时管道尾的 tr 仍回 0，只看 $? 的 set -e 不会触发，
# 于是空测量往下走，被当成健康水位放过（P-15 假绿灯，真机 2026-11-01 复现）。
set -eo pipefail

LINE_ID="$1"
SCRIPT_PATH="${2:-}"

TARGET_DIR="/mnt/ssd/bio_data"
MIN_FREE_PERCENT=20

# 1. 校验分析线合法性
if [[ "$LINE_ID" != "line1_bulk" && "$LINE_ID" != "line2_scrna" && "$LINE_ID" != "line3_spatial" ]]; then
    echo "[FATAL] 非法的流水线标识: $LINE_ID，严禁越界执行！"
    exit 1
fi

# 2. 路径红线只读检查：拒绝 FUSE 模拟层 (/sdcard 等)
FS_TYPE=$(df -T "$TARGET_DIR" 2>/dev/null | awk 'NR==2 {print $2}')
if [[ -z "$FS_TYPE" ]]; then
    echo "[FATAL] 无法读取 $TARGET_DIR 文件系统类型，可能未挂载"
    exit 1
fi
if [[ "$FS_TYPE" == *"fuse"* || "$FS_TYPE" == *"sdcardfs"* ]]; then
    echo "[FATAL] 数据目录 ($TARGET_DIR) 文件系统为 $FS_TYPE (FUSE层)，违反原生分区红线，阻断任务！"
    exit 1
fi

# 3. ext4/f2fs 存储水位检查 (<20% 阻断防 F2FS 阻塞式 GC)
USED_PERCENT=$(df -P "$TARGET_DIR" | awk 'NR==2 {print $5}' | tr -d '%')
# 与第 2 维同口径：量不出来就是没过。空串进 $(( )) 会被当成 0，算出 100% 空闲的假绿灯。
if [[ ! "$USED_PERCENT" =~ ^[0-9]+$ ]]; then
    echo "[FATAL] 无法读取 $TARGET_DIR 存储使用率（df -P 无有效输出），按未通过处理"
    exit 1
fi
FREE_PERCENT=$((100 - USED_PERCENT))
if [ "$FREE_PERCENT" -lt "$MIN_FREE_PERCENT" ]; then
    echo "[ERROR] 原生存储剩余空间低于安全阈值：剩余 ${FREE_PERCENT}%, 要求 >= ${MIN_FREE_PERCENT}%."
    echo "[ABORT] 触发 F2FS 前台 GC 保护门禁，阻断新任务提交。"
    exit 1
fi

# 4. 跨线路径静态扫描（若传了 script_path）
if [ -n "$SCRIPT_PATH" ] && [ -f "$SCRIPT_PATH" ]; then
    for OTHER_LINE in "line1_bulk" "line2_scrna" "line3_spatial"; do
        if [ "$OTHER_LINE" != "$LINE_ID" ]; then
            if grep -q "$OTHER_LINE" "$SCRIPT_PATH" 2>/dev/null; then
                echo "[FATAL] 检测到跨线数据引用违规！脚本 $SCRIPT_PATH (归属 $LINE_ID) 试图访问 $OTHER_LINE！"
                exit 1
            fi
        fi
    done
fi

echo "[OK] 门禁校验通过：文件系统=$FS_TYPE | 剩余空间=${FREE_PERCENT}% | 物理隔离线=$LINE_ID"
exit 0
