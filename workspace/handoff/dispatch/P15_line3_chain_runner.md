# P15：line3_spatial 全链真机取证脚本（只写脚本，未执行）

日期：2026-10-21
切片：P15
写域：cn_debug/2026-10-21_m1_line3_chain.mjs（新建）、con_hf/dispatch/P15_line3_chain_runner.md（本文件）
状态：脚本已就绪并通过语法校验；**按派发单要求未执行**（未 ssh、未提交任务、未跑 npm）。等 Lead 通知后再跑。

## 0. 结论

已交付一个 17 步的 line3_spatial 真机取证 runner，逐步 POST /api/tasks/submit，完成判定靠 /api/tasks 列表消失，结果判定读远端服务端台账的 status/exit_code，失败时打印台账里的 error_log 原文。相对 line1 模板（cn_debug/2026-10-21_m1_line1_chain.mjs，15 步已跑通）改了三处取证可靠性：台账定位改成"提交前快照 + 只认新增文件"、台账文件名加严格正则二次过滤、ssh 链路失败与台账缺失分开报。每步 inputs 按 src/line3_spatial/scripts/<step> 母版真实读取的文件名逐个核实后写，不是照抄 line1 命名。

未执行的原因与影响：脚本本身零真机验证，17 步的实际耗时、内存峰值、squidpy/liana/scTenifold 是否可用、gmt 缓存是否命中，全部是代码阅读推断，不是实测。第 6 节列了预判会失败的步骤。

## 1. 改了什么

只新建两个文件，未修改任何既有文件。

### 1.1 cn_debug/2026-10-21_m1_line3_chain.mjs（新建）

20402 字节 / 480 行 / CR=0 / LF=480 / em dash=0 / node --check 通过。

结构（按出现顺序）：

| 段 | 起始行 | 作用 |
| --- | --- | --- |
| 顶部注释 | 1 | 契约来源、三处与 line1 差异及理由、用法、断点续跑开关 |
| 常量 | 32 | BASE/PROJECT/LINE/SEED/P/LOGS/START/ONLY/SKIP_PREFLIGHT/KO_GENE、超时与台账等待窗口 |
| results/warns/check/warn | 48 | 结果收集；WARN 不计入失败 |
| shellQuote | 62 | POSIX 单引号转义 |
| sshBash | 72 | 命令整体 base64 后经 ssh 传，远端 base64 -d 交 bash |
| sshTry | 82 | 不抛的 ssh：链路失败与命令非零退出都收成返回值 |
| ledgerPattern | 102 | 台账文件名严格正则 |
| listLedgers | 106 | ls -t 列台账再按正则二次过滤 |
| readLedger | 121 | 先 test -f 再 cat 再 parse，三类失败分开 |
| waitNewLedger | 135 | 等"提交后新出现"的台账（窗口 120s） |
| STEPS | 163 | 17 步：step/inputs/outputs/超时/needsKoGene/outputsDir |
| preflight | 283 | 下发前逐个 [ -e ] 查输入，缺则不下发 |
| verifyOutputs | 299 | 成功后核对主产物，缺失只 WARN |
| fetchJson / runningIds | 312 / 324 | /api/tasks 轮询 |
| attempt | 330 | 单步：预检 → 快照 → 下发 → 轮询消失 → 读台账 → 判结果 → 核产物 |
| runStep | 430 | 失败重试一次（等 20s） |
| main | 441 | 健康检查 + 远端目录检查 + 顺序执行 + 汇总 |

### 1.2 con_hf/dispatch/P15_line3_chain_runner.md（本文件）

17 步与输入清单表、判定逻辑、与 line1 模板差异、预判失败步骤、验证尾行、已知边界、建议改动、跑法。

## 2. 为什么

### 2.1 台账定位为什么不用 line1 的 start_time 比较

line1 模板（cn_debug/2026-10-21_m1_line1_chain.mjs:45-53）用 latestLedger 取最新一条台账，再与提交时刻比较：ledger.start_time >= submittedAt。两个问题：

