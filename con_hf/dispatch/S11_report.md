# S11 执行台账：文献索引与软件版本接入交付报告

> 子 Agent 切片 S11。本文件按步骤追加，每完成一步写一次（不事后补写）。
> 项目根：`D:\00.AIagent\codespace\AI辅助生信分析流程工作台`

## 步骤 0 · 上下文核对（2026-10-19）

已读：`con_hf/dispatch/SUBAGENT_CONTRACT.md`、`aims/aims.txt`（§一.3 铁律 = seed/包版本契约；
§四 三线分工）、`reference/生信分析可用参考文献/文献下载清单.md`、04 目录 18 个 PDF、
`ops/build_client_report.py`（1881 行，七章 + `--self-test`）。

事实核对结果（与派发单描述的差异，据实记录）：

| 派发单说法 | 实际 | 处理 |
|---|---|---|
| `aims/aims.txt §3` | 文件内没有 `§3` 编号；对应内容是「## 一、架构拓扑与三大铁律」下的第 3 条（L28，含 `seed = 20261013` 与固定包版本要求） | 按 L28 实现 |
| `aims/aims.txt §3.2`（报告结构） | 不存在；七章结构实际写在 `ops/build_client_report.py` 的 `CHAPTER_BUILDERS` 与 `aims/aims.txt` §七.2 引用 | 以代码现状为准，不动章节结构 |
| 04 类「约 20 篇」工具包 PDF | 实际 **18 个 PDF / 14 篇唯一论文**（DESeq2、Scanpy、PyWGCNA、CellChat 各有一份重复拷贝） | INDEX.md 按 18 个文件全量覆盖，重复项标 `duplicate_of` |
| 远端 `ops/build_client_report.py` | 83411 字节（2026-10-19 02:46），**比本地 96059 字节旧**（缺 S7 的 `STEP_CATALOG` 分线重构） | 部署前先备份，再以本地版本覆盖（见步骤 4） |

另确认：本地不是 git 仓库（`git status` 报 `not a git repository`），因此「diff / 未提交改动」只能用
文件备份与 `diff` 对比来留痕，不能用 git。

## 步骤 1 · 远端实采软件版本（2026-10-19）

通道：`adb forward tcp:8022/10022` → `ssh k40-ubuntu` → 容器内 `Rscript` / `python3`。
探针脚本：`cn_debug/2026-10-19_s11_collect_versions.py`（只读：只 `requireNamespace` / `import`，
不安装不升级）。原始输出留档：`cn_debug/2026-10-19_s11_versions_raw.json`。

实测结果（节选，全量见 `docs/software_versions.json`）：

- `Rscript --version` → `Rscript (R) version 4.3.3 (2024-02-29)`
- `python3 --version` → `3.12.3`
- R：WGCNA 1.74 / limma 3.58.1 / ggplot2 4.0.3 / clusterProfiler 4.10.1 / Seurat 5.6.0 /
  pheatmap 1.0.12 / data.table 1.14.10 / glmnet 4.1.8 / GSVA 1.50.5 / matrixStats 1.2.0 /
  survival 3.5.8 / org.Hs.eg.db 3.18.0 / ComplexHeatmap 2.18.0 / pROC 1.18.5 / GSEABase 1.64.0
- Python：scanpy 1.12.4 / anndata 0.13.4 / pandas 2.3.3 / numpy 2.5.3 / scipy 1.18.1 /
  scikit-learn 1.9.1 / matplotlib 3.11.2 / seaborn 0.13.2 / networkx 3.7 / statsmodels 0.15.0 /
  harmonypy 2.0.2 / liana 1.10.0 / pyscenic 0.12.1 / arboreto 0.1.6 / gseapy 1.3.1 /
  scTenifold 0.5.1 / shap 0.53.0 / h5py 3.16.0 / Pillow 12.3.0 / adjustText 1.4.0
- **squidpy 未安装**（`ModuleNotFoundError`）:与 `src/line3_spatial/scripts/spatial_domains:220`
  记录的「squidpy dry-run 连带降级、改走 numpy 原生实现」一致。

「该包属于哪条线」不是猜的：对 `src/<line>/scripts/` 逐个 grep `library()/require()` 与
`^[[:space:]]*(import|from)`，未在任何线脚本出现的包（Seurat / pheatmap / ComplexHeatmap /
pROC / seaborn / squidpy）`lines` 留空并注明「已安装但未进入流程」，因此**不会被写进报告引用**。

产物：`docs/software_versions.json`（36 个包 + 2 个解释器 + seed 20261013，每条带 `source` 实测命令）。
选择 JSON 而非 YAML 的理由：报告引擎此前**零第三方依赖**（只 import stdlib），远端虽装有
PyYAML 6.0.3，但为交付链路引入隐式依赖不值得；`json` 是 stdlib，且同一份清单要在远端
`ops/` 与本地仓库两处读。

## 步骤 2 · 文献索引（2026-10-19）

