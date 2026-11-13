2026-10-25 编码整顿执行完毕，E2E L3 闭合，分组工具回迁

## 本地同步缺口闭合

上一轮因本地 exec 通道故障未同步的两个分组表工具已回迁，双端哈希一致：

ops/build_grouping_master.py f5df0f6f3a47f837c0ce65417f83023b336a8264dbbec8ab135e0e74d1a4bcc2
ops/grouping_master.py ec423e900291bbf226abc81b15da7be8a830ed776033825d5290d8416c905

## E2E 三层验证闭合

L1 七项、L2 五项、L3 八项，共 20 项全部通过。L3 本轮结果：

ITEM15 PASS limma 与母版对账 logFC 相关 0.9999999772
ITEM16 PASS wgcna 模块 47 个
ITEM17 PASS 特征守恒 20019 三方一致
ITEM18 PASS PNG 5 张魔数全对
ITEM19 PASS 非空报告 4 个
ITEM20 PASS sha256 台账 17 行
ITEM21 PASS 文本产物 CR 字节 0
ITEM22 PASS 温度峰值 35705 毫摄氏度

### L3 脚本修掉的两个自身缺陷

1. ITEM20 算术错误。grep -c 无匹配时输出多行，$((...)) 报 syntax error。改为先取
   head -1 再做整数校验。

2. ITEM21 判据误报。原判据把 PNG 纳入 CR 字节检查，5 张 PNG 贡献 1311 个 0x0D，
   判为 FAIL。PNG 是二进制，内部 0x0D 属图像压缩数据。改为只检查 TSV 与 TXT。

### 一个数据时效性陷阱

ITEM20 第一次修正后仍失败，sha_lines 为 0。根因是 L2 日志是 sha256 台账补齐之前
生成的，里面本来就没有 sha256 行。重跑 L2 刷新日志后，4 个日志合计 17 条，立即
通过。跨步骤依赖的检查项，上游重跑后下游必须跟着重跑，否则拿旧产物验新契约。

## sha256 台账补齐的独立复核

此前派子代理 Peirce 补齐 10 个脚本的 sha256 台账，该代理未发回汇报。按不采信汇报
的原则独立复核三个样本，均为实跑产出：

gsva_pathway_score exit 0，台账 2 条
lasso_cox_model exit 0，台账 4 条
wgcna_module_trait exit 0，台账 6 条

覆盖核查 17 个改造脚本全部含 sha256 台账代码。补齐成果认可。

复核中定位到 lasso_cox_model 的输入契约：只接收 --input、--output、--seed，输入
必须是含样本 ID、futime、fustat 与至少 1 个基因列的合并表。前两次复核失败分别是
漏传基因列（exit 2）与合成数据无关联导致 lambda.min 选不出基因（exit 1，自校验
正确拦截）。第三次用有真实关联的数据跑通。该自校验有效。

## 编码整顿（用户明确要求，本轮执行完毕）

### 扫描器的三次修正

第一版扫描结果严重虚高：10130 个文件、2467 个需处理。逐项排查后发现三个扫描器
自身缺陷：

1. 排除逻辑只匹配路径第一段。BioanalysDesktop/node_modules 这种嵌套的第三方目录
   没被排除，44 个 npm 的 .cmd 文件混进 P0。改为全段匹配。

2. 未排除临时目录。.tmp 下 1377 个文件中 583 个需处理，全是一次性任务残留。

3. 备份目录被当生产代码。encoding_backup_20261024 是 2026-10-24 建的编码备份，
   保留原始 GBK 正是它的用途。转换前先验证了里面确实是 GBK（严格 UTF8 解码失败，
   GBK 解码正常），确认不应转换。

修正后真实规模：1363 个扫描文件、286 个需处理。其中 GBK 从 1452 降到 6，
encoding_needs_manual_review 从 540 归零。

### 执行结果

分两批执行。先 P0 的 12 个生产文件，再全量 286 个。

P0 清单：src/workflows.json、src/line2_scrna/README.md、ops 下 4 个、
BioanalysDesktop/server/project.js 与 tests 下 5 个。

全量 286 个转换 0 失败。重扫 needing_action=0。第二次执行 total=0，幂等确认。

### 转换安全性验证

src/workflows.json 转换后仍是合法 JSON，5 个顶层键完好
GBK 转 UTF8 的 R 脚本中文注释与代码正常可读
抽查 4 个文件均无 BOM、CR 字节为 0
286 个原始文件完整备份在 ops/encoding_backup/，按原相对路径存放

### 端到端回归

分组表 validate 3/3 VALID
limma 用分组表实跑 exit 0，输出 sha256 与历史基线
57eed9a42fe0489c077b5496d6e7140fc559e7ab155d92b654beb8de3b888902 完全一致
分组表读写往返幂等 YES

## 新增工具

ops/scan_encoding.ps1 只读扫描，输出 docs/encoding-audit-report.md 与
encoding-audit-detail.tsv，按 P0/P2/P3 分级
ops/fix_encoding.ps1 按清单执行转换，字节流读写，转换前备份，幂等，支持 -WhatIf 预演

## 当前资产状态

17 个改造脚本全部含 sha256 台账
分组总表 6 张，validate 6/6 VALID，工具双端哈希一致
E2E 三层 20 项全过
本地工作区编码 needing_action=0
286 个原始文件备份完好

## 遗留项

Peirce 代理未发回汇报，其台账片段未落盘，由本文件替代记录。
算力节点 上的改造脚本本轮未做编码复查，但它们一直只从本地同步出去，源头已清理。
