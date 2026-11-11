# 结构化工单编排器门禁报告

日期 2026-11-11T16:04:12.888Z

本门禁只使用确定性合成工单与本地 mock 客户端，不连接远端设备，不启动分析任务。

| 判据 | 结果 | 详情 |
| :--- | :--- | :--- |
| 单入口存在 | 通过 |  |
| ADB 默认 | 通过 |  |
| SSH 已封存 | 通过 |  |
| 编排器不直接调用 SSH | 通过 |  |
| Ready 单图准入 | 通过 |  |
| DAG 串行派发 | 通过 |  |
| 完成回执校验 | 通过 |  |
| 报告验收 | 通过 |  |
| 汇总与回执落盘 | 通过 |  |
| 编译闭包 | 通过 |  |
| 默认通道 | 通过 |  |
| SSH 通道 fail closed | 通过 | SSH 通道已封存，见 _archive/ssh_retired_20261111/RESTORE.md |
| 组图 fail closed | 通过 | 组图已退役，禁止选择: fig_l3_multipanel |
| 契约测试 | 通过 | (node:10128) Warning: node:test run() is being called recursively within a test file. skipping running files. \| (Use `node --trace-warnings ...` to show where the warning was created) |

合计 14 项，通过 14 项，失败 0 项。

WORK_ORDER_ORCHESTRATOR_GATE_OK
