# 图模板全量目录

> 真源：`tools/bio/figure_template_profiles.json`。本文由 92 条模板元数据生成，面向客户端展示与人工查阅。

共 92 个模板，其中 Ready 27 个，规划中 64 个，兼容阻塞 1 个。

## 目录说明

- `Level` 表示图型复杂度层级，不表示分析线。
- `Ready` 表示已通过就绪准入，并可读取最新 DCM 测试数据实例。
- `规划中` 与 `兼容阻塞` 只进入全量目录展示，不进入生产可选清单。
- 所有 Ready 单图按 300 DPI、图例外置右侧、图注左下角的规范输出。

## L1：基础统计图

### 包珠图（CircularPacking）

- ID：`fig_l1_circularpacking`
- 基本信息：基础统计图，Tier 1，组成结构，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：circlepackeR、cowplot、data.tree、dplyr、flare、ggiraph、ggplot2、ggraph、htmlwidgets、igraph、packcircles、tidyr
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 CircularPacking，属于组成结构类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 circlepackeR、cowplot、data.tree、dplyr、flare、ggiraph、ggplot2、ggraph；该图型暂不可派发生产任务。

### 树状图（Dendrogram）

- ID：`fig_l1_dendrogram`
- 基本信息：基础统计图，Tier 1，组成结构，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：collapsibleTree、dendextend、ggraph、igraph、tidyverse
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 Dendrogram，属于组成结构类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 collapsibleTree、dendextend、ggraph、igraph、tidyverse；该图型暂不可派发生产任务。

### 环状图（Donut）

- ID：`fig_l1_donut`
- 基本信息：基础统计图，Tier 1，组成结构，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：ggplot2
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 Donut，属于组成结构类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 ggplot2；该图型暂不可派发生产任务。

### 富集分析结果（L1 Groupedbar）

- ID：`fig_l1_groupedbar`
- 基本信息：基础统计图，Tier 1，功能富集，R，已验证可用
- 分析线：线 1：GEO Bulk 常规挖掘，对应步骤：l1_enrich_bulk
- 输入：enrichment_gsea_go.tsv，登记产物：custom_fig_l1_groupedbar.png
- 依赖：RColorBrewer、dplyr、ggplot2、hrbrthemes、streamgraph、tibble、tidyr、viridis
- 用途：展示富集分析中通路或功能条目的富集方向与强度，识别被激活与被抑制的通路。
- 介绍：展示富集分析中通路或功能条目的富集方向与强度，识别被激活与被抑制的通路。属于功能富集类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 1：GEO Bulk 常规挖掘，对应步骤 l1_enrich_bulk，输入 enrichment_gsea_go.tsv，登记产物 custom_fig_l1_groupedbar.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L1_gsea_top.png`，300 DPI，`59163d72604f6add541be370a956196e8dbd837b0cd904a7632630ef155fa18f`

### 部分高亮饼图（PartPieChart）

- ID：`fig_l1_partpiechart`
- 基本信息：基础统计图，Tier 1，组成结构，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dplyr、ggplot2、ggpubr、patchwork
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 PartPieChart，属于组成结构类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 dplyr、ggplot2、ggpubr、patchwork；该图型暂不可派发生产任务。

### 饼图（PieChart）

- ID：`fig_l1_piechart`
- 基本信息：基础统计图，Tier 1，组成结构，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：ggplot2
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 PieChart，属于组成结构类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 ggplot2；该图型暂不可派发生产任务。

### 径向堆积柱状图（RadialStackedBar）

- ID：`fig_l1_radialstackedbar`
- 基本信息：基础统计图，Tier 1，组成结构，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：tidyverse、palmerpenguins
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 RadialStackedBar，属于组成结构类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 tidyverse、palmerpenguins；该图型暂不可派发生产任务。

### 矩形树图（Treemap）

- ID：`fig_l1_treemap`
- 基本信息：基础统计图，Tier 1，组成结构，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：DOSE、stats、tidyverse、treemap
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 Treemap，属于组成结构类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 DOSE、stats、tidyverse、treemap；该图型暂不可派发生产任务。

### 华夫饼图（Waffle）

- ID：`fig_l1_waffle`
- 基本信息：基础统计图，Tier 1，组成结构，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dplyr、ggplot2、waffle
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 Waffle，属于组成结构类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 dplyr、ggplot2、waffle；该图型暂不可派发生产任务。

### 载荷图（Biplot）

- ID：`fig_l1_biplot`
- 基本信息：基础统计图，Tier 1，相关关系，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dplyr、ggbiplot
- 用途：展示变量或样本之间的相关强度，识别共变关系和潜在离群样本。
- 介绍：展示变量或样本之间的相关强度，识别共变关系和潜在离群样本。参考图型为 Biplot，属于相关关系类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 dplyr、ggbiplot；该图型暂不可派发生产任务。

### 差异火山气泡图（Bubble）

- ID：`fig_l1_bubble`
- 基本信息：基础统计图，Tier 1，差异表达，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dplyr、gapminder、ggplot2、hrbrthemes、viridis
- 用途：展示差异倍数和显著性，快速识别上调、下调和不显著的基因。
- 介绍：展示差异倍数和显著性，快速识别上调、下调和不显著的基因。参考图型为 Bubble，属于差异表达类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 dplyr、gapminder、ggplot2、hrbrthemes、viridis；该图型暂不可派发生产任务。

### 空间自相关连接散点图（ConnectedScatter）

- ID：`fig_l1_connectedscatter`
- 基本信息：基础统计图，Tier 1，空间统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dplyr、ggplot2
- 用途：展示变量或样本之间的相关强度，识别共变关系和潜在离群样本。
- 介绍：展示变量或样本之间的相关强度，识别共变关系和潜在离群样本。参考图型为 ConnectedScatter，属于空间统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 dplyr、ggplot2；该图型暂不可派发生产任务。

### 样本相关性三角热图（Correlogram）

- ID：`fig_l1_correlogram`
- 基本信息：基础统计图，Tier 1，相关关系，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：GGally、corrgram、corrplot、ggcorrplot
- 用途：用颜色矩阵展示多个基因在样本、细胞类型或空间域中的相对变化。
- 介绍：用颜色矩阵展示多个基因在样本、细胞类型或空间域中的相对变化。参考图型为 Correlogram，属于相关关系类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 GGally、corrgram、corrplot、ggcorrplot；该图型暂不可派发生产任务。

### 二维密度图（Density2D）

- ID：`fig_l1_density2d`
- 基本信息：基础统计图，Tier 1，相关关系，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：MASS、RColorBrewer、ggplot2、hexbin、mvtnorm、patchwork、plotly
- 用途：展示变量或样本之间的相关强度，识别共变关系和潜在离群样本。
- 介绍：展示变量或样本之间的相关强度，识别共变关系和潜在离群样本。参考图型为 Density2D，属于相关关系类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 MASS、RColorBrewer、ggplot2、hexbin、mvtnorm、patchwork、plotly；该图型暂不可派发生产任务。

### 散点图（Scatter）

- ID：`fig_l1_scatter`
- 基本信息：基础统计图，Tier 1，相关关系，R，已验证可用
- 分析线：线 1：GEO Bulk 常规挖掘，对应步骤：l1_ml_hub
- 输入：ml_core_hub_genes.tsv，登记产物：custom_fig_l1_scatter.png
- 依赖：dplyr、geomtextpath、ggExtra、ggplot2、ggpmisc、ggpubr、plotly
- 用途：展示变量或样本之间的相关强度，识别共变关系和潜在离群样本。
- 介绍：展示变量或样本之间的相关强度，识别共变关系和潜在离群样本。参考图型为 Scatter，属于相关关系类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 1：GEO Bulk 常规挖掘，对应步骤 l1_ml_hub，输入 ml_core_hub_genes.tsv，登记产物 custom_fig_l1_scatter.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L1_wgcna_mm_gs.png`，300 DPI，`56489dda043e20f679bf79333b4f98b83dbaa8a5344815ebbb298c28d9906d5d`

