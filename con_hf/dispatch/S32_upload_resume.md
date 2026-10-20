# S32 派发单：上传断点续传 + 规格漂移 D5 收敛

日期：2026-10-21　切片：S32　来源：con_hf/architecture_review_2026-10-20.md 的 A8 + 规格漂移 D5

## 一、背景与真实缺口

架构评审 D5 记录：`aims/` 需求侧称"5MB 分片 + 断点续传"，实测两端都不是这样：

- `BioanalysDesktop/server/upload.js`：`CHUNK_SIZE = 4 * 1024 * 1024`（4MB），分片写入 `writeChunk`，**没有任何续传能力**；
- `BioanalysDesktop/src/App.tsx` 的上传面板：每次提交都**从 chunk 0 重新开始**，中断后必须整包重传（单细胞 RAW tar 常见 1-3GB，手机热点下这是真实痛点）；
- 工作台侧**没有**"查询已上传分片"的端点（`grep -n "api/uploads\|uploads/status" server/index.js` 无命中）。

结论：不是"文档写错了"，而是"断点续传这半个功能从来没实现过"。本切片要把它补上，并把文档口径改回真实值。

## 二、硬约束（违反即返工）

1. **不许真连 K40 / 不许跑远端写命令**。上传只写本地 `.uploads/` 暂存目录，本切片所有验证都在本机完成。
2. **不许改 `CHUNK_SIZE` 的语义**：保持 4MB，只补续传；不要为了迁就文档改成 5MB（既有测试与前端常量都按 4MB 断言）。
3. **不许动 S28/S29 已接线的东西**：`/api/tasks/submit` 的 `validateTaskPaths` 接线、S28 桥接检查块，一个字都不改。若 `server/index.js` 有冲突，只在你新增的 handler 区域动。
4. 前端不许引入新依赖；`npm run build` 必须过（`npx tsc --noEmit` 也要过）。
5. 换行 LF、中文注释不用 em dash、Linux 侧路径全英文（`docs/coding-standards.md`）。

## 三、要交付的四件事

### 1. 服务端：分片状态查询（只读）

`server/upload.js` 已有 `listChunks(uploadId)`、`initUpload`、`writeChunk`、`assembleChunks`、`cleanupUpload`。补一个可被 HTTP 复用的纯函数（导出，便于单测）：

```js
/** 返回该 uploadId 已落盘的分片序号（升序）与是否可续传 */
export function uploadStatus(uploadId)
// → { ok: true, uploadId, chunks: [0,1,2], nextIndex: 3, receivedBytes, chunkSize }
// 目录不存在 → { ok: false, reason: 'not_found', chunks: [] }
```

判定必须严格：`uploadId` 走 `sanitizeFilename` 同款消毒，禁止路径穿越；分片文件名解析不出序号就忽略（不要因为一个脏文件让整个续传判定炸掉）。

### 2. 服务端：新增 GET 端点

在 `server/index.js` 里新增（放在现有 `/api/upload/chunk` 附近，风格照抄相邻 handler）：

```
GET /api/upload/status?uploadId=<id>
→ 200 { ok: true, uploadId, chunks: [...], nextIndex, receivedBytes, chunkSize }
→ 400 { ok: false, error }   // uploadId 缺失/非法
→ 200 { ok: false, reason: 'not_found', chunks: [] }  // 没传过（前端据此从 0 开始）
```

### 3. 前端：上传面板真的会续传

`src/App.tsx` 的上传面板（现约 :3046-3130 区域，用 `grep -n "upload/chunk" src/App.tsx` 定位）：
- 选文件后、发第一个分片前，先 `GET /api/upload/status?uploadId=...`；
- 若 `nextIndex > 0`，从 `nextIndex` 开始传，并在 UI 上明示"已从第 N 片续传（共 M 片）"；
- 断网/失败重试按钮复用同一逻辑（不重置到 0）；
- 全部传完后才调 assemble，行为不变；
- 文案不要夸大：没说"支持任意时刻断点"就别写。

### 4. 文档口径收敛（D5）

- `grep -rn "5MB\|5 MB\|断点续传" aims/ docs/` 找出所有相关表述；
- 把"5MB 分片"改成"4MB 分片"；把"断点续传"从"规划/未实现"改成"已实现（GET /api/upload/status 查询已落盘分片，前端从 nextIndex 续传）"；
- **只改这几句，不要重写 aims 主体**（架构评审 C3：aims 主体不改写）。

## 四、测试（必须新增，不许只跑不写）

新建 `tests/upload_resume.test.js`，至少覆盖：

1. `uploadStatus` 纯函数：空目录 / 连续三片 / 有空洞（0,1,3 → nextIndex 仍按最小缺失算，或按连续性明确给出实现口径，二选一并写进注释与断言）/ 脏文件名 / 路径穿越 uploadId；
2. `GET /api/upload/status` 真 HTTP：not_found、正常续传、非法 uploadId 400；
3. 端到端（本地）：init → writeChunk 0,1 → 查 status 得 nextIndex=2 → 补 2 → assemble 成功且字节数正确；
4. 前端续传判定的纯逻辑如果抽得出来就抽出来测；抽不出来就在报告里说明"仅靠 tsc + 人工核对"，不要假装测过。

## 五、验证与收尾

- `cd BioanalysDesktop; npm test` → 必须 `fail 0`（当前基线 **346 通过**，你的新增只增不减）；
- `npx tsc --noEmit` → exit 0；
- `npm run build` → exit 0；
- 报告落 `con_hf/dispatch/S32_report.md`，章节序照 `con_hf/dispatch/S29_report.md`；
- 完成后把共享任务 `task-4` 标 complete（先 `team_task_get` 拿 revision，再 `team_task_update` action=claim → 做完 action=complete）。

## 六、写范围（不要越界）

- 允许写：`BioanalysDesktop/server/upload.js`、`BioanalysDesktop/server/index.js`（只新增 handler 区域）、`BioanalysDesktop/src/App.tsx`（只上传面板区域）、`BioanalysDesktop/tests/upload_resume.test.js`、`con_hf/dispatch/S32_report.md`、以及第 4 条点名的文档那几行。
- 禁止写：`portal/`、`shared/`、`server/report.js`、`server/task.js`、`server/run.js`、`ops/`、其他测试文件。
- 禁止：git 提交、删文件、装包、连远端。
