# P12 line1 PPI 离线化 交付报告

切片：P12（line1 PPI 离线化，去掉运行时联网依赖）
执行者：blacklist-arch
write scopes：`src/line1_bulk/scripts/ppi_string`、`BioanalysDesktop/tests/ppi_string_offline.test.js`、`con_hf/dispatch/P12_report.md`
未改动：package.json、其它切片文件、git（无 commit / checkout / stash）

## 0 结论

`ppi_string` 的边表来源从"运行时 POST string-db.org"改为"离线优先读 STRING v12.0 本地文件，只有离线文件完全不存在才回落 API"。下游消费的 `ppi_edges.tsv` / `ppi_hubs.tsv` 列名与量纲一字未变（`key_genes` 读 `ppi_hubs.tsv` 的 `gene`/`degree` 不受影响）。新增 13 条测试全绿（其中 7 条真跑脚本解析逻辑），全量 `npm test` 640 pass / 0 fail。

## 1 改动文件

| 文件 | 变更 | 规模（实测） |
| --- | --- | --- |
| `src/line1_bulk/scripts/ppi_string` | 重写数据获取段与绘图前的边表装配；绘图段（caption / wrap_label / fit_text_edges / legend_out / layout_fix / _install_layout_guard、l1_07 网络图、l1_08 hub 条形）逐字保留 | 377 行 → 628 行，26400 字节，LF=628，CR=0，em dash=0 |
| `BioanalysDesktop/tests/ppi_string_offline.test.js` | 新建 | 14527 字节，CR=0，13 个 test |
| `con_hf/dispatch/P12_report.md` | 本报告 | 新建 |

## 2 实现要点

### 2.1 离线优先决策树（ppi_string:472-527）

```
links_target = env_path("BIO_STRING_LINKS", DEFAULT_LINKS)      # :477
info_target  = env_path("BIO_STRING_INFO",  DEFAULT_INFO)       # :478
links_file   = resolve_offline(links_target)                    # :479
info_file    = resolve_offline(info_target)                     # :480

links 与 info 都在       -> source="offline"，走本地流式扫描（:496-520）
只有其中一个在           -> print_download_guidance(...) + sys.exit(1)（:485-490）
两个都不在               -> source="api"，warn 后回落网络（:491-494）
api 也失败               -> print_download_guidance(err, ...) + sys.exit(1)（:522-525）
```

路径解析（:239-243 常量、:277-296 函数）：

- `STRING_DIR = "/mnt/ssd/bio_data/public_references/stringdb"`
- `DEFAULT_LINKS = STRING_DIR + "/9606.protein.links.v12.0.txt.gz"`
- `DEFAULT_INFO = STRING_DIR + "/9606.protein.info.v12.0.txt.gz"`
- `path_variants(p)`：`.gz` 与去掉 `.gz` 的同名文件互为候选，`resolve_offline` 返回第一个真实存在的路径（None 表示都不存在）
- `open_text(path)`：扩展名是 `.gz` 用 `gzip.open(path, "rt")`，否则 `open(path, "rt")`。所以运维把文件解压成 `.txt` 或保留 `.txt.gz` 都能直接跑，不需要改配置。

### 2.2 三个环境变量

| 变量 | 默认 | 作用 | 校验 |
| --- | --- | --- | --- |
| `BIO_STRING_LINKS` | `/mnt/ssd/bio_data/public_references/stringdb/9606.protein.links.v12.0.txt.gz` | 边表路径（.gz 或 .txt） | 存在性 |
| `BIO_STRING_INFO` | 同目录 `9606.protein.info.v12.0.txt.gz` | ENSP 到基因符号的映射表 | 存在性 |
| `BIO_STRING_MIN_SCORE` | `400` | `combined_score` 阈值（STRING 0..1000 口径） | `env_int` 要求整数，且必须落在 0..1000（:473-475） |

### 2.3 流式扫描，只保留需要的列（ppi_string:350-387）

`scan_links(path, wanted_ensp, min_score)` 逐行处理，全程不物化整表：

