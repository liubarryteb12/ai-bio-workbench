# 任务台账 JSON Schema

> version 1 | 2026-10-12
> 落盘位置：服务器 `/mnt/ssd/bio_data/system_logs/`，每个工作流步骤一个 JSON 文件。
> 用途：供 AI Agent 读取做状态追踪、失败重试、资源复盘。

## Schema

```json
{
  "task_id": "uuid-xxxx-xxxx",
  "project_id": "default",
  "line_id": "line2_scrna",
  "step_name": "scTenifoldKnk_virtual_knockout",
  "status": "completed",
  "start_time": "2026-10-12T10:00:00Z",
  "end_time": "2026-10-12T10:45:30Z",
  "environment": {
    "language": "R",
    "version": "4.3.3",
    "env_name": "line2_r_env",
    "container_image": "proot-ubuntu24.04-aarch64",
    "random_seed": 42
  },
  "resource_usage": {
    "max_cpu_percent": 95.5,
    "max_memory_gb": 12.4,
    "disk_io_peak_mb_s": 450
  },
  "io_files": {
    "input": ["/mnt/ssd/bio_data/projects/default/line2_scrna/processed/ctrl_wt_matrix.mtx"],
    "output": ["/mnt/ssd/bio_data/projects/default/line2_scrna/results/DR_genes.csv"]
  },
  "checkpoint_status": "passed",
  "error_log": null,
  "next_action_suggested": "perform_GO_KEGG_on_DR_genes"
}
```

## 字段约束

| 字段 | 约束 |
|---|---|
| `project_id` | 项目 ID，只允许字母数字与 `._-`、不以 `.` 开头、长度 <= 64；缺省视为 `default`（兼容迁移前的历史台账） |
| `line_id` | 枚举，强制为 `line1_bulk` / `line2_scrna` / `line3_spatial` 之一 |
| `status` | `completed` / `failed` / `running` / `queued` |
| `environment.language` | `R` / `Python`（线内混用时记录本步骤实际用的语言） |
| `environment.random_seed` | 必填。没设种子的步骤视为不可复现，`checkpoint_status` 不得为 `passed` |
| `checkpoint_status` | `passed` / `failed` / `skipped`。桥上检查点（基因名/矩阵方向/细胞名/embedding）走这里 |
| `error_log` | 失败时必填，成功时为 `null` |
| `next_action_suggested` | 建议动作，须在本线内的合法步骤。不得建议跨线或合并 |

## 路径合法性

`io_files.input` / `io_files.output` 中的每个路径必须满足其一：

- 属于 `project_id` 指向项目的 `line_id` 那条线目录（`projects/<项目>/<线>/`）
- `public_references/` 下（只允许 input 引用）
- `system_logs/` 下

路径中若含项目段（`/projects/<项目>/`），该段必须与台账的 `project_id` 一致，跨项目引用即违规。
迁移前的历史台账路径不含 `/projects/` 段，按 legacy 处理，只要归属线正确即合法。

违反即台账非法，服务器侧 `ops/03_check_logs_remote.sh` 会报错
（PC 侧一键入口：`pwsh -File ops/04_check_logs.ps1`）。

## Agent 读法约定

- 重试时先读同 `line_id` 同 `step_name` 的最近一条台账，看 `error_log` 与 `resource_usage`。
- `failed` 状态且 `checkpoint_status` 为 `failed` 的步骤，须先修数据/格式再重跑，不能直接重试。
- `next_action_suggested` 是提示不是命令；Agent 仍要按线内合法步骤判断。
