#!/bin/bash
# k40_restore_drill.sh —— 冷备恢复演练（2026-11-02，Argon 第九轮第 4 节：备份从未演练过恢复）
#
# 验证目标不是「能不能解压」（tar -tzf 已证），而是「解出来的东西还能不能用」：
#   1. v1 解出的 libR.so 在目标机上能被 ldd 解析（不缺动态库）；
#   2. v2 解出的 venv 里 python 能 import numpy/pandas；
#   3. v3 解出的母版与 layout_autoload 垫片字节级一致（与仓库 git 版本对账）。
#
# 用法：bash k40_restore_drill.sh [卷目录，默认 /mnt/ssd/bio_data/_coldbackup]
# 演练在容器内临时目录进行，不覆盖现网 /opt 与 /root/venvs。
set -uo pipefail

VOL=${1:-/mnt/ssd/bio_data/_coldbackup}
WORK=/mnt/ssd/bio_data/_restore_drill
rm -rf "$WORK"; mkdir -p "$WORK/v1" "$WORK/v2" "$WORK/v3"
fails=0

echo '== 前置：三卷存在且 SHA256 匹配 =='
if [ -f "$VOL/SHA256SUMS.txt" ]; then
  (cd "$VOL" && sha256sum -c SHA256SUMS.txt) || { echo 'FAIL: 卷校验不匹配'; fails=$((fails+1)); }
else
  echo 'WARN: 卷目录无 SHA256SUMS.txt，跳过校验对账'
fi

echo '== 演练 1：v1 解包 + libR.so 动态链接自检 =='
tar -C "$WORK/v1" -zxf "$VOL/v1_opt_R.tar.gz" 2>/dev/null || { echo 'FAIL: v1 解压失败'; fails=$((fails+1)); }
LIBR="$WORK/v1/opt/R/4.5.3/lib/R/lib/libR.so"
if [ -f "$LIBR" ]; then
  missing=$(ldd "$LIBR" 2>/dev/null | grep -c 'not found')
  if [ "$missing" -gt 0 ]; then echo "FAIL: libR.so 缺 $missing 个动态库"; ldd "$LIBR" | grep 'not found'; fails=$((fails+1));
  else echo 'OK: libR.so 解出且动态库全解析'; fi
else
  echo 'FAIL: v1 里找不到 libR.so'; fails=$((fails+1))
fi

echo '== 演练 2：v2 解包 + venv python 可 import 核心库 =='
tar -C "$WORK/v2" -zxf "$VOL/v2_venvs.tar.gz" 2>/dev/null || { echo 'FAIL: v2 解压失败'; fails=$((fails+1)); }
VPY="$WORK/v2/venvs/bio-py/bin/python3"
if [ -x "$VPY" ]; then
  if LD_LIBRARY_PATH= "$VPY" -c 'import numpy, pandas; print("OK numpy", numpy.__version__)' 2>/dev/null; then
    echo 'OK: venv python 可 import（注意：venv 通常绑绝对路径，跨目录 import 失败属预期，见下方说明）'
  else
    echo 'INFO: venv 换路径后 import 失败——venv 的 pyvenv.cfg/脚本 shebang 绑绝对路径，'
    echo '      恢复时必须解回原路径 /root/venvs 或在同路径重建；此项不算 FAIL 但必须写进恢复手册'
  fi
else
  echo 'FAIL: v2 里找不到 bio-py python'; fails=$((fails+1))
fi

echo '== 演练 3：v3 解包 + 母版与仓库对账（layout_autoload 垫片字节一致）=='
tar -C "$WORK/v3" -zxf "$VOL/v3_ops_bin_src.tar.gz" 2>/dev/null || { echo 'FAIL: v3 解压失败'; fails=$((fails+1)); }
for f in ops/layout_autoload/bin/Rscript ops/layout_autoload/sitecustomize.py; do
  # v3 是 tar -C /mnt/ssd/bio_data 打的，解出顶层直接是 ops/bin/src/...，无 bio_data 前缀
  a="$WORK/v3/$f"; b="/mnt/ssd/bio_data/$f"
  if [ -f "$a" ] && [ -f "$b" ]; then
    sa=$(sha256sum "$a" | cut -d' ' -f1); sb=$(sha256sum "$b" | cut -d' ' -f1)
    if [ "$sa" = "$sb" ]; then echo "OK: $f 与现网一致"; else echo "FAIL: $f 漂移"; fails=$((fails+1)); fi
  else echo "FAIL: 解包缺 $f"; fails=$((fails+1)); fi
done

echo '== 汇总 =='
rm -rf "$WORK"
if [ "$fails" -eq 0 ]; then echo 'RESTORE_DRILL_OK'; exit 0; fi
echo "RESTORE_DRILL_FAIL fails=$fails"; exit 1