#!/bin/bash
# resume_benchmark.sh：手机恢复后一键续跑 DCM 基准剩余步骤（串行，失败即停）。
#
# 背景：2026-11-05 11:00 起 k40-ubuntu 失联（SSH 握手即断），L2 的 cellcomm 被中断、
# ko 与 L3 全链未跑。本脚本把剩余步骤按依赖顺序串起来，每步等台账落盘再走下一步，
# 任一步失败就停并打印该步日志尾部，避免级联假失败。
#
# 用法：bash resume_benchmark.sh [--from cellcomm|signatures|ko|l3]
set -uo pipefail

HOST=k40-ubuntu
PID=PRJ_DCM_BENCH_20261105
ROOT=/mnt/ssd/bio_data/projects/$PID
RUNNER=/tmp/run_project_step.sh
SEED=20261105
FROM="${1:-cellcomm}"
FROM="${FROM#--from=}"
[ "$1" = "--from" ] && FROM="${2:-cellcomm}"

die() { echo "[resume] 失败: $*" >&2; exit 1; }
log() { echo "[resume $(date +%H:%M:%S)] $*"; }

# 0. 连通性与前置检查
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" 'echo OK' >/dev/null 2>&1 \
  || die "$HOST 不可达（先确认手机上 Termux sshd 在跑）"
ssh -o BatchMode=yes "$HOST" "test -f $RUNNER" || die "远端缺 $RUNNER（先 scp 项目 scripts/run_project_step.sh 过去）"
log "连通性 OK，从 $FROM 开始"

submit_and_wait() {
  local line="$1" step="$2" script="$3" inputs="$4" outputs="$5" extra="${6:-}"
  # 适配脚本按 <line>/ 根目录写 processed/ 与 results/（母版才需要 cwd=processed 的裸文件名语义）；
  # 本脚本续跑的全是项目内适配步，所以 cwd 用 <line>/ 根。
  local wd="$line"
  log "提交 $line/$step"
  local out
  out=$(ssh -o BatchMode=yes "$HOST" "RUN_CWD=$wd bash $RUNNER submit $line $step $script '$inputs' '$outputs' $extra" 2>&1) \
    || die "提交失败: $line/$step -> $out"
  local tid
  tid=$(printf '%s\n' "$out" | sed -n 's/^TASK_ID=//p' | head -1)
  [ -n "$tid" ] || die "拿不到 TASK_ID: $out"
  log "TASK_ID=$tid，等待台账"
  # 轮询台账（最多 60 分钟），每 20 秒一次，避免长连接被对端掐断
  local i=0 ledger=""
  while [ "$i" -lt 180 ]; do
    ledger=$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" \
      "test -f /mnt/ssd/bio_data/system_logs/${tid}_ledger.json && grep -o '\"status\": \"[a-z]*\"' /mnt/ssd/bio_data/system_logs/${tid}_ledger.json | head -1" 2>/dev/null)
    [ -n "$ledger" ] && break
    sleep 20
    i=$((i + 1))
  done
  [ -n "$ledger" ] || die "$line/$step 60 分钟内没有台账（tid=$tid）"
  if printf '%s' "$ledger" | grep -q completed; then
    log "$line/$step completed"
  else
    ssh -o BatchMode=yes "$HOST" "tail -25 /mnt/ssd/bio_data/system_logs/${tid}.log" 2>&1 | tail -25
    die "$line/$step 未完成: $ledger（tid=$tid）"
  fi
}

L2=$ROOT/line2_scrna/processed
L3=$ROOT/line3_spatial

case "$FROM" in
  cellcomm)
    submit_and_wait line2_scrna cellcomm_adapt cellcomm_adapt.sh \
      "$L2/scrna_annotated.h5ad,$L2/scrna_norm.h5ad" "$L2/results/cellcomm_interactions.tsv"
    ;&
  signatures)
    submit_and_wait line2_scrna export_signatures export_signatures.sh \
      "$L2/scrna_annotated.h5ad,$L2/scrna_norm.h5ad" "$L2/results/signatures.tsv"
    ;&
  ko)
    submit_and_wait line2_scrna ko_adapt ko_adapt.sh \
      "$L2/scrna_annotated.h5ad,$L2/scrna_norm.h5ad" "$L2/results/ko_dr_genes.tsv" "KO_GENE=ATM"
    ;&
  l3)
    submit_and_wait line3_spatial ingest_visium ingest_visium.sh \
      "$L3/raw_data/GSE218759_RAW.tar,$L3/raw_data/GPL24247_family.soft.gz" "$L3/processed/spatial_counts_mouse.h5ad"
    submit_and_wait line3_spatial qc_visium qc_visium.sh \
      "$L3/processed/spatial_counts_mouse.h5ad" "$L3/processed/spatial_qc_mouse.h5ad"
    submit_and_wait line3_spatial domains_visium domains_visium.sh \
      "$L3/processed/spatial_qc_mouse.h5ad" "$L3/processed/spatial_domains_mouse.h5ad"
    submit_and_wait line3_spatial autocorr_visium autocorr_visium.sh \
      "$L3/processed/spatial_domains_mouse.h5ad" "$L3/results/morans_i_top_genes.tsv"
    submit_and_wait line3_spatial deconv_visium deconv_visium.sh \
      "$L3/processed/spatial_domains_mouse.h5ad,$L2/results/signatures.tsv" "$L3/results/deconv_proportions.tsv"
    # 靶基因清单来自 L1 贯通 Top5（本地已产出），先推上计算面再跑定位
    HUB_LOCAL="$(cd "$(dirname "$0")/../.." && pwd)/results/line1_bulk/l1_hub_top5.txt"
    [ -f "$HUB_LOCAL" ] || die "缺 L1 靶基因清单: $HUB_LOCAL（先跑 l1_cohort_robustness.py）"
    ssh -o BatchMode=yes "$HOST" "mkdir -p $L3/results" || die "远端建目录失败"
    scp -o BatchMode=yes "$HUB_LOCAL" "$HOST:$L3/results/target_genes.txt" >/dev/null 2>&1 \
      || die "靶基因清单上传失败"
    log "靶基因清单已上传: $(tr '\n' ' ' < "$HUB_LOCAL")"
    submit_and_wait line3_spatial localization_visium localization_visium.sh \
      "$L3/processed/spatial_domains_mouse.h5ad,$L3/results/target_genes.txt" "$L3/results/target_localization.tsv"
    submit_and_wait line3_spatial spatial_stats spatial_stats.sh \
      "$L3/processed/spatial_domains_mouse.h5ad" "$L3/results/fibrosis_spot_stats.tsv"
    ;;
  *)
    die "未知起点: $FROM（可选 cellcomm|signatures|ko|l3）";;
esac

log "全部完成。下一步：回搬产物到 local_projects/$PID/data/ 与 figures/，再跑跨线贯通。"