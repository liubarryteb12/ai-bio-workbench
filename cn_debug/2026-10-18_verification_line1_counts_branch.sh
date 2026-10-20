#!/usr/bin/env bash
# 分支 B（counts_rnaseq）夹具验证：1 个正例矩阵 + 2 个正例变体 + 10 个负对照。
#
# 为什么用夹具：line1 现有一套数据是基因芯片（series matrix），没有真实 Bulk counts
# 数据可跑 counts 分支，只能合成夹具做单测。夹具全部落在 /tmp，产物落在夹具目录，
# 不触碰真实数据面 projects/default/line1_bulk/processed/ 下的既有产物。
#
# 跑法（服务器侧）：bash /tmp/prep_counts_branch_check.sh
#
# 注意：夹具根目录名故意带 "count"（/tmp/prep_counts_test）。脚本按整条绝对路径做
# 文件名特征分流，目录名会一起参与匹配，所以这里顺带把"宽松的 counts 模式串抢走
# grouping 文件"这个隐患固定在回归里；分流顺序必须特异度从高到低。
set -u

BIN=/mnt/ssd/bio_data/bin/line1_bulk/prep_matrix
ROOT=/tmp/prep_counts_test
SM=/mnt/ssd/bio_data/projects/default/line1_bulk/raw_data/GSE277173_series_matrix.txt.gz
rm -rf "$ROOT"
mkdir -p "$ROOT"
export BIOANALYS_SEED=42

pass=0
total=0

check_rc() {
  total=$((total + 1))
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1))
    echo "PASS $1 (rc=$3, 期望 $2)"
  else
    echo "FAIL $1 (期望 rc=$2，实际 $3)"
  fi
}

# 内容断言：报告/产物里的固定子串
check_text() {
  total=$((total + 1))
  if grep -qF "$2" "$1"; then
    pass=$((pass + 1))
    echo "PASS $3"
  else
    echo "FAIL $3  (在 $1 里找不到: $2)"
  fi
}

# 跑一个 case，把 rc 与 stdout/stderr 落盘到 case 目录
run_case() { # dir [args...]
  local dir="$1"
  shift
  ( cd "$dir" && "$BIN" "$@" ) > "$dir/out.txt" 2> "$dir/err.txt"
  return $?
}

echo "==================== FX1：正例（symbol 键 + 注释列 + 全零基因） ===================="
mkdir -p "$ROOT/fx1"
printf 'gene_id\tGSM9000001\tGSM9000002\tGSM9000003\tGSM9000004\tLength\nGENE_A\t100\t120\t200\t180\t1000\nGENE_B\t0\t0\t0\t0\t500\nGENE_C\t50\t60\t55\t65\t800\nGENE_D\t300\t280\t310\t290\t1500\nGENE_E\t10\t12\t11\t13\t400\n' > "$ROOT/fx1/counts_matrix.tsv"
printf 'group_label\ttag\tn\tGSM list\tsample labels\nLS group LS\tLS\t2\tGSM9000001, GSM9000002\tS1, S2\nNL group NL\tNL\t2\tGSM9000003, GSM9000004\tS3, S4\n' > "$ROOT/fx1/grouping.txt"
run_case "$ROOT/fx1" --input "$ROOT/fx1/counts_matrix.tsv" --input "$ROOT/fx1/grouping.txt" --seed 42
check_rc fx1_happy 0 "$?"
echo "--- fx1 prep_report.txt ---"
cat "$ROOT/fx1/prep_report.txt"
echo "--- fx1 expr_genes.tsv (前 3 行) ---"
head -3 "$ROOT/fx1/expr_genes.tsv"
echo "--- fx1 group_map.tsv ---"
cat "$ROOT/fx1/group_map.tsv"
check_text "$ROOT/fx1/prep_report.txt" "genes=4" "fx1 genes=4（全零 GENE_B 被丢）"
check_text "$ROOT/fx1/prep_report.txt" "samples=4" "fx1 samples=4"
check_text "$ROOT/fx1/prep_report.txt" "groups=LS:2 NL:2" "fx1 分组均衡 LS:2 NL:2（table() 按字典序排，L 在 N 前）"
check_text "$ROOT/fx1/prep_report.txt" "counts_genes_allzero_dropped=1" "fx1 全零基因计数=1"
check_text "$ROOT/fx1/prep_report.txt" "counts_annotation_cols=Length" "fx1 注释列 Length 被识别且不参与计算"
check_text "$ROOT/fx1/prep_report.txt" "counts_ensembl_fraction=0.0%" "fx1 非 Ensembl 键"
check_text "$ROOT/fx1/prep_report.txt" "gene_key=列首基因 ID 原样" "fx1 gene_key 原样"
check_text "$ROOT/fx1/prep_report.txt" "grouping_check=一致（2 组 4 样本）" "fx1 grouping 一致"
check_text "$ROOT/fx1/expr_genes.tsv" "gene	GSM9000001	GSM9000002	GSM9000003	GSM9000004" "fx1 expr 列名 = counts 样本列名"
check_text "$ROOT/fx1/expr_genes.tsv" "GENE_A" "fx1 GENE_A 在位"
check_text "$ROOT/fx1/group_map.tsv" "GSM9000001	LS" "fx1 group_map GSM->LS"
check_text "$ROOT/fx1/group_map.tsv" "GSM9000003	NL" "fx1 group_map GSM->NL"
check_text "$ROOT/fx1/out.txt" "prep_mode=counts_rnaseq" "fx1 stdout 声明 counts 模式"

