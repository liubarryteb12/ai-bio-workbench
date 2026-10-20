# 架构评审 · 全工作目录（2026-10-20 · 主 Agent 亲办）

> 起因：用户原话"工作台越做越臃肿、功能越做越烦，框架没想象中好、效率没想象高"，
> 要求全量过一遍 + 出规整清单（小白视角）+ 我拍板 + 直接干。
> 每条都有证据（文件:行号 或 实测命令输出）。
> 说明：S25 子 Agent 切片失败（41 次工具调用后只把派发单抄进报告文件，实质为空），
> 故由主 Agent 亲办；派发单存于 `con_hf/dispatch/S25_scout_architecture_review.md`。

## 0. 结论摘要（给小白的三句话）

1. **架构没坏，坏在"管家太多了"**：客户门户、管理工作台、运维脚本是三套独立系统，
   同一件事（守护/日志检查/链接检查）有多处实现——你感觉的"臃肿"主要来自这里，
   不是分析流程本身。
2. **分析主线是健康的**：三线 137 张图件全过判决、处理数据零污染、建项契约有
   30+ 条断言把守；但有两个"承诺了没接上"的地方（桥接四项断言 0 次调用、
   客户交付报告无入口）和一个真 P0（台账写入超长被静默截断）。
3. **该做的不是重构框架，是 8 件具体事**：修 1 个 P0、补 2 个断链、收敛 3 处重叠、
   清 1 处 689MB 历史数据。全部有明确目标文件，不动架构。

## 1. 架构总评（设计 vs 现状）

### 1.1 云-端解耦：设计成立，保持
- **你能感受到的**：本地电脑只跑浏览器和两个小服务，重活全在手机；电脑风扇不响。
- **证据**：进程实测只有 `portal/serve.mjs`(PID 5968) 与 `server/index.js`(PID 26256)
  两个 node 服务；计算全部走 ssh 到 K40。aims.txt §一.1 与此一致。
- **判断**：**保持**。这是整套设计里最对的一块，不要动。

### 1.2 "管家"有六套，这是臃肿主因
- **你能感受到的**：断链/服务异常时不知道该信哪个脚本；每次排查要从六个里挑。
- **证据**（ops/ 内守护/修复类）：`00_link_check.ps1`(131 行) + `serve_guard.ps1`(214 行)
  + `bio_watchdog.sh`(56 行) + `fix_runsvdir.sh`(65 行) + `01_fix_svlogger.ps1`(89 行)
  + `svlogger_crond`/`svlogger_ssh-agent`/`svlogger_sshd` 三个目录。
- **判断**：**收敛**。保留 `00_link_check.ps1`（断链重连，aims §一.1 点名）
  + `run_throttled_task.sh`（任务削峰与台账，aims §六.3 点名）；
  其余评估后归档。归档=移动文件，需你一句话授权（见 §5 B 批）。

### 1.3 三线硬隔离：全项目最扎实的部分
- **你能感受到的**：三条线互不污染，审计能机器判决（这正是能查出 137 张图全过、
  #198/#199 两个种子 P0 的原因）。
- **证据**：`src/三线目录` + 远端 `projects/<id>/<line>/` 物理隔离 +
  `server/audit.js` 跨线扫描 + `server/ledger.js` 跨线判决 +
  `ops/check_storage_and_isolation.sh` 四门禁；S21 盘点 23 端点无跨线漏洞。
- **判断**：**保持，且作为其他子系统的范本**。

### 1.4 R/Python 分工：口径有漂移，低危
- **证据**：aims.txt §一.3 声明"线1 切 1 次 / 线2 切 2 次 / 线3 切 0 次"；
  实测各脚本内 `Rscript` 与 `python` 调用次数：线1 = 23/10、线2 = 5/24、线3 = 2/17。
  线1 有 10 次 python 调用，与"1 次单向切换"的口径需核对
  （"调用"≠"跨语言桥接"，但规格没写清区别）。
- **判断**：**低危**，aims 该按实测口径改写定义，别让规格骗人（§5 A 批）。

### 1.5 桥接四项断言：铁律空转（本轮最值得注意的架构发现）
- **你能感受到的**：跨语言转换的正确性目前靠"跑出来没报错"，不靠自动断言。
- **证据**：58 个分析脚本 `grep verify_bridge_checkpoint` **0 命中**；
  aims.txt §一.3 明写"每次跨语言转换必须通过桥接四项断言检查点，由
  `ops/verify_bridge_checkpoint.py` 自动执行"。
- **判断**：**补接线，但不改 58 个脚本**（那会动三线隔离域且工作量巨大）。
  正确位置是 8787 任务提交层统一接（§5 A5）。

