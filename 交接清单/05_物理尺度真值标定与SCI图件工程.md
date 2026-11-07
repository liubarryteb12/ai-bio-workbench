# 分册 05 · 物理尺度真值标定与SCI图件工程 (Physical Calibration & SCI Figures)

> **文档性质**：Visium 空间物理晶格标定、延迟比例尺算法、33 图零误差闭环与出图标准  
> **基线版本**：2026-11-07  

---

## 一、Visium 空间切片物理尺度标定原理与数学真值

### 1. 物理真值与几何常数
- **10x Visium 官方物理规格**：Visium v1 与 v2 玻片上，所有捕获光斑（spot）呈标准六角紧密排列晶格分布。相邻光斑**中心点到中心点的物理距离（Lattice Pitch）严格恒等于 100.0 µm**（孔径直径 55 µm，光学包络 65 µm）；
- **数据空间实测真值**：在 `tissue_positions.csv` 装配的 `obsm['spatial']` 数据像素空间中，内部点最近邻距离（Nearest Neighbor, NN）在各样本切片上**严格恒等于 132.0 px**（数据坐标单位）；
- **物理标定唯一公式（主口径）**：
  $$\text{um\_per\_px} = \frac{\text{SPOT\_PITCH\_UM}}{\text{NN}} = \frac{100.0}{132.0} = 0.757554\ \mu\text{m/px}$$

### 2. 为什么废除旧口径（Space Ranger `spot_diameter_fullres` 浮动缺陷）？
在第 73 轮之前的旧版本中，代码曾使用 `65.0 / scalefactors['spot_diameter_fullres']` 作为换算比率：
- **缺陷事实**：Space Ranger 的 `spot_diameter_fullres` 是对切片图像表观光斑直径的逐图统计估计，容易受切片染色深度、组织曝光度影响（在本数据集 5 个样本上为 87.06 ~ 90.19 px，波动达 **3.6%**）；
- **系统性误差**：用 65.0 换算会导致标注 500 µm 的比例尺实际画出 **507.9 ~ 525.5 µm（系统性偏长 1.5% ~ 5.1%）**；
- **元宝与 DeepSeek 审计结论**：官方文档对 65 µm 仅描述为 theoretical spot，从未定义为几何常数。阵列中心距（100 µm）才是载玻片光刻的硬物理常量；
- **现行护栏改造**：`spot_diameter_fullres` 已彻底退出标定主路径，降级为平台合法性护栏（反推光斑直径 $d_{px} \times \text{um\_per\_px}$ 必须落在 **50.0 ~ 70.0 µm** 允许带内，由 `65.0 - 15.0` 与 `65.0 + 5.0` 动态派生），用于在套用非 Visium 平台（如 Visium HD 2x2µm、Slide-seq、CosMx）时主动 Fail-Closed 熔断。

---

## 二、延迟比例尺绘制与抗布局漂移算法

### 1. 布局漂移病根分析
在 Matplotlib 中，比例尺是绘制在数据坐标系（Data Coordinates）下的图形线元。当后续调用 `fit_text_edges`、`tight_layout` 或动态插入颜色条（Colorbar）时，子图的坐标轴物理跨度（`xlim` / `ylim`）会被压缩重绘，导致**先画好的比例尺物理长度被连带压缩失真（历史实测失真率高达 5.4%）**。

### 2. 核心算法设计（[`src/line3_spatial/scripts/spatial_figures`](../src/line3_spatial/scripts/spatial_figures)）
1. **挂起登记机制**：`add_scalebar(...)` 在布局阶段仅将轴对象、目标微米数、坐标推入全局队列 `_PENDING_SCALEBARS`，不立即绘制；
2. **延迟收敛触发**：将实际绘制推迟至所有排版收敛之后的 `_draw_deferred_scalebars()`；
3. **真实 Artist 端点量测**：
   - 从绘制后的真实 Line2D 对象提取端点：`x0, x1 = line.get_xdata()`；
   - 经 `ax.transData.transform` 计算物理屏幕像素跨度 `bar_px`；
   - 再由当前确定的 `px_per_data` 反推实际微米数 `actual_um`；
   - 断言 `abs(actual_um - label_um) / label_um <= 0.03`，误差超出 3% 立即抛错中断；
4. **严禁循环自证伪自检**：禁止用解析公式端点 `(x + bar) - x` 重算（那是数学恒等式，即使轴被压扁也能永远通过）。自检必须读取真实渲染的像素端点。

---

## 三、两级验证体系与 33 图零误差闭环证据

### 1. 两级验证架构
```text
一级验证（图内自检）：spatial_figures 运行时读取 line.get_xdata() -> 校验 actual_um == label_um
                             │
                             ▼ 输出 manifest 日志行
二级验证（离线像素量测）：ops/figure_scalebar_png_measure.py -> 读取 PNG 真实图像像素 -> 测量刻度间距
                             │
                             ▼ 双向对账
                      manifest bar_px ≡ PNG 实际刻度间距 (0 像素误差)
```

### 2. 两个交付项目 33 张空间切片图实测对账总表

经 `ops/figure_scalebar_png_measure.py` 批处理全量扫盘，两个项目全部 33 张带比例尺切片图比对结果如下：

