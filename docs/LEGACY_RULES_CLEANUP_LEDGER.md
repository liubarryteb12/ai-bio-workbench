# 旧规则清理台账

日期 2026-11-08｜范围 L1 到 L3 工作台、图件注册表、运行通道、项目内容

## 1. 结论

旧规则分三类：仍然有效的硬约束、需要改写口径的历史基线、已经与当前产品冲突的废弃规则。第三类已停用，第二类已对齐当前真源，第一类保留并写清影响。

| 旧规则 | 原位置 | 对当前运行的实际影响 | 处置 | 当前状态 |
| :--- | :--- | :--- | :--- | :--- |
| G1 到 G5 组图契约，组合图是正式产出 | `docs/figure_spec.md` v2.2 及母版注释 | 会让 `l2_20_composition_panel` 等组合图继续生成，与“只要单图”冲突 | v2.3 明确作废，`l1_32`、`l3_16`、L2 组合图生成段退役，Ready 降为 39 | 已停用 |
| Ready 基线 30 条或棘轮 `>=40` | `SCOPE.md`、`docs/ARCHITECTURE_OVERVIEW.md`、旧测试注释 | 与当前 39 条 Ready 单图白名单冲突，容易让审计误判基线漂移 | 统一改为 39，图件模板总数 92，组合图模板保持 draft/pending | 已对齐 |
| 默认 SSH，ADB 失败自动回落 SSH | `docs/ARCHITECTURE_OVERVIEW.md`、README、前端类型、服务端旧注释 | 设备侧 sshd 掉线会让任务、上传、回搬、报告链路静默改走不稳定通道 | 默认 ADB，所有 ssh/scp argv 在 `proc.js` 翻译成 ADB，SSH 仅 `BIO_COMPUTE_ADAPTER=ssh` 特殊启用 | 已停用 |
| 旧来源配置与旧报告是交付依赖 | 项目 `PRJ_DCM_BENCH_20261105` 历史资产 | 容易让报告、图廊、客户端发现依赖过时文件 | 项目内容消融五场景验证删除后仍自洽 | 已隔离为历史资产 |
| `scripts/resume_benchmark.sh` 是续跑入口 | 封存项目脚本 | 继续依赖 SSH 轮询，和 ADB 主通道口径冲突 | 消融验证删除后客户端、报告、门禁无依赖 | 已隔离为历史资产 |
| 报告正文允许出现运行环境、机器名、内部目录 | 旧报告模板与旧页脚 | 会把分析设施信息泄露给客户 | 脱敏契约扫描两份已导出报告与渲染器 footer | 已停用 |
| 项目内可放母版同名脚本做临时改版 | 历史运维习惯 | 会造成仓库母版与算力面脚本分叉 | `project_script_gate` 与 `k40_script_parity` 继续硬阻断 | 保留为否决项 |
| 8GB 内存下可引入重型解卷积 | 参考代码与旧实验脚本 | 生产链可能 OOM 137 或高温降频 | 继续禁止 RCTD、cell2location、Stereoscope，精度优化走 Top20 marker 与 0.05 截断 | 保留为硬红线 |
| 三线可互相取产物 | 早期实验口径 | 破坏项目与线隔离，结果无法复现 | `docs/isolation.md` v2、`bridge_guard.sh`、`isolated_bridge_gate` 继续硬阻断，只放行冻结签名桥 | 保留为硬红线 |

## 2. 清理动作

- 生产母版：删除 L1 `l1_32_deg_overview`、L3 `16_domain_panel`、L2 `20_composition_panel` 的组合图生成段。
- 图件注册表：组合模板 `fig_l3_multipanel`、`fig_l3_combinationpanel`、`fig_l3_sankeybubbleplot` 保持 draft/pending，不带 preview 与 render evidence。
- 出图规范：`docs/figure_spec.md` v2.3 明确只出单图，图例在轴框外右侧纵向排列，图注在左下角。
- 运行通道：`docs/remote_channel_policy.md` 与 README 改为默认 ADB，删除“尚未迁移特殊路径”旧说明。
- 前端：`App.tsx` 的计算面模式支持 `adb/ssh/mock`，默认 `adb`。
- 架构文档：`docs/ARCHITECTURE_OVERVIEW.md` 改用 ADB 主通道口径，并同步 92/39/39 的图件基线。
- 参考脚本：`ops/verify_plot_matrix.py`、`ops/verify_r453_figures.py` 的组合图证据标为 retired，不参与 Ready 单图基线。
- 项目内容：旧报告、legacy 图、组图、旧来源配置、旧 SSH runner 只保留作历史证据，不进入自动工单产物链。

## 3. 仍需保留的兼容项

- `project.js` 的旧模板 id、旧阈值档位名、旧上传 id 缓存映射：用于读历史项目，不用于新工单默认行为。
- SSH 特殊开关：只保留给明确批准的设备链路健康检查与临时故障处置，不作为默认通道。
- 参考区的旧验证图：只读留痕，不进入生产图件清单，不参与 Ready 矩阵。

## 4. 判据

- 39 条 Ready 单图，源码与预览 sha256 命中 39/39，分叉 0。
- 项目内容消融 5 个场景全通过。
- 便携包同源、算力节点 57 个母版同源、台账同源、图件规范、变异反证与结构化工单闭环纳入总门禁。
- 官方入口全量测试通过，TypeScript 类型检查无错误。

LEGACY_RULES_CLEANUP_OK