### 1.6 固定种子 20261013：渗透良好，台账有已知残留
- **证据**：#198/#199 两个 P0 都是种子问题被台账/探针抓出，机制有效；
  已知残留：`ops/03_check_logs_remote.sh` 判 "passed 但 random_seed 为空" 为
  VIOLATION，走 ops 直跑的沙盒脚本会被误判。
- **判断**：S26 修台账时顺带补 seed/project_id 字段
  （`run_throttled_task.sh` 写的台账本来就没这两个字段，脚本侧缺口）。

### 1.7 出图规范：全项目最完整的子系统，作为范本
- **证据**：`docs/figure_spec.md` 15 条判据 + 4 个工具（code_audit/score/scan/
  audit_figure_layout）+ 负对照体系 + 137 图机器判决（三线 PASS 全满）。
- **判断**：**保持**。其他子系统（台账、上传、报告）应对齐它的工程标准。

### 1.8 建项契约：服务端强、向导弱，S24 已补
- **证据**：服务端 `v3_intake.test.js` 30 断言；S24 前向导录不了 intake 四块、
  进不了 IN_HOUSE（R2 死路）；S24 已交付并复核（E2E 25/25）。
- **判断**：**保持 S24 成果**，后续 UI 目检一次即可。

### 1.9 con_hf 三个大台账：纪律价值高，但已是 606K 单体文件
- **证据**：`handoff.md` 239K + `操作台账.md` 223K + `踩坑台账.md` 144K（实测）。
- **判断**：**暂不拆**。台账是跨会话恢复的唯一依据，拆分会增加恢复成本；
  等 handoff 超 500K 再按"近期/历史"拆。当前用"追加不重写"纪律维持。

### 1.10 项目根非 git 仓库：所有改动无原生回滚
- **证据**：`git status` → not a git repository（S18R 报告同样记录）。
- **判断**：**建议初始化 git**（B 批，需你授权）——这是"框架没想象中好"的真实痛点：
  任何误操作都没有原生回滚手段，只能靠手工备份。

## 2. 臃肿清单（五分类，每项有体积/行数证据）

### 2.1 【删】（需你一句话授权，都是不可逆操作）
| 项 | 证据 | 为什么 | 风险 |
|---|---|---|---|
| `cn_debug/scenic_db/` 689MB | 3 个文件 298M+297M+94M；全仓库 `grep scenic_db` **0 引用** | SCENIC 数据库是历史上一次性下载用的参考数据，躺在调试目录里，与目录性质不符 | 不可逆。删了若日后再跑 SCENIC 要重下（下载源在网络侧，需重新获取） |
| `cn_debug/subagent_*.log` 24 个 4.9MB | ls 实测 | 子 Agent 运行日志，结论都已进台账/报告，日志只是过程 | 低。删了不影响任何判决证据 |
| `ops/__pycache__/` | ls 实测 | Python 缓存，可再生 | 无 |

### 2.2 【归档】（同样需授权；归档=移到 `_archive/`，该目录你点名过需确认）
- `docs/geo_mining_sop_v1.md`（已被 v2 取代并挂横幅，实测确认）
- `ops/serve_guard.ps1`(214 行)、`ops/bio_watchdog.sh`(56 行)、
  `ops/fix_runsvdir.sh`(65 行)、`ops/01_fix_svlogger.ps1`(89 行)、
  `ops/svlogger_*` 三个目录、`ops/04_check_logs.ps1`（与 `03_check_logs_remote.sh`
  功能重叠；`consistency.test.js` 固化的是 sh 版口径）
- `cn_debug/` 里的一次性探针与调试脚本（`2026-10-20_debug_*`、`2026-10-19_verify_*` 等）

### 2.3 【合并】（收敛重叠，不需动文件也能先做的部分）
- **守护机制六套 → 两套**：保留 `00_link_check.ps1`（断链重连）+ `run_throttled_task.sh`
  （任务守护），其余见 2.2 归档。
- **日志检查两套 → 一套**：保留 `03_check_logs_remote.sh`（服务端 `ledger.js`
  与 `consistency.test.js` 同口径），`04_check_logs.ps1` 归档。
- **上传白名单两套不一致**：8787 允许 `.h5/.loom/.soft/.tar/.rdata`
  （`upload.js:24-27`），portal 允许 `.xlsx` 但不允许上述（`archive.mjs:23`）
  ——**同一份数据走两个入口校验结论不同**，用户会困惑。建议以 aims 数据集形态为准
  统一成一份（S30 处理）。