echo "==================== FX3：正例变体（小数 counts 四舍五入留痕） ===================="
mkdir -p "$ROOT/fx3"
printf 'gene_id\tGSM9000021\tGSM9000022\tGSM9000023\tGSM9000024\nGENE_A\t100.4\t120.7\t200.2\t180.9\nGENE_B\t300.1\t280.5\t310.6\t290.3\n' > "$ROOT/fx3/counts_matrix.tsv"
printf 'group_label\ttag\tn\tGSM list\tsample labels\nLS group LS\tLS\t2\tGSM9000021, GSM9000022\tS1, S2\nNL group NL\tNL\t2\tGSM9000023, GSM9000024\tS3, S4\n' > "$ROOT/fx3/grouping.txt"
run_case "$ROOT/fx3" --input "$ROOT/fx3/counts_matrix.tsv" --input "$ROOT/fx3/grouping.txt" --seed 42
check_rc fx3_fractional 0 "$?"
check_text "$ROOT/fx3/prep_report.txt" "counts_fractional_rounded=8" "fx3 8 个小数单元格被四舍五入并留痕"

echo "==================== FX2：正例（Ensembl 键 + GPL 映射） ===================="
mkdir -p "$ROOT/fx2"
printf 'gene_id\tGSM9000011\tGSM9000012\tGSM9000013\tGSM9000014\nENSG00000141510.5\t500\t520\t480\t510\nENSG00000012048.10\t200\t210\t190\t205\nENSG00000157764.8\t80\t90\t85\t95\n' > "$ROOT/fx2/counts_matrix.tsv"
printf 'group_label\ttag\tn\tGSM list\tsample labels\nLS group LS\tLS\t2\tGSM9000011, GSM9000012\tS1, S2\nNL group NL\tNL\t2\tGSM9000013, GSM9000014\tS3, S4\n' > "$ROOT/fx2/grouping.txt"
# GPL 注释文件名必须大写 GPL 开头：分流按 *GPL* 匹配（与 GEO 导出的命名约定一致）
printf 'ID\tgene_assignment\nENSG00000141510\tTP53 // p53 // tumor protein p53\nENSG00000012048\tBRCA1 // BRCA1 // DNA repair\nENSG00000157764\tBRAF // BRAF // B-Raf proto-oncogene\n' > "$ROOT/fx2/GPL_annot.tsv"
run_case "$ROOT/fx2" --input "$ROOT/fx2/counts_matrix.tsv" --input "$ROOT/fx2/grouping.txt" --input "$ROOT/fx2/GPL_annot.tsv" --seed 42
check_rc fx2_ensembl 0 "$?"
echo "--- fx2 prep_report.txt ---"
cat "$ROOT/fx2/prep_report.txt"
check_text "$ROOT/fx2/prep_report.txt" "counts_ensembl_fraction=100.0%" "fx2 Ensembl 占比 100%"
check_text "$ROOT/fx2/prep_report.txt" "gene_key=Ensembl -> symbol" "fx2 走 GPL 映射"
check_text "$ROOT/fx2/prep_report.txt" "genes=3" "fx2 映射后 3 个 symbol"
check_text "$ROOT/fx2/expr_genes.tsv" "BRAF" "fx2 BRAF 映射结果在位"

