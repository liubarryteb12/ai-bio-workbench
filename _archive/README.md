# _archive/ — 冷备归档区

> 归档 = 移到本目录，**保留全文与 git 历史**，但不再参与日常链路。
> 规则：本目录下的文件**不许被运行时脚本 import / source / 调用**；需要用时用 `git mv` 取回原路径再改。
> 建档：2026-10-21（架构评审 B2 落地）。

## 一、已归档（只读冷备）

| 归档路径 | 原路径 | 归档日期 | 理由 | 现存引用 |
|---|---|---|---|---|
| `_archive/docs/geo_mining_sop_v1.md` | `docs/geo_mining_sop_v1.md` | 2026-10-21 | 已被 `docs/geo_mining_sop_v2.md` 取代（v1 自带取代横幅，:3-5 明写"不要基于本文件修订"） | `docs/geo_mining_sop_v2.md:3` 版本记录已改指本路径 |
| `_archive/ops/01_fix_svlogger.ps1` | `ops/01_fix_svlogger.ps1` | 2026-10-21 | 一次性修复器（坑 #88 的 log 子服务 crash-loop），2026-10-20 reboot 后已执行完成并可回滚；不属日常链路 | `ops/README.md` 清单与"日常用法"已改指本路径 |

### 2026-11-01 归档（用户裁定 3：旧计划、旧审计、根目录交付快照归档）

只搬入链引用为零的 4 件。逐件 `git grep -l -F -- <名> -- ':(exclude)_archive'` 实扫，
另 16 件候选被活文档按路径引用（详见下表），搬走会让引用指向空路径，故留在原位，
待用户裁定是「改引用后再搬」还是「就地保留」。

| 归档路径 | 理由 |
|---|---|
| `_archive/con_hf/2026-10-19_IS_lactylation_plan.md` | 课题计划已完结，产物在项目报告里；全仓零入链引用 |
| `_archive/con_hf/2026-10-20_IS_全量流水线设计.md` | 设计已被三线母版与 P3 正本取代；全仓零入链引用 |
| `_archive/con_hf/2026-10-25_master_plan_structure_sync_figures.md` | 计划已执行完并移交后续正本；全仓零入链引用 |
| `_archive/con_hf/project_report_2026-10-21.md` | 阶段报告，已由 handoff.md 逐轮取代；全仓零入链引用 |

候选但**未搬**的 16 件，及引用它们的活文档（引用数最多的两件）：

数字是「引用该名的文件数」（`git grep -l -F`，排除 `_archive/`）：

| 文件 | 入链文件数 | 主要引用方 |
|---|---:|---|
| `con_hf/2026-10-19_figure_polish_plan.md` | 22 | `docs/figure_spec.md:444`、`con_hf/figure_manual_review.md:3`、`con_hf/dispatch/` 18 份 |
| `项目交付报告.html`（仓库根） | 11 | `con_hf/SPEC_DECISIONS.md`、`docs/delivery_supervisor_prompt.md`、`aims/old/` 4 份 |
| `con_hf/architecture_review_2026-10-20.md` | 8 | `con_hf/SPEC_DECISIONS.md:18,28`、`ops/README.md:87`、`con_hf/dispatch/` 4 份 |

余下 13 件各 1 到 4 处引用。

其余 14 件（各 1 到 4 处引用）：`2026-10-13_plan_goal全量推进`（`ops/05_push_testdata.ps1:41` 是执行层注释）、
`2026-10-19_figure_spec_audit_report`、`2026-10-19_wgcna_audit_report`（`cn_debug/2026-10-19_verification_wgcna_v1_v10.mjs:6` 是执行层依据）、
`2026-10-20_调研_三线定制数据集与实验设计`、`2026-10-20_IS_项目解读报告`、`2026-10-20_reboot_test`（`ops/README.md:21`）、
`2026-10-23_问题模块清单与处置建议`、`2026-10-23_mod化改造执行计划`、`2026-10-24_topic_sieve_landing_plan`（`docs/topic_survey_sop.md:6`）、
`2026-10-25_project_structure_and_sync_plan`、`2026-10-25_shell_discipline_prompt`（`docs/coding-standards.md:54`）、
`architecture_review_2026-10-20`（`con_hf/SPEC_DECISIONS.md:18,28`、`ops/README.md:87`）、`scratch-t2-tickets`、
`项目情况汇总2026-10-31.md`（`aims/bio/07_master_6abbd50_a2a_20261031.md:4,11,146` 把它当对齐基线）。

搬这 16 件的前置条件：先改上述引用路径（含 3 处执行层与 docs 正文引用），再 `git mv`。

取回示例：

```
git mv _archive/ops/01_fix_svlogger.ps1 ops/01_fix_svlogger.ps1
```

## 二、评审建议归档、但经核查**保留在职**（不归档，附理由）

架构评审 §2.3 曾建议把守护机制"六套 → 两套"、日志检查"两套 → 一套"，其余归档。
A6 逐项核查后结论相反：这些脚本**各有唯一定位**，归档会让 `ops/README.md` 的决策表
（"该信哪个：唯一入口"）指向空路径。故保留在原位，理由逐条记录在此，供后续再判：

| 脚本 | 保留理由 | 若真要归档，需同步改 |
|---|---|---|
| `ops/serve_guard.ps1` | PC 侧 8787 / 8080 / frpc 的唯一常驻守护入口；`docs/user_portal_deploy.md` 第 74-97 行的带口令启动、公网映射说明全部以它为准 | 决策表第 57 行、`user_portal_deploy.md` §口令与守护、`BioanalysDesktop/server/index.js:62` 注释 |
| `ops/bio_watchdog.sh` | 手机 Termux 侧保活（runit 监管）的正本模板；`docs/termux_keepalive.md` 第 5/26/27/33 行以它为准 | 决策表第 59 行、`termux_keepalive.md` 四处 |
| `ops/fix_runsvdir.sh` | reboot 后双 runsvdir 抢锁（R15）的唯一修复入口，2026-10-20 真机实战用过；`run-as com.termux sh` 的调用方式只在这里写清 | 决策表第 58 行、`con_hf/2026-10-20_reboot_test.md` |
| `ops/04_check_logs.ps1` | 台账校验的 PC 侧一键入口（自动 scp + ssh + 传回退出码）；`03_check_logs_remote.sh` 是它被调用的服务端本体，二者不是重复而是"壳 + 体" | 决策表第 62 行、`docs/isolation.md:50`、`docs/ledger-schema.md:65` |
| `ops/svlogger_*` 三个目录 | 本地 `ops/` 下**本就不存在**（只存在于远端 Termux 服务目录），无可归档对象 | — |

## 三、评审提到但**未批量归档**：`cn_debug/` 一次性探针

`cn_debug/` 现有 266 个受版本控制的文件（约 33MB，大头是 GSE30528 系列原始数据与审计 CSV）。
评审 §2.2 提到"一次性探针与调试脚本"可归档，但 §2.5 同时要求**保留判决证据**
（`figure_audit_all.csv`、负对照样本、各验证脚本）。两者边界模糊，且
`con_hf/dispatch/` 的报告逐条按 `cn_debug/<文件名>` 引用，批量移动会让引用失效。

处理方式改为**建索引而不是搬家**：`cn_debug/README.md` 按主题分区登记每个脚本的用途与是否可删，
新增探针必须登记；日志（`*.log`，已被 `.gitignore` 忽略）随时可删。
