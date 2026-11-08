2026-10-25 line2 与 line3 动态验证，台账钩子四个缺陷修毕

## 验证规模

派两个子代理分线推进，主代理同步核验 line1：

Herschel 负责 line2_scrna 19 个脚本
Sartre 负责 line3_spatial 15 个脚本
主代理自验 line1_bulk 未动态验证的 6 个资产

## line3_spatial 结果（15/15 全通过）

 Sartre 实测：ingest_spatial、normalize_hvg、dim_reduce、spatial_domains、
spatial_markers、enrichment、spatial_autocorr、spatial_cooccurrence、
spatial_composition、spatial_communication、spatial_localization、
spatial_knockout、celltype_annotation、dr_post_analysis 共 14 个退出码 0，
台账条数 2 到 4 不等，逐条实算哈希全部一致，连续调用台账脚本两次段数恒为 1。

第 15 个 spatial_figures 计算与出图成功（59 张 PNG）但台账挂不上，已修，
修后复测 59 张全部上台账、逐条哈希 OK、幂等保持。

温度门禁：284 次采样最高 52.5 度，超 60 度 0 次。default 项目 77 个 processed
文件有 size 与 mtime 前后守卫，未发现覆盖改写。

## line1_bulk 自验结果（6/6 通过）

gsva_pathway_score exit 0，台账 2 条
lasso_cox_model exit 0，台账 4 条
multivariate_cox_model exit 0，台账 4 条
lasso_feature_select exit 0，台账 5 条

加上此前已验证的 limma、geo_pca_scatter、roc_diagnostic_curve、
univariate_cox_screen、drug_sensitivity_correlation、oncopredict_ridge，
line1 动态验证覆盖 10/17。wgcna_module_trait 因测试数据基因数不足 100 未跑通
（脚本的合理校验，非缺陷）。multi_metric_survival_roc、prognostic_diagnostic_roc、
rf_gene_select、cibersort_reference 本轮未跑。

## line2_scrna 因温度闸中断

Herschel 在 annotate_celltypes 末端实测到 61.4 度，触发温度保护，队列立即终止
并停止后续 18 个。这是规范的热保护正常生效，不是失败。温度回落到 36 度后具备
继续条件，但为避免再次触闸未在同一轮重跑。

它报回三个有价值的缺陷，都已修。

## 修掉的四个台账钩子缺陷

### 缺陷1：scenic_figures 钩子目录与报告名双错

OUT = "../figures"，钩子用 $PWD（输入目录），且指定 scenic_figures_report.txt，
但脚本只写 figures_manifest.txt。已改为 $PWD/../figures 加 figures_manifest.txt。

### 缺陷2：scrna_figures 钩子指到上游报告

钩子指定 composition_report.txt，那是 scrna_composition 的上游产物，把上游报告
当本步骤台账载体。已改为本步骤自己的 figures_manifest.txt。

### 缺陷3：spatial_figures 同类双错

OUT = "../figures"，钩子用 $PWD 且要 spatial_figures_report.txt，脚本只写
figures_manifest.txt。修后 59 张 PNG 全部上台账。

### 缺陷4：39 个钩子全带 || true，台账失败被静默放过

原意是让台账补登失败不影响主步骤退出码（台账是附加的，不该让分析失败），
但副作用是台账缺失无声无息。已改为显式告警：

  > /dev/null 2>>"$0.ledger.err" \
  || echo "WARN sha256 ledger backfill failed, see $0.ledger.err" >&2

保留主流程优先，但在 stderr 留痕。39 个全部替换，bash 语法 39/39，零残留。

## 回归验证

qc_cells 用新钩子形态重跑：exit 0，台账 6 条，逐条哈希全对，stderr 告警 0 条
（说明钩子正常执行时不留告警）
spatial_figures 修后：exit 0，59 张 PNG 台账，幂等保持

## 全库钩子一致性核查

对 39 个脚本逐个列出钩子目录参数、报告名与脚本的 OUT 定义，确认四个 figures
类脚本都正确指向 $PWD/../figures 加 figures_manifest.txt，其余脚本的报告名与
目录参数与各自 OUT 定义一致。未发现第五个同类缺陷。

## 双端一致性

line2 与 line3 共 40 个文件（39 脚本加 README.md）本地与远端哈希逐项一致，
match=40 diff=0 missing=0。spatial_figures 单独核对也 MATCH。

## 遗留

line2 的 19 个脚本动态验证未完成（温度闸中断），只完成静态核验与钩子一致性核查。
温度窗口合适后可继续，建议分批小步跑，每批 3 到 4 个，避免再次触闸。

line1 的 multi_metric_survival_roc、prognostic_diagnostic_roc、rf_gene_select、
cibersort_reference 四个本轮未动态验证。

wgcna_module_trait 测试数据基因数不足 100，是脚本的合理校验。要用真实数据
（PRJ_E2E_GSE277173 的 20019 基因）才能跑，该路径此前已验证过。
