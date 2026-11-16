# QC 哨兵规则（生物学质控判据）

本文件是 Pi CLI 读指标卡后做推进或挂起判定的唯一规则正本。
规则必须可机检：每条都给出触发条件、动作、以及理由。规则与代码的分工是
「代码算出事实，规则决定表述与是否调参」。

## 1. DEG 数量失衡拦截

- 触发：`l1_de_limma.metrics.deg_total < 10` 或 `> 3000`
- 动作：
  1. 先核对分组与批次（`l1_qc_matrix` 的 `group_counts`、`spearman_cor_range`），不先动阈值；
  2. 结论仍失衡时，用 `remediate_step_param` 在 `l1_de_limma.log2fc_cutoff` 的阶梯值之间调整：
     `0.585 → 1.0 → 1.5`，每次只动一档，写明生物学理由；
  3. `padj_cutoff` 的调整必须显式说明「放宽 FDR 会抬高假阳性」，不可作为首选。
- 禁止：为了让基因数「好看」而改阈值却不留记录；把调参后的基因数当成原始结果报告。

## 2. WGCNA 软阈值告警

- 触发：`l1_de_wgcna.metrics.scale_free_r2_ok === false`
- 动作：标记「网络无标度特性较弱」，建议
  1. 开启鲁棒相关性 `bicor`；
  2. 复查离群样本（`wgcna_report.txt` 的 `sample_outliers_Zk_gt_2.5`）；
  3. 若模块数与样本量之比过高，降低 `min_module_size` 反而更糟，应改为减小基因输入集。
- 禁止：直接报告模块-性状相关性而不提无标度拟合未达标。

## 3. 验证集过拟合预警

- 触发：训练集 AUC `> 0.90` 且独立验证集 AUC `< 0.65`
- 动作：
  1. 报告中禁止表述为「强诊断标志物」；
  2. 必须降级为「探索性候选特征，存在队列异质性」；
  3. 触发时必须同时写出两个 AUC 与各自的 95% CI。
- 禁止：只报告训练集 AUC；用交叉验证 AUC 冒充外部验证 AUC。

## 4. 空间维度补充判据

- 触发：`l3_qc_spots.metrics.valid_spot_count` 明显低于预期，或
  `l3_branches_celltype.metrics` 的解卷积平均残差范数偏高
- 动作：先确认比例尺校准状态（`scalebar_verified`），再讨论丰度截断值。
- 禁止：把域 marker 自签名说成外部细胞类型参考谱。

## 5. 通用纪律

1. 任何数值表述只能引用指标卡槽位，不得自己复述记忆里的数字。
2. 推荐锁定靶点必须给 1–3 个，每个带 `gene`、`evidence_mod`、`effect_size`。
3. 质控告警必须原样进入报告 Appendix，不得删减。