- `for line in fh` 逐行迭代，没有 `readlines()`、没有 `.read()`
- 跳过 `#` 注释行与 `protein1 protein2` 表头
- `parts = line.split(None, 3)[:3]`：只切出前 3 列（STRING 的 links 文件第 3 列是 combined_score），第 4 列及之后不解析
- 先做"边两端都在查询集内"与"score >= min_score"两道过滤，命中的边才写进字典
- 统计 `rows` / `low`（低于阈值）/ `dup`（重复边，含反向重复，保留最高分）/ `self`（自环）/ `kept`

内存占用与文件行数基本无关，见第 3.4 节实测。

### 2.4 ENSP 到基因符号映射，缺失不静默丢边

- `load_protein_info(path, wanted_symbols)`（:326-349）：读 info 表，只为查询基因建 `sym2ensp` 与 `ensp2sym`，跳表头注释行，不把 200 万行 info 全建进内存
- `norm_protein(pid)`（:312）去掉 `9606.` 物种前缀，`looks_like_ensp`（:322）识别 `^(?:\d+\.)?ENSP\d+$`
- `edges_to_table`（:389-427）：查不到符号的 ENSP **保留原名进边表**，只打 warn；同一基因的多个蛋白异构体折叠成自环时直接跳过（自环对 degree 无意义）
- warn 上限 `MAX_UNMAPPED_WARN = 20`（:236）：前 20 个逐条提醒，第 21 个改打一条汇总（"已超过 20 个，后续不再逐条提醒（这些边仍然保留 ENSP 原名，不会被丢弃）"）。理由：真实查询集上千基因、info 表版本不匹配时逐条 warn 会刷出几千行 stderr，把真正的错误埋掉
- 输入基因本身是 ENSP 形式（`looks_like_ensp`）时直接进查询集（:503-505），这是"映射缺失保留 ENSP"分支在正常数据下唯一可达的路径

### 2.5 两条路都失败：下载指引 + exit 1（:297-311）

`print_download_guidance(reason, links_target, info_target)` 打印的原文（实测输出，路径中的临时目录用 `<TMP>` 替换）：

```
ppi_string 拿不到 STRING 边表：<原因>
请下载 STRING v12.0 离线文件后放到目标路径（压缩包与解压后的 .txt 都支持）：
  links 目标: <TMP>/stringdb/9606.protein.links.v12.0.txt.gz
  links 下载: https://stringdb-downloads.org/download/protein.links.v12.0/9606.protein.links.v12.0.txt.gz
  info  目标: <TMP>/stringdb/9606.protein.info.v12.0.txt.gz
  info  下载: https://stringdb-downloads.org/download/protein.info.v12.0/9606.protein.info.v12.0.txt.gz
也可用 BIO_STRING_LINKS / BIO_STRING_INFO 指向别处（例如 /mnt/ssd/bio_data/ 下已有副本）。
```

默认部署时上面两个"目标"就是 `/mnt/ssd/bio_data/public_references/stringdb/` 下的两个文件名（测试用例真跑了默认路径不存在 + 死代理的场景，断言 stderr 里含这两个绝对路径与两个 URL，并断言 `ppi_edges.tsv`/`ppi_hubs.tsv` 没有被写出半成品）。

### 2.6 输出兼容性：改动前后对照