1. 台账 start_time 由 算力节点 生成，submittedAt 由本机生成。算力节点 是算力节点/远程主机、本机是 PC，两台机器时钟可能差几十秒到几分钟（line1 跑批时就出现过台账被判旧账的假失败）。时钟往任何一侧偏，比较都不可靠。
2. 同一天重复跑同一步会累积多条台账，latestLedger 取"最新"，但"最新"是 ls -t 的 mtime 排序，与"本次提交产生"不等价。

改法：提交前 listLedgers 拍快照 beforeSet，提交后只认"文件名不在快照里"的那一条。与时钟无关，与 mtime 也无关。

### 2.2 台账文件名为什么要严格正则二次过滤

ls 的 glob 是"*_<step>_*.json"。line3 的 enrichment 与 enrichment_figures 互为前缀：glob *PRJ_E2E_SPATIAL*_enrichment_*.json 会同时命中 2026-10-21_PRJ_E2E_SPATIAL_line3_spatial_enrichment_figures_ab12cd34.json。只按 glob 取最新一条，可能把 enrichment_figures 的账当成 enrichment 的账，判出假的 status。

改法：ledgerPattern(step) = /_line3_spatial_<step>_[^_/]*\.json$/。锚定服务端命名规则（server/run.js:151-161：YYYY-MM-DD_<project>_<line>_<step>_<taskId 前 8 位>.json），taskId 段不含下划线，所以 [^_/]* 恰好吃掉前 8 位，enrichment 不会误命中 enrichment_figures。

### 2.3 ssh 失败为什么要与台账缺失分开

ssh 不通（exit 255 / 连接超时）说明链路或 BatchMode 密钥有问题，需要查链路；台账没落盘说明任务跑了但服务端没写账（或还没写完），需要等或查 run_throttled_task.sh。两者处置完全不同，合并成"未找到台账"会误导排查方向。

改法：sshTry 把两类失败收成不同返回值；readLedger 再细分 kind = ssh / missing / parse（先 test -f 确认存在，再 cat，再 JSON.parse，任一步失败带上具体 kind 与原文片段）。

### 2.4 为什么读服务端台账而不是包装器台账

远端有两套账：

- 包装器 ops/run_throttled_task.sh:34-35 写 /mnt/ssd/bio_data/system_logs/<TASK_ID>_ledger.json，文件名不含项目与步骤，且 run_throttled_task.sh:82-98 写出的 JSON 没有 exit_code 字段，error_log 只是日志文件路径。
- 服务端 server/run.js:151-161 写 YYYY-MM-DD_<project>_<line>_<step>_<taskId前8位>.json，字段见 server/task.js:385-413，含 exit_code；error_log 是剥掉 ssh 噪声后的 stderr 尾部（server/run.js:83，最多 2000 字符）。

取证要 status + exit_code + 真实报错文本，只有第二套满足，所以 glob 里带项目名，天然排掉包装器账。

### 2.5 为什么每步要 preflight

缺输入的下发必然 failed（母版第一步就 exit 1 或 exit 2），白占一次远端执行与一轮排队。算力节点 内存只有 7.5GB 且 line2 重链在跑，浪费一次执行机会代价高。preflight 逐文件 [ -e ]，任一缺失直接判该步失败且不下发，报文里列出缺哪些文件。

### 2.6 为什么 spatial_knockout 要带 targetKoGene

服务端 server/index.js:1512-1532：requiresKoGene(step) 为真而 targetKoGene 缺失时返回 400「虚拟敲除必须指定 target_ko_gene」。server/task.js:37 的 KNOCKOUT_STEPS = ['virtual_knockout','spatial_knockout'] 包含本步，所以不带该字段提交直接 400。脚本用 KO_GENE 默认 'Spp1'，与母版 src/line3_spatial/scripts/spatial_knockout:113 的硬编码兜底一致（母版尚未读 BIO_KO_GENE，见第 7 节）。

## 3. 17 步与输入清单

步骤顺序取自 BioanalysDesktop/server/project.js:246-252 的 LINE_STEPS.line3_spatial，与脚本 STEPS 数组逐项对齐（脚本 STEPS 第 163-280 行）。

记号：P = /mnt/ssd/bio_data/projects/PRJ_E2E_SPATIAL/line3_spatial；processed 与 figures 相对 P。