### 三元图（TernaryPlot）

- ID：`fig_l1_ternaryplot`
- 基本信息：基础统计图，Tier 1，相关关系，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：ggtern、ggthemes
- 用途：展示变量或样本之间的相关强度，识别共变关系和潜在离群样本。
- 介绍：展示变量或样本之间的相关强度，识别共变关系和潜在离群样本。参考图型为 TernaryPlot，属于相关关系类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 ggtern、ggthemes；该图型暂不可派发生产任务。

### 面积图（AreaChart）

- ID：`fig_l1_areachart`
- 基本信息：基础统计图，Tier 1，时间趋势，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dygraphs、ggpattern、hrbrthemes、tidyverse、viridis、xts
- 用途：展示数值随时间或有序阶段的变化趋势，比较轨迹与拐点。
- 介绍：展示数值随时间或有序阶段的变化趋势，比较轨迹与拐点。参考图型为 AreaChart，属于时间趋势类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 dygraphs、ggpattern、hrbrthemes、tidyverse、viridis、xts；该图型暂不可派发生产任务。

### 线性图（LineChart）

- ID：`fig_l1_linechart`
- 基本信息：基础统计图，Tier 1，时间趋势，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：gghighlight、ggplot2、ggpmisc、patchwork、viridis
- 用途：展示数值随时间或有序阶段的变化趋势，比较轨迹与拐点。
- 介绍：展示数值随时间或有序阶段的变化趋势，比较轨迹与拐点。参考图型为 LineChart，属于时间趋势类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 gghighlight、ggplot2、ggpmisc、patchwork、viridis；该图型暂不可派发生产任务。

### 堆叠面积图（StackedArea）

- ID：`fig_l1_stackedarea`
- 基本信息：基础统计图，Tier 1，时间趋势，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：babynames、dplyr、ggplot2、hrbrthemes、plotly、tidyverse、viridis
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 StackedArea，属于时间趋势类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 babynames、dplyr、ggplot2、hrbrthemes、plotly、tidyverse、viridis；该图型暂不可派发生产任务。

### 流线图（Streamgraph）

- ID：`fig_l1_streamgraph`
- 基本信息：基础统计图，Tier 1，时间趋势，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dplyr、ggplot2、ggstream、htmlwidgets、streamgraph
- 用途：展示数值随时间或有序阶段的变化趋势，比较轨迹与拐点。
- 介绍：展示数值随时间或有序阶段的变化趋势，比较轨迹与拐点。参考图型为 Streamgraph，属于时间趋势类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 dplyr、ggplot2、ggstream、htmlwidgets、streamgraph；该图型暂不可派发生产任务。

### 时间序列图（Timeseries）

- ID：`fig_l1_timeseries`
- 基本信息：基础统计图，Tier 1，时间趋势，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dplyr、ggplot2、patchwork
- 用途：展示数值随时间或有序阶段的变化趋势，比较轨迹与拐点。
- 介绍：展示数值随时间或有序阶段的变化趋势，比较轨迹与拐点。参考图型为 Timeseries，属于时间趋势类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 dplyr、ggplot2、patchwork；该图型暂不可派发生产任务。

### 分组显著性箱线图（BoxPlot）

- ID：`fig_l1_boxplot`
- 基本信息：基础统计图，Tier 1，分布形态，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dplyr、ggExtra、ggplot2、ggpmisc、ggpubr、ggtext、hrbrthemes、rstatix、viridis
- 用途：比较数值分布、集中趋势和离散程度，识别偏态与异常值。
- 介绍：比较数值分布、集中趋势和离散程度，识别偏态与异常值。参考图型为 BoxPlot，属于分布形态类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 dplyr、ggExtra、ggplot2、ggpmisc、ggpubr、ggtext、hrbrthemes、rstatix；该图型暂不可派发生产任务。

### 断点图（BreakPlot）

- ID：`fig_l1_breakplot`
- 基本信息：基础统计图，Tier 1，分布形态，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：RColorBrewer、dplyr、ggbreak、ggplot2、ggpubr、rstatix
- 用途：比较数值分布、集中趋势和离散程度，识别偏态与异常值。
- 介绍：比较数值分布、集中趋势和离散程度，识别偏态与异常值。参考图型为 BreakPlot，属于分布形态类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 RColorBrewer、dplyr、ggbreak、ggplot2、ggpubr、rstatix；该图型暂不可派发生产任务。

### 密度图（Density）

- ID：`fig_l1_density`
- 基本信息：基础统计图，Tier 1，分布形态，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：cowplot、dplyr、geomtextpath、ggExtra、ggplot2、ggpmisc、ggpubr、hrbrthemes、readr、tidyr、viridis
- 用途：比较数值分布、集中趋势和离散程度，识别偏态与异常值。
- 介绍：比较数值分布、集中趋势和离散程度，识别偏态与异常值。参考图型为 Density，属于分布形态类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 cowplot、dplyr、geomtextpath、ggExtra、ggplot2、ggpmisc、ggpubr、hrbrthemes；该图型暂不可派发生产任务。

### 直方图（Histogram）

- ID：`fig_l1_histogram`
- 基本信息：基础统计图，Tier 1，分布形态，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：cowplot、ggExtra、ggplot2、ggpmisc、ggpubr、readr、tidyverse、viridis
- 用途：比较数值分布、集中趋势和离散程度，识别偏态与异常值。
- 介绍：比较数值分布、集中趋势和离散程度，识别偏态与异常值。参考图型为 Histogram，属于分布形态类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 cowplot、ggExtra、ggplot2、ggpmisc、ggpubr、readr、tidyverse、viridis；该图型暂不可派发生产任务。

### 径向柱状图（RadialColumnChart）

- ID：`fig_l1_radialcolumnchart`
- 基本信息：基础统计图，Tier 1，分布形态，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dplyr、ggforce、ggplot2、scales
- 用途：比较数值分布、集中趋势和离散程度，识别偏态与异常值。
- 介绍：比较数值分布、集中趋势和离散程度，识别偏态与异常值。参考图型为 RadialColumnChart，属于分布形态类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 dplyr、ggforce、ggplot2、scales；该图型暂不可派发生产任务。