| 产物 | 改动前（API 版） | 改动后（离线版） | 是否兼容 |
| --- | --- | --- | --- |
| `ppi_edges.tsv` 列 | `gene_a` `gene_b` `combined_score` | 同左，一字未变 | 是 |
| `combined_score` 量纲 | STRING API `score` 列，0..1 浮点 | 离线 0..1000 整数除以 1000 后 `round(...,3)`，0..1 浮点 | 是（同量纲） |
| `ppi_edges.tsv` 行序 | API 返回顺序 | 按 `combined_score` 降序，同分按 `gene_a`、`gene_b` 升序 | 否（更可复现；下游按 `head()` 取 hub 不依赖边序） |
| `ppi_edges.tsv` 去重 | `drop_duplicates(subset=["gene_a","gene_b"])` | ENSP 层去重（含反向）保留最高分，再映射符号；同基因异构体折叠自环时跳过 | 等价或更严 |
| `ppi_hubs.tsv` 列 | `gene` `degree` | 同左 | 是 |
| `ppi_hubs.tsv` 行数 | `hub.head(200)` | `hub.head(200)`（:540，未改） | 是 |
| `ppi_hubs.tsv` 排序 | `sort_values("degree", ascending=False)` | `sort_values(["degree","gene"], ascending=[False,True], kind="stable")` | 是（degree 同序，同分时由基因名定序，`key_genes` 取 head 不再随机） |
| `ppi_report.txt` 键 | `step/seed/input_modules/method/note/n_edges/n_genes_in_network/top_hubs/outputs/elapsed_seconds` | 同左 | 是 |
| `ppi_report.txt` 的 `method` 行 | `method=STRING API network (species=9606, required_score=400)` | `method=STRING network (species=9606, required_score=400, source=offline:9606.protein.links.v12.0.txt.gz)` | 文本变了，键没变；多带 `source=` 便于事后判断这条报告是离线还是联网产物 |
| 图件 | `../figures/l1_07_ppi_network.png`、`../figures/l1_08_ppi_hubs.png` | 同左（绘图段逐字保留） | 是 |

下游实测依据：`src/line1_bulk/scripts/key_genes:236` 只取 `ppi_hubs.tsv` 的 `head(HUB_TOP)["gene"]`，`:253` 组 `hub_set`；仓库内没有任何脚本读 `combined_score`（它只在 `ppi_string` 内部当边权与绘图用）。

### 2.7 关键决策与理由

1. **半套离线不回落网络（:485-490）**：只有 links 没有 info 时直接 exit 1。理由：算力节点 外网不稳（本切片要解决的问题），回落等于把"偶发超时"重新引回来；而且缺 info 表只能输出 ENSP 名，下游 `key_genes` 会拿 ENSP 当基因符号去查，属于静默错结果，比失败更糟。
2. **`combined_score` 除以 1000（:412）**：离线 links 的 combined_score 是 0..1000 整数，API 的 score 是 0..1 浮点。除以 1000 后两者同量纲，下游与历史报告数字可直接对比。
3. **按"边两端都在查询集内"过滤**：这与 STRING `network` API 的语义一致（API 只返回查询集内部的互作），保持改动前后边集定义相同。副作用：查询基因与集外蛋白的边不进来，与旧行为一致。
4. **hub 排序加基因名作第二键**：旧版同 degree 的顺序取决于字典/DataFrame 内部顺序，`key_genes` 取 `head(30)` 时可能不同批次出不同 hub 集；加 `gene` 升序后同分顺序稳定可复现。
5. **保留 API 回落而不是彻底删掉**：派发单要求"只在离线文件完全不存在时才回落"。这样新环境（还没下载离线包）不会直接硬失败，但会先 warn 说明正在联网，跑完报告里 `source=api` 可追溯。

## 3 实测证据

### 3.1 新增单测

命令：`cd BioanalysDesktop && node --test tests/ppi_string_offline.test.js`
尾行原文：

```
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 13651.5457
```

13 条用例清单（7 条真跑脚本，用 `D:\Git\bin\bash.exe` + python3，全程带死代理 `HTTPS_PROXY/HTTP_PROXY=http://127.0.0.1:9`，任何触网都会立刻失败）：

