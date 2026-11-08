# T-FT-05 adapted task execution evidence

日期：2026-10-28  
状态：任务执行链 PASS，真实数据语义适配仍待补齐

## What worked

1. `fig_l2_pca` 通过 `/api/figures/adapt/derive` 生成项目私有副本：

```text
local_path=local_projects/PRJ_AIMS_V3_20261027/figures/adapt/adapt_fig_l2_pca.R
remote_path=/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line1_bulk/scripts/adapt_fig_l2_pca.R
```

2. `derive` 返回 task：

```text
step=adapt_fig_l2_pca
depends_on_step=l1_qc_pca
scriptPath=/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line1_bulk/scripts/adapt_fig_l2_pca.R
canonicalOutput=L2_pca_verified.png
customOutput=custom_fig_l2_pca.png
```

3. 通过隔离的 18787 编排面提交任务：

```text
taskId=PRJ_AIMS_V3_20261027-line1_bulk-1793119924113
```

4. K40 台账：

```text
task_id=36397b6e-6547-4e2c-b5ee-6976529f4478
step_name=adapt_fig_l2_pca
status=completed
exit_code=0
checkpoint_status=passed
compute_node_id=k40-ubuntu
```

5. 真实回搬图件：

```text
local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l2_pca.png
size=121891
sha256=a0b7d1081801088cc21c9134615d6e1bae30d5885dc0701c5f7da40e2511e549
width=1051
height=944
Pillow verify+load=PASS
```

6. 当前 task 返回的 remote script path 缺少 `<line>` 的 bug 已修复，并在第二次 derive 后验证为：

```text
/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line1_bulk/scripts/adapt_fig_l2_pca.R
```

## Evidence files

- `con_hf/runs/2026-10-28_aims_v31/adapted_task/ledger.json`
- `con_hf/runs/2026-10-28_aims_v31/adapted_task/artifact_validation.tsv`
- `local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l2_pca.png`

## Remaining limitation

参考模板 `L2_more_code.R` 仍使用合成 PCA 坐标，不会读取传入的 `pca_scores.tsv`。因此本次证明了“派生脚本真实上传、真实执行、真实回搬、真实台账”的链路，但还没有证明“真实项目输入表驱动模板出图”的语义适配。T-FT-05 仍需为 ready 模板增加输入表适配层，否则只能视为执行基础设施完成，不能视为最终业务闭环完成。