### 云雨图（RaincloudPlot）

- ID：`fig_l1_raincloudplot`
- 基本信息：基础统计图，Tier 1，分布形态，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：tidyverse、ggbeeswarm、palmerpenguins
- 用途：比较数值分布、集中趋势和离散程度，识别偏态与异常值。
- 介绍：比较数值分布、集中趋势和离散程度，识别偏态与异常值。参考图型为 RaincloudPlot，属于分布形态类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 tidyverse、ggbeeswarm、palmerpenguins；该图型暂不可派发生产任务。

### GSEA NES 山脊分布图（Ridgeline）

- ID：`fig_l1_ridgeline`
- 基本信息：基础统计图，Tier 1，功能富集，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：ggplot2、ggridges、hrbrthemes、readr、viridis
- 用途：展示富集分析中通路或功能条目的富集方向与强度，识别被激活与被抑制的通路。
- 介绍：展示富集分析中通路或功能条目的富集方向与强度，识别被激活与被抑制的通路。参考图型为 Ridgeline，属于功能富集类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 ggplot2、ggridges、hrbrthemes、readr、viridis；该图型暂不可派发生产任务。

### 小提琴图（ViolinPlot）

- ID：`fig_l1_violinplot`
- 基本信息：基础统计图，Tier 1，分布形态，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dplyr、forcats、gghalves、ggplot2、ggstatsplot、hrbrthemes、palmerpenguins、readr、tidyr、viridis
- 用途：比较数值分布、集中趋势和离散程度，识别偏态与异常值。
- 介绍：比较数值分布、集中趋势和离散程度，识别偏态与异常值。参考图型为 ViolinPlot，属于分布形态类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 dplyr、forcats、gghalves、ggplot2、ggstatsplot、hrbrthemes、palmerpenguins、readr；该图型暂不可派发生产任务。

### 条形图（BarPlot）

- ID：`fig_l1_barplot`
- 基本信息：基础统计图，Tier 1，排序比较，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：cowplot、dplyr、forcats、ggpattern、ggplot2、ggpubr、hrbrthemes、magrittr、rstatix、tidyr
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 BarPlot，属于排序比较类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 cowplot、dplyr、forcats、ggpattern、ggplot2、ggpubr、hrbrthemes、magrittr；该图型暂不可派发生产任务。

### 圆形条形图（CircularBarplot）

- ID：`fig_l1_circularbarplot`
- 基本信息：基础统计图，Tier 1，排序比较，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：tidyverse
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 CircularBarplot，属于排序比较类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 tidyverse；该图型暂不可派发生产任务。

### Upset图（UpsetPlot）

- ID：`fig_l1_upsetplot`
- 基本信息：基础统计图，Tier 1，排序比较，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：UpSetR、ggupset
- 用途：按统计值排序展示条目，快速定位排名靠前的基因、通路或类别。
- 介绍：按统计值排序展示条目，快速定位排名靠前的基因、通路或类别。参考图型为 UpsetPlot，属于排序比较类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 UpSetR、ggupset；该图型暂不可派发生产任务。

### 韦恩图（VennPlot）

- ID：`fig_l1_vennplot`
- 基本信息：基础统计图，Tier 1，排序比较，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：VennDiagram、ggVennDiagram、ggplot2
- 用途：按统计值排序展示条目，快速定位排名靠前的基因、通路或类别。
- 介绍：按统计值排序展示条目，快速定位排名靠前的基因、通路或类别。参考图型为 VennPlot，属于排序比较类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 VennDiagram、ggVennDiagram、ggplot2；该图型暂不可派发生产任务。

## L2：组学常用图

### 气泡热图（BubbleHeatmap）

- ID：`fig_l2_bubbleheatmap`
- 基本信息：组学常用图，Tier 2，相关关系，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：tidyverse、scRNAtoolVis
- 用途：用颜色矩阵展示多个基因在样本、细胞类型或空间域中的相对变化。
- 介绍：用颜色矩阵展示多个基因在样本、细胞类型或空间域中的相对变化。参考图型为 BubbleHeatmap，属于相关关系类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 tidyverse、scRNAtoolVis；该图型暂不可派发生产任务。

### 复杂热图（ComplexHeatmap）

- ID：`fig_l2_complexheatmap`
- 基本信息：组学常用图，Tier 2，相关关系，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：ComplexHeatmap、circlize、dendextend、gridExtra、pheatmap、tidyr
- 用途：用颜色矩阵展示多个基因在样本、细胞类型或空间域中的相对变化。
- 介绍：用颜色矩阵展示多个基因在样本、细胞类型或空间域中的相对变化。参考图型为 ComplexHeatmap，属于相关关系类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 ComplexHeatmap、circlize、dendextend、gridExtra、pheatmap、tidyr；该图型暂不可派发生产任务。

### 热图（Heatmap）

- ID：`fig_l2_heatmap`
- 基本信息：组学常用图，Tier 2，相关关系，R，已验证可用
- 分析线：线 1：GEO Bulk 常规挖掘，对应步骤：l1_ingest_prep
- 输入：expr_genes.tsv，登记产物：custom_fig_l2_heatmap.png
- 依赖：ComplexHeatmap、RColorBrewer、circlize、cowplot、d3heatmap、dplyr、ggplot2、gridExtra、heatmaply、hrbrthemes、htmlwidgets、lattice
- 用途：用颜色矩阵展示多个基因在样本、细胞类型或空间域中的相对变化。
- 介绍：用颜色矩阵展示多个基因在样本、细胞类型或空间域中的相对变化。参考图型为 Heatmap，属于相关关系类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 1：GEO Bulk 常规挖掘，对应步骤 l1_ingest_prep，输入 expr_genes.tsv，登记产物 custom_fig_l2_heatmap.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L1_topvar_heatmap.png`，300 DPI，`8a955ab3e5a95f87fe66029b5225fc2251829c4f40f9e9e0c13a1e82f9399108`

### PCA图（L2 Pca）

- ID：`fig_l2_pca`
- 基本信息：组学常用图，Tier 2，相关关系，R，已验证可用
- 分析线：线 1：GEO Bulk 常规挖掘，对应步骤：l1_qc_pca
- 输入：pca_scores.tsv，登记产物：custom_fig_l2_pca.png
- 依赖：FactoMineR、dplyr、factoextra、ggfortify、ggplot2
- 用途：展示降维后的样本或细胞分布，检查分组结构和批次效应。
- 介绍：展示降维后的样本或细胞分布，检查分组结构和批次效应。属于相关关系类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 1：GEO Bulk 常规挖掘，对应步骤 l1_qc_pca，输入 pca_scores.tsv，登记产物 custom_fig_l2_pca.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L1_pca.png`，300 DPI，`564c326ac0fcf0e8b529c414e71efc71619001e682ea7c63ddfeb34b52aa7edb`