- 机读源：`reference/生信分析可用参考文献/citations.json`（15 条 entries + 4 条 duplicates）。
- 人读视图：`reference/生信分析可用参考文献/INDEX.md`（105 行），由 `ops/gen_reference_index.py`
  从 JSON 生成，**不手写**:报告引用与人工索引读同一份数据，避免两套说法漂移。
  生成时逐个校验 PDF 路径真实存在；04 目录下任一 PDF 未进索引即报错。

取值一律用 `pdftotext -f 1 -l 1 -enc UTF-8` 抽首页文字层，取不到的写「未获取」。核对中发现
三处与文件名预期不符的事实（据实记录，不修正文件名）：

1. `工具包_*_2014__Moderated_estimation_of_fold_change_and_dispersion...`（两个文件）首页标题是
   **DESeq2**（Love/Huber/Anders），**不是 limma**。→ 本项目 line1 在用 limma 3.58.1，
   但**本目录没有 limma 原始论文**，报告里明写「无本地文献可引」，不拿 DESeq2 顶替。
2. `工具包_批次校正__2021__harmony_...pdf` 首页是 **R 包手册**（`Package 'harmony'`，
   Version 2.0.5，构建日期 June 13, 2026），不是原始论文；且本项目用的是 Python 端
   `harmonypy`。报告引用处标注了该差异，DOI 标「未获取」。
3. `工具包_空间转录组__2021__Squidpy_...pdf` 首页文字层编码损坏（输出为乱码），
   标题取自文件名与 bioRxiv DOI 行，作者标「未获取」；且容器内 squidpy 未安装、line3 用
   numpy 原生实现，故该文献不进入报告引用。

## 步骤 3 · 报告引擎接入（2026-10-19）

改 `ops/build_client_report.py`（1881 → 2206 行，**纯新增，未删改既有行**）：

- 新增 `load_manifest / load_software_versions / load_reference_citations`：按
  「环境变量（`BIO_SOFTWARE_VERSIONS` / `BIO_REFERENCE_CITATIONS`）→ 脚本同目录 → 仓库路径 → 数据根」
  找清单。环境变量一旦设置就**只认它**，不再回落（否则"设了变量却没生效"会被静默兜底）。
- 新增 `active_lines(ctx)`：判定本项目真正跑过的线。
- 新增 `version_rows(active, manifest)`：按跑过的线过滤解释器与包，另返回「已安装未使用」名单。
- 新增 `citation_rows(active, manifest, citations)`：只输出「该包在跑过的线里」且「本地确有 PDF」
  的文献；返回 `missing`（在用但无原始论文）与 `uncited`（在用但无单篇方法学论文）。
- `chapter2()` 在既有「**软件环境**」段之后**追加**三个小节：`软件与版本登记（算力容器实测）`、
  `随机种子`、`方法学引用（原始论文）`。既有 kv 表、English Methods 段落、配对/协变量说明、
  章节顺序与字段名一律未动；`STEP_CATALOG` 一行未改。
- `--self-test` 增 14 条断言（含纯函数用例与降级用例），总断言 18 → 32。

自测中抓到并修掉两个自己的 bug（都留了回归断言）：

1. `active_lines` 最初用 `pipeline_dag` 的 stepId 去 `STEP_CATALOG[line]` 反查，结果
   **三条线全部命中**:`enrichment_figures` 在三线 catalog 里重名。首次实跑的报告里因此
   混进了 scanpy / harmonypy / liana 等未跑线的包。改为以任务台账 `line_id` 为主、该线产物为辅，
   并加断言「重名步骤不会把未跑的线判成 active」。
2. 降级用例最初"通过"得莫名其妙：环境变量指向不存在的文件时仍回落到了默认清单。
   改为严格只认环境变量后，降级文案才真正被测到。

## 步骤 4 · 部署与远端验证（2026-10-19）

1. 远端备份：`cp -p ops/build_client_report.py ops/_bak_20261019_s11/build_client_report.py.bak`
   （md5 `0137f8724be8fc44fc12ce7a4e8cdadb`，与备份前一致）。
2. 部署 3 个文件到 `/mnt/ssd/bio_data/ops/`，本地与远端 md5 逐一对齐：
   `build_client_report.py c6e8d4b1405d487865f358058cfec185`、
   `software_versions.json f4fca46ba3a2af3b59dcf8732eb34cd4`、
   `reference_citations.json 2c43f09b44ab112ec807618df303ac5d`。
3. 远端 `--self-test`：32 PASS / 0 FAIL / exit 0。
4. 远端生成报告：
   `python3 /mnt/ssd/bio_data/ops/build_client_report.py --project /mnt/ssd/bio_data/projects/PRJ_E2E_GSE277173 --no-tar`
   → exit 0，图件 35 / 结果表 54。
5. 降级复现（A4）：`mv software_versions.json software_versions.json.s11off` → 重跑 → 抓报告 →
   **立刻 `mv` 回来**（md5 前后同为 `f4fca46b…`）→ 再跑一次恢复正式报告（exit 0，
   恢复后报告里降级文案出现 0 次）。降级原文见 `cn_debug/2026-10-19_s11_report_degraded.md`。
