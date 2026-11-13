2026-10-25 line2 与 line3 台账补齐，三线契约统一

## 完成度审计发现的缺口

逐项审计时发现：line1 的 17 个改造资产已全部补齐 sha256 台账，但 line2_scrna 的
22 个与 line3_spatial 的 17 个共 39 个步骤脚本，台账覆盖率为 0/39。这是规范第 6 条
要求的契约，line1 做了，另外两条线漏了。

同时确认母版 10 个脚本完好（零改造特征污染），三线检查点都在位，三线编码全干净。

## 方案选择

39 个脚本的尾部写法有三种：report_lines 列表加 open 写文件、report.append 加
os.environ 路径、只出图不出报告。逐个适配侵入式补丁需要三套适配器，且容易漏。

改用非侵入方案：写一个独立的后置台账脚本 k40_step_sha_ledger.sh，由各步骤脚本
在末尾调用一次。这样 39 个脚本只加一个钩子，逻辑集中在一处可维护。

## 开发中修掉的四个缺陷

1. 钩子插入位置错误（最严重）。最初插在 PYSCRIPT 之前，而 PYSCRIPT 是 heredoc 的
   结束标记，插在它前面等于把 bash 行当 Python 代码传给孩子进程。发现方式：抽样
   5 个脚本提取 Python 段做语法检查，全部报 invalid syntax。排查后确认钩子行落在
   Python 域。已回滚 39 个脚本，把钩子改到 PYSCRIPT 之后重新应用。

2. outdir 解析出双引号。outdir_var 返回已带引号的字符串，模板又包一层，生成
   ""$PWD""。已改为返回裸表达式，由模板统一加引号。

3. 台账自引用。台账段把报告自身也哈希，而报告正在被追加写入，哈希必然不匹配，
   自校验恒 FAIL。已跳过报告自身，它的完整性由写出它的步骤负责。

4. 台账把输入与日志也算进去。最初扫目录下所有文件，把上游输入的 h5ad 和我的
   run.log 也哈希了。已改为优先读报告里的 outputs= 清单，只哈希本次步骤产物；
   报告没有 outputs= 行时才退回目录扫描并排除输入与日志。

## 端到端验证

line2 qc_cells：exit 0，台账只含 scrna_qc.h5ad 与 qc_cell_metrics.tsv 两个产物，
自校验全 OK，重复执行幂等（段数恒为 1）
line3 qc_spots：exit 0，台账含 spatial_qc_mouse.h5ad、spatial_qc_human.h5ad、
spot_qc_metrics.tsv 三个产物，自校验全 OK

## 交付物

/mnt/ssd/bio_data/ops/k40_step_sha_ledger.sh 独立台账脚本，125 行，幂等，自校验
/mnt/ssd/bio_data/ops/hook_ledger.py 钩子接入工具
39 个步骤脚本末尾加钩子，bash 语法 39/39，Python 段语法 0 失败，钩子位置 0 错放
39 个脚本各有 .bak_20261025_ledger_hook 备份，权限 755
src/line2_scrna/scripts 与 src/line3_spatial/scripts 母版已同步为含钩子版本，
与 bin 部署版零差异，避免下次部署丢失

## 双端一致性

39 个 line2 与 line3 脚本本地与 算力节点 哈希逐项一致，match=39 diff=0 missing=0
两个新工具已同步到本地 ops/

比对时遇到一个假阳性：line2 与 line3 有 4 组同名脚本（dr_post_analysis、
enrichment、enrichment_figures、normalize_hvg），按文件名匹配会串线，报出 4 个
DIFF。改成带线前缀的键后确认 39/39 一致。同名脚本的双端比对必须带线前缀。

## 全库编码

同步后重扫 needing_action=0，1375 个文件全部合规，新工具无 BOM 纯 LF。