### UMAP图（L2 Umap）

- ID：`fig_l2_umap`
- 基本信息：组学常用图，Tier 2，相关关系，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_integrate_cluster
- 输入：scrna_clustered.h5ad，登记产物：custom_fig_l2_umap.png
- 依赖：RColorBrewer、Seurat、SeuratData、dplyr、ggplot2、mlbench、patchwork、umap
- 用途：展示降维后的样本或细胞分布，检查分组结构和批次效应。
- 介绍：展示降维后的样本或细胞分布，检查分组结构和批次效应。属于相关关系类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_integrate_cluster，输入 scrna_clustered.h5ad，登记产物 custom_fig_l2_umap.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L2_umap_celltype.png`，300 DPI，`4acade660531882d3df4e6409b45b55934d6c371c7bea0168847df832d31af6c`

### KM 曲线（KaplanMeierPlot）

- ID：`fig_l2_kaplanmeierplot`
- 基本信息：组学常用图，Tier 2，临床统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：未登记
- 用途：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。
- 介绍：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。参考图型为 KaplanMeierPlot，属于临床统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 未登记第三方依赖；该图型暂不可派发生产任务。

### 棒棒糖图（LollipopPlot）

- ID：`fig_l2_lollipopplot`
- 基本信息：组学常用图，Tier 2，临床统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dplyr、ggplot2、ggpubr、patchwork
- 用途：按统计值排序展示条目，快速定位排名靠前的基因、通路或类别。
- 介绍：按统计值排序展示条目，快速定位排名靠前的基因、通路或类别。参考图型为 LollipopPlot，属于临床统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 dplyr、ggplot2、ggpubr、patchwork；该图型暂不可派发生产任务。

### 元分析森林图（MetaForestPlot）

- ID：`fig_l2_metaforestplot`
- 基本信息：组学常用图，Tier 2，临床统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dplyr、forestplot、ggplot2、grid、meta、metafor、tidyr
- 用途：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。
- 介绍：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。参考图型为 MetaForestPlot，属于临床统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 dplyr、forestplot、ggplot2、grid、meta、metafor、tidyr；该图型暂不可派发生产任务。

### 马赛克图（MosaicPlot）

- ID：`fig_l2_mosaicplot`
- 基本信息：组学常用图，Tier 2，临床统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dplyr、ggplot2、graphics、plyr、reshape2、vcd、wesanderson
- 用途：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。
- 介绍：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。参考图型为 MosaicPlot，属于临床统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 dplyr、ggplot2、graphics、plyr、reshape2、vcd、wesanderson；该图型暂不可派发生产任务。

### 诺莫图（Nomogram）

- ID：`fig_l2_nomogram`
- 基本信息：组学常用图，Tier 2，临床统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：readr、regplot、rms、survival
- 用途：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。
- 介绍：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。参考图型为 Nomogram，属于临床统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 readr、regplot、rms、survival；该图型暂不可派发生产任务。

### 回归分析表格（RegressionTable）

- ID：`fig_l2_regressiontable`
- 基本信息：组学常用图，Tier 2，临床统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：datawizard、dplyr、gtsummary、survival
- 用途：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。
- 介绍：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。参考图型为 RegressionTable，属于临床统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 datawizard、dplyr、gtsummary、survival；该图型暂不可派发生产任务。

### 细胞-细胞通讯网络圈图（CellChatCirclePlot）

- ID：`fig_l2_cellchatcircleplot`
- 基本信息：组学常用图，Tier 2，组学统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：CellChat、ggplot2、circlize
- 用途：展示组学统计中的主要模式，辅助比较分组、排序和异常结构。
- 介绍：展示组学统计中的主要模式，辅助比较分组、排序和异常结构。参考图型为 CellChatCirclePlot，属于组学统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 CellChat、ggplot2、circlize；该图型暂不可派发生产任务。

### Omics_ChromosomePlot（ChromosomePlot）

- ID：`fig_l2_chromosomeplot`
- 基本信息：组学常用图，Tier 2，组学统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：未登记
- 用途：展示组学统计中的主要模式，辅助比较分组、排序和异常结构。
- 介绍：展示组学统计中的主要模式，辅助比较分组、排序和异常结构。参考图型为 ChromosomePlot，属于组学统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 未登记第三方依赖；该图型暂不可派发生产任务。

### 基因结构图（GeneStructurePlot）

- ID：`fig_l2_genestructureplot`
- 基本信息：组学常用图，Tier 2，组学统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：gggenes、ggtree、tidyverse
- 用途：展示富集分析中通路或功能条目的富集方向与强度，识别被激活与被抑制的通路。
- 介绍：展示富集分析中通路或功能条目的富集方向与强度，识别被激活与被抑制的通路。参考图型为 GeneStructurePlot，属于组学统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 gggenes、ggtree、tidyverse；该图型暂不可派发生产任务。

### KEGG通路图（Kegg Pathway）

- ID：`fig_kegg_pathway`
- 基本信息：组学常用图，Tier 2，组学统计，R，受 R 版本兼容阻塞
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dbplyr、pathview
- 用途：展示富集分析中通路或功能条目的富集方向与强度，识别被激活与被抑制的通路。
- 介绍：展示富集分析中通路或功能条目的富集方向与强度，识别被激活与被抑制的通路。属于组学统计类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为受 R 版本兼容阻塞，依赖 dbplyr、pathview；该图型暂不可派发生产任务。

### 曼哈顿图（ManhattanPlot）

- ID：`fig_l2_manhattanplot`
- 基本信息：组学常用图，Tier 2，组学统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：aplot、qqman、tidyverse
- 用途：展示差异分析中的效应量与显著性，核对阈值线和显著基因数量。
- 介绍：展示差异分析中的效应量与显著性，核对阈值线和显著基因数量。参考图型为 ManhattanPlot，属于组学统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 aplot、qqman、tidyverse；该图型暂不可派发生产任务。

### 多组火山图（MultiVolcanoPlot）

- ID：`fig_l2_multivolcanoplot`
- 基本信息：组学常用图，Tier 2，组学统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：corrplot、scRNAtoolVis
- 用途：展示差异倍数和显著性，快速识别上调、下调和不显著的基因。
- 介绍：展示差异倍数和显著性，快速识别上调、下调和不显著的基因。参考图型为 MultiVolcanoPlot，属于组学统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 corrplot、scRNAtoolVis；该图型暂不可派发生产任务。

### 基因突变全景瀑布图（MutationOncoplot）

- ID：`fig_l2_mutationoncoplot`
- 基本信息：组学常用图，Tier 2，组学统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：ComplexHeatmap、tidyverse、maftools
- 用途：展示组学统计中的主要模式，辅助比较分组、排序和异常结构。
- 介绍：展示组学统计中的主要模式，辅助比较分组、排序和异常结构。参考图型为 MutationOncoplot，属于组学统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 ComplexHeatmap、tidyverse、maftools；该图型暂不可派发生产任务。

### 网络图（NetworkPlot）

- ID：`fig_l2_networkplot`
- 基本信息：组学常用图，Tier 2，组学统计，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_ko_drpost
- 输入：dr_regulatory_network.tsv，登记产物：L2p_konetwork_verified.png
- 依赖：MetaNet、dplyr、igraph、pcutils
- 用途：展示节点之间的连接、流向或层级关系，阅读关键通路和网络中心性。
- 介绍：展示节点之间的连接、流向或层级关系，阅读关键通路和网络中心性。参考图型为 NetworkPlot，属于组学统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_ko_drpost，输入 dr_regulatory_network.tsv，登记产物 L2p_konetwork_verified.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L1_ppi_network.png`，300 DPI，`86adc97acd699790444cfbe8bba0c88f431593302e80626f899e3cd3909e4054`