6. 结构对比（A5）：同一份数据、同一时刻，用**备份的旧引擎**
   （`_bak_20261019_s11/*.bak --out /tmp/s11_oldeng`）与新引擎各生成一份报告做 diff →
   删除行 **1 条**（仅「生成时间」戳），新增 **52 行**（全部是 S11 三段）。七章标题与顺序、
   既有字段名逐字未变。

### 顺带查清的一处「看似回归」（不是 S11 引入）

与 02:46 生成的历史报告相比，第一/三/五章现在输出「未找到可解析的差异分析…」。
用备份旧引擎在**当前数据**上重跑，得到同样文案 → 触发因素是数据变化（`line1_bulk/results/`
在 11:29 被 WGCNA 写入 7 个表格），而 `artifact_dir()` 只要 `results/` 非空就整体返回
`results/`，而 `deg_all.tsv` 在 `processed/`。属既有缺陷，未在本切片修复（见「架构/接口变更建议」）。

## 验收对照

| 项 | 结论 | 证据 |
|---|---|---|
| A1 远端实采、每条带 source、≥10 包、含 R 与 Python | 通过 | `python cn_debug/2026-10-19_s11_verify.py` 11 条断言全过；36 包 + 2 解释器，逐条与探针原始输出对账一致 |
| A2 INDEX.md 覆盖 04 全部 PDF、字段齐全、无编造 | 通过 | 18 个 PDF 全部进索引（14 篇 + 4 重复）；缺项标「未获取」；DOI 格式校验通过 |
| A3 版本表 + seed + 引用三段，且引用对应实际用到的包 | 通过 | 报告第二章三段原文见回报；版本表含 WGCNA 1.74 / limma 3.58.1；引用 2 条（WGCNA、Bioconductor）≤ line1 在用的 19 个包 |
| A4 降级可复现 | 通过 | 移走清单 → 「⚠ 版本清单缺失，方法学引用不完整…」；移回后 md5 一致、文案消失 |
| A5 既有章节/字段未被破坏 | 通过 | 同数据同刻 diff：删 1 行（时间戳）、增 52 行；7 章标题与 kv 字段名未变 |
| A6 语法检查 + 远端 exit 0 | 通过 | `python -m py_compile` 5 个脚本全过；远端生成报告 exit 0 |

## 文件清单（本切片新增/修改）

| 路径 | 类型 | 说明 |
|---|---|---|
| `docs/software_versions.json` | 新增 | 软件版本清单（36 包 + 2 解释器 + seed），每条带 `source` 与 `lines` |
| `reference/生信分析可用参考文献/citations.json` | 新增 | 文献机读索引（15 entries + 4 duplicates） |
| `reference/生信分析可用参考文献/INDEX.md` | 新增 | 人读索引，由 `ops/gen_reference_index.py` 生成 |
| `ops/gen_reference_index.py` | 新增 | 索引生成器 + PDF 存在性/覆盖性校验（`--check`） |
| `ops/build_client_report.py` | 修改 | 新增清单加载、版本表、引用表、seed 一致性、降级文案；`--self-test` 18 → 32 断言 |
| `ops/README.md` | 修改 | 补 `gen_reference_index.py` 条目与两份清单的部署说明 |
| `cn_debug/2026-10-19_s11_collect_versions.py` | 新增 | 远端版本探针（只读） |
| `cn_debug/2026-10-19_s11_versions_raw.json` | 新增 | 探针原始输出（对账证据） |
| `cn_debug/2026-10-19_s11_build_versions.py` | 新增 | 探针输出 → `docs/software_versions.json` 编译器 |
| `cn_debug/2026-10-19_s11_verify.py` | 新增 | A1/A2 验收自检 |
| `cn_debug/2026-10-19_s11_pdf_meta.py` | 新增 | PDF 首页元数据探针（pdftotext） |
| `cn_debug/2026-10-19_probe_pdf_tools.py` | 新增 | 本机 PDF 工具可用性探测 |
| `cn_debug/2026-10-19_s11_report_before.md` | 新增 | 部署前远端报告快照（对比基线） |
| `cn_debug/2026-10-19_s11_report_after.md` | 新增 | 部署后远端报告快照 |
| `cn_debug/2026-10-19_s11_report_oldengine_samedata.md` | 新增 | 旧引擎同数据报告（归因证据） |
| `cn_debug/2026-10-19_s11_report_degraded.md` | 新增 | 清单缺失时的降级报告快照 |

未触碰：`src/` 全部脚本、`STEP_CATALOG`、模板四件套、`portal/`、`BioanalysDesktop/server/figures.js`、
`test_use_data/`、远端 `bin/<line>/` 与项目 `raw_data/`、`reference/` 下任何 PDF。
远端改动仅：`ops/` 下 3 个文件 + `ops/_bak_20261019_s11/` 备份目录 + `/tmp` 临时文件。
