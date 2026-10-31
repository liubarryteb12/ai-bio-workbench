# 分组总表使用说明

每个项目一张 `grouping_master.tsv`，放在项目根目录下：

```text
projects/<项目名>/grouping_master.tsv
```

分组对应关系集中在这一张表里，配套一个只读的 manifest 说明文件
`grouping_master.tsv.manifest.txt`，记录口径、来源与已知差异。

## 表结构

固定 12 列，顺序不可改：

```text
sample_id	group	gsm_id	cohort	group_id	group_role	stage_order	color_hex	pair_id	batch	is_reference	contrast_primary
```

前两列固定叫 `sample_id` 与 `group`，这是刻意设计的：所有改造后的分析脚本
都用 `--groups` 直接吃这张表，不需要任何转换。后 10 列承载元数据，用不用随你。

## 怎么读

```bash
python3 /mnt/ssd/bio_data/ops/grouping_master.py list
python3 /mnt/ssd/bio_data/ops/grouping_master.py show <项目名>
python3 /mnt/ssd/bio_data/ops/grouping_master.py show <项目名> --group LS
python3 /mnt/ssd/bio_data/ops/grouping_master.py show <项目名> --gsm GSM8515887
python3 /mnt/ssd/bio_data/ops/grouping_master.py show <项目名> --cohort GSE16561
python3 /mnt/ssd/bio_data/ops/grouping_master.py counts <项目名>
python3 /mnt/ssd/bio_data/ops/grouping_master.py validate <项目名>
python3 /mnt/ssd/bio_data/ops/grouping_master.py fields
```

`validate` 会查重复样本、空分组、缺字段、未登记分组、孤儿配对、同组配对，
有问题返回退出码 1 并逐条列出，适合改完表后跑一遍。

## 怎么改

```bash
# 加样本
python3 .../grouping_master.py add <项目名> <样本ID> <组名> [--gsm GSMxxx] [--cohort 队列名]

# 改单个字段（sample_id 不可改，它是主键）
python3 .../grouping_master.py set <项目名> <样本ID> <字段名> <值>

# 换组，group_id、group_role、stage_order、color_hex、is_reference 自动跟着同步
python3 .../grouping_master.py move <项目名> <样本ID> <新组名>

# 删样本
python3 .../grouping_master.py remove <项目名> <样本ID>
```

每次写操作都会：备份到 `grouping_master.tsv.bak_before_edit`、原子重写、
保持 UTF-8 无 BOM 加 LF、刷新 manifest。

实测 add → set → move → remove 完整往返后，文件与原始态字节级一致，
可以反复编辑不累积漂移。

## 怎么重建

表由 `project.json` 的 `grouping_design`、`experimental_design` 与各队列的
`group_map.tsv`、`raw_data/grouping*.txt` 汇总生成：

```bash
python3 /mnt/ssd/bio_data/ops/build_grouping_master.py
```

重建是幂等的，重复跑结果相同。要改设计（换组定义、改颜色、改主对比）请改
`project.json` 的 `grouping_design`，再跑一次重建，不要在表上手改派生列。

## 已知口径

`project.json` 的 `grouping_design` 在本工作区存在两种键名风格：多数项目用驼峰
（`groupName`、`groupId`、`stageOrder`、`colorHex`、`isPrimary`、`sampleIds`），
`default` 项目用下划线（`group_name`、`group_id`、`stage_order`、`color_hex`、
`is_primary`、`sample_ids`）。构建器与读写工具两种都认，用 `first_key` 取第一个
存在的写法。新建项目时建议跟前一种，与多数项目一致。

`PRJ_20261019_IS_lactylation` 的 manifest 有一条 WARN：`grouping_design` 只登记
132 个样本，表里有 195 个。原因是顶层 `group_map.tsv` 只收了 GSE22255 与
GSE58294 两个队列，漏了 GSE16561 的 63 个样本，而 `grouping_design` 照抄了顶层。
表取三个队列的并集所以是 195，更完整。要消除这条 WARN，把 GSE16561 的 63 个样本
补进 `grouping_design` 的 `sampleIds`。

三个空骨架项目（DKD_bulk、DKD_scrna、RIF_spatial）只有表头，manifest 里标注
`header-only table awaiting curation`，等有数据再重建。

`cohort` 与 `batch` 两列对单队列项目为空，是多队列时才用的。

## 字段来源

| 列 | 来源 |
| --- | --- |
| sample_id | 各 `group_map.tsv` 的样本列 |
| group | 各 `group_map.tsv` 的分组列 |
| gsm_id | `grouping.txt` 或 `grouping_master.txt` 的 GSM 编号列桥接 |
| cohort | `group_map.tsv` 的 dataset 列，或队列目录名 |
| group_id | `grouping_design.groups[].groupId` |
| group_role | `grouping_design.groups[].role` |
| stage_order | `grouping_design.groups[].stageOrder`，0 是合法值 |
| color_hex | `grouping_design.groups[].colorHex` |
| pair_id | `experimental_design.pair_map`，支持 GSM 编号或人类标签两种键 |
| batch | `experimental_design.cov.batch_col` 指向的列 |
| is_reference | role 等于 reference 时为 TRUE |
| contrast_primary | `grouping_design.contrasts[]` 中 isPrimary 为真的 name |