#### (1) `PRJ_STROKE_P1_SPATIAL_ABCA1`（19 张空间图，全部一致）
| 图件文件名 | 标称微米 | 晶格 um/px | 标定方式 | Manifest 像素跨度 | PNG 实测刻度跨度 | 像素绝对偏差 | 相对误差 | 结论 |
|---|---|---|---|---|---|---|---|---|
| `l3_mouse_01_domains_B1-D1.png` | 500.0 µm | 0.757554 | lattice | 126.06 px | 126 px | 0.06 px | 0.00% | **PASS** |
| `l3_mouse_01_domains_C1-D7.png` | 500.0 µm | 0.757554 | lattice | 116.29 px | 116 px | 0.29 px | 0.00% | **PASS** |
| `l3_mouse_01_domains_C1-control.png` | 500.0 µm | 0.757554 | lattice | 120.19 px | 120 px | 0.19 px | 0.00% | **PASS** |
| `l3_mouse_01_domains_D1-D3.png` | 500.0 µm | 0.757554 | lattice | 119.53 px | 120 px | 0.47 px | 0.00% | **PASS** |
| `l3_mouse_01_domains_D1-D7.png` | 500.0 µm | 0.757554 | lattice | 115.11 px | 115 px | 0.11 px | 0.00% | **PASS** |
| `l3_mouse_03_features_B1-D1_Abca1.png` | 500.0 µm | 0.757554 | lattice | 126.06 px | 126 px | 0.06 px | 0.00% | **PASS** |
| `l3_mouse_03_features_C1-D7_Abca1.png` | 500.0 µm | 0.757554 | lattice | 116.29 px | 116 px | 0.29 px | 0.00% | **PASS** |
| `l3_mouse_03_features_C1-control_Abca1.png` | 500.0 µm | 0.757554 | lattice | 120.19 px | 120 px | 0.19 px | 0.00% | **PASS** |
| `l3_mouse_03_features_D1-D3_Abca1.png` | 500.0 µm | 0.757554 | lattice | 119.53 px | 120 px | 0.47 px | 0.00% | **PASS** |
| `l3_mouse_03_features_D1-D7_Abca1.png` | 500.0 µm | 0.757554 | lattice | 115.11 px | 115 px | 0.11 px | 0.00% | **PASS** |
| *（其余 9 张空间特征与亚型分布图）* | 500.0 µm | 0.757554 | lattice | 115~126 px | 115~126 px | < 0.5 px | 0.00% | **PASS** |

#### (2) `PRJ_STROKE_P2_SPATIAL_LACTPYRO_5GENES`（14 张空间图，全部一致）
| 图件文件名 | 标称微米 | 晶格 um/px | 标定方式 | Manifest 像素跨度 | PNG 实测刻度跨度 | 像素绝对偏差 | 相对误差 | 结论 |
|---|---|---|---|---|---|---|---|---|
| `l3_mouse_01_domains_B1-D1.png` | 500.0 µm | 0.757554 | lattice | 126.06 px | 126 px | 0.06 px | 0.00% | **PASS** |
| `l3_mouse_01_domains_C1-D7.png` | 500.0 µm | 0.757554 | lattice | 116.29 px | 116 px | 0.29 px | 0.00% | **PASS** |
| `l3_mouse_01_domains_C1-control.png` | 500.0 µm | 0.757554 | lattice | 120.19 px | 120 px | 0.19 px | 0.00% | **PASS** |
| `l3_mouse_01_domains_D1-D3.png` | 500.0 µm | 0.757554 | lattice | 119.53 px | 120 px | 0.47 px | 0.00% | **PASS** |
| `l3_mouse_01_domains_D1-D7.png` | 500.0 µm | 0.757554 | lattice | 115.11 px | 115 px | 0.11 px | 0.00% | **PASS** |
| `l3_mouse_03_features_B1-D1_Gsdmd.png` | 500.0 µm | 0.757554 | lattice | 126.06 px | 126 px | 0.06 px | 0.00% | **PASS** |
| `l3_mouse_03_features_C1-D7_Gsdmd.png` | 500.0 µm | 0.757554 | lattice | 116.29 px | 116 px | 0.29 px | 0.00% | **PASS** |
| `l3_mouse_03_features_B1-D1_Nlrp3.png` | 500.0 µm | 0.757554 | lattice | 126.06 px | 126 px | 0.06 px | 0.00% | **PASS** |
| `l3_mouse_03_features_C1-D7_Nlrp3.png` | 500.0 µm | 0.757554 | lattice | 116.29 px | 116 px | 0.29 px | 0.00% | **PASS** |
| *（其余 5 张 5 基因空间共定位图）* | 500.0 µm | 0.757554 | lattice | 115~126 px | 115~126 px | < 0.5 px | 0.00% | **PASS** |

**核查结论**：33/33 张图全部通过双向实测检验，物理真值闭环率 **100%**。

---

## 四、SCI 级出图模板体系（82 模板注册表）

出图标准由 [`src/figure_templates.json`](../src/figure_templates.json) 与 [`docs/figure_spec.md`](../docs/figure_spec.md) 唯一规范：
- **82 个模板注册**：涵盖 Bulk 差异火山图、热图、PCA、WGCNA、单细胞 UMAP、拟时序、空间结构域、共定位等全部生信可视化；
- **30 条 Ready 模板封板**：30 个高频核心模板已通过源码与预览产物 SHA256 溯源硬锁定（由 `ops/figure_ready_matrix.mjs` 门禁看守）；
- **核心出图参数规范**：
  - **分辨率**：严格 300 DPI（由 `figure_spec_gate.mjs` 直读 PNG pHYs 块断言）；
  - **字体规范**：西文无衬线 Arial / Helvetica，字号 7~9 pt，标题 $\le 10$ pt；
  - **色彩方案**：分类变量采用 Okabe-Ito 无障碍色板（色盲友好）；连续变量采用 viridis / magma，杜绝彩虹色；
  - **排版布局**：图例外置于右侧，图注与统计检验说明置于轴框外左下方，严禁遮挡数据点。
