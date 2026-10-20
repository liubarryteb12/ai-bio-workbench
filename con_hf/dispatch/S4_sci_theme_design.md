# Step 3 设计：SCI 主题层（layout / 要素 / 美化基座）

> 制定：2026-10-19（主 Agent 设计稿）。**本文件只定设计与验收，实施另派子 Agent。**
> 目标：把"每脚本内嵌一份 helper、改一处要同步 17 份"的现状，收敛成
> **一个主题源 + 自动挂载 + 机器可验证**，且不改变任何统计口径。

## 1. 现状与痛点（实测）

| 层 | 现状 | 痛点 |
|---|---|---|
| Python | 17 个出图脚本各自内嵌同一份 helper（`caption`/`wrap_label`/`fit_text_edges`/`legend_out`/`layout_fix`/`_install_layout_guard`）+ 各自 rcParams | 同一份代码复制 17 份，改一处必须同步 17 处；漏改就漂移（历史已发生） |
| Python 模板 | `ops/layout_autoload/sitecustomize.py` 在 `BIOANALYS_PROJECT_JSON` 存在时包 `Figure.savefig`，套"成品风格"（画幅比例/图例方位/脚注栏/角标） | 已有，但只管模板，不管字体/边框/网格等基础主题 |
| R（ggplot） | `ops/layout_autoload/Rprofile` 包 `ggsave` 套模板 | 只有模板，没有 ggplot 主题（字体/spines/网格/图例样式） |
| R（base graphics） | 6 张图（`pca_matrix`/`deg_limma`/`wgcna_modules`）走 `png()` 设备 | **完全没有任何主题**，规范里"已知限制" |

## 2. 设计原则

1. **零脚本改动生效**：主题必须由 `layout_autoload` 自动挂载，不能要求 17 个脚本改代码
   （母版只读边界 + 漏改即漂移的历史教训）。
2. **模板只能放大不能缩小**：沿用 `max(脚本尺寸, 模板尺寸)`，禁止模板压扁脚本 figsize
   （2026-10-19 踩坑 FE-013 的根因）。
3. **失败不中断出图**：主题是增强项；任何异常只 warning 到 stderr（沿用 Rprofile/sitecustomize 现有约定）。
4. **幂等 + 可关闭**：重复挂载只包一层；`BIOANALYS_LAYOUT_DISABLE=1` 完全退出。
5. **可机器验证**：每条主题规则都要有一个探针能证明它生效/失效（含负对照）。

## 3. 交付物

### 3.1 R 侧：`ops/fig_theme.R`（部署到 `/mnt/ssd/bio_data/ops/fig_theme.R`）

```r
# 主题源：Rprofile 启动时 source，给 ggplot 与 base R 两套入口
bioanalys_gg_theme <- function() ggplot2::theme_bw(base_size = 9) + ggplot2::theme(
  plot.title = ggplot2::element_text(size = 10, hjust = 0),
  axis.title = ggplot2::element_text(size = 9),
  axis.text  = ggplot2::element_text(size = 8),      # 8pt 下限，破例即违规
  legend.text = ggplot2::element_text(size = 8),
  panel.grid.major = ggplot2::element_blank(),
  panel.grid.minor = ggplot2::element_blank(),
  panel.border = ggplot2::element_rect(colour = "grey20", fill = NA),
  axis.line = ggplot2::element_line(colour = "grey20"),
  legend.key = ggplot2::element_blank()
)
bioanalys_par <- function(...) {   # base R：png() 设备图的统一 par
  par(cex.axis = 0.9, cex.lab = 1.0, cex.main = 1.1, ...)   # cex 下限 0.7 ≈ 8pt
}
```

挂载方式（改 `ops/layout_autoload/Rprofile`，不动脚本）：
- 已有 `ggsave` 包装保留；
- 新增包装 `print.ggplot` / `plot.ggplot`：绘图前把 `bioanalys_gg_theme()` 加进对象
  （`obj + theme`，不覆盖脚本已显式设过的 theme——用 `theme_get()` 合并，
  脚本显式设置优先，主题只兜底）；
- `bioanalys_par()` 由 base R 出图脚本显式调用（仅 3 个脚本，改的是本地 src/ 母版，
  属我们的源码，不算破母版只读边界）。

### 3.2 Python 侧：`ops/fig_theme.py` + sitecustomize 挂载

- 把 17 份内嵌 helper 的**权威实现**放到 `ops/fig_theme.py`（函数与现有内嵌版逐字一致，
  先复制后收敛，避免一次性大改）；
- `sitecustomize.py` 在挂模板的同一处，先把 `fig_theme` 的 rcParams 基线合并进
  `matplotlib.rcParams`（`figure.dpi/savefig.dpi=300`、`font.size=9`、`axes.titlesize=10`、
  `axes.grid=False`、`savefig.bbox=tight`、`image.cmap=viridis`），再包 savefig；
- 脚本内嵌副本暂时保留（幂等，重复装一层由 `_layout_guard` 标记防重），
  下一轮再逐脚本删除内嵌副本并回归。

### 3.3 主题规则清单（机器可判）

| ID | 规则 | 探针 |
|---|---|---|
| T1 | 落盘 DPI==300 | `figure_audit_scan.py` A2（已有） |
| T2 | 图内最小字号 ≥8pt | `figure_code_audit.py` C4/C8/C9（已有） |
| T3 | 图例外置、图注轴框外、标注不出框、不重叠 | `audit_figure_layout.py` A–E（仅 Python） |
| T4 | 模板只放大不缩小 | 探针：给定 figsize=(6,5) 的图，主题后画布尺寸不得小于 (6,5)*300 |
| T5 | R base 图 par 生效 | 探针：渲染后读 PNG 尺寸/字幅，或 `par("cex")` 日志断言 |
| T6 | 主题不改变数据内容 | 同种子重跑前后**表格 md5 不变**，图件 md5 允许变（样式变） |

## 4. 实施切片（派子 Agent）

| 切片 | 内容 | 验收 |
|---|---|---|
| S4a | 新增 `ops/fig_theme.R` + `ops/fig_theme.py`（权威 helper），并改两个 autoload 挂载 | 负对照：把主题规则改坏（如 `base_size=6`），探针必须报 FAIL；正对照：no issue |
| S4b | 3 个 base R 脚本（pca_matrix/deg_limma/wgcna_modules）调 `bioanalys_par()` | 同种子重跑，**表格 md5 不变**；图件重渲染后走 `figure_audit_scan` 33/33 |
| S4c | 全量 line1 重渲染 + 三件套复跑 + 打分 | code_audit no issue；scan fail=0；score 的 FAIL=0（R 图 B 项仍 UNVERIFIED，符合计划） |

## 5. 风险与回退

- **图件 md5 必然变化**（样式变）——这是预期，不是回归；回归判据是 T6（表格不变）+ 机器审计不红。
- R `print.ggplot` 包装若与脚本内 `theme()` 冲突，可能改变图幅 → 用"只兜底不覆盖"合并策略，
  并在 S4a 用 3 个脚本的 before/after 图件对比逐张核。
- 回退：`BIOANALYS_LAYOUT_DISABLE=1` 可整层关闭；`ops/fig_theme.*` 可直接删（脚本不依赖它）。

## 6. 待确认

1. 主题选 `theme_bw` 兜底会不会与现有 SCI 模板的留白/边框重复（需 S4a 出对比图定版）。
2. base R 三图是否值得为它们单独引入 theme（还是只统一 par 与字号）。
