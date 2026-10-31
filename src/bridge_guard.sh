#!/usr/bin/env bash
# bridge_guard.sh：跨语言桥接四项断言的母版内守卫（task-10 / m00939 边界②）。
#
# 背景：verify_bridge_checkpoint.py 的四项断言此前只在工作台提交层
# （BioanalysDesktop/server/index.js 的 /api/tasks/submit S28 块）执行一次，
# 直连 K40 跑母版、或母版被改动后绕过提交层时，断言就空转。本守卫把同一引擎
# 收进母版内部：母版既是执行者，也是断言的第一个调用者。
#
# 用法：
#   bridge_guard.sh --input <路径> --from Python|R --to R|Python [--script <母版路径>] \
#                   [--stage post-dimred|pre-dimred]
#
# 契约：
#   1. --input 必须是调用方真实持有的输入路径，本守卫不编造、不改写路径；
#   2. 输入不是 .h5ad/.rds 时打印 [BRIDGE SKIP] 并 exit 0（无可校验对象，不假装通过）；
#   3. 引擎不可达（本机无引擎且 ssh 连接失败/超时，退出码非 0 且输出无断言结论）
#      时打印 [BRIDGE SKIP] 并 exit 0：K40 离线时母版必须还能跑，守卫永不比计算
#      本身更硬；
#   3c. 本机模式（MODE=local）下引擎非 0 退出即 [BRIDGE FAIL] 并透传退出码：
#      本机引擎是否存在已在解析阶段确认过，非 0 只可能是输入不可读或引擎自身
#      结论为失败。真机实测（2026-10-21，/tmp/bad.h5ad 损坏文件）早期版本把这
#      种情况归到"不可达"而 exit 0，等于把坏输入静默放行：比不校验更危险；
#   3b. 引擎解析顺序是「本机优先，ssh 兜底」：母版通常就跑在计算节点上（任务引擎
#      ssh 进 k40-ubuntu 再执行 step），此时从容器里再 ssh 到 k40-ubuntu 是反模式
#      （容器内不解析该主机名，2026-10-21 真机实测：exit 255 + "Could not resolve
#      hostname k40-ubuntu" ⇒ 守卫恒 SKIP，四项断言在真实主路径上形同空转）；
#   4. 引擎可执行则透传退出码与输出：结论为通过 → [BRIDGE OK]，断言失败 →
#      [BRIDGE FAIL] 并以引擎退出码退出（断言不过，母版随之中止）；
#   5. --stage 透传给引擎（aims v2.5 §一.2 阶段感知）：默认 post-dimred（第 4 项
#      降维断言为硬断言）；pre-dimred 仅用于"降维尚未发生"的早期矩阵，由调用方
#      显式声明，守卫不替调用方猜测、也不静默降级；未知 --stage 在参数校验
#      阶段即 exit 2，与引擎对非法 --stage 的退出码保持同一契约；
#   6. 不读 BIOANALYS_SEED、不写任何业务文件，可重复调用（幂等）。
set -euo pipefail

GUARD_NAME="bridge_guard"
BRIDGE_ENGINE_REMOTE="${BRIDGE_ENGINE_REMOTE:-/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py}"
# 本机引擎路径：默认与远端同一落点（计算节点上就是本地文件）。显式置空可强制走 ssh。
BRIDGE_ENGINE_LOCAL="${BRIDGE_ENGINE_LOCAL-/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py}"
SSH_TARGET="${BRIDGE_SSH_TARGET:-k40-ubuntu}"
SSH_TIMEOUT="${BRIDGE_SSH_TIMEOUT:-60}"
# ssh 客户端可覆盖：默认 PATH 上的 ssh；排障或接 plink/包装器时用 BRIDGE_SSH_CMD 指定。
SSH_CMD="${BRIDGE_SSH_CMD:-ssh}"

INPUT=""
FROM_LANG=""
TO_LANG=""
SCRIPT_NAME=""
STAGE="post-dimred"

while [ $# -gt 0 ]; do
  case "$1" in
    --input) INPUT="${2:-}"; shift 2 ;;
    --from) FROM_LANG="${2:-}"; shift 2 ;;
    --to) TO_LANG="${2:-}"; shift 2 ;;
    --script) SCRIPT_NAME="${2:-}"; shift 2 ;;
    --stage) STAGE="${2:-}"; shift 2 ;;
    *) echo "[BRIDGE SKIP] $GUARD_NAME 未知参数: $1" >&2; exit 0 ;;
  esac