| # | step | 下发 inputs（母版真实读取） | 预期主产物 | 超时 |
| --- | --- | --- | --- | --- |
| 1 | ingest_spatial | raw_data/GSE192741_RAW.tar、raw_data/GPL24247_family.soft.gz、raw_data/GPL24676_family.soft.gz、raw_data/grouping.txt | processed/spatial_counts_mouse.h5ad、spatial_counts_human.h5ad、samples_meta.tsv、ingest_report.txt | 90 分 |
| 2 | qc_spots | processed/spatial_counts_mouse.h5ad、spatial_counts_human.h5ad | processed/spatial_qc_mouse.h5ad、spatial_qc_human.h5ad、spot_qc_metrics.tsv、qc_report.txt | 45 分 |
| 3 | normalize_hvg | processed/spatial_qc_mouse.h5ad、spatial_qc_human.h5ad | processed/spatial_norm_mouse.h5ad、spatial_norm_human.h5ad、hvg_genes_mouse.tsv、hvg_genes_human.tsv | 45 分 |
| 4 | dim_reduce | processed/spatial_norm_mouse.h5ad、spatial_norm_human.h5ad | processed/spatial_dimred_mouse.h5ad、spatial_dimred_human.h5ad、dimred_report.txt | 45 分 |
| 5 | spatial_domains | processed/spatial_dimred_mouse.h5ad、spatial_dimred_human.h5ad | processed/spatial_domains_mouse.h5ad、spatial_domains_human.h5ad、domains_report.txt | 45 分 |
| 6 | spatial_markers | processed/spatial_domains_mouse.h5ad、spatial_domains_human.h5ad | processed/spatial_marker_mouse.h5ad、spatial_marker_human.h5ad、domain_markers_mouse.tsv、domain_markers_human.tsv | 45 分 |
| 7 | spatial_autocorr | processed/spatial_marker_mouse.h5ad、spatial_marker_human.h5ad | processed/spatial_autocorr_mouse.h5ad、spatial_autocorr_human.h5ad、gene_autocorr_mouse.tsv、gene_autocorr_human.tsv | 45 分 |
| 8 | spatial_cooccurrence | processed/spatial_autocorr_mouse.h5ad、spatial_autocorr_human.h5ad | processed/spatial_cooccurrence_mouse.h5ad、spatial_cooccurrence_human.h5ad、domain_cooccurrence_mouse.tsv、domain_cooccurrence_human.tsv | 45 分 |
| 9 | spatial_composition | processed/spatial_cooccurrence_mouse.h5ad、spatial_cooccurrence_human.h5ad | processed/spatial_composition_mouse.h5ad、spatial_composition_human.h5ad、sample_composition_mouse.tsv、sample_composition_human.tsv | 45 分 |
| 10 | spatial_communication | processed/spatial_composition_mouse.h5ad、spatial_composition_human.h5ad | processed/spatial_communication_mouse.h5ad、spatial_communication_human.h5ad、sample_communication_mouse.tsv、sample_communication_human.tsv | 60 分 |
| 11 | celltype_annotation | processed/spatial_marker_mouse.h5ad、spatial_marker_human.h5ad、domain_markers_mouse.tsv、domain_markers_human.tsv | processed/celltype_scores_*.tsv、celltype_annotation_*.tsv、spatial_deconv_*.h5ad、deconv_report.txt | 45 分 |
| 12 | spatial_localization | processed/spatial_communication_mouse.h5ad、spatial_communication_human.h5ad | processed/spatial_localization_mouse.h5ad、spatial_localization_human.h5ad、gene_localization_mouse.tsv、gene_localization_human.tsv | 45 分 |
| 13 | spatial_knockout | processed/spatial_localization_mouse.h5ad、spatial_localization_human.h5ad | processed/spatial_knockout_mouse.h5ad、spatial_knockout_human.h5ad、ko_dr_genes_mouse.tsv、ko_dr_genes_human.tsv | 90 分 |
| 14 | dr_post_analysis | processed/spatial_knockout_mouse.h5ad、spatial_knockout_human.h5ad、ko_dr_genes_mouse.tsv、ko_dr_genes_human.tsv、domain_markers_mouse.tsv、domain_markers_human.tsv | processed/dr_enrichment_*.tsv、dr_overlap_*.tsv、dr_post_report.txt | 45 分 |
| 15 | enrichment | processed/spatial_marker_mouse.h5ad、spatial_marker_human.h5ad | processed/enrichment_ora_*.tsv、enrichment_gsea_*.tsv、enrichment_report.txt | 60 分 |
| 16 | enrichment_figures | processed/enrichment_ora_mouse.tsv、enrichment_ora_human.tsv、enrichment_gsea_mouse.tsv、enrichment_gsea_human.tsv | figures/l3_mouse_12_ora_top.png、l3_human_12_ora_top.png | 45 分 |
| 17 | spatial_figures | processed/spatial_knockout_mouse.h5ad、spatial_knockout_human.h5ad | figures/l3_*_01_domains.png、03_ko_dr.png 等 7 张 | 45 分 |

