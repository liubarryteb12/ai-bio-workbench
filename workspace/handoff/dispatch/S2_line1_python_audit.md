[派发单 · 切片 S2] 子 Agent 任务：line1_bulk Python 图件几何审计补齐

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\2026-10-19_figure_polish_plan.md
两份文件是你的最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【远端通道】先执行：adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022
然后一律用：ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu '<命令>'
（本机 shell 是 git-bash；给原生 Windows 工具的路径用 C:/... 或 D:/... 正斜杠形式）

【背景】主 Agent 已确认：ops/audit_figure_layout.py 的机器几何审计只覆盖 Python 出图
（R 的 png() 设备拦不住，wgcna_modules 跑出来 figs=0）。line1_bulk 的 Python 图件里，
目前只有 enrichment_figures 有判决（4 图 PASS，已导入）。你要把其余 4 个 Python 出图脚本
补齐，产出逐图判决 CSV，供主 Agent 导入打分系统。

【任务项】（只做这些，不多做）
1. 修复/确认链路：adb forward 两条；ssh k40-ubuntu 'echo OK'。
2. 对下列 4 个脚本，逐个在远端跑几何审计并回收 CSV 到本地
   D:\00.AIagent\codespace\AI辅助生信分析流程工作台\cn_debug\figure_audit_sweep\：
     - /mnt/ssd/bio_data/bin/line1_bulk/bulk_figures
     - /mnt/ssd/bio_data/bin/line1_bulk/pca_matrix
     - /mnt/ssd/bio_data/bin/line1_bulk/deg_limma
     - /mnt/ssd/bio_data/bin/line1_bulk/key_genes
   命令模板（脚本路径必须绝对路径，cwd 用项目 processed 目录）：
     ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
       --script /mnt/ssd/bio_data/bin/line1_bulk/<step> \
       --cwd projects/PRJ_E2E_GSE277173/line1_bulk/processed \
       --runner bash --csv /tmp/audit_<step>.csv'
   回收：scp k40-ubuntu:/tmp/audit_<step>.csv 到上面的本地目录，文件名保持 audit_<step>.csv。
   若某个脚本审计失败（退出码 2 / 环境缺数据），**不要反复重试**，记录实际错误原文，
   继续下一个，并在回报里标为阻断项。

【硬性禁止】
- 禁止修改、新建、删除仓库里任何 src/ ops/ docs/ cn_debug/ con_hf/ 下的文件
  （唯一允许写入：cn_debug/figure_audit_sweep/ 目录下的 CSV 与一份结果说明 md）。
- 禁止直接 scp 覆盖 /mnt/ssd/bio_data/bin/ 下任何文件；禁止安装/升级任何包。
- 禁止访问外网；禁止动 projects/ 下的数据（审计默认 --write 不传，不会写图；
  但你必须在每个脚本审计前后各做一次 md5sum 校验，证明远端图件未被改写）。
- 禁止跑 ppi_string / ml_model / external_validation / ml_hub_analysis
  （前三个依赖外网或已有历史判决，属主 Agent 保留项）。

【验收标准】（主 Agent 按这些复核，不满足即打回）
A1 链路：adb forward 两条存在，ssh k40-ubuntu 'echo OK' 成功（附输出）。
A2 每个脚本都有：审计命令原文 + 输出尾 3 行（含 audit: figs=N fail=N 行）+ 对应 CSV 落本地。
A3 每个脚本都有审计前后远端 figures/ 的 md5sum -c 结果，证明图件未被改写。
A4 汇总一张表：脚本 / figs / fail / CSV 路径 / 涉及图文件名清单。
A5 明确列出：哪些脚本被跳过或失败、失败的错误原文、你的判断（代码/环境/数据问题）。
A6 不得给出"应该没问题"类结论；每个 PASS 都要有命令与输出佐证。

【回报】按 SUBAGENT_CONTRACT.md 的输出契约，Markdown 按序返回：
任务理解、实现摘要、文件变更清单、接口与交互实现说明、测试与验证记录、
假设与风险、架构/接口变更建议、待主 Agent 决策事项、建议下一步。
回报写到哪里：D:\00.AIagent\codespace\AI辅助生信分析流程工作台\cn_debug\figure_audit_sweep\S2_report.md