echo "==================== 负对照（必须非零退出） ===================="
# N1 负值
mkdir -p "$ROOT/n1"
printf 'gene_id\tGSM9000031\tGSM9000032\tGSM9000033\tGSM9000034\nGENE_A\t100\t120\t200\t180\nGENE_B\t-5\t60\t55\t65\n' > "$ROOT/n1/counts_matrix.tsv"
printf 'group_label\ttag\tn\tGSM list\tsample labels\nLS group LS\tLS\t2\tGSM9000031, GSM9000032\tS1, S2\nNL group NL\tNL\t2\tGSM9000033, GSM9000034\tS3, S4\n' > "$ROOT/n1/grouping.txt"
run_case "$ROOT/n1" --input "$ROOT/n1/counts_matrix.tsv" --input "$ROOT/n1/grouping.txt" --seed 42
check_rc n1_negative_value 1 "$?"
check_text "$ROOT/n1/err.txt" "含负值" "n1 stderr 说明原因：含负值"

# N2 最大值 < 50（形似已归一化矩阵）
mkdir -p "$ROOT/n2"
printf 'gene_id\tGSM9000041\tGSM9000042\tGSM9000043\tGSM9000044\nGENE_A\t10\t12\t20\t18\nGENE_B\t30\t28\t31\t29\n' > "$ROOT/n2/counts_matrix.tsv"
printf 'group_label\ttag\tn\tGSM list\tsample labels\nLS group LS\tLS\t2\tGSM9000041, GSM9000042\tS1, S2\nNL group NL\tNL\t2\tGSM9000043, GSM9000044\tS3, S4\n' > "$ROOT/n2/grouping.txt"
run_case "$ROOT/n2" --input "$ROOT/n2/counts_matrix.tsv" --input "$ROOT/n2/grouping.txt" --seed 42
check_rc n2_max_below_50 1 "$?"
check_text "$ROOT/n2/err.txt" "不是原始 counts" "n2 stderr 说明原因：疑似已归一化"

# N3 grouping 的 GSM 与 counts 列不一致
mkdir -p "$ROOT/n3"
cp "$ROOT/fx1/counts_matrix.tsv" "$ROOT/n3/counts_matrix.tsv"
printf 'group_label\ttag\tn\tGSM list\tsample labels\nLS group LS\tLS\t2\tGSM9000001, GSM9000099\tS1, S2\nNL group NL\tNL\t2\tGSM9000003, GSM9000004\tS3, S4\n' > "$ROOT/n3/grouping.txt"
run_case "$ROOT/n3" --input "$ROOT/n3/counts_matrix.tsv" --input "$ROOT/n3/grouping.txt" --seed 42
check_rc n3_grouping_mismatch 1 "$?"
check_text "$ROOT/n3/err.txt" "不一致" "n3 stderr 说明原因：GSM 集合不一致"

# N4 非数值单元格
mkdir -p "$ROOT/n4"
printf 'gene_id\tGSM9000051\tGSM9000052\tGSM9000053\tGSM9000054\nGENE_A\t100\t120\t200\t180\nGENE_B\tabc\t60\t55\t65\n' > "$ROOT/n4/counts_matrix.tsv"
printf 'group_label\ttag\tn\tGSM list\tsample labels\nLS group LS\tLS\t2\tGSM9000051, GSM9000052\tS1, S2\nNL group NL\tNL\t2\tGSM9000053, GSM9000054\tS3, S4\n' > "$ROOT/n4/grouping.txt"
run_case "$ROOT/n4" --input "$ROOT/n4/counts_matrix.tsv" --input "$ROOT/n4/grouping.txt" --seed 42
check_rc n4_non_numeric 1 "$?"

# N5 首列是样本编号而不是基因 ID（表头与数据行列数必须一致，否则 fread 会自行补列，
#    把首列判成行名，反而绕过了这条检查）
mkdir -p "$ROOT/n5"
printf 'GSM9000061\tGSM9000062\tGSM9000063\tGSM9000064\n100\t120\t200\t180\n300\t280\t310\t290\n' > "$ROOT/n5/counts_matrix.tsv"
printf 'group_label\ttag\tn\tGSM list\tsample labels\nLS group LS\tLS\t2\tGSM9000062, GSM9000063\tS1, S2\nNL group NL\tNL\t2\tGSM9000061, GSM9000064\tS3, S4\n' > "$ROOT/n5/grouping.txt"
run_case "$ROOT/n5" --input "$ROOT/n5/counts_matrix.tsv" --input "$ROOT/n5/grouping.txt" --seed 42
check_rc n5_first_col_is_gsm 1 "$?"
check_text "$ROOT/n5/err.txt" "首列是样本编号" "n5 stderr 说明原因：首列不是基因 ID"