### 文字叠加的富集分析柱状图（TextEnrichmentBarPlot）

- ID：`fig_l2_textenrichmentbarplot`
- 基本信息：组学常用图，Tier 2，组学统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：未登记
- 用途：展示富集分析中通路或功能条目的富集方向与强度，识别被激活与被抑制的通路。
- 介绍：展示富集分析中通路或功能条目的富集方向与强度，识别被激活与被抑制的通路。参考图型为 TextEnrichmentBarPlot，属于组学统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 未登记第三方依赖；该图型暂不可派发生产任务。

### 火山图（L2 Volcano）

- ID：`fig_l2_volcano`
- 基本信息：组学常用图，Tier 2，组学统计，R，已验证可用
- 分析线：线 1：GEO Bulk 常规挖掘，对应步骤：l1_de_limma
- 输入：deg_all.tsv，登记产物：custom_fig_l2_volcano.png
- 依赖：ggrepel、readxl、tidyverse
- 用途：展示差异倍数和显著性，快速识别上调、下调和不显著的基因。
- 介绍：展示差异倍数和显著性，快速识别上调、下调和不显著的基因。属于组学统计类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 1：GEO Bulk 常规挖掘，对应步骤 l1_de_limma，输入 deg_all.tsv，登记产物 custom_fig_l2_volcano.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L1_volcano.png`，300 DPI，`5a099542a88e0d02a28bfcff6382c9e59f1f172432add0cde980d1ebb45851ec`

### 交互式火山图（iVolcanoPlot）

- ID：`fig_l2_ivolcanoplot`
- 基本信息：组学常用图，Tier 2，组学统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：ivolcano、fanyi、clusterProfiler、org.Hs.eg.db
- 用途：展示差异倍数和显著性，快速识别上调、下调和不显著的基因。
- 介绍：展示差异倍数和显著性，快速识别上调、下调和不显著的基因。参考图型为 iVolcanoPlot，属于组学统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 ivolcano、fanyi、clusterProfiler、org.Hs.eg.db；该图型暂不可派发生产任务。

### 条形图（Python）（BarPlot）

- ID：`fig_l2p_barplot`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_profile_composition
- 输入：celltype_composition.tsv，登记产物：custom_fig_l2p_barplot.png
- 依赖：matplotlib、seaborn、pandas、numpy
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 BarPlot，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_profile_composition，输入 celltype_composition.tsv，登记产物 custom_fig_l2p_barplot.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L2_celltype_composition.png`，300 DPI，`821a67cd28ab8c979593bffc726556f6ba00561ccf50a2a22e54778229f4454b`

### 箱线图（Python）（BoxPlot）

- ID：`fig_l2p_boxplot`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_qc_cells
- 输入：qc_cell_metrics.tsv，登记产物：custom_fig_l2p_boxplot.png
- 依赖：matplotlib、seaborn、pandas、numpy
- 用途：比较数值分布、集中趋势和离散程度，识别偏态与异常值。
- 介绍：比较数值分布、集中趋势和离散程度，识别偏态与异常值。参考图型为 BoxPlot，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_qc_cells，输入 qc_cell_metrics.tsv，登记产物 custom_fig_l2p_boxplot.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L2_qc_nfeature_by_sample.png`，300 DPI，`810188ef86231a8f608e6fdba0431fb54657d8cd69e9b4c9f5990072b497a94e`

### 复杂热图（Python）（ComplexHeatmap）

- ID：`fig_l2p_complexheatmap`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：matplotlib、pandas、numpy、PyComplexHeatmap
- 用途：用颜色矩阵展示多个基因在样本、细胞类型或空间域中的相对变化。
- 介绍：用颜色矩阵展示多个基因在样本、细胞类型或空间域中的相对变化。参考图型为 ComplexHeatmap，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 matplotlib、pandas、numpy、PyComplexHeatmap；该图型暂不可派发生产任务。

### 混淆矩阵（Python）（ConfusionMatrixPlot）

- ID：`fig_l2p_confusionmatrixplot`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：matplotlib、seaborn、numpy、scikit-learn
- 用途：展示差异分析中的效应量与显著性，核对阈值线和显著基因数量。
- 介绍：展示差异分析中的效应量与显著性，核对阈值线和显著基因数量。参考图型为 ConfusionMatrixPlot，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 matplotlib、seaborn、numpy、scikit-learn；该图型暂不可派发生产任务。

### ORA 富集气泡图（Python）（EnrichmentPlot）

- ID：`fig_l2p_enrichmentplot`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_branches_enrich
- 输入：enrichment_ora.tsv，登记产物：L2p_enrichment_verified.png
- 依赖：matplotlib、seaborn、pandas、numpy
- 用途：展示富集分析中通路或功能条目的富集方向与强度，识别被激活与被抑制的通路。
- 介绍：展示富集分析中通路或功能条目的富集方向与强度，识别被激活与被抑制的通路。参考图型为 EnrichmentPlot，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_branches_enrich，输入 enrichment_ora.tsv，登记产物 L2p_enrichment_verified.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L1_gsea_top.png`，300 DPI，`59163d72604f6add541be370a956196e8dbd837b0cd904a7632630ef155fa18f`

### GSEA NES 条形图（Python）（GseaPlot）

- ID：`fig_l2p_gseaplot`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_branches_enrich
- 输入：enrichment_gsea.tsv，登记产物：L2p_gsea_verified.png
- 依赖：matplotlib、seaborn、pandas、numpy
- 用途：展示富集分析中通路或功能条目的富集方向与强度，识别被激活与被抑制的通路。
- 介绍：展示富集分析中通路或功能条目的富集方向与强度，识别被激活与被抑制的通路。参考图型为 GseaPlot，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_branches_enrich，输入 enrichment_gsea.tsv，登记产物 L2p_gsea_verified.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L1_gsea_top.png`，300 DPI，`59163d72604f6add541be370a956196e8dbd837b0cd904a7632630ef155fa18f`

### 热力图（Python）（Heatmap）

- ID：`fig_l2p_heatmap`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_branches_gsva
- 输入：gsva_scores.tsv，登记产物：custom_fig_l2p_heatmap.png
- 依赖：matplotlib、seaborn、pandas、numpy、scipy
- 用途：用颜色矩阵展示多个基因在样本、细胞类型或空间域中的相对变化。
- 介绍：用颜色矩阵展示多个基因在样本、细胞类型或空间域中的相对变化。参考图型为 Heatmap，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_branches_gsva，输入 gsva_scores.tsv，登记产物 custom_fig_l2p_heatmap.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L1_cluster_heatmap.png`，300 DPI，`b92ce3f79c065e3cb0231fca66b55a4b46755cfbbffc0652d787bea4aa4589da`

