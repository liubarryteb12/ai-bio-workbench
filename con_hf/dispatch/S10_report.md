# S10 报告 · scrna_figures 的 S5-17（箱线标 perm_p）+ F2（标准二分类色）

> 切片：S10（`src/line2_scrna/scripts/scrna_figures` 单文件）
> 执行：子 Agent · 2026-10-19
> 依据：`con_hf/dispatch/SUBAGENT_CONTRACT.md`、`con_hf/dispatch/S5_scout_report.md` §3.2 / §5-P2-S5-17 / §7-F2、
> `con_hf/dispatch/S9_fix_color_groupname.md`（同题 line1 写法范本）、`con_hf/踩坑台账.md` #190 / #193 / #194
> 本文件**每完成一步追加一次**（派发单硬要求，防宿主中断丢报告）。

---

## 0. 任务理解

只改 `src/line2_scrna/scripts/scrna_figures` 两件事：

1. **F2 色值统一**：箱线面色（L352）与 PCA 点色（L468）的 `#4C72B0` / `#C44E52`
   → 规范二分类标准色 ctrl=`#3B4992` / case=`#EE0000`；**谁是 case/ctrl 从 `project.json`
   的 `grouping_design.contrasts` 读，读不到按 S9 的 `resolve_case_ctrl` 同款规则派生**，
   不写死组名。
2. **S5-17 箱线标 perm_p**：数据只从 `uns["composition"]["group_tests_json"]` 取（`scrna_composition`
   已算好），**不重算统计**；只对有 `perm_p` 的 celltype 画括号 + 文本，无值静默不画；
   文本数值必须与 `composition_report.txt` 的 `perm_p` 逐值一致（一次性断言）。

不碰：`src/line1_bulk/`、`src/line3_spatial/`、`ops/build_client_report.py`、模板四件套、portal、
统计口径 / 阈值 / 种子 / 图件命名 / 出图数量。

跑场：`default` 项目（`projects/default/line2_scrna/processed` 有真实历史数据）。

---

## 1. 链路自检 + 基线 md5（派发单任务项前置，#190 纪律）

链路：`adb forward tcp:8022/10022` → `ssh -o BatchMode=yes k40-ubuntu`，远端时间 `Mon Oct 19 15:12:24 UTC 2026`。

```
$ ssh k40-ubuntu 'P=/mnt/ssd/bio_data/projects/default/line2_scrna; cd $P/processed && md5sum * | sort -k2 > /tmp/s10_before_processed.md5; cd $P/figures && md5sum * | sort -k2 > /tmp/s10_before_figures.md5; wc -l ...'
  59 /tmp/s10_before_processed.md5
  37 /tmp/s10_before_figures.md5
  96 total
--- 数据表（非 h5ad）44 个；figures 里 l2_06 = 13 张
```

基线已回搬本地：`cn_debug/s10_before_processed.md5`（59 行）、`cn_debug/s10_before_figures.md5`（37 行）。

本切片会重渲染的图件基线（旧值，用于 §7 md5 对比）：

```
400ff913798d0a565d12146c10310f31  l2_06_composition_box_Langerhans_cell.png
03d10d1c80aa9855bb9b6a37387ab151  l2_06_composition_box_NK_ILC.png
16bbb71159f0e0450325c83aba1d8cd1  l2_06_composition_box_T_cell.png
31fb7f49b1589d340651a1574099dbef  l2_06_composition_box_activated_keratinocyte.png
4c76313991498333fa36265639d55c69  l2_06_composition_box_basal_keratinocyte.png
986bfd85abce822a9bb54e52626e8b58  l2_06_composition_box_channel_keratinocyte.png
82c113b6018555910ad4f867a37e7fab  l2_06_composition_box_macrophage_mDC.png
947951ddb8c15a1fe8489e4aa34bac70  l2_06_composition_box_melanocyte.png
826313b32120ba013c6ef28a65be4475  l2_06_composition_box_mitotic.png
f041331539020d48c0325af2c946bb1c  l2_06_composition_box_pDC.png
b8f732176e0e91744ef5318ee83a139d  l2_06_composition_box_progenitor_keratinocyte.png
42b958eaa253713bbc850d8fc789a7df  l2_06_composition_box_suprabasal_keratinocyte.png
c5f9bcf1fdd331304b5835cc358f422c  l2_06_composition_box_unknown.png
a61a6220b5d7c4cb967422324a7ef549  l2_09_deg_sig_bar.png
3108e666a70750311ddb29b17109fae9  l2_10_pca_diagnosis.png
```

源码基线：本地 `src/line2_scrna/scripts/scrna_figures` md5 = `acfd2157b5ffaefebc2b31380a65eb0a`，
与远端母版 `bin/line2_scrna/scrna_figures` **同值**（部署前已同步）。
原文件备份：`cn_debug/2026-10-19_before_s10_scrna_figures`（同 md5；本仓库无 git，`git status` 报 not a git repository）。

