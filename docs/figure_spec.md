# 单图出图规范

> 版本：v3.1，2026-10-29
> 规范正本：`reference/03出图规范/sci.md`
> 参考代码：`reference/05.可参考出图代码/图码对应库_交付包`
> 适用范围：工作台当前可派发的 15 个单图模板，以及三条线新增的独立单图脚本

## 一、单图边界

每张图只允许一个图表主体。脚本不拼接子图，不添加面板标签，不在图内写主标题、
副标题或方法图注。图注、样本量、统计方法、阈值和随机种子写入同步骤的
`*_report.txt` 与项目报告。

旧的 `fig_l3_multipanel` 已退役，注册表中标记为 `pending` 且 `deprecated=true`。
历史拼图代码只作为参考资料，不进入当前派发链路。

## 二、物理画布

宽度档位固定如下，高度由参考图或模板声明，最大高度 220 mm：

| 档位 | 宽度 | 典型高度 | 用途 |
|---|---:|---:|---|
| `small` | 58 mm | 50 至 60 mm | 小图、ROC、DCA、单基因图 |
| `single` | 88 mm | 60 至 88 mm | 常规单栏图 |
| `medium` | 130 mm | 85 至 110 mm | 中栏图、Sankey、长标签图 |
| `wide` | 180 mm | 90 至 220 mm | 热图、宽 UMAP、长名 DotPlot |

Nature 等出版社的 89 mm 和 183 mm 只作为等价宽度记录，模板自身仍以
`58 / 88 / 130 / 180 mm` 为主契约。

固定画布规则：

- Python 使用 `fig.set_size_inches(width_mm / 25.4, height_mm / 25.4)`。
- R 使用 `ggsave(width=..., height=..., units="mm")` 或
  `cairo_pdf(width=width_mm / 25.4, height=height_mm / 25.4)`。
- 落盘时 Python 使用 `bbox_inches=None`，R 不使用自动裁切。
- 适配脚本同时设置 `BIOANALYS_LAYOUT_PRESERVE_FIGSIZE=1` 和
  `BIOANALYS_LAYOUT_FIXED_CANVAS=1`。

## 三、字体、线宽与坐标轴

| 项目 | 契约 |
|---|---|
| 字体 | Arial 或 Helvetica，缺失时回退 DejaVu Sans |
| 轴标题 | 7 pt |
| 轴刻度 | 6.5 pt，绝对下限 5 pt |
| 图例标题 | 7 pt |
| 图例条目 | 6.5 pt，绝对下限 5 pt |
| 坐标轴线与刻度线 | 0.5 pt |
| 主数据线 | 0.75 至 1.0 pt |
| 辅助线、阈值线、误差棒 | 0.35 至 0.5 pt |
| 最细线 | 不低于 0.25 pt |

坐标轴采用经典单图主题，仅保留左、下轴线，热图和降维图按图型需要保留必要边框。
默认无网格。轴刻度标签保持水平，不旋转 45 度。长类别名使用换行、缩短标签或横向
条形图处理。

图例只解释数据映射，不重复轴标题。图例去边框，可放在单图内部空白处、
右侧或顶部。连续变量使用
viridis、cividis、magma 或 inferno；双向 Z-score 使用 `RdBu_r` 并保证 0 值为白色。
禁止红绿直接对比和 rainbow、jet 色阶。

## 四、交付三件套

每个模板必须同时生成：

1. `.pdf` 矢量母版，真实嵌入 TrueType / Type 42 字体。Type 0 字体必须追到
   `DescendantFonts / CIDFontType2 / FontFile2`；Type 3 字体直接判失败。
   PDF `/Title` 元数据只记录文档元数据，与图内标题分开判定。
2. `_preview.png` 或模板声明的 PNG，300 dpi。
3. `_plot.rds` 或 `_plot.pkl` 可编辑对象。

单文件控制在 10 MB 以内。单细胞点数超过 5,000 时，点层使用 600 dpi 光栅化，
坐标轴和文字仍保持矢量。

## 五、当前 15 个 ready 模板

注册表：`src/figure_templates.json`