### PCA 图（Python）（PcaPlot）

- ID：`fig_l2p_pcaplot`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：matplotlib、seaborn、pandas、numpy、scikit-learn
- 用途：展示降维后的样本或细胞分布，检查分组结构和批次效应。
- 介绍：展示降维后的样本或细胞分布，检查分组结构和批次效应。参考图型为 PcaPlot，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 matplotlib、seaborn、pandas、numpy、scikit-learn；该图型暂不可派发生产任务。

### ROC 与 PR 曲线（Python）（RocPrPlot）

- ID：`fig_l2p_rocprplot`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：matplotlib、seaborn、pandas、numpy、scikit-learn
- 用途：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。
- 介绍：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。参考图型为 RocPrPlot，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 matplotlib、seaborn、pandas、numpy、scikit-learn；该图型暂不可派发生产任务。

### 散点图（Python）（ScatterPlot）

- ID：`fig_l2p_scatterplot`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：matplotlib、seaborn、pandas、numpy、scipy
- 用途：比较标志基因在不同细胞类型或分组中的表达，核验注释和定位。
- 介绍：比较标志基因在不同细胞类型或分组中的表达，核验注释和定位。参考图型为 ScatterPlot，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 matplotlib、seaborn、pandas、numpy、scipy；该图型暂不可派发生产任务。

### 单细胞点图（Python）（L2p Dotplot）

- ID：`fig_l2p_dotplot`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_ko_localization
- 输入：target_gene_localization.tsv，登记产物：custom_fig_l2p_dotplot.png
- 依赖：scanpy、anndata、pandas、numpy、matplotlib
- 用途：比较标志基因在不同细胞类型或分组中的表达，核验注释和定位。
- 介绍：比较标志基因在不同细胞类型或分组中的表达，核验注释和定位。属于Python 通用统计类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_ko_localization，输入 target_gene_localization.tsv，登记产物 custom_fig_l2p_dotplot.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L2_umap_group.png`，300 DPI，`cb561afa019091ce4d0e655b69d3e45132d8dc35f384eddc91b22e4b3504de27`

### 单细胞堆叠小提琴图（Python）（ScrnaStackedViolin）

- ID：`fig_l2p_scrnastackedviolin`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：scanpy、anndata、pandas、numpy、matplotlib
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 ScrnaStackedViolin，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 scanpy、anndata、pandas、numpy、matplotlib；该图型暂不可派发生产任务。

### 样本 UMAP 降维图（Python）（L2p Umap）

- ID：`fig_l2p_umap`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，已验证可用
- 分析线：线 3：空间转录组，对应步骤：l3_dimred_reduce
- 输入：spatial_dimred_human.h5ad，登记产物：custom_fig_l2p_umap.png
- 依赖：scanpy、anndata、pandas、numpy、umap-learn、matplotlib
- 用途：展示降维后的样本或细胞分布，检查分组结构和批次效应。
- 介绍：展示降维后的样本或细胞分布，检查分组结构和批次效应。属于Python 通用统计类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 3：空间转录组，对应步骤 l3_dimred_reduce，输入 spatial_dimred_human.h5ad，登记产物 custom_fig_l2p_umap.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L2_umap_celltype.png`，300 DPI，`4acade660531882d3df4e6409b45b55934d6c371c7bea0168847df832d31af6c`

### 生存曲线（Python）（SurvivalPlot）

- ID：`fig_l2p_survivalplot`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：matplotlib、seaborn、pandas、numpy、lifelines
- 用途：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。
- 介绍：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。参考图型为 SurvivalPlot，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 matplotlib、seaborn、pandas、numpy、lifelines；该图型暂不可派发生产任务。

### UpSet 图（Python）（UpSetPlot）

- ID：`fig_l2p_upsetplot`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：matplotlib、pandas、numpy
- 用途：展示多个集合之间的交集和独有项，比较筛选结果的一致性。
- 介绍：展示多个集合之间的交集和独有项，比较筛选结果的一致性。参考图型为 UpSetPlot，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 matplotlib、pandas、numpy；该图型暂不可派发生产任务。

### 维恩图（Python）（VennPlot）

- ID：`fig_l2p_vennplot`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：matplotlib、matplotlib-venn
- 用途：展示多个集合之间的交集和独有项，比较筛选结果的一致性。
- 介绍：展示多个集合之间的交集和独有项，比较筛选结果的一致性。参考图型为 VennPlot，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 matplotlib、matplotlib-venn；该图型暂不可派发生产任务。

### 小提琴图（Python）（L2p Violin）

- ID：`fig_l2p_violin`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_profile_composition
- 输入：celltype_composition.tsv，登记产物：custom_fig_l2p_violin.png
- 依赖：matplotlib、seaborn、pandas、numpy
- 用途：比较数值分布、集中趋势和离散程度，识别偏态与异常值。
- 介绍：比较数值分布、集中趋势和离散程度，识别偏态与异常值。属于Python 通用统计类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_profile_composition，输入 celltype_composition.tsv，登记产物 custom_fig_l2p_violin.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L2_celltype_composition.png`，300 DPI，`821a67cd28ab8c979593bffc726556f6ba00561ccf50a2a22e54778229f4454b`

### 火山图（Python）（L2p Volcano）

- ID：`fig_l2p_volcano`
- 基本信息：组学常用图，Tier 2，Python 通用统计，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_profile_deg
- 输入：deg_all_by_celltype.tsv，登记产物：custom_fig_l2p_volcano.png
- 依赖：matplotlib、pandas、numpy
- 用途：展示差异倍数和显著性，快速识别上调、下调和不显著的基因。
- 介绍：展示差异倍数和显著性，快速识别上调、下调和不显著的基因。属于Python 通用统计类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_profile_deg，输入 deg_all_by_celltype.tsv，登记产物 custom_fig_l2p_volcano.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L2_fibroblast_volcano.png`，300 DPI，`d14299415d05bc36a7fa4b44910359657b90afdecbf9c7e869d27692ed764564`

### Harmony批次校正UMAP与供体熵对照图（Harmony UMAP with Donor Entropy）

