结论

正式签发 Final Go-Live（V1.0 生产封板令生效）。

本次 BLKR-01 真机冒烟直接揪出了 3 个任何 Mock 与单测都绝对测不出来的致命物理断层（真机 R site-library 43,228 个断链、真机 run_throttled_task.sh 停留在 11 月 6 日无 6.5GB 档位旧版、以及 .csv 矩阵角色正则漏匹配导致 prep_matrix Exit 2）。这完全印证了上一轮“严禁跳过真机冒烟”的铁律。当前四组观测点全部实证闭环，2207 条用例 0 失败、29 道门禁全绿、28 条变异 0 逃逸，已具备上线投产条件。

两处裁定

裁定 1：关于签名结构偏差（认可现状，严禁封板前破拆 receipt/v1 Schema）

判决：完全认可当前已实现的“交付包 CHECKSUMS.sig + 包内 receipt_v1.json 搭载 ed25519_signature + sentinel: "PRODUCTIZATION_RECEIPT_OK" 字符串”方案；废除原第二轮设计稿中“将 sentinel 从字符串改为对象”的提议。

架构理由：
防篡改密码学等价性已 100% 满足：只要 receipt_v1.json 自身带有 ed25519_signature（且被纳入 CHECKSUMS.sha256 清单，再由 CHECKSUMS.sig 实施整包 Ed25519 签名），攻击者篡改 delivery_grade 或 adaptation_trace 的任何一个字节，都会同时击穿 receipt_v1.json 验签与 CHECKSUMS.sig 验签。安全强度与原设计稿完全等价。
守护契约向后兼容性：sentinel: "PRODUCTIZATION_RECEIPT_OK" 是现有的字符串型不变量契约。若在封板前夕将其强行改为嵌套 Object，会直接破坏下游验收器与历史归档解析器的类型假设，属于典型的“为了形式对齐而制造回归风险”。
后续收敛：仅需确认 receipt_v1.json 内部计算 ed25519_signature（或写入 CHECKSUMS.sha256 前）已包含顶层的 delivery_grade 与 adaptation_trace 字段即可，无需在封板后另开破坏 Schema 的补丁票。

裁定 2：关于真机计算链与 Pi 双检查点分步验证（批准封板，单会话胶水列为封板后 Ticket #2）

判决：当前证据已足够签发 Final Go-Live，无需为了合并单会话重跑封板流程；但必须将“Pi 会话 PLAN_APPROVED 自动触发 D4.9 生产 DAG 下发与 AWAITING_TARGET_APPROVAL 回调”列为封板后第二顺位补丁票（Post-Go-Live Ticket #2）。

架构理由：
高风险物理面已全部验真：本次冒烟最核心的任务是验证 D1→D2 跨面同步、ADB 10022 → K40 容器 6.5GB/3.5GB 算力执行、R 3.68.5 真实环境产出 WROTE 账实一致 以及 Pi 180s 自动放行与检查点二签发状态机。这两条子链路在同一个项目目录、同一套 SQLite 库与算力节点上各自跑通，证明所有底层组件与边界契约均已无死角工作。
剩余工作属于纯内存状态胶水：将“Pi 检查点一 PLAN_APPROVED”与“调用编排器触发 4 个模块计算”串成单一路径，仅涉及 server 内部事件触发与 session_id ↔ work_order_id 的外键透传，不涉及跨设备 I/O 或底层 Schema 变更，放在封板后常规迭代合并风险极低。

必补项

本次 Final Go-Live 已无任何前置阻塞项（0 Blockers）。封板后第一周按以下严格顺位消化 3 张巩固票（Post-Go-Live Hardening Tickets）：

[TICKET-OPS-01] K40 算力面环境与脚本哈希开机自检门禁（最高优，针对观测点 3）：
背景：真机冒烟暴露出两个极高危隐患——R site-library 43,228 个断链，以及真机 run_throttled_task.sh 停留在 11 月 6 日旧版（违反 REJ-003）。
动作：在编排器启动或每次 D2 认领首单前的 preflight_check 中，加入一条 1 秒级 ADB 探针：① 核对远端 run_throttled_task.sh 与 core/mem_guard.py 的 SHA-256 与本地仓库一致（不一致则自动 adb push 覆盖）；② 执行 Rscript -e "library(limma)" 快速探活（失败则立即告警阻断下发，拒绝带着断链跑任务）。

[TICKET-D4.9-02] Pi 单会话与生产计算链端到端胶水合龙（针对裁定 2）：
动作：打通 AWAITING_PLAN_APPROVAL --(180s auto-pass)--> PLAN_APPROVED 后的自动钩子，使其无需管理员二次手动确认工单即可直接驱动 dispatch_and_poll_dag 跑完 prep/qc/pca/deg 并自动停靠在 AWAITING_TARGET_APPROVAL。

[TICKET-D0-01] Electron 主从进程 stdin 死亡管道防孤儿锁（上一轮遗留）：
动作：实装 stdio: ['pipe', ...] 与 process.stdin.on('end', exit)，闭环 Windows 强杀残留问题。

风险

K40 冷备卷恢复后的文件系统持久性风险（中危）：
观测点 3 提到“R site-library 的 43,228 个文件原本全是指向空目录的断链，用冷备卷恢复后可用”。需要警惕：为什么之前会变成指向空目录的断链？如果是因为手机重启、Termux/proot 挂载点顺序变化或 /tmp 清理脚本误删了软链目标目录，下次手机断电重启后还会再次断链。对策：在 [TICKET-OPS-01] 中固化挂载点检查，或将 site-library 从符号链接改为实体目录/只读 bind-mount。

表格类扩展名在不同分析线的长尾漏网风险（低危）：
本次抓出了 .csv 在 counts/matrix 角色中漏配正则的真 Bug。需顺手核查单细胞（Line 2）和空转（Line 3）的 plan 角色正则是否已完整对齐 D1 门户的 14 项扩展名白名单（特别是 .csv.gz、.tsv.gz、.mtx.gz、.h5、.h5ad、.rds），防止门户放行进来的合法后缀在编排器 role_resolver 处再次出现“门户认、执行器不认”的断层。

下一步

打标封板：在 Git 仓库对当前通过 2207 条测试、29 道门禁与 BLKR-01 真机冒烟的 Commit 打上正式标签（如 v1.0.0-go-live），并将本次产出的 PKG_2026-11-15_152638_BLKR01_PKG 及其签名回执归档为永久基线样本。

转入稳态运营：按顺序合入 [TICKET-OPS-01]、[TICKET-D4.9-02]、[TICKET-D0-01]，并开启首周三大指标（僵尸锁、Exit 5 冷却、OOM 适配预算）观察。

本轮架构会审全部结束，恭喜项目高质量封板通关。