| # | 用例 | 类型 |
| --- | --- | --- |
| 1 | shebang / `set -euo pipefail` / LF / 无 em dash | 静态 |
| 2 | 先解析离线文件再谈网络回落；`urlopen` 全文只出现 1 次；默认目录与两个文件名；三个环境变量名 | 静态 |
| 3 | 下载指引含两个单行 URL、两个目标路径、`sys.exit(1)` | 静态 |
| 4 | `scan_links` 体内 `for line in fh`、无 `readlines`、无 `.read()`、`split(None, 3)[:3]`、`score < min_score` | 静态 |
| 5 | `bash -n` | 真跑 |
| 6 | gz 离线文件出边表（阈值过滤 + 反向去重 + 符号映射 + 查询集外边剔除） | 真跑 |
| 7 | 只有未压缩 `.txt` 时按扩展名走纯文本读法 | 真跑 |
| 8 | `BIO_STRING_MIN_SCORE=300` 纳入 350 分低分边，默认 400 排除 | 真跑 |
| 9 | info 表缺符号时保留 ENSP 原名并 warn | 真跑 |
| 10 | 输出列名与 `combined_score` 量纲（header `gene_a/gene_b/combined_score`，分值 `[0.9,0.86,0.8,0.45]` 全在 0..1） | 真跑 |
| 11 | hub 表 degree 与边表逐行对账 | 真跑 |
| 12 | 两条路都失败：exit 1 + 两个 URL + 两个目标路径 + 不留半成品 | 真跑 |
| 13 | 只有 links 没有 info：不回落网络，exit 1 且指名缺 `protein.info` | 真跑 |

fixture 覆盖的脏数据：低分边（350）、反向重复边（900 出现两次）、查询集外边（ACTB-GAPDH）、info 表里查不到的 ENSP（ENSP00000000009）。期望边表 `EGFR-TP53 0.9 / ENSP00000000009-TP53 0.86 / BRCA1-MYC 0.8 / BRCA1-EGFR 0.45`，期望 hub 表 `BRCA1 2 / EGFR 2 / TP53 2 / ENSP00000000009 1 / MYC 1`，测试里逐字比对。

### 3.2 语法与字节

- `bash -n src/line1_bulk/scripts/ppi_string` → exit 0
- 字节统计：`bytes=26400 lines=628 LF=628 CR=0 EMDASH=0`

### 3.3 端到端 smoke（7 行 fixture，真跑，无网络）

stdout 原文：

```
step_executed=ppi_string
bioanalys_seed=20261013
input_modules=wgcna_modules.tsv
input_trait=wgcna_module_trait.tsv
significant modules=['tan', 'turquoise'] genes=5
offline_source links=<TMP>/stringdb/9606.protein.links.v12.0.txt.gz info=<TMP>/stringdb/9606.protein.info.v12.0.txt.gz info_rows=6 symbol_mapped=4/5 ensp_in_query=5
offline_scan rows=7 low_score=1 dup=1 self=0 kept=4
STRING edges=4 (source=offline, min_score=400)
wrote ppi_edges.tsv (4) + ppi_hubs.tsv (5 genes)
ppi_string warn: protein.info 缺 ENSP00000000009 的基因符号，输出保留 ENSP 原名
wrote ../figures/l1_07_ppi_network.png
wrote ../figures/l1_08_ppi_hubs.png
ppi_string_done
```

`ppi_edges.tsv`：

```
gene_a	gene_b	combined_score
EGFR	TP53	0.9
ENSP00000000009	TP53	0.86
BRCA1	MYC	0.8
BRCA1	EGFR	0.45
```

`ppi_hubs.tsv`：

```
gene	degree
BRCA1	2
EGFR	2
TP53	2
ENSP00000000009	1
MYC	1
```

`ppi_report.txt` 的 `method` 行：`method=STRING network (species=9606, required_score=400, source=offline:9606.protein.links.v12.0.txt.gz)`，`elapsed_seconds=1.2`。

### 3.4 规模与内存（实测，合成 links 文件）

合成数据：随机 ENSP 对 + 每 500 行插一条查询基因边，分数 150..999 均匀分布；info 表 20 万行 + 4 条查询基因。峰值内存用 PowerShell 每 100ms 采样 `python` 进程 `WorkingSet64` 取最大值；耗时用 `Stopwatch` 包住整个 bash 进程（含 pandas/matplotlib 导入与出图）。

