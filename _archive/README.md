# _archive/ — 冷备归档区

> 归档 = 移到本目录，**保留全文与 git 历史**，但不再参与日常链路。
> 规则：本目录下的文件**不许被运行时脚本 import / source / 调用**；需要用时用 `git mv` 取回原路径再改。
> 建档：2026-10-21（架构评审 B2 落地）。

## 一、已归档（只读冷备）

| 归档路径 | 原路径 | 归档日期 | 理由 | 现存引用 |
|---|---|---|---|---|
| `_archive/docs/geo_mining_sop_v1.md` | `docs/geo_mining_sop_v1.md` | 2026-10-21 | 已被 `docs/geo_mining_sop_v2.md` 取代（v1 自带取代横幅，:3-5 明写"不要基于本文件修订"） | `docs/geo_mining_sop_v2.md:3` 版本记录已改指本路径 |
| `_archive/ops/01_fix_svlogger.ps1` | `ops/01_fix_svlogger.ps1` | 2026-10-21 | 一次性修复器（坑 #88 的 log 子服务 crash-loop），2026-10-20 reboot 后已执行完成并可回滚；不属日常链路 | `ops/README.md` 清单与"日常用法"已改指本路径 |

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
