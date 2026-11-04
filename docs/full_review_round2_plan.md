# 全量审查 Round2 计划稿：外部评审接入 + 梯队票图（Argon 第 32 轮裁定已落地）

本文件接 docs/full_review_round1_plan.md。Round1 出 227 条缺陷与 34 张票；本轮做的是**执行**与**扩票**，不是重新取证。

## 一、裁定来源

4 Argon 第 32 轮（.tmp/argon32_full.txt）Q1 到 Q5 全选 A，置信度 100%（Q4 为 95%）：

| 问 | 裁定 |
|---|---|
| Q1 | 保持严格串行，外部新增 P0 插入梯队 0，不开并行轨 |
| Q2 | 外部新增 4 项按爆炸半径归档：fetchJson+ErrorBoundary 并入 T0-5；15 分钟同步 scp 改异步流进梯队 1.5；AbortController 进梯队 3；一键验签进梯队 4 |
| Q3 | 合并双层脚本审计到引擎层唯一入口，提交层保留当场 400 的能力，断言 auditedScript === executedScript |
| Q4 | mutation_gate 从 5 条扩到 7 条，纳入「异步上传不阻塞」与「验签失败必红」 |
| Q5 | CI 先补 tsc --noEmit 与 e2e 并修净存量红点，最后一步才撤除 || true |

## 二、梯队 0 收官状态（本轮已全绿）

| 票 | 主题 | 实现 | 红测 | 变异 |
|---|---|---|---|---|
| T0-1 | 门户进程级 DoS | portal/serve.mjs:1473 / :1859 / :1864 / :1869 / :1871 | portal_resilience 2 条 | A 变红 |
| T0-2 | survey 端点未鉴权 | serve.mjs:1544 PROTECTED_API 纳入两端点 | portal_csrf 1 条 | B 变红 |
| T0-3 | 写端点无 CSRF | serve.mjs:420 checkSameOrigin，:1561 接入 | portal_csrf 2 条 | B 连带变红 |
| T0-4 | 远端命令拼接 | proc.js:114 shellQuote；diagnostics 三处 + **余震 10 处**全部接入 | diagnostics_injection 3 条 + remote_command_quoting 3 条 | C / H / I 变红 |
| T0-5 | 桌面端 effect 交错与白屏 | App.tsx 两 effect 拆平级；SelfCheckAdminView 判 res.ok + checks 兜底；fetchJson / ErrorBoundary 由 ui-resilience 落 | e2e 三条 | 见 ui-resilience |
| T0-6 | 幽灵任务位永久 409 | tasks.routes.js STALE_SLOT_MS + reclaimStaleSlots + registerTaskSlot；index.js 导出 runningTasks | task_slot_reclaim 4 条 | D / E 变红 |
| T0-7（新） | 双层脚本审计分叉 | run.js:43 prepareAndAuditTask（唯一编译+审计，冻结对象，强制 wrapperTaskId）；tasks.routes.js 提交层改调它并下传 preparedScript | audit_single_source 4 条 | F / G 变红 |

## 三、本轮实测发现的三个新缺陷（不在 Round1 的 227 条里）

1. **T0-4 余震（已修）**：同一个 `dir` 参数修好探针后仍原样流进 ledger_fetch.js:5/13 与 query_views.js:56，这两处是裸插值。真 bash 复现 injection_executed=true。修复后 false。此外全仓另有 7 处同类裸插值（upload/figures×2/report/projects/task_input×2），一并换成 shellQuote。
2. **T0-7 双层审计分叉（已修）**：提交层 tasks.routes.js:272 与引擎层 run.js:53 各审一次，两次的输入不同（引擎层多带 throttled/detached/wrapperTaskId）。探针证明脚本内容已分叉。已按 Q3 合并为唯一入口。
3. **clean_workspace 的默认安全是巧合**（gates-steward 实测，我独立复核一致）：默认 --keep-days 7 时 targets=442、删除集里 git 已跟踪文件数 **0**；--keep-days 3 时 targets=489、git 已跟踪命中 **29**（样本 con_hf/runs/2026-10-28_aims_v31/delivery_verify.log 等）。Round1 写的「dry-run targets=440 且含 git 已跟踪文件」在默认参数下不成立，需按此修正：危险分界线在 3 天，不是默认值。

