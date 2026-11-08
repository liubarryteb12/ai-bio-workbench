2026-10-25 每项目分组总表落地

## 需求

为每个项目单独建一张表，分组对应信息集中存放，以后可自由读取与修改。

## 交付物

1. 每项目一张表：`projects/<项目名>/grouping_master.tsv`
2. 每表一个只读 manifest：`grouping_master.tsv.manifest.txt`
3. 构建器：`/mnt/ssd/bio_data/ops/build_grouping_master.py`（12646 字节，755）
4. 读写工具：`/mnt/ssd/bio_data/ops/grouping_master.py`（13693 字节，755）
5. 使用文档：`docs/grouping-master-usage.md`

## 表结构

固定 12 列，顺序不可改。前两列刻意叫 `sample_id` 与 `group`，让所有改造脚本的
`--groups` 直接吃这张表，零转换。

sample_id, group, gsm_id, cohort, group_id, group_role, stage_order,
color_hex, pair_id, batch, is_reference, contrast_primary

## 工具命令

读取：list、show（支持 --group、--gsm、--cohort 过滤）、counts、validate、fields
写入：add、set、move、remove

写操作每次备份到 `.bak_before_edit`、原子重写、保持 UTF-8 无 BOM 加 LF、刷新
manifest。`sample_id` 是主键不可改，重复 add 被拒。

## 验收结果（8 项全过）

1. schema 六项全对：6/6
2. validate 全 VALID：6/6
3. 表直接被 limma_deg_analysis 与 geo_pca_scatter 消费：exit 0、exit 0
4. 与旧 group_map 统计等价：同参照组下 sha256 完全一致，为
   57eed9a42fe0489c077b5496d6e7140fc559e7ab155d92b654beb8de3b888902
5. 写读往返幂等：add 加 set 加 move 加 remove 后文件与原始态字节级一致
6. 字段填充（E2E）：除 cohort 与 batch 外全部 16/16，这两个对单队列项目为空
7. 文件卫生：两个工具与表均无 BOM、CR 字节为 0、mode 755
8. 全程温度最高 28.9 摄氏度

## 各项目规模

PRJ_20261019_IS_lactylation 195 样本，Control 67、IS 128，GSM 全映射 195/195
PRJ_E2E_GSE277173 16 样本，LS 8、NLS 8，GSM 16/16，配对 16/16
default 16 样本，LS 8、NLS 8，GSM 16/16
PRJ_20261020_DKD_bulk、DKD_scrna、RIF_spatial 空表，manifest 标注待补录
PRJ_E2E_SPATIAL 无 project.json，构建时 SKIP 并打印
_archive 是归档目录，按设计跳过

## 开发中修掉的缺陷

1. GSM 桥接源太窄。原只认 `grouping_master.txt`，E2E 项目用的是 `grouping.txt`，
导致 16 个样本的 GSM 全空。已扩展到两种文件名，并放宽表头匹配（去空格后比对）。

2. batch 列永远为空。`batch_col=dataset` 时去 `row["dataset"]` 取值，但
`collect_rows` 把 dataset 装进了 `cohort`，键名不一致。已改为从 cohort 回填，
IS 项目 195/195 填充。

3. pair_id 全空。`pair_map` 的键是 GSM 编号，表里是人类标签，直接查不到。已改为
先试人类标签，失败再用 GSM 桥接，E2E 达到 16/16。

4. `grouping_design` 为 null 时崩溃。`.get("grouping_design", {})` 在键存在但值为
null 时返回 None，再 `.get` 就炸。已改为 `((project or {}).get("grouping_design") or {})`。

5. manifest 写成表内注释行，把下游读取器打挂。`read.table` 把 `#` 行当数据行，
报 `line 17 did not have 12 elements`，两个改造脚本 exit 2。已拆成独立 manifest
文件，表恢复纯数据。

6. `stageOrder=0` 被写成空串。0 是合法阶段序号，被 falsy 判断丢掉，NLS 组
（reference）的 0 全变空。已改为显式 None 判断，现在 8 个 0 与 8 个 1。

7. `default` 项目元数据全空。它的 `grouping_design` 用下划线键名（`group_name`、
`is_primary`），构建器只认驼峰。已加 `first_key` 兼容两种风格，default 的
group_id、group_role、stage_order、color_hex、is_reference、contrast_primary
全部补齐，validate 由 INVALID 转 VALID。

8. `move` 换组后 `contrast_primary` 丢失。`sync_derived_fields` 只管组派生列，
没管表级的主对比列。已让主对比列每次同步都重写。

## 已知口径

IS 项目 manifest 有一条 WARN：`grouping_design` 登记 132 样本，表里 195 个。
原因是顶层 `group_map.tsv` 只收 GSE22255 与 GSE58294，漏了 GSE16561 的 63 个，
而 `grouping_design` 照抄了顶层。表取三队列并集所以是 195，更完整。要消 WARN，
把 GSE16561 的 63 个样本补进 `grouping_design` 的 sampleIds。

## 一个假阳性诊断

第一次对账两种输入时得 `EQUIVALENT=NO`，logFC 最大差 3.965、t 最大差 11.29，
P 值却完全一致。一度以为是表的问题。排查发现是对照基准用错参照组：
`/tmp/l2_deg_ls` 那次是 `reference_group=LS`，新表那次传的是 `NLS`。同参照组下
重跑，六列数值最大差全为 0，sha256 完全一致。这个诊断避免了误改正确代码。

## 遗留项

本地 exec 通道持续故障，`ops/` 下两个新脚本与表尚未同步到本地工作区，本地只有
使用文档。远端 `/mnt/ssd/bio_data/ops/` 是当前唯一母版。
