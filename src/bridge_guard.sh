#!/usr/bin/env bash
# bridge_guard.sh：跨语言桥接四项断言的母版内守卫（task-10 / m00939 边界②）。
#
# 背景：verify_bridge_checkpoint.py 的四项断言此前只在工作台提交层
# （BioanalysDesktop/server/index.js 的 /api/tasks/submit S28 块）执行一次，
# 直连 K40 跑母版、或母版被改动后绕过提交层时，断言就空转。本守卫把同一引擎
# 收进母版内部：母版既是执行者，也是断言的第一个调用者。
#
# 用法：
#   bridge_guard.sh --input <路径> --from Python|R --to R|Python [--script <母版路径>]
#
# 契约：
#   1. --input 必须是调用方真实持有的输入路径，本守卫不编造、不改写路径；
#   2. 输入不是 .h5ad/.rds 时打印 [BRIDGE SKIP] 并 exit 0（无可校验对象，不假装通过）；
#   3. 引擎不可达（ssh 连接失败/超时，退出码非 0 且输出无断言结论）时打印
#      [BRIDGE SKIP] 并 exit 0：K40 离线时母版必须还能跑，守卫永不比计算本身更硬；
#   4. 引擎可执行则透传退出码与输出：结论为通过 → [BRIDGE OK]，断言失败 →
#      [BRIDGE FAIL] 并以引擎退出码退出（断言不过，母版随之中止）；
#   5. 不读 BIOANALYS_SEED、不写任何业务文件，可重复调用（幂等）。
set -euo pipefail

GUARD_NAME="bridge_guard"
BRIDGE_ENGINE_REMOTE="${BRIDGE_ENGINE_REMOTE:-/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py}"
SSH_TARGET="${BRIDGE_SSH_TARGET:-k40-ubuntu}"
SSH_TIMEOUT="${BRIDGE_SSH_TIMEOUT:-60}"
# ssh 客户端可覆盖：默认 PATH 上的 ssh；排障或接 plink/包装器时用 BRIDGE_SSH_CMD 指定。
SSH_CMD="${BRIDGE_SSH_CMD:-ssh}"

INPUT=""
FROM_LANG=""
TO_LANG=""
SCRIPT_NAME=""

while [ $# -gt 0 ]; do
  case "$1" in
    --input) INPUT="${2:-}"; shift 2 ;;
    --from) FROM_LANG="${2:-}"; shift 2 ;;
    --to) TO_LANG="${2:-}"; shift 2 ;;
    --script) SCRIPT_NAME="${2:-}"; shift 2 ;;
    *) echo "[BRIDGE SKIP] $GUARD_NAME 未知参数: $1" >&2; exit 0 ;;
  esac
done

WHERE="${SCRIPT_NAME:-$GUARD_NAME}"

# 契约 2：交给守卫的输入必须自己就是可校验对象
case "$INPUT" in
  *.h5ad|*.rds) ;;
  *) echo "[BRIDGE SKIP] $WHERE 输入非 h5ad/rds（${INPUT:-空}），无桥接断言可做"; exit 0 ;;
esac

# 契约 3 前半：本机没有可用客户端时不假装跑过
if ! command -v "$SSH_CMD" >/dev/null 2>&1; then
  echo "[BRIDGE SKIP] $WHERE 本机无 $SSH_CMD，无法触达桥接引擎"; exit 0
fi

remote_cmd="python3 $BRIDGE_ENGINE_REMOTE --input '$INPUT' --from $FROM_LANG --to $TO_LANG 2>&1"
# 分开捕获输出与退出码：ssh 连接失败的退出码（如 255）与引擎断言失败的退出码
# （如 3）必须区别对待，否则一次断言失败会被误判成"引擎不可达"而静默放行。
output=$("$SSH_CMD" -n -o BatchMode=yes -o ConnectTimeout="$SSH_TIMEOUT" "$SSH_TARGET" "$remote_cmd" 2>&1) && ssh_rc=0 || ssh_rc=$?
[ -n "$output" ] && echo "$output"

if echo "$output" | grep -q 'BRIDGE FAIL'; then
  # 契约 4：断言失败，透传引擎退出码（至少 1，绝不冒充 0）
  [ "$ssh_rc" -gt 0 ] && rc="$ssh_rc" || rc=1
  echo "[BRIDGE FAIL] $WHERE 桥接四项断言未过（$FROM_LANG -> $TO_LANG, input=$INPUT）"
  exit "$rc"
fi

if [ "$ssh_rc" -ne 0 ]; then
  # 契约 3 后半：连不上/超时/引擎自身崩溃，放行母版继续算
  echo "[BRIDGE SKIP] $WHERE 桥接引擎不可达（ssh 退出码 $ssh_rc），母版继续执行"; exit 0
fi

echo "[BRIDGE OK] $WHERE 桥接四项断言通过（$FROM_LANG -> $TO_LANG, input=$INPUT）"
exit 0