## 四、后续梯队票图（串行，每票红测先行）

| 梯队 | 票 | 出口判据 |
|---|---|---|
| 1 | T1-1 母版三份归一；T1-2 30 ready 重渲染；T1-3 preview 与产物 sha 恒等门禁；T1-4 line2 火山接真源；T1-5 桑基产线缺口定案；T1-6 火山排版接规范；T1-7 便携包适配器同步 | 30/30 preview sha 逐字节相等；readyCount 恒 30 |
| 1.5（新） | T1-8 15 分钟同步 scp 改异步流 + 进度回调；T1-9 边缘长任务主动心跳 | 大文件上传期间 /api/health 仍 200 且 P95 响应 < 500ms；心跳静默 5 分钟触发判定 |
| 2 | T2-1..T2-7 七张门禁票（gates-steward 已出 21 条红测，8 个文件全红） | mutation_gate 7 条变异全红；gate:all 从 7 道变 8 道且绿；CI 撤 || true 后仍绿 |
| 3 | T3-1 tab 收敛为 3；T3-2 双端校验同一份常量；T3-3 fetch 裸调清零；T3-4 内部术语外泄清零；T3-5 空态与错误态；T3-6 门户提交反馈；T3-7 请求体上限与 413；T3-8 meta 404；**T3-9 PiAgentView 轮询生命周期** | grep 断言为 0；每处失败路径有可见错误态 |
| 4 | T4-1 门户五步密度；T4-2 结果页三栏；T4-3 无障碍；**T4-4 交付包一键验签** | axe 0 critical；篡改一字节必报 FAIL |

## 五、执行纪律（本轮继续有效）

1. 梯队内可并行，梯队间严格串行。
2. 每票先写红测，红测不变红不许改实现。
3. 每票收尾做一次变异反证：把该票修的东西破坏回去，对应红测必须变红，并核对原文件 sha 还原一致。
4. 梯队 1 期间锁死 ops/figure_ready_allowlist.json，readyCount 恒 30。
5. 变异驱动器统一走 .tmp/mut_tier0.mjs 的锚点替换机制（命中次数不等于 1 直接报错，跑完自动还原并比对 sha）。

## 六、验收基线（本轮结束时）

- npm test：1425 tests / 1424 pass / 0 fail / 1 skipped。
- tsc --noEmit：exit 0。
- 变异反证：A B C D E F G H I 九条全部变红，还原 sha 全部一致。
- 3 个新测试文件入库：diagnostics_injection / portal_resilience / portal_csrf / task_slot_reclaim / audit_single_source / remote_command_quoting。
## 七、Round2 执行进度（截至本轮结束）

| 项 | 状态 | 证据 |
|---|---|---|
| Tier0 六票 + T0-7 | 已完成并提交 | 4c5fc7a、cce95ce |
| 测试入口口径分裂（新发现） | 已完成并提交 | 77d5ee7 |
| T1-4 line2 火山接真源 | 已完成并提交 | 7395a49，变异 A-D 全红 |
| 静态门禁 remote-quoting（新防线） | 已完成并提交 | 9799c89，变异全红 |
| T1-1 母版归一 | 红测已就绪未实施 | .tmp/review2/t11_*.redtest.test.js 红 1 条（两份 divergent 同名） |
| T1-2 / T1-3 | 待下一轮（需 k40） | .tmp/review2/figures.md、tier1_spec.md |
| T2-1..T2-7 | 红测已就绪未实施 | .tmp/review2/gates.md，21 条红测 |
| T1.5 异步 scp | 红测与阻塞实测已就绪 | .tmp/review2/runtime_delivery.md |
| T4-4 一键验签 | 设计已就绪 | .tmp/review2/runtime_delivery.md |

## 八、为什么 T1-1 与 T2 的红测没有放进 BioanalysDesktop/tests/