### 1.1 现场核实的两条契约事实（决定实现写法）

**(a) `default/project.json` 的 `grouping_design` 描述的不是 line2 的 diagnosis 维度**

```
$ python3 -c 'print(json.load(open("project.json"))["grouping_design"])'
groups:    g1 NLS (role=reference, color_hex=#3B4992) / g2 LS (role=disease_stage, color_hex=#EE0000)
contrasts: [{name: LS_vs_NLS, case: LS, ctrl: NLS, is_primary: true}]
```

而 line2 的观测组是 `['Healthy', 'Psoriasis']`（`obs.diagnosis` 实测）。即 contrasts 里的
`LS/NLS` 是 line1 的 region/stage 维度，**不在 line2 观测组里**。
→ 实现必须校验 `contrasts` 的 case/ctrl **确实出现在观测组**才采用；不匹配时打印一行原因后
按规则回落（`is_reference` → 两组字典序，后者为 case）。直接照抄 S9 的代码会在后续
"case/ctrl 必须在观测组"校验里 `SystemExit`，那样本切片就跑不动。

**(b) `perm_p` 的数据形态**（`scrna_deg.h5ad` 实测）

```
comp_keys = [..., 'group_tests_json', 'proportion_matrix', ...]
levels    = ['diagnosis']
diagnosis groups ['Healthy','Psoriasis'] n={'Healthy': 3, 'Psoriasis': 5}
per_celltype n=13, with_perm=13, perm_mode=exact_enum, n_perm=56
例：Langerhans_cell perm_p=0.2982456140350877 / T_cell 0.07017543859649122
```

`composition_report.txt` 用 `%.4g` 落盘（`scrna_composition:489`），故图上文本也必须用
`%.4g`，才能与报告逐值一致（例 `0.2982`、`0.03509`）。

---

## 2. 实现（任务项 1/2）

改动只在 `src/line2_scrna/scripts/scrna_figures`（487 → 669 行；其中 151 行为新增的
分组契约/取色/perm_p 函数与注释）。原文件备份 `cn_debug/2026-10-19_before_s10_scrna_figures`
（md5 `acfd2157b5ffaefebc2b31380a65eb0a`，与部署前母版同值）。

| 位置（改后行号） | 改动 | 依据 |
|---|---|---|
| `from matplotlib import colors as mcolors` | 新增 import（tab20 取色用） | §八.5 |
| `CASE_COLOR` / `CTRL_COLOR` | `#EE0000` / `#3B4992` | §三 / §八.5 |
| `load_project_json()` | 读 `BIOANALYS_PROJECT_JSON`（引擎注入） | §八.2 |
| `resolve_case_ctrl(observed)` | contrasts（**case/ctrl 必须在观测组内**，`is_primary` 优先→第一条）→ `groups[].is_reference` → 观测两组字典序（后者 case）→ 否则 `SystemExit` | 派发单任务项 1 |
| `build_group_colors()` / `color_of()` | 按实际组名建色表；缺映射即 `SystemExit`（无静默灰） | 派发单任务项 1 |
| obs 载入后（L435-457） | 解析 `diagnosis` 观测组 → `resolve_case_ctrl` → 打印 `contrast=… case=… ctrl=… source=…` 与 `group_colors=…` | A2 的 stdout 证据 |
| L486-488 组成图排序 | `0 if diag[i] == "Healthy"` → `0 if diag[i] == ctrl_group` | 去写死组名 |
| L521-548 箱线图块 | 组序 `[ctrl_group, case_group]`；面色 `[color_of(g) for g in labs]`（旧 `["#4C72B0","#C44E52"]` 删除）；新增 perm_p 括号 | S5-17 + F2 |
| `perm_p_by_celltype(comp)` | 只读 `uns["composition"]["group_tests_json"]` 的 `diagnosis` 级 `perm_p`；缺键/解析失败只 WARN 不抛错 | S5-17（**不重算统计**） |
| `annotate_perm_p(ax, 1, 2, p, data)` | 两组上方画括号 + `"perm p = %.4g"`；`clip_on=False` 防括号被裁；靠 `fit_text_edges` 兜底出框 | S5-17 |
| L634 `l2_09` 条形色 | `color="#4C72B0"` → `color=CTRL_COLOR`（单序列条形，用交付基色，非组编码） | A1（全文件 0 命中旧色） |
| L649-651 `l2_10` PCA 点色 | `[("Healthy","#4C72B0"),("Psoriasis","#C44E52")]` → `for g in [ctrl_group, case_group]: col = color_of(g)` | F2 |

