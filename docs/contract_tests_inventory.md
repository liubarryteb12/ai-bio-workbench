# server 模块契约测试清册

这份文件回答一个问题：`BioanalysDesktop/server/` 下 45 个模块里，哪些有**独立的契约测试**，
各自钉住什么。测试文件头注释只解释单个模块，跨模块的覆盖全景此前无处可查，所以单独落一份。

## 已覆盖

| 模块 | 测试文件 | 条数 | 变异 | 钉住的契约 |
|---|---|---|---|---|
| `domain.js` | `domain_contract.test.js` | 12 | 3 | 三线枚举闭合、目录根都在 SSD_ROOT 下、非法 projectId 返回 null 而非抛错 |
| `figure_graph.js` | `figure_graph_contract.test.js` | 13 | 6 | produces 与 input_tables 的匹配、语言亲和性、跨线/跨项目守卫、影响面阈值、ready 才可派发 |
| `static_assets.js` | `static_assets_contract.test.js` | 8 | 4 | 只服务 dist 内文件（含 %2E%2E 编码穿越）、MIME 与安全头 |
| `portal_inbox.js` | `portal_inbox_contract.test.js` | 8 | 3 | 收件箱名单字符类、两种在册目录形态、坏 JSON 不连坐同目录条目 |
| `remote_exec.js` | `remote_exec_contract.test.js` | 7 | 3 | ssh 目标固定 k40-ubuntu（零算力红线）、单层 ls、噪声行只删行首两类 |
| `sinks.js` + `http_response.js` | `sinks_and_http_contract.test.js` | 10 | 6 | SSE 帧格式、单 sink 抛错不连坐、JSON 响应头固定、no-store |
| `a2a_state.js` + `query_views.js` | `a2a_query_contract.test.js` | 17 | 8 | TASK_STATE_ 前缀归一化、终结态集合、项目参数越界回 null、本地副本优先于远端 |
| `routes/diagnostics.routes.js` | `diagnostics_routes_contract.test.js` | 15 | 7 | 命中必须显式 return true、五盏灯与 all_pass 的等价、探测抛错落 unknown、台账不可达报阻塞、数据面树的三级 400 |
| `portal_page.js` | `portal_page_contract.test.js` | 8 | 6 | 客户端字段进 HTML 前必须转义、URL 三段参数必须编码、阻塞段与空段各有可读原因 |

合计 9 个文件覆盖 11 个模块、98 条断言、46 次变异。

## 三条方法论

1. **先探针实测再写断言，实现是真源。** 按想象写会得到「测试红了但代码是对的」，
   比不写更糟：它会把正确实现改坏。`domain.js` 那轮三处差异（非法值返回 `''` 而不是 `null` 等）
   全部是改测试而不是改实现。
2. **变异必须能证明自己生效。** 用 node 的 `split/join` 替换并校验 `broken !== original`，
   否则一次静默未命中的替换会被误读成「测试太弱」。PowerShell 的 `-replace` 就踩过这个坑。
3. **行为断言抓不到的冗余守卫，用结构断言钉住并在注释里写明它是纵深第二层。**
   `static_assets` 的包含性校验与 `portal_inbox` 的反斜杠检查当前都无独立输入可触发，
   诚实记录「删掉它行为不变」，比假装被行为测试覆盖更可信。

## 两个会伪造绿灯的坑

- mock `res` 必须是真 `Writable`：非流对象时 `pipe()` 同步抛错、被实现的 catch 吞掉后走 404 分支，
  表现为「合法文件也 404」。
- 顺序比较 `indexOf` 抓不到 `if (false && local)` 这类行为变异：必须断言代码结构本身。

## 边界

本清册只覆盖 `BioanalysDesktop/server/` 模块。`ops/` 下的生成与验收脚本、前端 `src/`，
它们的守门在各自的自检、静态门禁与 e2e 里，不在本文件范围内。