这两组红测当前都是红的（T1-1 红 1 条、T2 红 21 条）。放进正式测试树会让 `npm test` 长期挂红，
等于用「已知红」污染基线，与「红测先写、修完才绿」的纪律冲突。
统一放在 .tmp/review2/，文件名带 .redtest. 前缀（不匹配 tests/*.test.js 官方入口），
下一轮实施时先让它们转绿再迁入。批跑入口：node .tmp/review2/run_redtests.mjs。
## 九、Round2 收官状态（第三十四轮结束）

HEAD 27326d1，工作区完全干净。

| 判据 | 结果 |
|---|---|
| npm test | 1452 tests / 1451 pass / **0 fail** / 1 skipped（连跑两次同结果） |
| gate:all | **8 道全绿**（143 秒） |
| 红测批跑 | 39 pass / 0 fail / red-files 0/11（T1-1/T1-3/T1-4/T0-4/T2-1..T2-7 全部转绿） |
| 变异反证 | 本轮累计 20 条全红，还原 sha 全部一致 |

### 已完成并提交

| 票 | 内容 | 提交 |
|---|---|---|
| T1-1 | 母版唯一真源归一（27→24 runner，三份进 _legacy） | 7caf192 |
| T1-3 | 预览溯源门禁（--info-only 阶段）+ render_evidence 字段 | 7caf192 |
| T1-4 | line2 火山接阈值真源与规范三色 | 7395a49 |
| T1.5 | 五处同步 scp/ssh 改异步流 | 9fa7f71 |
| T2-1..T2-7 | 门禁自证七票 + 第 8 道 mutation_gate | 27326d1 |
| T3-4 首批 | 6 处用户可见内部术语 | 789000d |
| 卫生 | %SystemDrive% 空目录链 + 8 探针归档 + 防呆 | d674678 |
| 接缝加固 | 改用 git 跟踪状态判定源码 | dfa98d4 |

### 仍未做

| 票 | 阻塞原因 |
|---|---|
| T1-2 | 需 k40 真机重渲染 9 条 preview 分叉，会改 registry 与 preview 文件 |
| T3-1 / T3-2 | 会大改 OnboardingView 1925 行巨石 |
| T3-5..T3-8 | 空态 / 提交反馈 / 413 / meta 404 |
| T4-1..T4-4 | 页面美化与一键验签 |

### 关键数字（供下一轮引用）

- preview 溯源：ready 30 条中 有矩阵证据 12（相等 3 / 分叉 9）、无证据 18。
- 异步化：改造前 3022ms / 探针最慢 2993ms / childCalls 全 spawnSync；
  改造后 3014ms / 71 样本 / 探针最慢 2ms / childCalls 全 spawn。
- clean_workspace：默认 keep-days 7 时 git 已跟踪命中 0，keep-days 3 时命中 29。
### T1-2 前置核对（第三十四轮实测）

k40 连线与工具链已确认可用：
- `ssh k40-ubuntu` → ALIVE，Linux aarch64（PRoot-Distro 容器）
- `/usr/bin/Rscript`、`/usr/bin/python3` 均在
- `/mnt/ssd/bio_data/reference/05.可参考出图代码/` 存在

**compat 母版与本地一致**（逐字节核对，前 8 位）：

| 母版 | k40 | 本地 |
|---|---|---|
| L1_boxplot_code.R | dfc6a22b | dfc6a22b |
| L1_rest_code.R | da210745 | da210745 |
| L1_violin_code.R | 9470bc63 | 9470bc63 |
| L2_core_code.R | a8ae5c81 | a8ae5c81 |
| L2_more_code.R | 0b5342dd | 0b5342dd |
| L3_sankey_code.R | 9f80d4b6 | 9f80d4b6 |

**两处必须先同步再重渲染**：
1. k40 上 `_legacy/` 不存在（本地是刚建的），迁移后的目录结构需要同步到 k40，
   否则 `verify_plot_matrix.py` 在远端找不到 legacy 母版会直接报缺文件。
2. `_meta/script_plot_matrix.json` k40 版与本地不同（本地已删 3 条 legacy runner，27→24），
   远端必须用同一份，否则重渲染出的 artifact 集合与本地门禁的判据口径不一致。

T1-2 执行顺序（下一轮）：
1. 同步 `_legacy/` 与裁剪后的 matrix 到 k40；
2. 在 k40 上只重渲染 9 条分叉的 preview（不是全部 30 条）；
3. 回搬 9 个 PNG，重跑 `node ops/build_figure_templates.cjs` 重写 registry；
4. 去掉 `ops/run_all_gates.mjs` 里 preview_provenance 的 `--info-only` 开关，门禁转硬阻断；
5. 判据：`node ops/figure_preview_provenance.mjs` exit 0，readyCount 恒 30。