- ID：`fig_l2_harmony_umap_entropy`
- 基本信息：组学常用图，Tier 2，降维嵌入，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_integrate_cluster
- 输入：scrna_clustered.h5ad，登记产物：l2_01_umap_celltype.png
- 依赖：未登记
- 用途：展示降维后的样本或细胞分布，检查分组结构和批次效应。
- 介绍：展示降维后的样本或细胞分布，检查分组结构和批次效应。属于降维嵌入类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_integrate_cluster，输入 scrna_clustered.h5ad，登记产物 l2_01_umap_celltype.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L2_harmony_umap_entropy.png`，300 DPI，`94661ad934cd13de17355893b237b213f8c8e6b1121d756fba3a44fe2c3501c0`

### 细胞亚群配受体通讯气泡图（LIANA Ligand Receptor Dotplot）

- ID：`fig_l2_liana_lr_dotplot`
- 基本信息：组学常用图，Tier 2，细胞通讯，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_branches_cellcomm
- 输入：cellcomm_interactions.tsv，登记产物：l2_07_comm_top.png
- 依赖：未登记
- 用途：比较细胞类型之间的配受体通讯强度，筛选高排序的互作关系。
- 介绍：比较细胞类型之间的配受体通讯强度，筛选高排序的互作关系。属于细胞通讯类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_branches_cellcomm，输入 cellcomm_interactions.tsv，登记产物 l2_07_comm_top.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L2_liana_lr_dotplot.png`，300 DPI，`cdb3f1e986238d2708bcf61e4ac2aa4b4a6dd6064861497cad5ec18cd49f2c24`

### 细胞类型CanonicalMarker表达核验图（Canonical Marker Dotplot）

- ID：`fig_l2_canonical_marker_dotplot`
- 基本信息：组学常用图，Tier 2，注释核验，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_integrate_annotate
- 输入：cluster_markers.tsv，登记产物：l2_07_marker_top5.png
- 依赖：未登记
- 用途：比较标志基因在不同细胞类型或分组中的表达，核验注释和定位。
- 介绍：比较标志基因在不同细胞类型或分组中的表达，核验注释和定位。属于注释核验类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_integrate_annotate，输入 cluster_markers.tsv，登记产物 l2_07_marker_top5.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L2_canonical_marker_dotplot.png`，300 DPI，`e3d94d6b939dd895c07c3c60f53143b390380fcdc0fff65cc54d5cc5e235b99a`

### 亚群降维后处理与调控网络图（Downstream Regulatory Network）

- ID：`fig_l2_dr_trajectory_post`
- 基本信息：组学常用图，Tier 2，下游网络，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_ko_drpost
- 输入：dr_regulatory_network.tsv，登记产物：custom_fig_l2_networkplot.png
- 依赖：未登记
- 用途：展示降维后的样本或细胞分布，检查分组结构和批次效应。
- 介绍：展示降维后的样本或细胞分布，检查分组结构和批次效应。属于下游网络类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_ko_drpost，输入 dr_regulatory_network.tsv，登记产物 custom_fig_l2_networkplot.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L1_ppi_network.png`，300 DPI，`86adc97acd699790444cfbe8bba0c88f431593302e80626f899e3cd3909e4054`

### 细胞类型特异差异表达火山图（Cell Type Specific DEG Volcano）

- ID：`fig_l2_celltype_deg_volcano`
- 基本信息：组学常用图，Tier 2，差异表达，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_profile_deg
- 输入：deg_all_by_celltype.tsv，登记产物：l2_08_deg_volcano_mitotic.png
- 依赖：未登记
- 用途：展示差异倍数和显著性，快速识别上调、下调和不显著的基因。
- 介绍：展示差异倍数和显著性，快速识别上调、下调和不显著的基因。属于差异表达类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_profile_deg，输入 deg_all_by_celltype.tsv，登记产物 l2_08_deg_volcano_mitotic.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L2_celltype_deg_volcano.png`，300 DPI，`2ec6f8485d387ad59ed64f18a014bf9e28f96ae077aa312e53edbcf471f43e5d`

## L3：高级统计图

### 柱状图+蜂群点图+折线图组合（CombinationPanel）

- ID：`fig_l3_combinationpanel`
- 基本信息：高级统计图，Tier 3，临床统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：tidyverse、ggbeeswarm、patchwork
- 用途：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。
- 介绍：展示模型或临床结局的判别能力，阅读阈值、校准和净获益。参考图型为 CombinationPanel，属于临床统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 tidyverse、ggbeeswarm、patchwork；该图型暂不可派发生产任务。

### 组合桑基气泡图（SankeyBubblePlot）

- ID：`fig_l3_sankeybubbleplot`
- 基本信息：高级统计图，Tier 3，组学统计，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：未登记
- 用途：展示节点之间的连接、流向或层级关系，阅读关键通路和网络中心性。
- 介绍：展示节点之间的连接、流向或层级关系，阅读关键通路和网络中心性。参考图型为 SankeyBubblePlot，属于组学统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 未登记第三方依赖；该图型暂不可派发生产任务。

### 分面图（Python）（FacetGridPlot）

- ID：`fig_l3p_facetgridplot`
- 基本信息：高级统计图，Tier 3，Python 通用统计，Python，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：matplotlib、seaborn、pandas、numpy
- 用途：展示Python 通用统计中的主要模式，辅助比较分组、排序和异常结构。
- 介绍：展示Python 通用统计中的主要模式，辅助比较分组、排序和异常结构。参考图型为 FacetGridPlot，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 matplotlib、seaborn、pandas、numpy；该图型暂不可派发生产任务。

### 多面板组合图（L3 Multipanel）

- ID：`fig_l3_multipanel`
- 基本信息：高级统计图，Tier 3，R 通用统计，R，规划中
- 分析线：线 1：GEO Bulk 常规挖掘，对应步骤：l1_ml_external
- 输入：external_validation_preds.tsv，登记产物：custom_fig_l3_multipanel.png
- 依赖：ggplot2、patchwork
- 用途：展示R 通用统计中的主要模式，辅助比较分组、排序和异常结构。
- 介绍：展示R 通用统计中的主要模式，辅助比较分组、排序和异常结构。属于R 通用统计类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 1：GEO Bulk 常规挖掘，对应步骤 l1_ml_external，输入 external_validation_preds.tsv，登记产物 custom_fig_l3_multipanel.png。当前仅作候选目录展示，未进入生产可选清单。当前状态为规划中，依赖 ggplot2、patchwork；该图型暂不可派发生产任务。

### 出版级样式与导出（Python）（PublicationStyle）

- ID：`fig_l3p_publicationstyle`
- 基本信息：高级统计图，Tier 3，Python 通用统计，Python，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：matplotlib、seaborn、pandas、numpy、SciencePlots
- 用途：展示Python 通用统计中的主要模式，辅助比较分组、排序和异常结构。
- 介绍：展示Python 通用统计中的主要模式，辅助比较分组、排序和异常结构。参考图型为 PublicationStyle，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 matplotlib、seaborn、pandas、numpy、SciencePlots；该图型暂不可派发生产任务。

### 桑基图（Python）（SankeyDiagram）

- ID：`fig_l3p_sankeydiagram`
- 基本信息：高级统计图，Tier 3，Python 通用统计，Python，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：pandas、numpy、plotly
- 用途：展示节点之间的连接、流向或层级关系，阅读关键通路和网络中心性。
- 介绍：展示节点之间的连接、流向或层级关系，阅读关键通路和网络中心性。参考图型为 SankeyDiagram，属于Python 通用统计类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 pandas、numpy、plotly；该图型暂不可派发生产任务。

### 和弦图（ChordDiagram）

- ID：`fig_l3_chorddiagram`
- 基本信息：高级统计图，Tier 3，比例构成，Python，已验证可用
- 分析线：线 2：单细胞转录组，对应步骤：l2_branches_cellcomm
- 输入：cellcomm_interactions.tsv，登记产物：L3_cellcomm_chord_verified.png
- 依赖：chorddiag、circlize、dplyr、ggraph、igraph、readr、readxl、tidygraph、tidyverse、viridis
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 ChordDiagram，属于比例构成类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 2：单细胞转录组，对应步骤 l2_branches_cellcomm，输入 cellcomm_interactions.tsv，登记产物 L3_cellcomm_chord_verified.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L2_cellcomm_top20.png`，300 DPI，`94cc620b17874bd2979d8c28b915ae1261f3567c3c55e17d0ab9197a730a141a`

