# P10 报告：line2 虚拟敲除内存削峰（防崩套件 / 7.5GB 内存墙）

## 改动文件

| 文件 | 性质 | 规模 |
| --- | --- | --- |
| src/line2_scrna/scripts/virtual_knockout | 改 | git diff --numstat 实测 +73 / -2，最终 18596 字节、420 行 |
| BioanalysDesktop/tests/virtual_knockout_memory.test.js | 新建 | 13 条静态断言，8405 字节 |

未触碰：src/line2_scrna/scripts/gsva_pathways（别的切片已改过，本切片零写入）、其它母版、package.json、git 历史（无 commit/checkout/stash）。

## 口径对齐：派发单写的是 R，脚本实际是 Python

先把这个偏差说清楚，后面所有实现都按"脚本实际结构"落地，没有凭空造 R 代码。

- 派发单的描述（rm(res); gc(verbose = FALSE)、gc(reset = TRUE)、三种子循环 20261013/20261014/20261015）来源是 aims/aims.txt:312 与 aims261021todo.txt:179，那两处是 scTenifoldKnk R 包语境。
- 本仓库 line2 的实际实现是 bash 包装 + python3 heredoc（scTenifoldpy 0.5.1）：grep 证据 `python3 - <<'PYSCRIPT'` 在 src/line2_scrna/scripts/virtual_knockout:85；src/ 下没有任何 .R 文件，全仓 grep `gc(`、`VmHWM`、`memory_peak` 在脚本侧 0 命中。
- 脚本里没有"连续 3 次不同种子"的循环：seed 由引擎一次性注入（BIOANALYS_SEED，缺失 exit 3），一次运行产出唯一一份 DR 表与 h5ad。在脚本内造 3 轮循环会改数值口径与产物数量，属于需求裁决，本切片未擅自加（见遗留风险 3）。
- 等价映射：rm -> del；gc(verbose = FALSE) -> gc.collect()（Python 的 collect 没有 verbose 参数，回收本来就静默）；循环前 gc(reset = TRUE) -> 建网前一次 gc.collect()；"三种子循环" -> 本步骤三个重内存阶段（装配 expr / 建网 / 落盘）。

## 实现要点

1. 三个重内存阶段各一组 del + gc.collect() + record_peak 三元组（行号为改动后）：
   - :222-225 装配收尾：del pop_counts / del norm -> gc.collect() -> record_peak("assemble_expr")
   - :262-265 建网收尾：del scn / del qc_matrix -> gc.collect() -> record_peak("after_network")（scn 持 10 个 2000x2000 网络加张量，是本步骤最大的常驻块）
   - :366-371 落盘收尾：del out / del annot / del dr_out / del dr_indexed -> gc.collect() -> record_peak("write_h5ad")（annot 与 out 是同一批细胞的两份副本）
   - 附带 :299-301 del dr -> gc.collect() -> record_peak("dr_ready")
2. 建网前强制回收（等价 gc(reset = TRUE)）：:229 gc.collect() + :230 record_peak("before_network")，落在输入校验与 ko_fraction 闸之后、st.scTenifoldKnk 调用之前，中间没有 fail 分支。
3. 峰值记录：:128 PEAK_FILE = "memory_peak.tsv"；:132 peak_rss_mb() 读 /proc/self/status 的 VmHWM（KB）-> round(x/1024.0, 1) MB；:144 record_peak(stage) 以 open(PEAK_FILE, "a") 追加写，列顺序 stage/peak_rss_mb/timestamp，表头只在文件不存在或大小为 0 时补写一次；所有 OSError 只落 stderr，不调用 fail()，读不到 /proc 时该列留空。
4. 阶段覆盖 7 行：load_inputs(:171) / assemble_expr / before_network / after_network / dr_ready / write_h5ad / done(:420)。
5. 数值与随机序列不变：KO_GENE/N_NETS/N_SAMP_CELLS/N_COMP/Q_VALUE/TD_RANK/MA_DIMS/TOP_N/SIG_LEVEL/QC_MIN_PERCENT 原文保留；nc_kws 与 td_kws 仍是 random_state=seed_int；dr = scn.build()、三个产物写入、22 处 fail 自校验分支全在；没有新增 np.random / random / random.seed。
6. 一处必要的取前置（静态测试第 9 条抓出来的真问题）：报告段要用 out.uns 的两个字段，原本在 del out 之后才引用，会 NameError。改成 :362-363 先取 sctenifold_version / ko_gene_provenance 两个字符串，:366 再释放 out。

## 实测证据

- 语法：`D:\Git\bin\bash.exe -n src/line2_scrna/scripts/virtual_knockout` -> bash_n_exit=0；把 heredoc 正文抽出来 `python -c "ast.parse(...)"` -> py_ast_ok / py_exit=0。
- 新增测试：`node --test tests/virtual_knockout_memory.test.js` 尾行原文
```
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 111.1443
```
- 全量回归：`cd BioanalysDesktop && npm test` 尾行原文
```
ℹ tests 605
ℹ suites 0
ℹ pass 605
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 21043.3328
```
- 峰值记录器真跑（把脚本里的 PEAK_FILE / peak_rss_mb / record_peak 原样抽出，用本机 python 在临时目录跑，跑完已删临时目录）：
  - 单次运行输出：表头 1 行 + stage_a / stage_b 两行；Windows 没有 /proc，peak_rss_mb 列留空且不报错。
  - 同一输出目录连跑两次：文件共 5 行（1 表头 + 4 数据行），证明是追加不是覆盖。
  - 把 PEAK_FILE 指向一个目录制造写失败：stderr 打印 `memory_peak.tsv 写入失败（不影响分析）: [Errno 13] Permission denied: 'blocked.tsv'`，随后照常打印 survived_write_failure，exit 0。
- 换行与字符：脚本 bytes=18596 crlf=0 emdash=0；新测试文件同样 LF、无 em dash。
- 变更面：`git diff --numstat` -> `73  2  src/line2_scrna/scripts/virtual_knockout`；`git status --porcelain` 里 gsva_pathways 的改动来自别的切片，本切片未写入（新增测试第 13 条对同级 24 个脚本逐个断言无 record_peak / memory_peak 字样）。

## 遗留风险

1. 没有真机内存实测：本机没有分析环境、也不连 K40，VmHWM 具体数值与"峰值 < 4.5GB"是否达成，待真机跑一次回填（预期 7 行落在输出目录 memory_peak.tsv）。
2. Python 的 gc 不保证把内存立刻还给 OS：numpy/pandas 释放后常留在 malloc arena，VmHWM 又是历史最高水位，所以真机上看到的不一定是"水位下降"，而是"后续分配不再叠加"。要证明削峰，需在真机看 /proc/<pid>/status 的 VmRSS 曲线与 memory_peak.tsv 的阶段间差值。
3. "连续 3 次不同种子"未落地：脚本是单 seed 单产物，加 3 轮会改数值口径与产物数量，需 lead 裁决是否另开切片。
4. memory_peak.tsv 写到进程 cwd：引擎若把 cwd 设在输出目录则与其它产物同处；若引擎 cwd 不是输出目录，需要引擎侧确认（本切片不动引擎）。
5. 静态断言的边界：断言的是源码结构，能防"同名变量 del 后仍被引用"（第 9 条已覆盖），但防不住通过别名间接持有（例如某个容器对象里还挂着 out 的引用）。这类只能靠真机内存曲线发现。
