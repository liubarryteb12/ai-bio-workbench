# UI / 页面布局优化清单（第 64 轮取证，待 Argon 定优先级）

## 一、已取证的前端现状

| 面 | 规模 | 观察 |
|---|---|---|
| `BioanalysDesktop/src` | 13 个 tsx/css | `app.css` 1343 行；`OnboardingView.tsx` 1691 行为最大视图 |
| `portal` | 6 个文件 | `figure_catalog.css` 993 行，已有 27 个 CSS 变量 |
| 响应式 | 全站仅 **2 处 `@media`** | 都在 720px 断点，平板/窄屏覆盖薄 |
| 配色 | `app.css` **零 CSS 变量** | 14 个高频颜色字面量重复 100+ 次（#fff 29、#52606d 17、#b3261e 14） |
| 空/加载/错三态 | 仅 `ResultStudioView` 有锚点 | 其余 4 个视图 0 个 `data-testid` |
| `!important` | 0 | 干净，无需清理 |

## 二、已闭环的一个真实缺陷（本轮修）

`t35_empty_state_contract.test.js` 的 `VIEWS` 数组声明了 `ResultStudioView` 与
`FigureGalleryView` 两个视图，但**所有断言只测 `VIEWS[0]`**，`VIEWS[1]` 从未被引用。
这是明确的测试盲区。

而 `FigureGalleryView` 的三态逻辑本来就在（loading / failed / blocked / 空态），
只是全渲染成裸 `<p>`，**没有任何 `data-testid` 锚点**，E2E 只能靠文案猜。

修复：
1. 四态补 `data-testid`（loading-state / error-state / empty-state / blocked），
   并带 `data-empty-kind="figures"`、`data-error-kind="figures"|"blocked"` 归类；
2. `t35` 补 3 条断言真正覆盖 `VIEWS[1]`；
3. 新增「VIEWS 数组每个索引都必须出现在 `read(...)` 调用里」的元断言，
   防以后再加视图又留盲区（第一版用了 `||` 兜底会让断言恒真，已改掉）。

## 三、候选优化项（按性价比排序，待裁定）

### P1：`app.css` 引入 CSS 变量（低风险、收益明确）

14 个高频色抽成 `:root` 变量，1343 行里约 100+ 处替换。
收益：改主题只需改一处；与 `portal/figure_catalog.css` 已有的 27 变量风格对齐。
成本：需重建前端产物 + 便携包（`dist_parity` 门禁会盯），约 1 小时。
**注意**：这是纯样式等价替换，必须逐条核对色值不变，不能顺手改配色。

### P2：补齐其余视图的三态契约（低风险、可测）

`FigureGalleryView` 已修。剩余 `LedgerAuditView` / `OnboardingView` / `PiAgentView` /
`SelfCheckAdminView` 四个视图仍是 0 锚点。
成本：每个约 15 分钟，可复用 `t35` 的元断言逐个纳入。

### P3：`OnboardingView.tsx` 1691 行拆分（中风险）

上一轮已抽出 `GroupDesignPanel.tsx`（177 行）与 `OnboardingDisplayParts.tsx`（48 行），
主文件仍 1691 行。可继续按「四段式 manifest 的每一段」抽组件。
风险：这个文件是建项主链路，改动面大，需要逐个垂直切块先红后绿。

### P4：响应式补强（中风险）

全站仅 2 处 `@media (max-width: 720px)`。若目标包含手机/平板预览，
需要补中间断点（如 1024px）与横向滚动容器的处理。
**需先确认**：工作台是否真的需要移动端支持？若只跑桌面大屏，这项没价值。

### P5：配色美化（主观性最强）

「美化」本身没有客观判据。建议先做 P1 的变量化打底，再挑 1-2 个视图做视觉对比
（截图前后），由你或 Argon 目视裁定，不要一次性全站改色。

## 四、需要 Argon 裁定的问题

1. `app.css` 变量化（P1）做不做？它触及构建产物，是否值得为此重建便携包？
2. 工作台是否要求移动端 / 平板（决定 P4 有无价值）？
3. `OnboardingView` 1691 行是否继续拆（P3），还是保持现状只做 P2 的三态契约？
4. 「美化」的验收口径是什么？我建议以「变量化打底 + 前后截图目视确认」为准，
   不设自动化视觉判据（机器判不了好不好看）。

我的默认建议：**P1 + P2**，两者都是低风险、有明确判据、能进门禁的改进；
P3/P4/P5 等上面四个问题定了再动。