### 网络图（Network）

- ID：`fig_l3_network`
- 基本信息：高级统计图，Tier 3，比例构成，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：RColorBrewer、cowplot、igraph、networkD3
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 Network，属于比例构成类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 RColorBrewer、cowplot、igraph、networkD3；该图型暂不可派发生产任务。

### 桑基图（Sankey）

- ID：`fig_l3_sankey`
- 基本信息：高级统计图，Tier 3，比例构成，R，规划中
- 分析线：未绑定，对应步骤：未绑定
- 输入：尚未绑定，登记产物：尚未登记
- 依赖：dplyr、ggalluvial、ggplot2、networkD3、openxlsx、readxl、tidyverse、webshot
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。参考图型为 Sankey，属于比例构成类。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。当前状态为规划中，依赖 dplyr、ggalluvial、ggplot2、networkD3、openxlsx、readxl、tidyverse、webshot；该图型暂不可派发生产任务。

### 空间功能域切片分布图（Spatial Functional Domains）

- ID：`fig_l3_banksy_domain`
- 基本信息：高级统计图，Tier 3，空间分布，Python，已验证可用
- 分析线：线 3：空间转录组，对应步骤：l3_dimred_domains
- 输入：spatial_domains_mouse.h5ad，登记产物：l3_mouse_01_domains_B1-D1.png
- 依赖：未登记
- 用途：展示切片内空间位置与表达或域标签的对应关系，检查空间聚集和逐样本差异。
- 介绍：展示切片内空间位置与表达或域标签的对应关系，检查空间聚集和逐样本差异。属于空间分布类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 3：空间转录组，对应步骤 l3_dimred_domains，输入 spatial_domains_mouse.h5ad，登记产物 l3_mouse_01_domains_B1-D1.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L3_banksy_domain.png`，300 DPI，`2b0c2c3b3bb2ec1d01e8b4797be9e9415534a8e1d64034dc298d70f32c2908d4`

### 空间Spot细胞亚型解卷积构成图（NNLS Cell Type Composition）

- ID：`fig_l3_nnls_deconv_pie`
- 基本信息：高级统计图，Tier 3，组成结构，Python，已验证可用
- 分析线：线 3：空间转录组，对应步骤：l3_branches_celltype
- 输入：celltype_scores_mouse.tsv，登记产物：l3_mouse_15_deconv_composition.png
- 依赖：未登记
- 用途：比较各类别在总体中的占比，观察组成结构是否随分组变化。
- 介绍：比较各类别在总体中的占比，观察组成结构是否随分组变化。属于组成结构类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 3：空间转录组，对应步骤 l3_branches_celltype，输入 celltype_scores_mouse.tsv，登记产物 l3_mouse_15_deconv_composition.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L3_nnls_deconv_pie.png`，300 DPI，`d3f63d3bb1b89832769e52208600ac634e4acc4d25c6e1d110cb86f4dafd32d1`

### 核心靶基因空间共定位切片图（Target Gene Spatial Localization）

- ID：`fig_l3_multigene_coloc`
- 基本信息：高级统计图，Tier 3，空间分布，Python，已验证可用
- 分析线：线 3：空间转录组，对应步骤：l3_branches_localization
- 输入：gene_localization_mouse.tsv，登记产物：l3_mouse_02_target_gene_B1-D1.png
- 依赖：未登记
- 用途：展示切片内空间位置与表达或域标签的对应关系，检查空间聚集和逐样本差异。
- 介绍：展示切片内空间位置与表达或域标签的对应关系，检查空间聚集和逐样本差异。属于空间分布类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 3：空间转录组，对应步骤 l3_branches_localization，输入 gene_localization_mouse.tsv，登记产物 l3_mouse_02_target_gene_B1-D1.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L3_multigene_coloc.png`，300 DPI，`978416e328b53246fd0218ce5e6474f3bd927478a99d6a6f55340d592eaafe4e`

### 空间高变自相关基因排序图（Spatial Autocorrelation Ranking）

- ID：`fig_l3_morans_i_spatial`
- 基本信息：高级统计图，Tier 3，空间统计，Python，已验证可用
- 分析线：线 3：空间转录组，对应步骤：l3_stats_autocorr
- 输入：gene_autocorr_mouse.tsv，登记产物：l3_mouse_04_morans_top.png
- 依赖：未登记
- 用途：展示变量或样本之间的相关强度，识别共变关系和潜在离群样本。
- 介绍：展示变量或样本之间的相关强度，识别共变关系和潜在离群样本。属于空间统计类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 3：空间转录组，对应步骤 l3_stats_autocorr，输入 gene_autocorr_mouse.tsv，登记产物 l3_mouse_04_morans_top.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L3_morans_i_spatial.png`，300 DPI，`edf6847cf1870676ec69a1172e2424ddce06bf8e23af5ee713a3be48b1da06c3`

### 空间微环境配受体互作热点图（Spatial Niche Communication）

- ID：`fig_l3_niche_comm_spatial`
- 基本信息：高级统计图，Tier 3，细胞通讯，Python，已验证可用
- 分析线：线 3：空间转录组，对应步骤：l3_stats_communication
- 输入：sample_communication_mouse.tsv，登记产物：l3_mouse_19_communication.png
- 依赖：未登记
- 用途：展示切片内空间位置与表达或域标签的对应关系，检查空间聚集和逐样本差异。
- 介绍：展示切片内空间位置与表达或域标签的对应关系，检查空间聚集和逐样本差异。属于细胞通讯类，来自生产流水线实证模板。读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。绑定线 3：空间转录组，对应步骤 l3_stats_communication，输入 sample_communication_mouse.tsv，登记产物 l3_mouse_19_communication.png。已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。
- 最新实例：`workspace/projects/DCM_CHAIN_20261109/report/figures/L2_cellcomm_top20.png`，300 DPI，`94cc620b17874bd2979d8c28b915ae1261f3567c3c55e17d0ab9197a730a141a`