输入清单的核实依据（逐脚本 grep，行号为母版 src/line3_spatial/scripts/ 下文件）：

- ingest_spatial:66-77 按文件名四分流：*.tar / *GPL24247* / *GPL24676* / *grouping*，其余名字 exit 2。grouping.txt 可选但本链给了。
- qc_spots:53-60 只认 *.h5ad；normalize_hvg:46-52、dim_reduce:48-56、spatial_domains:51-59、spatial_markers:54-62、spatial_autocorr:59-67、spatial_cooccurrence:51-59、spatial_composition:63-71、spatial_communication:53-61、spatial_localization:51-59 都是"上一步产物成对给 mouse + human"。
- celltype_annotation:6-14 的输入不参与参数解析（按 cwd 固定文件名读），但 h5ad 与 tsv 两套都真实需要：h5ad 取 uns 里的全量 marker，tsv 只提供 top20。所以两物种各两个文件，共 4 个。
- spatial_knockout:66-85 读 spatial_localization_*；dr_post_analysis:6-13 读 spatial_knockout_*.h5ad + ko_dr_genes_*.tsv + domain_markers_*.tsv（6 个文件）。
- enrichment:5-7,124 必须读 h5ad 而不是 tsv：母版要 uns['domain_markers'] 的全量 top200，tsv 只有 top20，给 tsv 会静默少基因集。
- enrichment_figures:30-46 输入可以是目录或文件，取 dirname 当 workdir；缺 ora 或 gsea 各自跳图，不阻断。脚本给 4 个具体 tsv（工作台侧按绝对路径展开成 --input）。
- spatial_figures:31-43 读 spatial_knockout_*.h5ad，出 7 张图（01_domains / 02_target_gene / 03_ko_dr / 04_morans_top / 05_knockout_dr / 06_umap_sample / 07_domain_composition）。

引擎侧的输入处理已核实：server/task.js:269-275 把 cwd 切到 <project>/<line>/processed；task.js:320 把每个 input 展开成 --input '<abs path>'；seed 走 export BIOANALYS_SEED。

## 4. 判定逻辑

单步流程（脚本 attempt，第 330 行起）：

1. 输入预检（SKIP_PREFLIGHT=1 可跳过）：ssh 逐文件 [ -e ]，末尾 echo PREFLIGHT_DONE 兜底判断脚本跑完。任一缺失 → 该步判失败且**不下发**。
2. 台账快照：listLedgers(step) 拿当前文件名集合 beforeSet。快照失败（ssh 不通）→ 该步判失败。
3. 下发：POST /api/tasks/submit，body = {projectId, lineId, step, inputs, outputs: [], seed}，spatial_knockout 额外带 targetKoGene。非 2xx 打印服务端 error 原文（例如 409 并发、400 缺 target_ko_gene）。
4. 完成判定：每 3s 轮询 /api/tasks，直到 taskId 从列表消失。轮询本身失败（HTTP 错、连接断）连续 5 次才判死，避免工作台瞬时抖动误杀。超过该步超时 → 判失败并打出 taskId 供人工追。
5. 读台账：等"提交后新出现"的台账，窗口 120s，每 3s 一次。三类失败分开报：ssh 失败 / 文件不存在 / JSON 解析失败。
6. 结果判定：ledger.status === 'completed' 为成功。否则打印 status、exit_code、start_time→end_time，并把 error_log 原文缩进打出（最多 1200 字符，服务端台账里就是 stderr 尾部，是真实报错文本）。
7. 产物核对（仅成功步）：verifyOutputs 逐个 [ -e ] 主产物，缺失只 WARN 不计入失败（母版自己会校验产物，这里防"exit 0 但产物落别处"）。
8. 失败重试一次：等 20s 再走 1-7。算力节点 有容器重启前科，重试针对的是外部因素，不是让母版改判。
9. 任一步最终失败 → 停止下发后续步骤（后续依赖其产物），汇总打印。

