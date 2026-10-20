# 出图错误台账（Figure Error Ledger）

> 用途：记录出图相关的**代码逻辑错误、规范执行错误、参数配置错误、图表生成错误**，
> 形成可追溯的知识库，防止同类问题再次出现。
> **新增图件或修改出图代码前必须先查本表。**
>
> 字段说明：错误类型 / 错误位置 / 问题描述 / 修正方案 / 预防措施。
> 状态：`已修复`（代码已改且有验证）/ `待修` / `仅记录`（不构成代码缺陷的设计说明）。

| ID | 日期 | 错误类型 | 错误位置（文件:行） | 问题描述 | 修正方案 | 预防措施 | 状态 |
|---|---|---|---|---|---|---|---|
| FE-001 | 2026-10-19 | 代码逻辑错误 | `src/line1_bulk/scripts/wgcna_modules:89` | 模块-性状相关硬编码 `trait_group <- gm[..., "group"] == "LS"`，把分组语义写死在代码里；换项目（组名不同）时会静默算错方向，`0/1` 编码与 case/ctrl 脱钩，且"LS vs NLS"被当成单一 0/1 列而不是组间比对 | 改为读 `BIOANALYS_PROJECT_JSON` 的 `grouping_design.contrasts`，取主对比对定 case/ctrl；性状矩阵按分组展开（主对比对一列 `case=1/ctrl=0` + 各组指示列）；无契约时按字典序派生并在报告注明；图注写 `contrast <case> vs <ctrl>` 与 trait 来源 | 1) 出图/统计代码禁止出现具体组名字面量；2) `docs/figure_spec.md` §八 立为硬契约；3) 报告必须打印 `primary_contrast=` 与 `trait_source=` 供核对 | 已修复 |
| FE-002 | 2026-10-19 | 规范执行错误 | `src/line1_bulk/scripts/bulk_figures:369,396` | 火山图与 MA 图图例写在轴内 `loc="upper right"`，规范 v2.2 §三之二 明确禁止轴内 loc（大类别数/主图占满时压数据） | 改为 `loc="upper center", bbox_to_anchor=(0.5,-0.10), ncol=1, frameon=False`（轴框下方单列） | 源码级静态扫描 `cn_debug/figure_code_audit.py` 的 C1 项在每次改码后必跑；新增图件同样适用 | 已修复 |
| FE-003 | 2026-10-19 | 规范执行错误 | `src/line1_bulk/scripts/enrichment_figures:320` | WGCNA 模块 ORA 图的 module 图例写在轴内 `loc="lower right", framealpha=0.9` | 改为轴框下方多列（`ncol=min(len(uniq),4)`）+ `frameon=False` | 同 FE-002 | 已修复 |
| FE-004 | 2026-10-19 | 规范执行错误 | `src/line1_bulk/scripts/ml_hub_analysis:594,701` | RFE 曲线与重要性分组条形图图例写在轴内 `loc="lower right"` | 改为轴框下方（RFE 单列；重要性两列）+ `frameon=False` | 同 FE-002 | 已修复 |
| FE-005 | 2026-10-19 | 规范执行错误 | `src/line2_scrna/scripts/enrichment_figures:280`<br>`src/line3_spatial/scripts/enrichment_figures:283` | line2 / line3 富集 ORA 图的 celltype / domain 图例写在轴内 `loc="lower right"` | 改为轴框下方多列 + `frameon=False` | 同 FE-002 | 已修复 |
| FE-006 | 2026-10-19 | 规范执行错误 | `src/line2_scrna/scripts/scrna_figures:444` | line2 DEG 火山图图例写在轴内 `loc="upper right"` | 改为轴框下方单列 | 同 FE-002 | 已修复 |
| FE-007 | 2026-10-19 | 规范执行错误 | `src/line2_scrna/scripts/dr_post_analysis:385` | DR 调控网络图例写在轴内 `loc="upper right", framealpha=0.9`（网络节点稀疏时也压边） | 改为轴框下方两列 + `frameon=False` | 同 FE-002 | 已修复 |
| FE-008 | 2026-10-19 | 参数配置错误 | `src/line1_bulk/scripts/cox_analysis:204,212,213,214` | 森林图 `cex.axis=0.7`、文本 `cex=0.65`、基因名 `cex=0.7`，均低于 8pt 下限（R 默认 base 12pt，0.65×12=7.8pt） | 统一提到 `cex=0.75`（9pt）、标题 `0.85` | 审查器 C4 项把 R 的 `cex=` 纳入字号检查（阈值 0.7）；新增 R 图件先自查 cex | 已修复 |
| FE-009 | 2026-10-19 | 图表生成错误 | `src/line1_bulk/scripts/{pca_matrix,deg_limma,wgcna_modules}` | 三个步骤用 `ggsave(.pdf)` / `pdf()` 把图写进 `processed/`，工作台图廊只扫 `figures/`，生成即"看不见"；且 PDF 违反"PNG 300dpi 为交付图件" | 改为 `figures/` 下的 300 DPI PNG：`l1_02_pca_step3` / `l1_03_volcano_limma` / `l1_28_wgcna_softpower` / `l1_29_wgcna_module_trait` | 1) `figure_spec.md` §一 明确"PDF 仅作可选副本"；2) 审查器 C6 项扫描 `savefig/ggsave/pdf(` 的 PDF/SVG 输出；3) 产物自校验清单含图件路径 | 已修复 |
| FE-010 | 2026-10-19 | 工具自身缺陷 | `cn_debug/figure_code_audit.py`（首版） | ① `main` 把 `--root` 当单文件读，目录遍历失效，报"no issue found"（假阴性）；② C4 把 ggplot `geom_point(size=1.2)`、gseapy `min_size=500` 误报为字号（假阳性 15 处） | 拆出 `audit_tree()` 做目录遍历；C4 收紧为只匹配 matplotlib `fontsize=` 与 R `cex=` | 审查工具上线前必须用**已知违规样例**做正负对照（本例正对照：bulk_figures:369） | 已修复 |
| FE-011 | 2026-10-19 | 工具自身缺陷 | `cn_debug/figure_score.py`（首版） | C2 命名正则只认 `_<两位数字>_`，把合规的 `l1_05a_genes_detected.png`（含 a/b 分号）判 FAIL，一票否决导致假 FAIL | 正则放宽为 `[0-9]{2}[ab]?_`，并把命名规则写进 `figure_spec.md` §七 C2 与 §一 | 打分规则里的每个正则都要有"合法样例白名单"对照表 | 已修复 |
| FE-012 | 2026-10-19 | 工具自身缺陷 | `cn_debug/figure_score.py` | B 项（图内标注/图例/图注/重叠）与 D2/D3 项默认给满分，等于"未验证却记满分"，会掩盖真实问题 | 已在文档中注明 B/D2/D3 需由 `audit_figure_layout.py` 与 `figure_code_audit.py` 提供输入，默认值是"待外部输入"而非"已通过" | 打分脚本后续改为 `--audit-csv` 显式导入几何判定结果，无输入时这四项标记为 `unverified` 不计满分 | 待修 |
| FE-013 | 2026-10-19 | 版式根因 | `ops/layout_helper.py`<br>`ops/layout_autoload/sitecustomize.py`<br>`ops/layout_autoload/Rprofile` | 三端无条件用模板 16:9 尺寸覆盖脚本 figsize，把 14in 高的 50 基因热图压到 4.05in，导致 `l1_04` Y 轴基因名重叠、`l1_13/14/15/26` 顶端标注出框、`l1_23` 图例与 colorbar 相压 | 三端统一改为 `max(脚本尺寸, 模板尺寸)`：模板只能放大、不能缩小；`l1_04` 由 1234px 高恢复到 4219px | 模板只负责"风格"，不负责"压扁内容"；新增图件若内容密度高，脚本必须显式设 figsize；验收时先看像素高宽再判版式 | 已修复 |
| FE-014 | 2026-10-19 | 图表生成错误 | `src/line1_bulk/scripts/wgcna_modules:211-228` | `l1_28` 两条文字标注都放在右上方：`threshold R^2 = 0.8` 与 `chosen power = 26` 互相压字，且右侧文字超出轴框被裁；右图同款标注也出框 | 阈值标注移到左侧（`adj=c(0,-0.35)`），chosen power 改为右对齐放在竖线左侧（`adj=c(1.08,1)`），顶部 headroom 提到 0.95 | 轴内文字标注必须预留"文字宽度"：先算 xlim/ylim 再放文字，禁止 `adj` 指向框外；同图多条标注分居两侧 | 已修复 |
| FE-015 | 2026-10-19 | 图表生成错误 | `src/line1_bulk/scripts/ml_hub_analysis:l1_23` | 聚类热图的 colorbar（默认右侧）与 group 图例（`bbox_to_anchor=(1.01,1.0)`）挤在同一列，窄画布下互相压住 | 热图右缘固定 0.78，group 图例紧贴热图；colorbar 用独立 `fig.add_axes([0.90,0.38,0.018,0.28])` 固定最右；`subplots_adjust` 之后再建 cax | 一张图只有一个"右侧挂件列"：colorbar 与图例必须显式分列；cax 必须在 `subplots_adjust` 之后创建，否则位置被重排覆盖 | 已修复 |
| FE-016 | 2026-10-19 | 图表生成错误 | `src/line1_bulk/scripts/wgcna_modules:l1_29` | 模块-性状热图底部图注单行过长，`mtext(side=1)` 只在绘图区内排版，6in 画布扣掉左右 margin 后仅约 3.4in，图注在右缘被裁成 `case=LS vs c...` | 图注拆两行；`par(oma=c(4.5,0,0,0))` + `mtext(..., outer=TRUE)` 占满整幅 6in；`cex` 0.8→0.75 | R 图的长图注一律用 `outer=TRUE` + `oma`，不要用绘图区 `mtext`；单行字符数按"画布宽 - 左右 margin"估算 | 已修复 |