**未改动**（自证边界）：`prop` 矩阵与 `var()` 排序、`ct_by_var` 顺序、13 张图件命名、
`n=%d/%d` 图注、`caption()` / `layout_fix()` / `legend_out()` / `fit_text_edges()` 版式层、
火山图阈值（`padj<0.05` / `|log2FC|>1`）、UMAP/热图/堆叠条/火山全部绘图代码、
种子读取（`BIOANALYS_SEED`）。

**有意保留的写死组名（不在本切片授权内）**：L438 `ax.set_xlabel("log2FC (Psoriasis vs Healthy)")`
属 scout §7-F3 的 line2 侧，但 DEG 方向由 `deg_groups:95-96`（`GROUP_A="Healthy"` /
`GROUP_B="Psoriasis"`，L190 `groups=[GROUP_B], reference=GROUP_A`）写死定义，本切片若只改
标签会与统计步骤的真实方向脱钩 → 不改，列入待决策（见 §11）。

---

## 3. 静态自检

```
$ python cn_debug/s10_syntax_check.py
py syntax OK heredoc_lines=614 file_lines=669
OK: 旧 ctrl 色 #4C72B0 0 命中
OK: 旧 case 色 #C44E52 0 命中
OK: 静默降级 .get(g, 'gray') 0 命中
OK: 写死组名 "Healthy" 0 命中
OK: 写死组名 "Psoriasis" 0 命中
RESULT: PASS

$ bash -n src/line2_scrna/scripts/scrna_figures
bash -n OK

$ python cn_debug/figure_code_audit.py --root src
code_audit: no issue found          （exit=0）

$ grep -nE '#4C72B0|#C44E52' src/line2_scrna/scripts/scrna_figures
（0 命中，exit=1）                   ← A1
```

（`s10_syntax_check.py` 第一次跑时把 `color_of` 文档串里的 `.get(g, "gray")` 字样也算命中，
已把该文档串改写成自然语言；判据本身未放松。）

---

## 4. 部署前预演（临时目录，不碰项目数据）

先 scp 到 `/tmp/s10smoke_iovy/`（`processed` 全为软链、`figures` 为空目录），带引擎同款 env 直跑：

```
$ BIOANALYS_SEED=20261013 BIOANALYS_PROJECT_JSON=.../default/project.json \
  PYTHONPATH=/mnt/ssd/bio_data/ops/layout_autoload bash /tmp/s10smoke_iovy/scrna_figures \
  --seed 20261013 --output ../figures --input .../scrna_deg.h5ad
[layout_autoload] project.json 无 plot_layout_config，使用默认模板
[layout_autoload] 已挂载出图模板: template_1_nature_side
loaded cells=4587 genes=2000
WARN: project.json contrasts（LS_vs_NLS）不在观测组 Healthy / Psoriasis 内（分组维度不同），改按规则派生方向
contrast=Psoriasis_vs_Healthy | case=Psoriasis | ctrl=Healthy | source=obs 字典序派生
group_colors=Healthy=#3B4992 Psoriasis=#EE0000
loaded deg_all rows=14000
...
perm_p celltypes=13（有值才画括号）
...
figures_done count=28 out=../figures elapsed=11.0s
```

→ 28 张、exit 0；方向/配色有 stdout 证据（A2），派生来源写明是"contrasts 维度不符 → 字典序"。

预演期几何审计（同一份脚本副本）：

```
$ python3 ops/audit_figure_layout.py --script /tmp/s10smoke_iovy/scrna_figures \
    --cwd projects/default/line2_scrna/processed --runner bash --seed 20261013
PASS l2_06_composition_box_*  ×13
audit: figs=28 fail=0 write=False
```

### 4.1 perm_p 行为探针（`cn_debug/s10_perm_p_probe.py`，三段全真跑）

```
--- 1) uns vs report: PASS   （13/13 逐值相同，例 basal_keratinocyte 0.03509 / T_cell 0.07018 / mitotic 0.8596）
--- 2) 图上文本 vs 报告: PASS （13/13 张，每张恰好 1 条 "perm p = <report 值>"）
OK   l2_06_composition_box_basal_keratinocyte.png   expect 'perm p = 0.03509', got ['perm p = 0.03509']
OK   l2_06_composition_box_T_cell.png               expect 'perm p = 0.07018', got ['perm p = 0.07018']
...
--- 3) 负对照（Langerhans_cell 无 perm_p）：PASS（28 张核对）
OK   neg l2_06_composition_box_Langerhans_cell.png  expect=None got=[]
perm_p celltypes=12（有值才画括号）      ← 负对照那轮的 stdout，脚本仍 exit 0
PROBE: PASS
```

负对照做法：复制一份 h5ad 到临时目录、只把 `Langerhans_cell.perm_p` 改成 `None`，
断言该图 0 条括号文本、其余 12 张不变、脚本不报错（A3 的"无值静默不画"）。

---