整体判定：所有 check 全过且无 FAIL 时 exit 0，否则 exit 1。WARN 不影响退出码。

## 5. 与 line1 模板的差异

| 维度 | line1（cn_debug/2026-10-21_m1_line1_chain.mjs） | line3（本脚本） | 理由 |
| --- | --- | --- | --- |
| 步骤数 | 15 | 17（顺序取 project.js:246-252） | 两条线的 LINE_STEPS 不同 |
| ssh 传参 | 命令字符串直接进 argv（:29-32） | 命令整体 base64 后传（:72-79） | 本脚本命令是多行（预检/核对循环），且路径可能含中文名（如 分组情况.txt），经 Windows argv 有编码与引号风险 |
| 台账定位 | latestLedger 取 ls -t 第一条 + start_time >= submittedAt（:34-53） | 提交前快照 + 只认新增文件（:135 起） | 规避 PC 与 算力节点 时钟漂移、同日多次跑累积台账 |
| 台账文件名 | glob *_<step>_*.json，无正则 | 加 ledgerPattern 严格正则二次过滤（:102-104） | enrichment 是 enrichment_figures 的前缀，会误命中 |
| ssh 失败 | try/catch 吞掉返回 null（:40-42） | sshTry 保留 exit code 与 stderr 片段（:82-93） | 链路失败与台账缺失要分开排查 |
| 台账读取 | 直接 cat 再 parse，失败一律 null | 先 test -f，再 cat，再 parse，kind 分 ssh/missing/parse | 同上 |
| 超时 | 固定 30 分钟（:105） | 按步分档：90 / 60 / 45 分钟 | ingest 与 spatial_knockout 明显更重 |
| 台账等待 | 90s（:45） | 120s | 服务端写账在 ssh 返回之后，重步骤余量留大一点 |
| 输入预检 | 无 | 有（preflight，缺文件不下发） | 缺输入的下发必然 failed，白占远端执行 |
| 产物核对 | 无 | 有（verifyOutputs，缺失只 WARN） | 防 exit 0 但产物落别处 |
| 轮询容错 | 单次 fetch 失败即抛（:73-77） | 连续 5 次失败才判死 | 工作台偶发抖动不应中断整链 |
| 敲除基因 | 不涉及 | spatial_knockout 必带 targetKoGene（KO_GENE，默认 Spp1） | 服务端 index.js:1512-1532 对该步强制校验，缺失 400 |
| 环境变量 | START_INDEX / ONLY_STEP | 另有 SKIP_PREFLIGHT / KO_GENE / SEED / PROJECT_ID / BASE | 便于单步复跑与换项目复跑 |

相同点：都是 node ESM、都用 fetch 打 /api/tasks 与 /api/tasks/submit、都以"任务从列表消失"为完成信号、都在失败时打印 error_log 原文、都在失败后停止后续步骤。

## 6. 预判会失败的步骤与原因（未实测，按代码阅读推断）

按风险从高到低：

