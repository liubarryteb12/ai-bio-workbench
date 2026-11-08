# 结构化工单编排器门禁报告

日期 2026-11-08T15:36:38.941Z

本门禁只使用确定性合成工单与本地 mock 客户端，不连接远端设备，不启动分析任务。

| 判据 | 结果 | 详情 |
| :--- | :--- | :--- |
| 单入口存在 | 通过 |  |
| ADB 默认 | 通过 |  |
| SSH 特殊开关 | 通过 |  |
| 无 SSH 直接调用 | 通过 |  |
| Ready 单图准入 | 通过 |  |
| DAG 串行派发 | 通过 |  |
| 完成回执校验 | 通过 |  |
| 报告验收 | 通过 |  |
| 汇总与回执落盘 | 通过 |  |
| 编译闭包 | 通过 |  |
| 默认通道 | 通过 |  |
| SSH fail closed | 通过 | SSH 仅在工单显式 allowSsh=true 的特殊场景启用 |
| 组图 fail closed | 通过 | 组图已退役，禁止选择: fig_l3_multipanel |
| 契约测试 | 通过 | ℹ tests 8 \| ℹ suites 0 \| ℹ pass 8 \| ℹ fail 0 \| ℹ cancelled 0 \| ℹ skipped 0 \| ℹ todo 0 \| ℹ duration_ms 100.5482 |

合计 14 项，通过 14 项，失败 0 项。

WORK_ORDER_ORCHESTRATOR_GATE_OK