# N6 Ensembl 键但没给 GPL
mkdir -p "$ROOT/n6"
cp "$ROOT/fx2/counts_matrix.tsv" "$ROOT/n6/counts_matrix.tsv"
cp "$ROOT/fx2/grouping.txt" "$ROOT/n6/grouping.txt"
run_case "$ROOT/n6" --input "$ROOT/n6/counts_matrix.tsv" --input "$ROOT/n6/grouping.txt" --seed 42
check_rc n6_ensembl_without_gpl 1 "$?"
check_text "$ROOT/n6/err.txt" "需同时提供 GPL" "n6 stderr 说明原因：缺 GPL"

# N7 NA 单元格
mkdir -p "$ROOT/n7"
printf 'gene_id\tGSM9000071\tGSM9000072\tGSM9000073\tGSM9000074\nGENE_A\t100\t120\t200\t180\nGENE_B\t\t60\t55\t65\n' > "$ROOT/n7/counts_matrix.tsv"
printf 'group_label\ttag\tn\tGSM list\tsample labels\nLS group LS\tLS\t2\tGSM9000071, GSM9000072\tS1, S2\nNL group NL\tNL\t2\tGSM9000073, GSM9000074\tS3, S4\n' > "$ROOT/n7/grouping.txt"
run_case "$ROOT/n7" --input "$ROOT/n7/counts_matrix.tsv" --input "$ROOT/n7/grouping.txt" --seed 42
check_rc n7_na_cell 1 "$?"

# N8 同时给 series_matrix 与 counts（模式无法判定，bash 层 exit 2）
mkdir -p "$ROOT/n8"
cp "$ROOT/fx1/counts_matrix.tsv" "$ROOT/n8/counts_matrix.tsv"
cp "$ROOT/fx1/grouping.txt" "$ROOT/n8/grouping.txt"
run_case "$ROOT/n8" --input "$SM" --input "$ROOT/n8/counts_matrix.tsv" --input "$ROOT/n8/grouping.txt" --seed 42
check_rc n8_both_modes 2 "$?"
check_text "$ROOT/n8/err.txt" "无法判定" "n8 stderr 说明原因：两模式同时给"

# N9 counts 模式缺 grouping（bash 层 exit 2）
mkdir -p "$ROOT/n9"
cp "$ROOT/fx1/counts_matrix.tsv" "$ROOT/n9/counts_matrix.tsv"
run_case "$ROOT/n9" --input "$ROOT/n9/counts_matrix.tsv" --seed 42
check_rc n9_missing_grouping 2 "$?"
check_text "$ROOT/n9/err.txt" "必须提供 grouping" "n9 stderr 说明原因：缺 grouping"

# N10 某样本文库大小为 0
mkdir -p "$ROOT/n10"
printf 'gene_id\tGSM9000081\tGSM9000082\tGSM9000083\tGSM9000084\nGENE_A\t100\t120\t0\t180\nGENE_B\t300\t280\t0\t290\n' > "$ROOT/n10/counts_matrix.tsv"
printf 'group_label\ttag\tn\tGSM list\tsample labels\nLS group LS\tLS\t2\tGSM9000081, GSM9000082\tS1, S2\nNL group NL\tNL\t2\tGSM9000083, GSM9000084\tS3, S4\n' > "$ROOT/n10/grouping.txt"
run_case "$ROOT/n10" --input "$ROOT/n10/counts_matrix.tsv" --input "$ROOT/n10/grouping.txt" --seed 42
check_rc n10_zero_libsize 1 "$?"
check_text "$ROOT/n10/err.txt" "文库大小为 0" "n10 stderr 说明原因：零文库"

echo "==================== 汇总 ===================="
echo "PASS $pass / $total"
if [ "$pass" = "$total" ]; then echo "ALL_PASS"; else echo "HAS_FAILURE"; fi
