[派发单 · 切片 S3] 子 Agent 任务：line1_bulk 剩余 Python 图件几何审计补齐（必须带真种子）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\2026-10-19_figure_polish_plan.md
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\踩坑台账.md 的 #190（必读，本轮最大的坑）
两份以上文件是你的最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【远端通道】先执行：adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022
然后一律用：ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu '<命令>'
（本机 shell 是 git-bash；原生 Windows 工具路径用 D:/... 正斜杠形式）

【#190 教训（违背即打回）】bash 通道的几何审计是**真跑脚本**，会重写远端 processed/ 的报告与
figures/ 的图件。种子必须传 `--seed 20261013`（本项目真种子）。审计默认不写图（不传 --write），
但报告仍会被重写（seed 行不变，`elapsed_seconds` 行会变）——这属于已知可接受副作用，
你必须在回报里如实记录每个报告文件的变化内容。

【任务项】
1. 链路自检：adb forward 两条；ssh k40-ubuntu 'echo OK'。
2. 建立前后对照基线（远端，一次即可）：
   - figures/ 全量 md5 → /tmp/s3_figs_before.md5
   - processed/ 全量 md5 → /tmp/s3_proc_before.md5
3. 对下列 3 个脚本逐个跑几何审计，CSV 回收本地到
   D:\00.AIagent\codespace\AI辅助生信分析流程工作台\cn_debug\figure_audit_sweep\：
     - /mnt/ssd/bio_data/bin/line1_bulk/ml_hub_analysis
     - /mnt/ssd/bio_data/bin/line1_bulk/ml_model
     - /mnt/ssd/bio_data/bin/line1_bulk/external_validation
   命令模板（**注意 --seed 20261013**）：
     ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
       --script /mnt/ssd/bio_data/bin/line1_bulk/<step> \
       --cwd projects/PRJ_E2E_GSE277173/line1_bulk/processed \
       --runner bash --seed 20261013 --csv /tmp/audit_<step>.csv'
   回收：scp k40-ubuntu:/tmp/audit_<step>.csv 到上述本地目录，文件名保持 audit_<step>.csv。
4. 每个脚本审计后立刻做前后对照：
   - md5sum -c /tmp/s3_figs_before.md5（统计 OK/FAILED）
   - md5sum -c /tmp/s3_proc_before.md5（统计 OK/FAILED，并对 FAILED 的文件逐个 diff 出差异行）
   若 FAILED 的文件**不是报告类**（.txt/.json 之外，比如 .tsv 数据表变化）→ 立即停止后续审计，
   在回报里标 P0 阻断并附差异内容，等主 Agent 裁决。
5. 合并本地 cn_debug/figure_audit_sweep/audit_*.csv（含 S2 已产出的 4 个）与
   cn_debug/figure_audit_line1.csv（enrichment 的 4 图判决）为一份
   cn_debug/figure_audit_line1.csv（列：figure,verdict,violations；同名图后者覆盖前者），
   并跑：
     python cn_debug/figure_score.py --dir outputs/PRJ_E2E_GSE277173/line1_bulk/figures \
       --audit-csv cn_debug/figure_audit_line1.csv --code-csv cn_debug/code_audit.csv \
       --ledger-dir outputs/system_logs
   把尾部 3 行原文贴进回报。

【硬性禁止】
- 禁止跑 `ppi_string`（它每次重取 STRING API，结果不可复现，重跑会改写 ppi_edges/ppi_hubs 交付表）。
- 禁止修改、新建、删除仓库里任何 src/ ops/ docs/ con_hf/ cn_debug/ 下的文件；
  唯一允许写入：`cn_debug/figure_audit_sweep/` 下的 CSV 与一份 S3_report.md。
- 禁止直接 scp 覆盖 /mnt/ssd/bio_data/bin/；禁止安装/升级任何包；禁止访问外网。
- 禁止改 `cn_debug/figure_score.py` / `figure_code_audit.py` 的行为或参数。
- 禁止对无法验证的项下结论；每个 PASS 都要有命令与输出佐证。

【验收标准】
A1 链路自检通过（附输出）。
A2 三个脚本各有：审计命令原文（含 --seed 20261013）+ 输出尾 3 行 + CSV 落本地。
A3 三个脚本各有前后 md5 对照：figures/ 与 processed/ 的 OK/FAILED 计数；
    FAILED 的文件逐个列出并给出差异行（diff）。
A4 合并后的 figure_audit_line1.csv 行数、其中 PASS/FAIL 计数。
A5 figure_score.py 输出的尾部 3 行原文（含 PASS/FAIL/UNVERIFIED 计数与 avg）。
A6 明确列出被跳过的脚本与理由、以及任何异常/阻断项。

【回报】按 SUBAGENT_CONTRACT.md 的输出契约，Markdown 按序返回：
任务理解、实现摘要、文件变更清单、接口与交互实现说明、测试与验证记录、
假设与风险、架构/接口变更建议、待主 Agent 决策事项、建议下一步。
回报写到：D:\00.AIagent\codespace\AI辅助生信分析流程工作台\cn_debug\figure_audit_sweep\S3_report.md
