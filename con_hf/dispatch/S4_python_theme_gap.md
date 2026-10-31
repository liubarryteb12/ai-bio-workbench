# Python 出图"模板已覆盖 / helper 已覆盖 / 真缺口"对照表

> 制定：2026-10-19（主 Agent）。用途：回答"Python 侧还要不要建主题层"，
> 避免重蹈 R 侧返工（踩坑 #192：设计前没读现有挂载点已实现什么）。
> 结论先行：**只剩 2 个真缺口（字体族、线宽/点大小），各一行 rcParams 就能补，
> 不需要单独的主题模块体系。**

## 三层现状（读码得出，非推测）

| 规则 | rcParams 基线<br>（17 脚本各自内嵌） | 模板层<br>`sitecustomize.py`+`layout_helper.py` | layout guard<br>（17 脚本各自内嵌） | 机器判据 |
|---|---|---|---|---|
| DPI 300 | ✓ `figure.dpi`/`savefig.dpi` | ✓ `fig.set_dpi(spec["dpi"])` | : | C3 / A2 |
| 画幅比例（16:9 等） | : | ✓ `figsize_for` + `max(脚本,模板)` | : | A3 |
| 字号 ≥8pt | ✓ font.size 9 / titlesize 10 | ✓ footnote 8pt / badge 9pt | ✓ | C4 |
| 脚注一条一行、轴框外 | : | ✓ `_draw_footnote`（灰底栏） | ✓ `caption()` | B3 / C1 |
| 图例外置 | : | ✓ `_place_legend`（含自动补建） | ✓ `legend_out`（兜底） | B2 / C1 |
| spines（去上右 / 四边框） | : | ✓ `_apply_axis_style`（classic_L / boxed） | : | B2 |
| 网格 | ✓ `axes.grid=False` | : | : | : |
| tick 旋转 | : | ✓ `_rotate_xticks`（auto_45） | : | : |
| 标题位置 | : | ✓ `_move_title`（搬 fig 层） | : | : |
| 长标签折行 | : | : | ✓ `wrap_label` | A |
| 轴内文本收边 | : | : | ✓ `fit_text_edges` | A |
| 保存后统一收口 | : | : | ✓ `layout_fix`+savefig guard | A-D |
| **字体族** | ✗ 未设 | ✗ 未设 | ✗ | **缺口** |
| **线宽 / 点大小** | ✗ 未设 | ✗ 未设 | ✗ | **缺口** |

## 两个真缺口

1. **字体族**：三层都没设 `font.family` / `font.sans-serif`。matplotlib 默认 DejaVu Sans，
   但没锁首选序列:容器里换字体或缺字体时会静默 fallback 到不同字形，
   同一张图在不同机器上渲染不完全一致（SCI 期刊对字体一致性有要求）。
   → 补 `font.family: sans-serif` + `font.sans-serif: [DejaVu Sans, Liberation Sans, Arial]`。
2. **线宽 / 点大小**：`lines.linewidth`、`lines.markersize`、`patch.linewidth` 全是 matplotlib 默认
   （1.5pt / 6 / 1.0），SCI 常见口径是线 0.6-1.0pt、点 2-4pt、误差棒帽 3pt，
   默认值偏粗，密集散点会糊成一团。
   → 补 `lines.linewidth: 0.8`、`lines.markersize: 4`、`errorbar.capsize: 3`。

## 实施（S4d，flag 门控、默认关、零脚本改动）: **已评估，结论：不启用**

- 新增 `ops/fig_theme.py`：只含上述 rcParams 片段 + 一个 `apply_fig_theme()`；
- `ops/layout_autoload/sitecustomize.py` 在既有挂载链路里追加：`BIOANALYS_PY_THEME=1` 时
  启动时合并进 `matplotlib.rcParams`（与模板同一处、同一套纪律：只 warning 不中断、幂等、可关）；

**2026-10-19 实测结论（踩坑 #193）**：rcParams 主题在真实图件上**零效果**:
`l1_09`/`l1_01`/`l1_06` 三张开/关主题 md5 逐字节相同。根因：脚本在绘图调用点显式传
`lw=`（三线 38 处）与散点 `s=`（19 处），显式参数优先级高于 rcParams；
用 seaborn 的脚本还会被 `sns.set()` 重置（实测 0.8 → 1.5）。
要真生效需逐脚本改 57 个调用点 + 全量重渲染 + 重新审计，成本远超收益。

**处置**：`BIOANALYS_PY_THEME` 保持默认关闭；`ops/fig_theme.py` 与挂载段保留为底座
（零副作用），后续若要做，正确做法是逐脚本改调用点，不是 rcParams。

## 明确不做

- 不把 17 份内嵌 helper 收敛成单一 import：脚本按"独立部署、不能引共享模块"的约束设计，
  收敛要改部署链路，收益仅是去重，风险大于收益（列为后续可选，不在本轮）。
