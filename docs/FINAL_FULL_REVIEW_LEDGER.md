# 全量复核收口台账

日期 2026-11-08｜复核对象 L1 到 L3 生信流水线、客户端、服务端、出图、自动化工单与门禁

## 1. 用户问题逐项裁决

| 问题 | 结论 | 证据 |
| :--- | :--- | :--- |
| 旧规则有哪些，对运行有何影响 | 旧规则分为保留硬约束、过期基线、与当前产品冲突三类。详见 `docs/LEGACY_RULES_CLEANUP_LEDGER.md` | 旧规则清理台账列明出处、影响、处置 |
| 无用、错误、冗杂内容是否整理清理 | 是。组图正式产出规则、旧来源配置依赖、旧报告依赖、旧 SSH runner 依赖、30/40 Ready 基线、默认 SSH 文案均已处理或隔离 | 项目内容消融 5/5，旧规则契约 8/8 |
| 出组图是否清理，只要单图 | 是。L1、L2、L3 生产母版不再生成组合图，图件注册表只保留 Ready 单图 | Ready 39/39，出图源码规范 blocking=0 |
| 能否脱离 AI 自动运行 | 能。结构化工单 JSON 通过单入口完成建项、上传、DAG 派发、完成回执、报告、验收、汇总与工单回执 | `ops/work_order_orchestrator.mjs`，工单门禁 OK |
| 是否需要项目内容消融 | 已做且纳入总门禁 | `ops/project_content_ablation_gate.mjs` |
| 是否做各生信分析功能代码消融、独立性、上下游兼容性 | 已做。54 模块逐项核对，121 条相邻兼容性边，486 个故障注入场景 | `docs/MODULE_ABLATION_MATRIX.md`，模块矩阵门禁 OK |

## 2. 本轮新增与修改

- 组图退役：生产母版只出单图，退役组合图降为 draft/pending，历史 caption 只服务旧项目读档。
- 项目内容消融：删除旧报告、legacy 图、组图、旧来源配置与旧 SSH runner 后仍自洽。
- ADB 主通道：主计算入口默认 ADB，新增 ADB 文件传输模块和唯一远端临时脚本名，SSH 只保留显式特殊开关。
- 结构化工单：新增 `ops/work_order_orchestrator.mjs`、门禁、契约测试、样例工单与项目汇总回执。
- 54 模块矩阵：新增 `ops/module_ablation_matrix.mjs`、gate、契约测试与逐模块报告。
- 旧规则清理：新增台账与契约测试，同步 SCOPE、架构总览、前端计算面模式、参考验证脚本与图件说明。
- 台账回执：给 `/api/ledger/check` 增加 `receipts` 原始回执字段，供工单编排器核对项目、线、步骤、seed、退出码、台账回执与产物清单。
- 设备同源：经 ADB 同步三个改过的生产母版，57 个脚本双向集合恒等且逐字节一致。
- 便携包与指标：重建便携包，更新 README 基线到 1950 tests / 1949 pass / 0 fail / 1 skipped。

## 3. 验证结果

- `node ops/run_all_gates.mjs`：24 道全绿，295 秒。
- 官方全量测试：1950 tests，1949 pass，0 fail，1 skipped，228 个测试文件。
- `npx tsc --noEmit`：无错误。
- `node ops/k40_script_parity.mjs`：57 个脚本同源，分叉 0，走 ADB 通道。
- `node ops/figure_ready_matrix.mjs`：Ready 39/39，源码与预览 sha256 全部吻合。
- `node ops/figure_code_gate.mjs`：blocking=0。
- `node ops/work_order_orchestrator_gate.mjs`：OK。
- `node ops/module_ablation_matrix_gate.mjs`：OK。
- ADB 文件传输真设备回环：push 与 pull 的 sha256 一致。

## 4. 边界说明

- 历史同步、异步与流式 ssh/scp argv 仍保留为显式 SSH 特殊开关与测试兼容形态。主计算入口、任务回执和新增文件传输默认 ADB，历史探针按单独工单逐步迁移，避免在总门禁里一次性改写已验证的流式行为。
- 本轮没有重跑真实生信分析，也没有改写 `PRJ_DCM_BENCH_20261105` 的生物学结论。功能级消融是代码与契约层的确定性验证。
- 54 模块矩阵报告未发现静态缺口。运行时兼容性仍以真实项目任务回执与报告验收共同把关。

## 5. 规则更新与备份（2026-11-08 第二轮）

- `AGENTS.md`：导航表新增出图规范、工单编排器、模块矩阵三个指针；硬规则新增「计算与文件传输默认走 ADB」与「生产图件只出单图」；清除「sshd 备用」旧措辞。
- `docs/remote_channel_policy.md`：标题与特殊开关措辞更新为「ADB 主通道，SSH 仅显式特殊开关」。
- 改动前快照备份到 `_archive/rules_backup_20261108/`，含 `AGENTS.md`、`docs/remote_channel_policy.md` 与 `MANIFEST.sha256`，哈希一致性由 `legacy_rules_cleanup_contract.test.js` 守护。
- 历史报告、台账与已作废 REJ 条目中的旧数字按规范保留留痕，不作为规则清理对象。

RULES_UPDATE_BACKED_UP_OK

FULL_REVIEW_GATE_ALL_OK
