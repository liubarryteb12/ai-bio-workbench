2026-10-25 E2E 三层验证闭合，sha256 台账复核，分组工具回迁本地

## 本地同步缺口已闭合

上一轮因本地 exec 通道故障未能同步的两个分组表工具，本轮用 SSH 输出 base64 再本地解码的方式回迁，双端哈希一致：

ops/build_grouping_master.py sha256 f5df0f6f3a47f837c0ce65417f83023b336a8264dbbec8ab135e0e74d1a4bcc2
ops/grouping_master.py sha256 ec423e900291bbf226abc81b15da7be8a830ed776033825d5290d8416c905

本地副本无 BOM、纯 LF、语法通过。

## sha256 台账补齐的独立复核

此前派出子代理 Peirce 补齐 10 个脚本的 sha256 台账，该代理未发回汇报。按不采信汇报的原则独立复核，实测三个样本：

gsva_pathway_score exit 0，台账 2 条
lasso_cox_model exit 0，台账 4 条
wgcna_module_trait exit 0，台账 6 条

覆盖核查 17 个改造脚本全部含 sha256 台账代码。补齐成果认可。

## E2E L3 闭合（此前遗留）

L1 七项、L2 五项、L3 八项，共 20 项全部通过。

L3 本轮结果：

ITEM15 PASS limma 与母版对账，logFC 相关 0.9999999772
ITEM16 PASS wgcna 模块 47 个
ITEM17 PASS 特征守恒，基因 20019、改造 20019、母版 20019
ITEM18 PASS PNG 5 张魔数全对
ITEM19 PASS 非空报告 4 个
ITEM20 PASS sha256 台账 17 行
ITEM21 PASS 文本产物 CR 字节 0
ITEM22 PASS 温度峰值 35705 毫摄氏度，低于 60000 门禁

## L3 脚本修掉的两个自身缺陷

1. ITEM20 算术错误。`grep -c` 无匹配时输出多行，`$((...))` 报 syntax error in
expression 导致脚本中断。已改为先取 head -1 再做整数校验。

2. ITEM21 判据误报。原判据把 PNG 也纳入 CR 字节检查，结果 5 张 PNG 贡献 1311 个
0x0D 字节，判为 FAIL。PNG 是二进制格式，内部 0x0D 属图像压缩数据而非文本行尾。
已改为只检查 TSV 与 TXT 文本产物，修正后 CR 字节为 0。

## 一个数据时效性陷阱

ITEM20 第一次修正后仍失败，sha_lines 为 0。根因是 L2 的日志是台账补齐之前生成的，
里面本来就没有 sha256 行。重跑 L2 刷新日志后，4 个日志合计 17 条台账，ITEM20 立即
通过。这类跨步骤依赖的检查项，上游步骤重跑后下游必须跟着重跑，否则拿旧产物验新契约。

## lasso_cox_model 复核中定位到的输入契约

该脚本只接收 `--input`、`--output`、`--seed` 三个参数，输入必须是单文件合并表，
列需含样本 ID、futime、fustat 与至少 1 个基因列。前两次复核失败分别是因为漏传基因列
（exit 2）与合成数据无关联导致 lambda.min 选不出基因（exit 1，自校验正确拦截）。
第三次用有真实关联的数据（80 样本 40 事件）跑通，台账 4 条齐全。

这说明该脚本的自校验是有效的，能拦住统计上不可用的输入。

## 当前资产状态

17 个改造脚本全部含 sha256 台账
分组总表 6 张，validate 6/6 VALID
分组表工具双端哈希一致
E2E 三层 20 项全过

## 遗留项

Peirce 代理未发回汇报，其台账片段 `ledger-sha256-backfill.md` 未落盘，
本文件替代记录。编码整顿（CRLF 转 LF、GBK 转 UTF-8 的扫描）仍未执行，
本地 exec 通道本轮已恢复，具备执行条件。