### 2.4 【抽公共】判决：**不抽**（附理由）
四组跨线同名脚本实测全部**已分叉**（不是复制粘贴残留）：
| 脚本对 | 线2 | 线3 | 判决 |
|---|---|---|---|
| `enrichment` | 196 行 md5 d4780331 | 289 行 md5 88b539b3 | 已分叉 |
| `enrichment_figures` | 331 行 80067ffe | 343 行 ead967ba | 已分叉 |
| `dr_post_analysis` | 497 行 da7465a6 | 442 行 51c729aa | 已分叉 |
| `normalize_hvg` | 198 行 8d14593d | 256 行 aa1de97f | 已分叉 |
**判决：不抽公共库。** 理由：① 三线硬隔离是项目铁律，抽公共库等于把跨线耦合
正式引进隔离线，日后改一处动三线；② 分叉是隔离线的正常演化（线2 的单细胞归一化
与线3 的空间归一化本来逻辑就不同）；③ 真要减重应做的是在 README 记录
"同名不同线有意分叉"，而不是合并。
`qc_matrix`(线1)/`qc_cells`(线2)/`qc_spots`(线3) 同理，且三线本就不同语义。

### 2.5 【保留】（动了会出事）
`aims/aims.txt`、`src/` 三线全部、`ops/run_throttled_task.sh`、
`ops/check_storage_and_isolation.sh`、`ops/verify_bridge_checkpoint.py`、
`ops/06_deploy_scripts.ps1`、`ops/07_pull_outputs.ps1`、`ops/build_client_report.py`、
`BioanalysDesktop/` 全部、`portal/` 全部、`docs/figure_spec.md` 及其工具链、
`con_hf/` 三个台账、`cn_debug/` 的判决证据（figure_audit_all.csv、负对照样本、
各验证脚本）。

## 3. 效率瓶颈（链路图 + 手工断点）

### 3.1 完整链路（一次"客户提交→交付报告"）
```
客户浏览器 → portal(8080) 填 5 步表单 + 上传数据文件
   → PKG_ 包落 portal/inbox/
   → 【手工断点1】管理员打开 8787 收件箱视图，人工导入建项
   → 8787 校验 + scp 数据到 K40 projects/<id>/<line>/raw_data/
   → 8787 提交任务（ssh 到 K40，run_throttled_task.sh 守护跑）
   → K40 跑分析 + 写 system_logs 台账
   → 8787 回搬 outputs/ 到本地
   → Studio 预览（图廊/TSV/解读）
   → 【手工断点2】客户交付报告：人工 ssh 上 K40 跑 ops/build_client_report.py
   → 【手工断点3】人工把报告文件捞回本地 deliverables/
```
### 3.2 手工断点清单（按痛感排序）
1. **报告生成与捞回无入口**（R3）：每次交付都要人 ssh 跑 CLI + 手动拷文件。
2. **收件箱到建项要人点**：客户提交后不会自动出现在工作台（设计上合理，
   但缺"待处理"提醒）。
3. **上传无断点续传**（R5）：1.89GB 级原始包传到 90% 断了要从头再来
   （`status` 端点存在但客户端不调用）。
4. **inputs/outputs 靠手打**（R10）：任务提交时输入输出路径是自由文本，
   placeholder 还是缺 `projects/<项目>` 段的旧路径，易错且无提交前校验。
5. **SCENIC 689MB 长期占用调试目录**：让每次 `find`/备份/同步都慢。

## 4. 规格漂移（aims 声明 vs 实测不符，逐条）

| # | aims 声明 | 实测 | 严重度 |
|---|---|---|---|
| D1 | §一.3"每次跨语言转换必须通过桥接四项断言，由 `verify_bridge_checkpoint.py` 自动执行" | 58 脚本 **0 调用** | **高**（铁律空转） |
| D2 | §一.3"线1 切1/线2 切2/线3 切0 次" | 实测 Rscript/python 调用 23/10、5/24、2/17（口径未定义"调用"vs"桥接"） | 低（定义不清） |
| D3 | §三.4 建项示例 `expected_formats: ["png_150dpi", ...]` | §三.4 正文与 `docs/figure_spec.md:13` 都是 **300 DPI**；`App.tsx:1638` 标签照错误示例写成 "150 DPI" | 中（规格自相矛盾，已误导 UI） |
| D4 | `docs/delivery_package_spec.md:37` 指定打包入口 `ops/09_package_delivery.ps1` | 该文件**不存在** | 中（交付链断） |
| D5 | §三.1"分片上传器支持 5MB 分片断点续传" | `upload.js:21` 是 4MB 分片且**无续传**（status 端点不被调用） | 中 |
| D6 | §三.3 自检五维（fs/storage/memory/isolation/link） | `index.js:819` isolation 灯硬编码 `line1_bulk`，line2/line3 无隔离扫描；温度与 7.5GB 水位缺（R6） | 中 |
| D7 | §二 `public_references/` 铁律"严禁从 line2 提取数据供 line3 反卷积" | 已按用户裁定维持跳过（反卷积不跑），非缺陷 | 记录在案 |