1. enrichment（第 15 步）与 dr_post_analysis（第 14 步）：最可能 exit 1。两处都在拿不到基因集时 fail：enrichment:159-160 与 dr_post_analysis:295 都是 fail("%s 无可用基因集" % species)。基因集来自 gseapy.get_library（Enrichr 联网下载），缓存目录是相对 processed 的 ../references/gmt_cache。算力节点 外网不稳且缓存未预热，这一步大概率空手。
2. spatial_knockout（第 13 步）：spatial_knockout:265 from scTenifold import scTenifoldKnk，包不在环境里就直接崩（ImportError）。另外它逐样本（15 个）建网，7.5GB 内存下是最重的一步，有 OOM 风险，脚本已给 90 分钟。
3. spatial_communication（第 10 步）：依赖 liana（PIPELINE_STEP_META 标注），但 grep 未命中 import liana，实际依赖可能是延迟导入或换名，需运行时确认。若 liana 缺失或版本不兼容（cellphoneDB 资源下载同样要联网）会失败。
4. spatial_autocorr（第 7 步）：PIPELINE_STEP_META 标注 Squidpy，grep 未命中 import squidpy，同样待运行时确认。
5. ingest_spatial（第 1 步）：若 raw_data 里实际文件名是 分组情况.txt（ops/05_push_testdata.ps1:58 列的是中文名，:64-66 的 RemoteNameMap 在推到远端时改名为 grouping.txt），则 preflight 会报缺 grouping.txt 而**拒下发**（这是诚实失败，不烧远端执行）。此时处置是改名或把该文件按真实名加进 inputs，但母版 ingest_spatial:66-77 只认 *grouping* 分支，传中文名会 exit 2，所以只能改名。
6. 其他步骤：spatial_markers / dim_reduce / normalize_hvg / celltype_annotation 都是 scanpy 常规路径，风险主要在内存（human 6889 spot）与 HVG 数量，不在依赖。

已知非阻断项：raw_data/grouping.txt 内容声明"共 10 个样本"与实际 15 个不符，ingest_spatial:33-34 只记 warning 不 exit，不影响判定。

## 7. 验证尾行原文

本切片禁止执行脚本（不 ssh、不提交任务、不跑 npm），因此只做了语法校验与文件体检。命令与输出原文：

    cd 'D:\00.AIagent\codespace\AI辅助生信分析流程工作台'; node --check cn_debug/2026-10-21_m1_line3_chain.mjs; "EXIT=$LASTEXITCODE"

尾行原文：

    EXIT=0

文件体检原文：

    bytes=20402 CR=0 LF=480

em dash 扫描：对脚本文件 grep U+2014（unicode 破折号），结果 0 条命中；注释里需要断句处一律用冒号，未使用破折号。

17 步顺序核对：脚本 STEPS 的 step 字段逐行列出为 ingest_spatial, qc_spots, normalize_hvg, dim_reduce, spatial_domains, spatial_markers, spatial_autocorr, spatial_cooccurrence, spatial_composition, spatial_communication, celltype_annotation, spatial_localization, spatial_knockout, dr_post_analysis, enrichment, enrichment_figures, spatial_figures，与 BioanalysDesktop/server/project.js:246-252 的 LINE_STEPS.line3_spatial 完全一致。

未跑的验证（明确留白）：任何真机步骤、任何 npm test（本切片未新增测试文件，写域不含 tests/）。

## 8. 已知边界

1. 脚本零真机验证。17 步耗时、内存峰值、squidpy / liana / scTenifold / gseapy 是否可用、gmt 缓存是否命中，全部是代码阅读推断。超时值 90 / 60 / 45 分钟是按母版工作量与 算力节点 7.5GB 内存拍的，不是实测值。
2. 台账只读服务端那套（server/run.js:151-161）。若服务端进程崩溃、或没走到落盘，waitNewLedger 会在 120s 后报"超时未见新增台账"，此时任务已从 /api/tasks 消失但无结论，需要人工上机看日志。脚本没有对这条路径做兜底（读包装器账或扫日志文件）。
3. 快照差集的前提是"同一步在同一时间窗内只有一次提交"。脚本靠两点保证：失败重试前等 20s；服务端对同项目同线同步骤并发第二次直接 409（server/index.js:1550-1555）。
4. spatial_knockout 提交层的 targetKoGene=Spp1 只是满足 400 校验。母版 src/line3_spatial/scripts/spatial_knockout:113 仍写死 KO_GENE = "Spp1" 且全文不读 BIO_KO_GENE，所以改 KO_GENE 环境变量**不会**改变母版行为，只改变提交字段与台账记录。
5. preflight 只查文件存在（[ -e ]），不查大小、可读性、格式。远端权限不足或文件是 0 字节时预检会通过，由母版报错。
6. 产物核对只核主产物：enrichment_figures 只核 2 张 ora 图（gsea 图与 13 号图未核），celltype_annotation 的 ../figures/l3_*_14/15 未核。缺失只 WARN，不判失败。
7. 若某步 status=completed 但台账缺 exit_code 字段，脚本只 WARN 不判失败（兼容两套台账字段差异）。
8. 台账不清理。同日重复跑同一步会累积多条，靠快照差集区分（文件名里 taskId 前 8 位不同，不会撞）。
9. 步骤 11 celltype_annotation 的 4 个 inputs 母版并不解析（按 cwd 固定文件名读），下发它们只为工作台侧记录依赖与预检；这是母版设计如此，不是脚本遗漏。
10. 脚本假定工作台在 BASE（默认 http://127.0.0.1:8791）上且 /api/health 可用。line1 模板默认 8787，本脚本刻意换端口，避免与正在跑 line2 的实例抢同一个进程。

