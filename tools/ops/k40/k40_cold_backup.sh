#!/usr/bin/env bash
# k40_cold_backup.sh —— K40 算力面不可再生资产冷备（2026-11-02，Argon 第五轮最大风险裁定）
#
# 为什么不全备 rootfs：实测 proot ubuntu rootfs 32G，而真正不可再生的只有
#   /opt（R 4.5.3 源码编译产物，重建需 3~5 天）、/root/venvs/bio-py（Python 环境）、
#   /mnt/ssd/bio_data/{ops,bin,src}（工具链与母版，已在 git 但有远端改写）。
#   其余 apt 基座可由 install_r453.sh 一类脚本重建。
#
# 一致性策略：先 tar 到容器可见的 SSD（168G 空闲，本地写快且不断网），
# 再逐卷 sha256 校验；宿主机侧用 adb exec-out 流式拉回，避免占用手机内部存储翻倍。
# 卷间断点：任一卷失败只重跑该卷。
set -euo pipefail

STAGE=/mnt/ssd/bio_data/_coldbackup
mkdir -p "$STAGE"

# 卷 1：R 4.5.3 工具链（最不可再生）
if [ ! -s "$STAGE/v1_opt_R.tar.gz" ]; then
  echo "[backup] v1 /opt 打包中…"
  tar -C / --exclude='./opt/R/src' -zcf "$STAGE/v1_opt_R.tar.gz" opt
fi

# 卷 2：Python venv
if [ ! -s "$STAGE/v2_venvs.tar.gz" ]; then
  echo "[backup] v2 /root/venvs 打包中…"
  tar -C /root -zcf "$STAGE/v2_venvs.tar.gz" venvs
fi

# 卷 3：SSD 上的运维/母版/工具链/验证证据（白名单，不用 exclude）
# 踩过的坑：--exclude='./bio_data/projects' 在 tar -C /mnt/ssd 下不生效，
# 21G 项目数据全被收进 v3 且持续增长（实测 8 分钟到 3.5G 未完）。
# 白名单语义明确：只备 ops（含 layout_autoload 垫片）/ bin（母版部署区）/
# src（母版真源镜像）/ validation（r453 图件验证证据链）/ a2a-core / a2a-gate。
# projects 与 public_references 不备：前者是业务数据（远端 SSD 为唯一真源，
# 丢了要重跑分析，冷备不解决），后者是可重新下载的大型参考库。
if [ ! -s "$STAGE/v3_ops_bin_src.tar.gz" ]; then
  echo "[backup] v3 工具链与母版白名单打包中…"
  tar -C /mnt/ssd/bio_data -zcf "$STAGE/v3_ops_bin_src.tar.gz" \
      ops bin src validation a2a-core a2a-gate
fi

echo "[backup] 容器侧产物："
ls -la "$STAGE"
echo "[backup] 校验和："
cd "$STAGE" && sha256sum v1_opt_R.tar.gz v2_venvs.tar.gz v3_ops_bin_src.tar.gz