## 5. 整改顺序与我的决定（已拍板，直接干）

> 总决定：**不做框架重构**。框架的主体（云-端解耦、三线隔离、project.json 契约、
> 出图规范）是健康的；做"断链补齐 + 重叠收敛 + 历史清理"。

### A 批（无争议，我正在做/已派）
| # | 事项 | 目标文件 | 状态 |
|---|---|---|---|
| A1 | 修台账 8KB 静默截断 P0（stdin 传 + WROTE/bytes 双校验） | `server/run.js` | **S26 已派** |
| A2 | 修测试端口硬编码（18787 → freePort） | `tests/index.test.js` | **S26 已派** |
| A3 | 修 D3：`aims.txt:134` 示例 `png_150dpi` → `png_300dpi`，`App.tsx:1638` 标签同步 | `aims/aims.txt`、`src/App.tsx` | 随 S30 |
| A4 | 补客户交付报告工作台入口（R3） | `server/` 新 report 模块 + `index.js` + `App.tsx` | S27 排队 |
| A5 | 桥接四项断言接线（8787 提交层统一接，不动 58 脚本） | `server/task.js` + `ops/verify_bridge_checkpoint.py` 只读调用 | S28 排队 |
| A6 | 收敛守护机制（先加"统一入口说明"，归档需授权） | `ops/README.md` | S30 |
| A7 | TaskPanel 改造（步骤下拉/种子默认 20261013/路径预校验，R8/R9/R10） | `src/App.tsx` + `server/index.js` | S29 排队 |
| A8 | 上传白名单统一 + 断点续传（R5/2.3） | `server/upload.js` + `src/App.tsx` | S30 排队 |

### B 批（需你一句话授权，都是不可逆/涉规格）
- B1 删 `cn_debug/scenic_db/` 689MB + `subagent_*.log` + `ops/__pycache__`
- B2 归档 2.2 列的文件（移到 `_archive/`）
- B3 **黑名单 provenance**（29 条 vs aims 8 条）：保留扩充并写回规格，或收敛到 8 条
- B4 **portal 鉴权方案**：我的建议是 `PORTAL_TOKEN` 环境变量可选鉴权
  （设了才要求，不设维持现状，向后兼容）
- B5 **初始化 git**：让每次改动有原生回滚

### C 批（决定保持现状，记录理由）
- C1 跨线同名脚本**不抽公共库**（四组全已分叉；抽了违反三线硬隔离铁律）
- C2 `con_hf` 三个大台账**不拆**（跨会话恢复依据， handoff 超 500K 再拆）
- C3 `aims.txt` 主体**不改写**，只修 D3 这类事实性漂移（规格是契约不是日记）
- C4 出图规范五步主线**已收口**（三线 137 图全 PASS），不再追加判据

### 我建议的执行顺序（goal 模式自主推进）
S26（已派，P0）→ S27 交付报告入口 → S28 桥接接线 → S29 TaskPanel →
S30 杂项收敛（D3/白名单/续传/守护说明）→ B 批等你授权。

---

## 落地状态（2026-10-21 收口，以此为准）

A 批全部完成：A1/A2（S26）、A3（D3 事实性漂移已修：`aims/aims.txt:140` 为 `png_300dpi`，`src/App.tsx:1888` 写 300 DPI）、A4（S27 交付报告入口）、A5（S28 桥接四项断言接线）、A6（`ops/README.md` 收敛说明）、A7（S29 TaskPanel + `validateTaskPaths`）、A8（S30 白名单单一事实源 `shared/data_formats.mjs` + S32 断点续传）。

B 批：B4（portal `PORTAL_TOKEN` 可选鉴权，S31）与 B5（git 初始化）已完成；**B1/B2/B3 仍待用户授权**——B1 实测已无收益（`cn_debug/scenic_db` 与 `ops/__pycache__` 早已不存在，剩余可删约 0.36MB）；B2 未执行（`_archive/` 未建，待归档 7 个 ops 脚本 + `geo_mining_sop_v1.md` 约 50KB）；B3 口径差未裁。

C 批维持原判。D 批：D1 由提交层兜住（脚本内仍 0 调用）、D2 口径未定义（非缺陷）、D3 已修、D4 已作废并改由 8787 侧四道闸承担、D5 已实现（4MB 分片续传）、D6 已收敛（`server/selfcheck.js`：温度/内存/负载 + 三线逐线隔离 + 桥接存在性）、D7 维持跳过。

验证：`npm test` 382/382 pass、`npm run build` exit 0、`npx tsc --noEmit` exit 0。详见 `con_hf/handoff.md` 末条与 `con_hf/操作台账.md` 2026-10-21 条目。

