# 图件准入专项封板记录（2026-11-02，第 34~35 轮）

## 封板裁定

与 4 Argon 第十轮至第十四轮讨论后的最终结论：**readyCount 锁定 28，专项封板。**

- 冻结其余 33 个真待办，不再为凑数开发新母版
- 不再改动 builder 契约（`ops/build_figure_templates.cjs` 的映射与基线）
- 不再新增 CSV 模板槽位（那属于结构性 Schema 变更，不是准入）
- 工作区与台账定格在 1091 tests 全绿基线

## 28 个就绪模板（按线分组）

### Line 1（Bulk 转录组，12 个）
fig_l1_groupedbar、fig_l1_scatter、fig_l1_boxplot、fig_l1_density、fig_l1_histogram、
fig_l1_violin、fig_l1_ridgeline、fig_l1_upsetplot、fig_l1_vennplot、fig_l1_correlogram、
fig_l1_bubble、fig_l2_heatmap（L2 命名但绑 line1 表达矩阵）

### Line 2（单细胞 + 虚拟敲除，12 个）
fig_l2p_scatterplot、fig_l2p_barplot、fig_l2p_boxplot、fig_l2p_heatmap、fig_l2p_dotplot、
fig_l2p_volcano、fig_l2p_violin、fig_l2p_gseaplot、fig_l2p_enrichmentplot、fig_l2_networkplot、
fig_l2_volcano、fig_l2_umap

### Line 3（空间转录组，2 个）
fig_l3_multipanel、fig_l3_sankey

### 跨线通用（2 个）
fig_l2_pca、fig_l2p_umap

## 三项防伪溯源断言（证据链闭环）

| 断言 | 防的是什么 | 位置 |
|---|---|---|
| A 哈希互斥 | 把 `library/figures/pgg_*.png`（68 张网站原图）改名冒充验证产物 | figure_templates_parity.test.js |
| B 报告与磁盘咬合 | 改了母版却没在 k40 重跑 verify（证据链断裂） | 同上 |
| C preview 与 sample 互斥 | 把 `*_verified.png` 拷成 `custom_fig_*.png` 冒充适配器实跑 | 同上 |

三条都是**无状态**断言：重跑覆盖、rebase、改配色都不会误伤。
A 与 C 的红绿验证都做过（拷图当场报红，恢复后全绿）。

## 未准入的 33 个真待办（长尾候选池）

按 Argon 第十四轮第 3 节裁定：**没有任何一项必须现在做**。它们保留在台账作长尾，
待真实客户点单时再单点激活。台账字段 `actionablePending` 是权威名单。

## 明确冻结的 22 个（不属于技术债）

判据见 `docs/figure_pending_triage.md` 三条可执行标准。冻结名单在
`ops/ledger_gen.mjs` 的 `EXCLUDED_IDS` 维护（一个含义一个真源，不在文档重复列全量）。

## 这次专项里被实测推翻的判断（教训留存）

1. **UpSetR 的 `upset()` 返回对象不自动绘制**，必须显式 `print()`。
   直接调用落盘只有 1018B 空白画布，靠落盘体积校验才抓住。
2. **matplotlib 命名色只认 `grey` 的少数形式**，`grey30`/`grey20` 直接 ValueError。
3. **模板的 input_tables 为空不等于绑不上**：必须反查 workflows.json 的 produces 全集。
   我曾因只看模板字段，误判 line3 没有 Moran 表与配体-受体表，当面向 Argon 说错了话。
4. **CSV 的语言列不是真源**：`fig_l2_networkplot` 登记为 r，但母版是 Python，
   默认推导会让 registry 绑定到 R 的 `l1_figures_bulk`，语言亲和性校验当场判红 8 条。
5. **图的显著性阈值要有降级守卫**：示例项目 `deg_all.tsv` 最小 adj_P_Val 0.4524，
   padj<0.05 命中 0 个，未校正 p<0.05 命中 1121 个。降级是边界保护，不是常态路径。
6. **cp -al 的体积台账必须单命令双路径 du**：分两次 scan 会把共享块重算一遍，
   得出 3.6G + 3.6G 的假数字；联合 scan 才是 3.6G + 15M。
