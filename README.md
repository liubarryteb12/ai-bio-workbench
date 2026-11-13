# AI 辅助生信分析流程工作台 (Bioanalys)

> **版本**：v3.2 治理收口版  
> **核心定位**：本地零算力控制面 + 用户自备 Linux 容器算力面的跨平面 AI 辅助生物信息学分析系统。

---

## 一、 快速启动

双击根目录脚本即可拉起全套服务：

* **一键启动（工作台 + 需求台）**：运行 [`start_all.bat`](start_all.bat)
* **管理工作台（Admin Workbench）**：运行 [`start_workbench.bat`](start_workbench.bat) -> `http://127.0.0.1:18787`
* **客户需求台（Client Portal）**：运行 [`start_portal.bat`](start_portal.bat) -> `http://127.0.0.1:8080`

---

## 二、 系统架构

```text
[客户需求台 (8080)]             [管理员工作台 (18787)]
       │                                │
       ▼                                ▼
[portal/inbox 需求归档] ──► [微内核与引擎层]
                                        │ 算力适配层
                                        ▼
                  [用户自备算力节点 (Linux 容器)]
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           ▼                            ▼                            ▼
   [Line 1: Bulk RNA-seq]      [Line 2: scRNA-seq]        [Line 3: Spatial]
   (16 个步骤脚本，含质控、       (22 个步骤脚本，含单细胞      (17 个步骤脚本，含空间微环境、
    Limma DEG、WGCNA、机器学习)   质控、Harmony、CellChat、    自相关基因、空间通讯与敲除)
                                 SCENIC 与虚拟敲除)
```

---

## 三、 三条生信分析流水线

1. **Line 1 转录组数据挖掘 (`src/line1_bulk/`)**：
   - 表达谱预处理、样本 QC、Limma 差异表达分析、GO/KEGG/GSEA 通路富集、离线 STRING PPI 网络、WGCNA 共表达网络、机器学习筛选核心基因（LASSO、随机森林、SVM-RFE）、Cox 生存分析、外部独立验证集模型验证与 SCI 出图。
2. **Line 2 单细胞转录组 (`src/line2_scrna/`)**：
   - Scanpy QC 过滤、高变基因筛选、Harmony 跨批次整合、UMAP 降维聚类、细胞类型自动注释、细胞通讯（CellChat）、pySCENIC 转录因子调控网络推断、GSVA 通路打分、Monocle 拟时序、单细胞虚拟敲除（Virtual Knockout）。
3. **Line 3 空间转录组 (`src/line3_spatial/`)**：
   - 组织切片 Spot 质控、空间域识别与聚类、空间标志物发现、Moran's I / Geary's C 空间自相关基因、空间邻近细胞通讯、空间虚拟敲除。

---

## 四、 赞助支持

如果这个项目对你有帮助，欢迎通过下面的赞助码支持后续维护与更新。

<p align="center">
  <a href="docs/assets/sponsor.jpg">
    <img src="docs/assets/sponsor.jpg" alt="赞助码" width="320">
  </a>
</p>

---

## 五、 核心技术标准与单一真源

* **架构规划真源导航**：[`aims/README.md`](aims/README.md)
* **当前收口战役手册**：[`aims/A2A/05_codex_a2a_v1_20261030.md`](aims/A2A/05_codex_a2a_v1_20261030.md)
* **目录组织规范**：[`docs/directories.md`](docs/directories.md)
* **三线物理隔离规范**：[`docs/isolation.md`](docs/isolation.md)
* **跨会话交接台账**：[`con_hf/handoff.md`](con_hf/handoff.md)
* **最新工作区全景盘点**：[`项目情况汇总2026-10-30.md`](项目情况汇总2026-10-30.md)

---

## 六、 常用运维与验证命令

```bash
# 1. 结构与契约门禁扫描（13 项全量检查）
node ops/check-gates.mjs

# 2. 微内核与引擎 strict 类型检查
node BioanalysDesktop/node_modules/typescript/bin/tsc -p tsconfig.core.json --noEmit

# 3. 管理端前端类型检查与生产打包
cd BioanalysDesktop && npm run build

# 4. 发布计划批次归类核验
node ops/release-plan.mjs

# 5. 算力节点链路健康自检
pwsh -File ops/00_link_check.ps1
```