## 使用约定

1. **新增条目**：每次核查发现新的代码/规范/参数/图表错误，按上表字段补一行，ID 递增（FE-013 起）。
2. **发现即查**：动手改出图代码前先用 `ID`、文件路径、错误类型三个关键词搜本表；
   同类错误第二次出现时必须先补预防措施再改码。
3. **闭环**：标记 `已修复` 前必须留下验证证据（跑了哪条命令、结果是什么），不接受"应该好了"。
4. **与踩坑台账的分工**：`con_hf/踩坑台账.md` 记录跨领域的排查过程与认知；
   本表只存**出图域**的错误事实，字段固定、可机器读取。

FE-017【存档漂移】回搬只增不删：远端已改名/删除的图件在本地存档残留（未修，仅记录）
- 现象：远端 `figures/` 共 32 张（无 `l1_27`），本地存档 33 张，多出 14:09 回搬的旧版
  `l1_27_wgcna_mm_gs.png`（与 `l1_31_wgcna_mm_gs.png` 同图不同版，尺寸相同 md5 不同）。
- 根因：`pullLineOutputs` 与 07 都只拉不删，远端删除/改名后本地无感知。
- 影响：工作台图廊 / 交付包按本地存档出清单时，会把旧图当正本展示、计入图件总数。
- 处置建议：pull 增加"远端清单中不存在的本地文件"报告项（先报告、不自动删，避免误删），
  由人确认后走清理流程。
- 状态：未修（本轮只记录，未改动 pull 行为）
