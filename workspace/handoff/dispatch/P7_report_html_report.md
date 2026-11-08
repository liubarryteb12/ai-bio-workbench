# P7 报告：出版级 HTML 报告渲染器（ops/render_report_html.py）

- 日期：2026-10-21
- 执行者：队友 audit-probe
- 任务：aims v2.5 §七.3 双模态交付（Markdown 主件 + 单文件 HTML 出版版）
- 状态：切片完成，全部新增测试通过；全量测试仅剩 1 条既有红灯（与本切片无关）

## 一、交付物

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `ops/render_report_html.py` | 33440 字节 | 单文件渲染器，纯标准库，无第三方依赖 |
| `BioanalysDesktop/tests/report_html.test.js` | 16073 字节 | 23 条 node:test 用例，python 子进程 + 临时目录 fixture |

两文件均为 LF 换行（实测 CR 计数 0）、无 em dash（实测 U+2014 计数 0）。未改动 `ops/build_client_report.py`、`BioanalysDesktop/server/**` 及任何其它源码。

## 二、命令行契约

```text
python ops/render_report_html.py --delivery-dir <目录> [--out <文件>] [--title <标题>]
python ops/render_report_html.py --self-test
python ops/render_report_html.py --version
```

- 输入：`<delivery-dir>/delivery_manifest.json` 与 `<delivery-dir>/Analysis_Report.md`
- 输出：默认 `<delivery-dir>/Analysis_Report.html`
- 退出码：0 成功；2 参数错或输入缺失/非法（目录不存在、缺清单、清单不是合法 JSON、清单顶层不是对象、缺 Markdown、Markdown 只有空白、写盘失败）；1 自校验失败

## 三、渲染能力

1. 零外链：CSS 全部内联在 `<style>` 里，产物不含 `<link>`、`<script src>`、`url(...)`、`@import`、`<img>`、`<iframe>`、`<object>`、`<embed>`、`<source>`，可离线双击打开、可直接邮件发送。
2. 中文优先字体栈：`"Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", system-ui`，代码块用等宽栈。
3. 版式：正文最大宽度 860px 居中、行高 1.75、表格斑马纹（`tbody tr:nth-child(even)`）+ 表头浅底 + 窄屏横向滚动、代码块浅底等宽、引用块左边框、标题分级字号。
4. 打印友好：`@media print` 内收窄页边距、`break-inside: avoid` 防表格/代码块被切断、`thead { display: table-header-group }` 让长表跨页重复表头、隐藏返回顶部等交互元素。
5. 自动目录：按正文 h2 生成 `<nav id="toc">`，锚点为 `sec-<slug>`（中文保留、重名自动去重），目录链接与 h2 id 严格一一对应。
6. 页脚：写明渲染时间与渲染器版本（`render_report_html.py 1.0.0`），页头写项目 ID、项目名、清单版本、报告生成时间。
7. 安全：Markdown 全量 `html.escape`，原始 HTML 一律当文本显示；链接只放行 `http(s)` 与 `mailto`，其余协议（含 `javascript:`、`data:`、`file:`）降级为纯文本；`http(s)` 链接补 `rel="noopener noreferrer"`。
8. 支持的 Markdown 语法：标题 1-6、段落、有序/无序列表、表格（含 `:---:` 对齐与 `\|` 转义）、围栏代码块（带 language 类）、行内代码、粗体、斜体、链接、引用块、分隔线。

## 四、两处刻意的行为约定（与 build_client_report 产物配合）

1. **Markdown 自带的「目录」段整段丢弃**。`build_client_report.py` 生成的 `Analysis_Report.md` 里有一节 `## 目录` 加一串 `[第一章](#第一章-...)` 链接，而本渲染器按 h2 重新生成目录、锚点前缀是 `sec-`，两者锚点规则不同，保留原文目录只会多出一组死链。因此识别「标题文本为 目录 / 目 录 / Contents / Table of Contents，且紧随其后是过半条目含链接的列表」的段落并整段跳过。实测真实报告 `deliverables/PRJ_E2E_GSE277173/Analysis_Report.md` 的 8 个 h2 里，「目录」被丢弃，正文 7 章 + 7 条目录锚点，死链 0。
2. **首个 h1 由页头承载**。若 Markdown 首个 h1 与标题（`--title` 或清单 project_name）不同，则把它渲染成页头下方的副标题 `.doc-subtitle`，正文不重复；其余 h1 降为 h2 以维持单一目录层级。

## 五、测试

### 5.1 脚本内建自检（`--self-test`）