## 9. 建议改动（范围外，交 Lead 落地）

1. BioanalysDesktop/server/project.js:298：PIPELINE_STEP_META.ingest_spatial 的 io 写的是 spatial_raw.h5ad，母版真实产物是 spatial_counts_mouse.h5ad / spatial_counts_human.h5ad。前端展示会指错文件，建议按母版改名。
2. src/line3_spatial/scripts/spatial_knockout:113：改成读 BIO_KO_GENE（缺省回落 "Spp1"），否则 P14 加的 targetKoGene 必填契约在 line3 只校验不生效。属后续修复切片，本切片不动母版。
3. enrichment / dr_post_analysis 的 gmt 缓存：建议把缓存目录做成环境变量（如 BIO_GMT_CACHE）并支持预下载/预置，否则 算力节点 断网时这两步必挂。当前硬编码相对 processed 的 ../references/gmt_cache。
4. ops/05_push_testdata.ps1:58,64-66：中文名到 grouping.txt 的改名映射要写进部署手册（否则 ingest 预检必失败，且传中文名会让母版 exit 2）。
5. 抽取公共 runner：line1 与 line3 两份脚本已有重复（sshTry、台账、preflight、verify、轮询），建议后续抽 cn_debug/lib/chain_runner.mjs，两条线只留步骤表。本切片按写域只交 line3 一份，未动 line1。

## 10. 等 Lead 通知后再跑

按派发单要求，本切片**未执行**脚本：没有 ssh、没有提交任何任务、没有跑 npm。原因：算力节点 只有 7.5GB 内存，line2 重链正由 upload-session 跑，两条重链不能并发。

Lead 通知可以跑之后，按下面步骤（需先确认 line2 已收尾、算力节点 内存空闲）：

    # 1) 起一个独立工作台进程，别占用 8787（可能正被别的实例用）
    cd BioanalysDesktop
    $env:BAD_PORT='8791'
    node server/index.js

    # 2) 另开一个终端，全链跑
    cd 'D:\00.AIagent\codespace\AI辅助生信分析流程工作台'
    $env:BASE='http://127.0.0.1:8791'
    node cn_debug/2026-10-21_m1_line3_chain.mjs

    # 3) 断点续跑（从第 6 步 spatial_markers 开始，0 基索引 5）
    $env:START_INDEX='5'
    node cn_debug/2026-10-21_m1_line3_chain.mjs

    # 4) 只复跑单步
    $env:ONLY_STEP='spatial_domains'
    node cn_debug/2026-10-21_m1_line3_chain.mjs

    # 5) 跳过输入预检（仅当确定远端已有输入、或 preflight 因 ssh 超时误报）
    $env:SKIP_PREFLIGHT='1'
    node cn_debug/2026-10-21_m1_line3_chain.mjs

跑之前建议先手动确认三件事：远端 /mnt/ssd/bio_data/projects/PRJ_E2E_SPATIAL/line3_spatial/raw_data/ 里的文件名（尤其 grouping.txt 是否已改名）、算力节点 上 scTenifold / liana / squidpy 是否已装（python3 -c "import scTenifold, liana, squidpy"）、以及 processed 是否确实为空（有残留旧产物会让母版读到过期输入）。

跑完后需要回填的内容：每步 status 与 exit_code、真实耗时、失败步的 error_log 原文、figures 实际出图清单，用于更新本报告第 6 节的预判（哪些猜中了、哪些没中）。
