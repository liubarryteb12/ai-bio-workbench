# 图件待办瘦身：55 个 pending 的真实分类（2026-11-02）

## 零、先更正上两轮的两处事实错误

我在第十一、十二轮汇报里对 4 Argon 说过两句**不成立**的话，本轮实测推翻：

1. **「line3 无 spatial_moran.csv、无配体-受体产物 step」——错。**
   `workflows.json` 里 `l3_stats_autocorr` 声明产出 `gene_autocorr_human.tsv` /
   `gene_autocorr_mouse.tsv`（Moran's I、Geary's C 全在列里），
   `l2_branches_cellcomm` 声明产出 `cellcomm_interactions.tsv`（LIANA 配体-受体对），
   `l3_stats_communication` 声明产出 `sample_communication_human.tsv`。
   设备侧实测这些文件**真实存在且有数据**：
   cellcomm 57,282 行、gene_autocorr_human 19,614 行、gene_autocorr_mouse 18,629 行、
   sample_communication_human 6 行、domain_cooccurrence_human 19 行。
   我当时只看了 pending 模板的 `input_tables` 为空就下了判断，没去 workflows.json
   反查 produces，属于**用一个缺失的信号当结论**。

2. **「padj<0.05 过于严苛所以整张表无显著基因」——这条只对示例项目成立。**
   PRJ_AIMS_V3_20261027 的 `deg_all.tsv` 最小 adj_P_Val 确实是 0.4524，
   但那是该项目的样本量与效应量决定的，不是所有项目的常态。
   所以降级守卫必须保留（它是**边界保护**，不是常规路径），措辞上不能写成
   「本项目无显著基因于是改用 p 值」这种仿佛通用事实的说法。

教训：判断「某个图型绑不上」之前，必须查 workflows.json 的 produces 全集，
不能只看模板自身的 input_tables 是否为空——那个字段是准入时才填的，天然为空。

## 一、分类判据

一个 pending 模板成为**真待办（actionable）**，必须同时满足：

1. **有上游表**：能在 `workflows.json` 的 54 个 Mod 的 produces 里找到它的输入表；
2. **表有真实数据**：设备侧该表存在且行数大于阈值（不是空表）；
3. **图型属于转录组交付**：SCI 三线（Bulk / scRNA / Spatial）结题报告会用的图；
4. **能产出静态矢量或高分辨率位图**：不依赖 htmlwidgets 这类网页交互组件。

不满足第 1 或第 2 条的归 **blocked_upstream**（等上游算法开发）。
不满足第 3 或第 4 条的归 **excluded_out_of_scope**（永久冻结，不再是待办）。

## 二、结论（详见台账 write_ledger 的输出）

- actionable：仍有上游表支撑、可逐模板准入的部分
- blocked_upstream：上游 Step 尚未声明对应产物的部分
- excluded_out_of_scope：地理地图、商业信息图、跨组学（GWAS/突变/CNV）等

本文件只记**判据与纠错**，具体名单由 `ops/ledger_gen.mjs` 从 CSV 生成，
避免两处名单手工同步（一个含义一个真源）。