done

WHERE="${SCRIPT_NAME:-$GUARD_NAME}"

case "$STAGE" in
  post-dimred|pre-dimred) ;;
  *) echo "[BRIDGE FAIL] $WHERE 未知 --stage: $STAGE（仅 post-dimred / pre-dimred）" >&2; exit 2 ;;
esac

# 契约 2：交给守卫的输入必须自己就是可校验对象
case "$INPUT" in
  *.h5ad|*.rds) ;;
  *) echo "[BRIDGE SKIP] $WHERE 输入非 h5ad/rds（${INPUT:-空}），无桥接断言可做"; exit 0 ;;
esac

# 引擎解析：本机优先，ssh 兜底（契约 3b）。
MODE=""
if [ -n "$BRIDGE_ENGINE_LOCAL" ] && [ -f "$BRIDGE_ENGINE_LOCAL" ] && command -v python3 >/dev/null 2>&1; then
  MODE="local"
elif command -v "$SSH_CMD" >/dev/null 2>&1; then
  MODE="ssh"
else
  if [ "${BIO_ALLOW_BRIDGE_SKIP:-0}" = "1" ]; then
    echo "[BRIDGE SKIP] $WHERE 本机无引擎且无 $SSH_CMD，无法触达桥接引擎（显式允许 skip）"; exit 0
  fi
  echo "[BRIDGE FAIL] $WHERE 本机无引擎且无 $SSH_CMD，无法触达桥接引擎（strict 模式；离线干跑请设 BIO_ALLOW_BRIDGE_SKIP=1）" >&2
  exit 2
fi

# 分开捕获输出与退出码：连接失败的退出码（如 255）与引擎断言失败的退出码
# （如 1/3）必须区别对待，否则一次断言失败会被误判成"引擎不可达"而静默放行。
if [ "$MODE" = "local" ]; then
  output=$(python3 "$BRIDGE_ENGINE_LOCAL" --input "$INPUT" --from "$FROM_LANG" --to "$TO_LANG" --stage "$STAGE" 2>&1) && ssh_rc=0 || ssh_rc=$?
else
  remote_cmd="python3 $BRIDGE_ENGINE_REMOTE --input '$INPUT' --from $FROM_LANG --to $TO_LANG --stage $STAGE 2>&1"
  output=$("$SSH_CMD" -n -o BatchMode=yes -o ConnectTimeout="$SSH_TIMEOUT" "$SSH_TARGET" "$remote_cmd" 2>&1) && ssh_rc=0 || ssh_rc=$?
fi
[ -n "$output" ] && echo "$output"

if echo "$output" | grep -q 'BRIDGE FAIL'; then
  # 契约 4：断言失败，透传引擎退出码（至少 1，绝不冒充 0）
  [ "$ssh_rc" -gt 0 ] && rc="$ssh_rc" || rc=1
  echo "[BRIDGE FAIL] $WHERE 桥接四项断言未过（$FROM_LANG -> $TO_LANG, input=$INPUT, stage=$STAGE）"
  exit "$rc"
fi

if [ "$ssh_rc" -ne 0 ]; then
  if [ "$MODE" = "local" ]; then
    # 契约 3c：本机引擎已在位，非 0 就是校验失败/引擎崩溃，不许降级成 SKIP
    echo "[BRIDGE FAIL] $WHERE 桥接引擎异常退出（local 模式退出码 $ssh_rc），见上方引擎输出"
    exit "$ssh_rc"
  fi
  # 契约 3 后半：连不上/超时，放行母版继续算（K40 离线时母版仍要能跑）
  if [ "${BIO_ALLOW_BRIDGE_SKIP:-0}" = "1" ]; then
    echo "[BRIDGE SKIP] $WHERE 桥接引擎不可达（$MODE 模式退出码 $ssh_rc，显式允许 skip），母版继续执行"; exit 0
  fi
  echo "[BRIDGE FAIL] $WHERE 桥接引擎不可达（$MODE 模式退出码 $ssh_rc，strict 模式硬阻断；离线干跑请设 BIO_ALLOW_BRIDGE_SKIP=1）" >&2
  exit 2
fi

echo "[BRIDGE OK] $WHERE 桥接四项断言通过（$FROM_LANG -> $TO_LANG, input=$INPUT, stage=$STAGE, engine=$MODE）"
exit 0