来源清单：`src/figure_sources/manifest.json`

适配器：`BioanalysDesktop/server/figure_adapters.js`

| 模板 | 语言 | 画布 | canonical output |
|---|---|---:|---|
| `fig_l1_boxplot` | R | 88 x 60 mm | `L1_boxplot_verified.png` |
| `fig_l1_density` | R | 88 x 60 mm | `L1_density_verified.png` |
| `fig_l1_groupedbar` | R | 88 x 60 mm | `L1_groupedbar_verified.png` |
| `fig_l1_histogram` | R | 88 x 60 mm | `L1_histogram_verified.png` |
| `fig_l1_scatter` | R | 88 x 75 mm | `L1_scatter_verified.png` |
| `fig_l1_violin` | R | 88 x 60 mm | `L1_violin_verified.png` |
| `fig_l2_heatmap` | R | 180 x 120 mm | `L2_heatmap_verified.png` |
| `fig_l2_pca` | R | 88 x 80 mm | `L2_pca_verified.png` |
| `fig_l2_umap` | Python | 180 x 90 mm | `umap_L2_umap_verified.png` |
| `fig_l2_volcano` | R | 88 x 80 mm | `L2_volcano_verified.png` |
| `fig_l2p_dotplot` | Python | 88 x 60 mm | `figures/dotplot__L2p_dotplot_verified.png` |
| `fig_l2p_umap` | Python | 88 x 80 mm | `umap_L2p_umap_verified.png` |
| `fig_l2p_violin` | Python | 180 x 85 mm | `figures/violin_L2p_violin_verified.png` |
| `fig_l2p_volcano` | Python | 88 x 80 mm | `L2p_volcano_verified.png` |
| `fig_l3_sankey` | R | 130 x 100 mm | `L3_sankey_verified.png` |

每个 ready 模板必须满足：

- `source` 与 `preview` 位于 `src/figure_sources` 和 `src/figure_previews`。
- `source_sha256`、`preview_sha256` 与磁盘字节一致。
- `catalog_id`、`catalog_page_url`、`catalog_language` 和 `source_match` 可追溯。
- `canonical_output` 在 ready 集合内唯一。
- 适配脚本保留母版字节，并在母版之前结束真实数据渲染分支。

## 六、代码落点

| 责任 | 代码 |
|---|---|
| 模板注册与尺寸契约 | `src/figure_templates.json` |
| 模板生成与来源校验 | `ops/build_figure_templates.cjs` |
| 真实数据适配与三件套 | `BioanalysDesktop/server/figure_adapters.js` |
| Python 固定画布兜底 | `ops/layout_autoload/sitecustomize.py`、`ops/layout_helper.py` |
| R 固定画布兜底 | `ops/layout_autoload/Rprofile`、`bin/layout_helper.R` |
| 真实渲染脚本生成 | `ops/render_figure_layout_contracts.mjs` |
| PNG 物理尺寸审计 | `ops/audit_figure_spec_v110.py` |
| 几何边界审计 | `ops/audit_figure_layout.py` |

`ops/layout_helper.py` 和 `bin/layout_helper.R` 的旧模板仍可读入，但 `auto_45`
和 `boxed` 会被归一为水平刻度与经典单图轴线。单图标题会在保存前清空，
图注只写入报告。

## 七、验收命令

```powershell
node ops/build_figure_templates.cjs --check
node --test --test-concurrency=1 BioanalysDesktop/tests/figure_templates_parity.test.js
node --test --test-concurrency=1 BioanalysDesktop/tests/figure_adapters.test.js
python -m unittest tests.test_figure_layout_contract -v
```

真实图件在 K40 渲染后，至少执行：

```bash
/mnt/ssd/bio_data/ops/layout_autoload/bin/python3 ops/audit_figure_spec_v110.py <figures-dir>
/mnt/ssd/bio_data/ops/layout_autoload/bin/python3 ops/audit_figure_layout.py --runner python --script <script> --cwd <cwd>
```

验收以尺寸审计、几何边界审计、三件套存在性和源码溯源为准。没有机器判决的图件
记为未验证，不能进入交付。