30 条用例，全部 PASS，exit 0。覆盖：缺清单/缺 md/空 md 抛 InputError、合法输入可读出、中文不乱码、行内代码/粗体/斜体、链接白名单（https 保留、javascript 降级、mailto 保留）、表格 thead/tbody 与对齐、代码块 language 类、目录锚点与 h2 对应、首个 h1 不重复、副标题逻辑、Markdown 自带目录段被丢弃、原文死锚点不出现、产物零外链、含 style 与 toc。

### 5.2 JS 集成测试（`BioanalysDesktop/tests/report_html.test.js`）

23 条，实测 `node --test tests/report_html.test.js` 为 tests 23 / pass 23 / fail 0。分组：

- 正常路径：exit 0、产物非空含 doctype/style/目录锚点；清单字段进页头；`--out` 自定义路径生效且默认路径不生成
- 安全：`<script>alert(1)</script>` 与 `<img src=x onerror=...>` 均渲染为文本；`javascript:` 降级、`mailto` 保留；文内锚点链接降级为纯文本
- 版式：表格 thead/tbody/斑马纹/右对齐；代码块 language 类与原文保真；`@media print` 存在；页脚含生成时间与脚本版本
- 目录：锚点与 h2 id 一一对应（deepEqual）；Markdown 自带目录段被丢弃且无死锚点
- 退出码：缺清单、缺 md、空白 md、目录不存在、清单非 JSON 均为 exit 2；`--version` 打印 1.0.0；`--self-test` exit 0
- 编码：产物 UTF-8 声明齐备、LF 换行（buffer 里 CR 计数 0）、中文不乱码

### 5.3 全量回归

`cd BioanalysDesktop; npm test` 实测 **tests 580 / pass 579 / fail 1 / cancelled 0 / skipped 0**，exit 1。唯一失败项：

```text
✖ §八 五本台账的物理落点全部存在（新章不能只是文字）
  AssertionError [ERR_ASSERTION]: §八 点名的台账不存在：con_hf/SPEC_DECISIONS.md
  at tests\aims_drift_guard.test.js:184:12
```

该失败是任务下发时已知的 2 条红灯之一（`con_hf/SPEC_DECISIONS.md` 尚未建立），与本切片无关；本切片新增的 23 条全绿。测试条数从基线 492 增至 580（含队友并发新增的用例）。

## 六、真实数据冒烟

`deliverables/PRJ_E2E_GSE277173/Analysis_Report.md`（34296 字节，来自既有 E2E 交付，目录里没有 delivery_manifest.json）复制到临时目录并自造清单后渲染：

```text
已渲染: <临时目录>\Analysis_Report.html（52836 字节，7 个二级章节，来源 Analysis_Report.md）
exit=0
bytes=52836 body_h2=7 toc=7 table=10 pre=12 link=0 imgtag=0 deadfrag=0
```

即真实报告里的 10 张表格、12 个代码块、7 个章节全部正确渲染，零外链、零死锚点。

## 七、遗留风险与后续建议

1. **尚未接入交付链路**：`server/report.js` 的 `pullDeliverables` 之后没有调用本渲染器，HTML 目前要手动跑一条命令生成。建议下一步在报告构建收尾处加一次调用（失败不阻断，记日志），并把 `Analysis_Report.html` 纳入交付包清单与 sha256 边车。
2. **清单缺失即失败**：真实 E2E 交付目录当前没有 `delivery_manifest.json`，渲染前必须先由上游产出。若上游允许无清单交付，需要 Lead 决策是否放宽为「缺清单用默认值继续」（当前按任务要求是 exit 2）。
3. **Markdown 语法白名单之外的写法会降级**：嵌套列表、任务列表、脚注、表格内多行、HTML 块、图片（`![]()`）都不支持，图片语法会按链接文字降级成纯文本。这是刻意的（零外链要求），但如果后续报告要插图，需要另设计内嵌 base64 的方案。
4. **深色模式未做**：当前只有浅色版式；打印样式已适配。
5. **大文件性能未压测**：真实报告 34KB 渲染瞬时完成；未见 MB 级报告的实测数据。

## 八、复现命令

```powershell
cd D:\00.AIagent\codespace\AI辅助生信分析流程工作台
$env:PYTHONIOENCODING='utf-8'
python ops/render_report_html.py --self-test          # 30 条，exit 0
python ops/render_report_html.py --version            # render_report_html.py 1.0.0
cd BioanalysDesktop
node --test tests/report_html.test.js                  # tests 23 / pass 23 / fail 0
npm test                                              # tests 580 / pass 579 / fail 1（已知红）
```
