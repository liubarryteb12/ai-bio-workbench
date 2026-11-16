#!/usr/bin/env bash
# tools/ops/remote_pack.sh
# 运行在 K40 proot 容器内部。
# 在远端先生成 01_work 与 02_output 的 checksums.sha256，再流式打包输出。
# 关键约束：所有诊断信息一律打到 stderr (>&2)，保持 stdout 为绝对纯净的二进制流！
set -euo pipefail

JOB_RUN_DIR="${1:-}"
MODE="${2:-stream}" # stream: 管道流式输出; file: 落盘为 tar.zst

if [[ -z "$JOB_RUN_DIR" || ! -d "$JOB_RUN_DIR" ]]; then
  echo "[REMOTE_PACK_ERROR] 作业目录不存在或未指定: $JOB_RUN_DIR" >&2
  exit 1
fi

cd "$JOB_RUN_DIR"

if [[ ! -d "01_work" || ! -d "02_output" ]]; then
  echo "[REMOTE_PACK_ERROR] 缺少必需子目录 01_work 或 02_output (目录: $JOB_RUN_DIR)" >&2
  exit 1
fi

# 1. 严格原子化预先生成 SHA-256 清单
echo "[REMOTE_PACK] 正在计算 01_work 与 02_output 逐文件 SHA-256 清单..." >&2
# 排除可能已有的旧 checksums 文件本身
rm -f checksums.sha256
find 01_work 02_output -type f -exec sha256sum {} + | sort -k2 > checksums.sha256

FILE_COUNT=$(wc -l < checksums.sha256)
echo "[REMOTE_PACK] 清单生成完毕，共登记 $FILE_COUNT 个文件。" >&2

# 2. 检查 zstd 是否可用，若无则使用 gzip 降级
COMPRESS_CMD="zstd -1 -c"
if ! command -v zstd >/dev/null 2>&1; then
  echo "[REMOTE_PACK_WARN] 未安装 zstd，降级为 gzip -1" >&2
  COMPRESS_CMD="gzip -1 -c"
fi

# 3. 执行打包
if [[ "$MODE" == "stream" ]]; then
  echo "[REMOTE_PACK] 开始以流式管道向 stdout 发送归档包..." >&2
  tar -cf - checksums.sha256 01_work 02_output | $COMPRESS_CMD
  echo "[REMOTE_PACK_FINISH] 流式输出完成。" >&2
else
  ARCHIVE_PATH="$JOB_RUN_DIR/run_artifacts.tar.zst"
  echo "[REMOTE_PACK] 正在就地生成归档文件: $ARCHIVE_PATH" >&2
  tar -cf - checksums.sha256 01_work 02_output | $COMPRESS_CMD > "$ARCHIVE_PATH"
  echo "[REMOTE_PACK_FINISH] 归档文件生成完毕: $ARCHIVE_PATH" >&2
fi
