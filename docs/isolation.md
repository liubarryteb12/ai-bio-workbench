# 三线隔离约束

> version 1 | 2026-10-12
> 术语定义见 `con_hf/CONTEXT.md`，本文件讲"约束是什么 + 怎么执行"。

## 约束内容

三条分析线：`line1_bulk`、`line2_scrna`、`line3_spatial`。

**互不交叉**（架构级硬约束，不是工作习惯）：

1. 不互相取参考。线3 做解卷积时，参考只能来自 `public_references/` 或线3 自有单细胞分辨率数据，
   **不得从线2 提取参考给线3**。
2. 不合并数据集。三条线的 `raw_data/`、`processed/`、`results/` 物理分离。
3. 不跨线验证。线1 的外部验证用独立 GEO 数据集，不拿线2/线3 的结果当验证集。

**虚拟敲除不是第四条线**：它是线2 和线3 各自的末端模块，产出 DR genes。

**R/Python 混用只发生在线内**：同一条线内部可以按工具分工换语言，
例如线2 用 Scanpy 做 QC 聚类、用 scTenifoldKnk 做虚拟敲除。这是工具层混用，不是分析线交叉。

## 目录层怎么保证

物理隔离靠目录边界，不靠人记得：

```
/mnt/ssd/bio_data/
├── projects/
│   ├── default/
│   │   ├── line1_bulk/{raw_data,processed,results,figures}/
│   │   ├── line2_scrna/{raw_data,processed,results,figures}/
│   │   └── line3_spatial/{raw_data,processed,results,figures}/
│   └── <新项目>/...          ← 项目之间同样物理隔离
├── bin/<line>/              ← 脚本部署区（全局一份）
├── envs/<line>/             ← 环境声明（全局一份）
└── public_references/       ← 跨项目唯一合法共享读入口
```

每条线的分析代码工作时，工作目录必须设在该项目该线的 `processed/` 内；
脚本的输入输出路径只允许出现：本项目本线目录、`public_references/`、`system_logs/`。

**两层隔离**：项目之间（不同 `<项目>` 目录互不引用）与线之间（同项目内三条线互不引用）都是硬约束。

## 执行层校验

约束不能只写在文档里，由两个脚本分管执行：

1. **代码静态检查**（PC 侧，`ops/02_check_isolation.ps1`）：
   `src/<line>/` 下的脚本，路径字符串中不得出现其他两条线的目录名或 line_id。
2. **台账检查**（服务器侧，`ops/03_check_logs_remote.sh`，PC 侧一键入口 `ops/04_check_logs.ps1`）：
   `system_logs/` 下任务台账 JSON 的 `line_id` 必须是三个合法值之一，`project_id` 必须合法
   （缺省视为 `default`，兼容迁移前的历史台账）；`io_files` 中的路径必须属于该 line_id 或
   `public_references/` 或 `system_logs/`，且路径中的项目段（`/projects/<项目>/`）必须与
   `project_id` 一致（跨项目引用一律判违规）。
3. **运行时路径断言**（后端 `server/files.js` / `figures.js` / `upload.js`）：
   所有浏览、出图、上传路径都必须落在 `projects/<项目>/<线>/` 或 `public_references/` 之内，
   别的项目、别的线、`..` 穿越一律拒绝。

## 桥接检查点（线内混用时必过）

跨语言传文件（如 Python 出 `.h5ad` 给 R 读）后，必须校验四项，任一不符即停：

- 基因名（symbol 是否一致、有没有带版本号后缀）
- 矩阵方向（基因×细胞 还是 细胞×基因）
- 细胞名是否保留
- embedding 是否保留

校验脚本放 `src/<line>/` 下，命名为 `checkpoint_*.R` 或 `checkpoint_*.py`。

## bulk 线的外部验证冻结

独立 GEO 验证集只做冻结评估：不重新筛基因、不重新调参。
验证集内部可以去批次，但**禁止把训练集和验证集合并校正后再评估**。
多外部数据集、跨平台必须分开报告，关注表达方向一致性。