| links 行数 | gz 体积 | 退出码 | 墙钟 | 峰值 python 工作集 | 脚本内 elapsed_seconds | 扫描统计 |
| --- | --- | --- | --- | --- | --- | --- |
| 5,000 | 72,358 B | 0 | 3.16 s | 399.4 MB | 1.6 s | rows=5000 low_score=6 dup=3 kept=11 |
| 1,000,000 | 14,394,819 B | 0 | 5.81 s | 402.6 MB | 4.3 s | rows=1000000 low_score=1175 dup=1411 kept=1414 |
| 4,000,000 | 57,580,984 B | 0 | 9.69 s | 407.9 MB | 8.2 s | rows=4000000 low_score=4619 dup=5749 kept=5632 |

行数放大 800 倍（5 千到 400 万），峰值工作集只从 399.4 MB 涨到 407.9 MB（+2.1%），增量部分来自边字典本身；这 400 MB 的底座主要是 pandas + matplotlib 导入。可以确认扫描是流式的，没有把整表读进内存。

另一次 2,000,000 行、gz 28,790,017 B 的同类实测：墙钟 7.15 s，峰值 404.5 MB，stderr 21 行（20 条逐条 warn + 1 条汇总，验证了 warn 上限生效）。

### 3.5 全量回归

命令：`cd BioanalysDesktop && npm test`
尾行原文：

```
ℹ tests 640
ℹ suites 0
ℹ pass 640
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 20744.8754
```

（计数随队友并行新增测试浮动；本切片新增的 13 条在 `tests/*.test.js` glob 内，已被包含。）

## 4 遗留风险

### 4.1 未实测项

- **算力节点 上默认路径是否存在**：按纪律不连远端，`/mnt/ssd/bio_data/public_references/stringdb/9606.protein.links.v12.0.txt.gz` 与同名 info 表是否已就位，待 算力节点 侧确认（不存在时脚本会 exit 1 并打印下载指引，不会静默失败）。
- **真实 v12.0 links 文件（约 1200 万行，全库约 1.3 亿行）的实际耗时**：本机只跑到 400 万行合成数据。按 400 万行 8.2 s 线性推算，人类 1200 万行约 25 s 量级（**推算值，未实测**）。
- **API 回落分支未真连 string-db.org**：测试只验证了"离线缺失 + 网络不可用 = exit 1 + 指引"这一侧；回落成功路径的解析逻辑沿用改动前的代码（`fetch_api_edges`，:428-444），未在联网环境复测。

### 4.2 已知边界

- `ppi_hubs.tsv` 仍写 `head(200)`（:540，与改动前一致）。`key_genes` 取 `head(30)` 不受影响，但如果未来有下游需要全量 degree 表，200 行截断会静默丢数据。
- 缺符号映射的 ENSP 逐条 warn 上限 20（:236）。超过 20 个后只有一条汇总，具体是哪些 ENSP 需要看边表本身，stderr 不再列出。
- 离线模式下"查询集外的边"被剔除（与 STRING `network` API 语义对齐）。若将来需要"查询基因的一阶邻居"（`interaction_partners` 语义），需要另外加一档过滤策略，不能直接改这个条件。
- 只支持 STRING 人类（species 9606）单文件；其它物种要换文件名，目前靠 `BIO_STRING_LINKS`/`BIO_STRING_INFO` 覆盖。

### 4.3 范围外建议改动（请 Lead 决定是否落地）

| 位置 | 建议 | 理由 |
| --- | --- | --- |
| `docs/` 或部署手册（line1 步骤说明） | 写明 STRING v12.0 两个文件的预下载命令与放置目录，并注明 `BIO_STRING_LINKS`/`BIO_STRING_INFO` 可覆盖 | 现在只有脚本报错时才知道要下什么；离线包属于环境前置条件 |
| 流水线配置/环境自检 | 在运行前置检查里加一条"离线 STRING 文件存在性"检查，缺文件在启动时就报错，而不是跑到 line1 第 7 步才 exit 1 | 省一次无效跑批 |
| `src/line1_bulk/scripts/key_genes` | 若要展示 `combined_score` 或全量 degree，需要同步放开 `head(200)` 与边序假设 | 本切片不动下游 |
| 其它用到 STRING 的脚本（若有） | 统一走同一套离线解析函数，避免第二个联网点 | 目前只有 `ppi_string` 联网 |
