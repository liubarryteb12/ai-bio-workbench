# 架构裁定与变更台账（SPEC_DECISIONS）

> 物理落点：本文件（aims §八 台账②）。记录所有触及 aims 条款或跨模块契约的裁定。
> 纪律：任何触及 aims.txt 条款或跨模块契约的变更，先在本文件立项，再改代码，再改断言。
> 编号连续，不回收不复用。新增追加到末尾。禁止删除历史裁定（推翻旧裁定用「取代 D-XX」表述）。

字段顺序固定：编号 / 日期 / 问题背景与冲突点 / 备选方案对比 / 最终拍板结论 / 受影响条款 / 同步修改文件清单 / 验证测试名。

---

## D-01 跨线同名脚本不抽公共库（接受四组分叉）

- **日期**：2026-10-20
- **问题背景与冲突点**：line1/line2/line3 存在四组同名脚本（enrichment、enrichment_figures、dr_post_analysis、normalize_hvg），代码相似度高，直觉上应抽公共库。但三线物理隔离是铁律，公共库会让一条线的改动同时影响另外两条线。
- **备选方案对比**：① 抽 src/common/ 公共库：省重复代码，但破坏物理隔离，且任一线路需求变化都要改共享文件（回归面扩大三倍）；② 保持分叉：代码重复，但每条线可独立演进、独立回归。
- **最终拍板结论**：保持分叉。已实测的分叉规模：enrichment 196 行 vs 289 行、enrichment_figures 331 vs 343、dr_post_analysis 497 vs 442、normalize_hvg 198 vs 256，差异已达语义级（不是格式差异），抽库必然引入条件分支。
- **受影响条款**：§一.2 铁律 2（三线物理与逻辑硬隔离）、§四 三线母版。
- **同步修改文件清单**：无代码改动（决定保持现状）；con_hf/architecture_review_2026-10-20.md 记录 C1 结论。
- **验证测试名**：tests/bridge_guard_invariant.test.js（三线母版不许跨线 import）、tests/consistency.test.js。

## D-02 不做框架重构，只做断链补齐 / 重叠收敛 / 历史清理

- **日期**：2026-10-20
- **问题背景与冲突点**：用户原话「工作台越做越臃肿、功能越做越烦，框架没想象中好、效率没想象高」，倾向重构。评审实测结论是架构没坏，臃肿来自门户（portal 8080）、工作台（8787）、运维三套系统各自实现了一遍守护、日志检查、链接检查。
- **备选方案对比**：① 框架重构（拆分服务、统一内核）：工期不可控，且当前 M1 阻塞未清零，重构会把已 PASS 的 137 张图与 296 条测试基线全部置于风险中；② 只做 A 批（断链补齐，无争议）+ B 批（不可逆清理，需授权）+ C 批（决定保持），重叠逻辑用「单一事实源 + 编译期注入」收敛而非重构。
- **最终拍板结论**：选 ②。A 批直接干；B 批列出清单等用户一句话授权；C 批写进本台账不再讨论。
- **受影响条款**：全篇工程纪律（§八）。
- **同步修改文件清单**：con_hf/architecture_review_2026-10-20.md、con_hf/handoff.md。
- **验证测试名**：tests/aims_drift_guard.test.js（条款与落点不得漂移）。

## D-03 桥接四项断言改为阶段感知（--stage post-dimred / pre-dimred）

- **日期**：2026-10-21
- **问题背景与冲突点**：verify_bridge_checkpoint.py 第 4 项要求 h5ad 必须带 X_pca / X_umap / spatial，但 gsva_pathways 消费的是降维前的归一化矩阵（scrna_norm.h5ad），天然没有这些 obsm，导致合法输入被判 fail；若为此放宽断言，又会让真正缺失降维结果的矩阵蒙混过关。
- **备选方案对比**：① 直接删掉第 4 项断言：A 面（真缺降维）失去保护；② 方案 B「阶段感知」为主 + 方案 A「母版改造」为辅：引擎加 --stage，pre-dimred 阶段把该项降级为 [BRIDGE WARN] 并放行，post-dimred 阶段维持硬失败；同时 gsva_pathways 优先消费 00_sc_harmony.h5ad（有 obsm，走 post-dimred 硬断言），文件不存在才回落 scrna_norm.h5ad 并同步降级 stage。
- **最终拍板结论**：选 ②。守卫侧同样加 --stage（默认 post-dimred，非法值打印 [BRIDGE SKIP] 到 stderr 并 exit 0，不让守卫本身成为阻塞），R/Python 双引擎共用同一口径。
- **受影响条款**：§一.2 铁律 3、§三.2 三道闸 ③。
- **同步修改文件清单**：ops/verify_bridge_checkpoint.py（--stage argparse、warn()、check_h5ad/check_rds 分支）、src/bridge_guard.sh（--stage 透传）、src/line2_scrna/scripts/gsva_pathways（输入源解析 + BRIDGE_STAGE + BIO_GSVA_NORM 传参）、BioanalysDesktop/tests/bridge_stage.test.js（新建）。
- **验证测试名**：tests/bridge_stage.test.js（11 条，含真跑 anndata fixture 与 bash 真跑解析块）、tests/bridge_guard_invariant.test.js。

## D-04 守卫双落点 + 母版候选路径解析（部署布局与仓库布局不同）

- **日期**：2026-10-21
- **问题背景与冲突点**：母版在仓库里位于 src/<线>/scripts/<step>，相对路径 ../../bridge_guard.sh 指向 src/bridge_guard.sh；但真机部署后母版在 /mnt/ssd/bio_data/bin/<线>/<step>（task.js 的 binDir 进 PATH），同一相对路径解析成 /mnt/ssd/bio_data/bridge_guard.sh，守卫根本不在那里，等于部署后守卫静默失效。
- **备选方案对比**：① 只改部署目录结构：要动 bin/ 布局与 PATH 契约，影响面大；② 双落点 + 候选解析：src/bridge_guard.sh 作为仓库唯一正本，同步脚本额外镜像一份到远端 ops/bridge_guard.sh；母版按候选列表（相对路径 → /mnt/ssd/bio_data/ops/bridge_guard.sh → /mnt/ssd/bio_data/bridge_guard.sh）解析，全找不到时打印 [BRIDGE SKIP] 放行并留痕。
- **最终拍板结论**：选 ②。理由：守卫是「保护性设施」，它的缺失不该让分析母版跑不起来（那会把保护变成故障源）；但必须留痕，便于运维发现漏部署。
- **受影响条款**：§一.2 铁律 3、§六 本地与远端原子同步。
- **同步修改文件清单**：src/line2_scrna/scripts/gsva_pathways（候选路径循环）、ops/sync_and_verify_remote.ps1（第 5.5 步镜像部署 + 哈希校验）、con_hf/ops_ledger.md（自动追加）。
- **验证测试名**：tests/bridge_stage.test.js（gsva 守卫候选路径静态断言）。

## D-05 上传白名单单一事实源 + 门户编译期注入（禁止三份手抄）

- **日期**：2026-10-21
- **问题背景与冲突点**：14 类扩展名与 5GiB 上限在 shared/data_formats.mjs、portal/lib/archive.mjs、portal/index.html 三处各写一份，改一处漏两处的风险已经实际发生（历史上出现过 9 项 vs 14 项不一致）。
- **备选方案对比**：① 门户改为构建期打包：需要给 portal 引入构建链，与「单文件 index.html 双击可用」的离线交付定位冲突；② 服务端注入 + 字面量回落：portal/serve.mjs 只读 import 权威值，注入到 HTML 的 JSON 块，页面脚本命中注入就覆盖本地副本，未命中（离线双击）回落字面量，parity 测试继续钉住字面量副本与权威值一致。
- **最终拍板结论**：选 ②。注入走 scriptSafeJson（转义 < 与 U+2028/2029），注入失败不影响页面可用性。
- **受影响条款**：§三.1 模块 B。
- **同步修改文件清单**：portal/serve.mjs（sharedContractsPayload / scriptSafeJson / injectSharedContracts）、portal/index.html（注入锚点 + #region P5 shared contracts 覆盖段）、BioanalysDesktop/tests/portal_inject.test.js（新建 16 条）。
- **验证测试名**：tests/portal_inject.test.js、tests/data_format_parity.test.js、tests/tumor_blacklist_parity.test.js。
- **已知边界**：注入的 MAX_DATA_BYTES 取 shared 默认值，不感知 portal/lib/archive.mjs 的 PORTAL_MAX_DATA_BYTES 环境变量覆盖；运维若改过该 env，页面提示与服务端校验会不一致（待后续收敛）。

## D-06 上传会话额度用 reservedBytes 硬预留，413 与 507 分属两级

- **日期**：2026-10-21
- **问题背景与冲突点**：客户端在 init 时声明 fileSize，但服务端此前只按实际落盘字节算配额，等于「声明 20GiB 也先放进来」，全局配额耗尽时其它会话被饿死；同时缺会话级闸门，单片超限只能靠最终 assemble 失败。
- **备选方案对比**：① 只做全局配额：简单，但恶意/误操作会话可长期占坑；② 会话预留 + 两级错误码：init 落 session.json 记录 reservedBytes（写 tmp 再 rename，原子），chunk 写盘前依次过 400（参数）/ 413（会话额度）/ 507（全局配额），complete 成功后显式清元数据。
- **最终拍板结论**：选 ②。顺序固定，不允许调换（400 是调用方错误，413 是会话越界，507 是系统容量，混用会让前端无法正确提示）。
- **受影响条款**：§三.1 模块 B。
- **同步修改文件清单**：BioanalysDesktop/server/upload.js（normalizeReservedBytes / writeSessionMeta / readSessionMeta / checkReservedBytes / checkChunkAdmission）、BioanalysDesktop/server/index.js（init 落元数据 + chunk 闸门 + complete 清理）、tests/upload_reserve.test.js（新建 23 条）。
- **验证测试名**：tests/upload_reserve.test.js、tests/upload_quota.test.js。
- **已知边界**：额度是客户端声明值，不报 fileSize 则只有全局 507 兜底（兼容老客户端）；checkChunkAdmission 与 writeChunk 之间非原子，同一 uploadId 并发两片理论上可各自通过检查。

## D-07 自检第 4 维 SHA256 口径：不一致 fail / 缺失 warn / 不可达 unknown

- **日期**：2026-10-21
- **问题背景与冲突点**：aims §三.3 第 4 维要求「比对本地与远端 bridge_guard.sh 及核心母版的 SHA256，不一致即判 warn/fail」，但实现只有隔离门禁与桥接在位检查，属规格漂移。难点在远端不可达时的判定：若判 fail，一次网络抖动就会让整个自检全红，值班会失去对红灯的信任。
- **备选方案对比**：① 不可达判 fail：信号强但噪声大；② 沿用「远端输出缺 END 一律 unknown」的既有口径：不可达判 unknown，守卫哈希不一致判 fail，守卫缺失判 warn。
- **最终拍板结论**：选 ②。理由：unknown 语义就是「这次没测出来」，与 fail「测出来是坏的」必须区分，否则四档状态形同虚设。
- **受影响条款**：§三.3 第 4 维。
- **同步修改文件清单**：BioanalysDesktop/server/selfcheck.js（第 4 维新增 sha256 比对）、tests/selfcheck_sha256.test.js（新建）。
- **验证测试名**：tests/selfcheck_sha256.test.js、tests/selfcheck.test.js。

## D-08 server/proc.js 必须用默认导入 child_process（测试垫片可拦截）

- **日期**：2026-10-21
- **问题背景与冲突点**：P4 切片写 HTTP 级 complete 用例时用 mock.method(childProcess, spawn|spawnSync) 想拦住 scp/ssh，实际拦不住：server/proc.js 用具名导入 import { spawn, spawnSync }，具名绑定在链接期固化，改 module.exports 属性无效。结果测试真连 K40，往 raw_data 写了两个探针文件。
- **备选方案对比**：① 测试改成不触网的目录级用例（回避）：留下同款隐患，另外 5 个测试文件用同一套失效垫片，只是恰好没走到 scp/ssh；② 接缝改默认导入 + 属性调用：一处改动让全部垫片真生效。
- **最终拍板结论**：选 ②，并作为铁律写进本台账：凡是可被测试替换的接缝，一律默认导入 + 属性调用，禁止具名导入外部可变依赖。
- **受影响条款**：§八.2 文件域写隔离与契约冲突升级（接缝属共享契约）。
- **同步修改文件清单**：BioanalysDesktop/server/proc.js（import childProcess from node:child_process，调用改 childProcess.spawn / childProcess.spawnSync）、tests/sync_script_guard.test.js（新建静态断言防回归）。
- **验证测试名**：tests/sync_script_guard.test.js、tests/upload_reserve.test.js（改用不触网用例）。

## D-09 同步脚本三条硬规矩：printf 喂 xargs、传完归一化权限、过滤 ssh Warning

- **日期**：2026-10-21
- **问题背景与冲突点**：ops/sync_and_verify_remote.ps1 首次真跑连踩三坑：① 把单引号路径串直接管道给 xargs sha256sum，shell 会去执行这些脚本（bridge_guard.sh 报 Permission denied、run_throttled_task.sh 被无参执行）；② scp 不带 -p，落盘 0644，母版按名字直接调用 ops 脚本时 Permission denied；③ ssh 的 known_hosts 提示走 stderr，2>&1 后混进输出，把「按行首锚定」的哈希正则顶掉，导致 18 个文件全判「远端无回读」。
- **备选方案对比**：① 三处分别打补丁；② 立三条硬规矩并加静态断言：路径清单必须先 printf 再管道；scp 之后按后缀 chmod（.sh 755 / 其余 644）；Invoke-Remote 统一过滤 Warning 行。
- **最终拍板结论**：选 ②。第 ③ 条特别重要：解析远端输出时永远不能假设输出干净（与踩坑台账 #90 同源）。
- **受影响条款**：§六 本地与远端原子同步、§八.3 防漂移。
- **同步修改文件清单**：ops/sync_and_verify_remote.ps1、tests/sync_script_guard.test.js（新建静态断言）。
- **验证测试名**：tests/sync_script_guard.test.js；真跑证据见 con_hf/ops_ledger.md 最后一行（18/18 一致、镜像 1/1 一致、exit 0）。

## D-10 反卷积按用户裁定跳过（D7）

- **日期**：2026-10-20
- **问题背景与冲突点**：line3 空间转录组反卷积（cell2location / RCTD 类）在 7.5GB 内存墙下不可行，评审曾建议改 CIBERSORTx 或跳过。
- **备选方案对比**：① 换轻量算法（RCTD 仍需参考矩阵，内存不可控）；② 跳过并在交付物中如实披露缺失项。
- **最终拍板结论**：按用户裁定跳过，交付报告必须披露该步骤未做，禁止用替代指标冒充。
- **受影响条款**：§四 三线母版（line3 步骤清单）。
- **同步修改文件清单**：aims/aims.txt（§四 步骤清单标注跳过）。
- **验证测试名**：tests/aims_drift_guard.test.js（条款与落点一致）。

## D-11 HTML 交付报告渲染器定位：离线单文件、纯标准库、不并入 build_client_report.py

- **日期**：2026-10-21
- **问题背景与冲突点**：交付物此前只有 Markdown 与 PDF 链路，客户拿到 md 体验差；但 build_client_report.py 已 117KB 且承担清单与校验和职责，把渲染塞进去会让单一职责崩掉。
- **备选方案对比**：① 并入 build_client_report.py：少一个文件，但巨型脚本继续膨胀且渲染失败会拖垮交付主链；② 独立 ops/render_report_html.py：单文件、纯标准库、--self-test 自检、退出码 0/2/1 与母版规范一致，由交付链按需调用。
- **最终拍板结论**：选 ②。渲染器只消费 delivery 目录（Analysis_Report.md + delivery_manifest.json），不反向写清单；是否接入 pullDeliverables 之后由交付链决定，接入时必须把 Analysis_Report.html 纳入清单并生成 sha256 边车。
- **受影响条款**：§三.4 交付门禁、§五 出图规范（PDF/HTML 呈现一致性）。
- **同步修改文件清单**：ops/render_report_html.py（新建）、tests/report_html.test.js（新建 23 条）。
- **验证测试名**：tests/report_html.test.js；自检 python ops/render_report_html.py --self-test 30 条 PASS。
- **已知边界**：语法白名单外的元素（图片、嵌套列表、任务列表、脚注、HTML 块）降级为纯文本；仅浅色版式。
- **补充核查（2026-10-21，本次）**：交付主链并没有断。ops/build_client_report.py:1901 已经生成 Analysis_Report.html，BioanalysDesktop/server/report.js:69 的 DELIVERABLE_NAME_PATTERNS 与 :224-228 的 pullDeliverables 把 html 列为必需件（缺了就报「远端交付件缺失」）。因此 render_report_html.py 的定位是**离线兜底与预览工具**，不并入主链，避免两套渲染器同时写同名文件互相覆盖。

## D-12 出图规范冻结：不再新增判据（C4）

- **日期**：2026-10-20
- **问题背景与冲突点**：docs/figure_spec.md 已有 15 条判据 + 4 个工具 + 负对照，137 张图三线全 PASS，是全项目最完整子系统；继续加判据会不断触发存量图返工。
- **备选方案对比**：① 继续加判据：边际收益递减、返工成本上升；② 冻结判据，只允许在真实客户投诉或数据错误时例外立项。
- **最终拍板结论**：选 ②，例外必须先在 SPEC_DECISIONS 立项。
- **受影响条款**：§五 出图规范。
- **同步修改文件清单**：无（保持现状）。
- **验证测试名**：tests/figures.test.js、ops/audit_figure_layout.py 负对照。

## D-13 五本台账落点与不可手工删改

- **日期**：2026-10-21
- **问题背景与冲突点**：aims §八 点名五本台账，但其中两本（SPEC_DECISIONS.md、pitfalls_ledger.md）此前只存在于条款文字里，物理文件不存在，防漂移测试红。
- **备选方案对比**：① 改 aims 把落点改指向已有文件（踩坑台账.md、操作台账.md）：省事，但会让条款被实现反向绑架；② 补齐两本新台账并明确与既有台账的分工。
- **最终拍板结论**：选 ②。分工：SPEC_DECISIONS.md 只记裁定（为什么这么定）；pitfalls_ledger.md 只记坑与复盘（坏了怎么修、怎么防复发），与 con_hf/踩坑台账.md（历史长台账，按 #序号）互为索引，新坑先进 pitfalls_ledger.md 拿 P 编号，再按需在踩坑台账追加细节。ops_ledger.md 由同步脚本自动追加，禁止手工编辑历史行。
- **受影响条款**：§八.1 五本核心台账。
- **同步修改文件清单**：con_hf/SPEC_DECISIONS.md（新建）、con_hf/pitfalls_ledger.md（新建）。
- **验证测试名**：tests/aims_drift_guard.test.js §八（台账落点必须物理存在）。

## D-14 桥接守卫改为「本机优先，ssh 兜底」

- **日期**：2026-10-21
- **问题背景与冲突点**：src/bridge_guard.sh 原设计只走 `ssh k40-ubuntu python3 /mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py`。但母版本来就跑在计算容器里（任务引擎先 ssh 进 k40-ubuntu 再执行 step），容器内不解析 `k40-ubuntu` 这个主机名 —— 真机首跑 gsva_pathways 实测 `ssh: Could not resolve hostname k40-ubuntu` → exit 255 → `[BRIDGE SKIP]`，四项断言在真实主路径上 100% 空转（与 P-12 同类，只是从提交层搬到执行层）。
- **备选方案对比**：① 给容器加 hosts 记录让它能 ssh 回宿主：改动落在环境侧，换机即失效，且多一跳 ssh；② 守卫改成「本机引擎存在就直接 python3 调用，否则 ssh 兜底」：容器内天然命中本机分支，PC 侧仍能远程校验；③ 干脆去掉 ssh 分支：PC 侧无法校验远端文件，退化为本机专用。
- **最终拍板结论**：选 ②。新增 `BRIDGE_ENGINE_LOCAL`（默认 `/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py`，显式置空可强制 ssh）。MODE 判定顺序：本机引擎存在且 `command -v python3` → local；否则有 ssh → ssh；都没有 → SKIP。OK 文案带 `engine=local|ssh`，日志里能一眼看出走的是哪条路。
- **受影响条款**：§一.2 铁律 2（跨语言桥接四项断言）、§三.3 第 4 维（桥接引擎在位）。
- **同步修改文件清单**：src/bridge_guard.sh（MODE 判定 + local 分支 + 契约 3b）、src/line2_scrna/scripts/gsva_pathways（守卫候选路径列表，P-11 部署布局差一层）、BioanalysDesktop/tests/bridge_guard_local.test.js（新建）、tests/bridge_stage.test.js（runGuardCapture 显式置空 BRIDGE_ENGINE_LOCAL 锁定 ssh 分支）。
- **验证测试名**：tests/bridge_guard_local.test.js（7 条）；真机验证：`cd /tmp/gsva_verify/processed && BIOANALYS_SEED=42 bash /mnt/ssd/bio_data/bin/line2_scrna/gsva_pathways` → `[BRIDGE PASS] all 4 assertions passed` + `engine=local` + exit 0。

## D-15 五维自检第 4 维合并报灯 + 自检 ssh 严格化

- **日期**：2026-10-21
- **问题背景与冲突点**：aims §三.3 第 4 维原文是「跨线隔离、桥接引擎与远端版本一致性灯」—— 三件事共用一盏灯。P11 交付的 SHA256 比对若单独 push 一条 checks，界面会多出一盏 aims 里不存在的灯；反过来若只把哈希结果塞进 detail，判红时说不清是隔离门禁坏还是版本漂移。
- **备选方案对比**：① 新开第 6 盏灯：与条款冲突，前端灯位与文档对不上；② 只取最坏状态、detail 只留一句话：看不出是哪件事坏；③ 两盏子灯分开算、合并成一盏（状态取最坏，value 与 detail 并列）：既守住「一盏灯」，又能点名。
- **最终拍板结论**：选 ③。新增 `worstStatus()`（fail > warn > unknown > pass，unknown 比 pass 重：自检是门禁，没测出来不能算过）与 `mergeIsolationChecks()`，由 server/index.js 第 4 维调用。
- **同时修的既有缺陷（P-16）**：`runRemote` 丢弃 ssh 退出码，链路断时 stdout 为空 → 第 1 维把空串判成「原生 ext4」、第 2 维把空串算成 100% free，自检出现假绿灯。新增 `runSshStrict`（proc.js，退出码非 0 或输出为空即抛错），第 1~4 维全部改走严格版。
- **受影响条款**：§三.3 五维自检、§六 防崩与同步（版本漂移预案）。
- **同步修改文件清单**：server/selfcheck.js（worstStatus / mergeIsolationChecks）、server/proc.js（runSshRaw / runSshStrict）、server/index.js（import + 第 1~4 维严格化 + 第 4 维合并）、tests/selfcheck_isolation_merge.test.js（新建 16 条）。
- **验证测试名**：tests/selfcheck_isolation_merge.test.js、tests/selfcheck_sha256.test.js；真机只读探测：runSha256ParityCheck() → `status=pass, value=4/4 一致`，buildIsolationCommand() → 三线 LINE|*|0 + BRIDGE|present + END|。

## D-16 桥接引擎的失败口径：不可读输入 = 断言失败，不是「引擎不可达」

- **日期**：2026-10-21
- **问题背景与冲突点**：真机探针 `printf notah5ad > /tmp/bad.h5ad` 交给守卫，引擎抛 `OSError: Unable to synchronously open file` 的裸 traceback，守卫只看到「非 0 退出码 + 无结论」，按契约 3 归到「不可达」→ SKIP → exit 0，坏输入被静默放行（比不校验更危险）。
- **备选方案对比**：① 只改守卫（本机模式非 0 即 FAIL）：能挡住，但引擎仍吐 traceback，调用方看不到人话；② 只改引擎（把异常折成 [BRIDGE FAIL]）：守卫仍可能因为别的崩溃形态走 SKIP；③ 两边都改。
- **最终拍板结论**：选 ③。引擎侧：main 里先判 `os.path.exists`，再 `try/except` 包住校验，任何异常都折成 `[BRIDGE FAIL] 引擎无法校验输入（类型: 消息）` 并 exit 1；同时把 stdout/stderr 强制 UTF-8（Windows 宿主默认 cp936 会把中文结论写成乱码，调用方 grep 不到）。守卫侧：新增契约 3c —— 本机模式非 0 退出即 `[BRIDGE FAIL]` 并透传退出码；ssh 分支的 255/超时仍降级 SKIP（K40 离线时母版必须还能跑）。
- **受影响条款**：§一.2 铁律 2、§三.3 第 4 维。
- **同步修改文件清单**：ops/verify_bridge_checkpoint.py（存在性检查 + 异常折行 + UTF-8 输出）、src/bridge_guard.sh（契约 3c 分支）、tests/bridge_stage.test.js（+2 条真跑引擎）、tests/bridge_guard_local.test.js（崩溃改判 FAIL，另加 ssh 255 仍 SKIP）。
- **验证测试名**：tests/bridge_stage.test.js（13 条）、tests/bridge_guard_local.test.js（7 条）；真机验证：`bash /mnt/ssd/bio_data/ops/bridge_guard.sh --input /tmp/bad.h5ad ...` → `[BRIDGE FAIL] 引擎无法校验输入（OSError: ...）` + `GUARD_EXIT=1`。

### D-17 远端有两个落点：`src/`（仓库镜像）与 `bin/`（引擎真正执行）

- **编号**：D-17
- **日期**：2026-10-21
- **问题背景与冲突点**：`ops/sync_and_verify_remote.ps1` 把文件同步到 `$RemoteRoot/src/<线>/scripts/...`
  （保持仓库目录结构），而任务引擎是通过 PATH 执行 `$RemoteRoot/bin/<线>/<步骤名>`（由
  `ops/06_deploy_scripts.ps1` 部署）。两处各写各的：同步成功 ≠ 引擎跑的是新版本。
  2026-10-21 实测 `bin/` 里有 3 个母版落后于仓库（ml_diagnostics、ml_hub_analysis、virtual_knockout），
  而自检第 4 维只比「仓库 vs 镜像」，一盏灯都没亮 —— 这是比哈希不一致更隐蔽的假绿灯。
- **备选方案对比**：① 让同步脚本直接写 `bin/`（把两个落点合成一个）—— 会与 `06_deploy_scripts.ps1`
  的部署契约（同名拒绝、逐文件字节校验、可执行位复核）打架，且镜像就没人维护了；
  ② 在同步脚本末尾加「第 6 步 部署一致性」，只比对不写入，漂移就报出来（选中）；
  ③ 改自检第 4 维去比 `bin/` —— 自检是只读探针，跑一次要对 55 个文件做哈希，代价高且语义混淆。
- **最终拍板结论**：采用 ②。同步脚本第 6 步把「仓库哈希」与「远端 `bin/` 落点哈希」逐文件比对，
  输出 `[ OK ] 部署一致性：仓库与 bin/ 落点 N/N 一致` 或 `[WARN] 部署漂移 K/N`，并写进 manifest
  的 `deploy` 字段与台账的「部署」列；`-FailOnDrift` 时漂移即 exit 1。修复动作固定为
  `pwsh -File ops/06_deploy_scripts.ps1 -Force`。README.md 这类文档不进 `bin/`，不算漂移。
- **受影响条款**：aims §三.3 第 4 维（版本一致性灯的口径）；`ops/README.md` 部署章节。
- **同步修改文件清单**：`ops/sync_and_verify_remote.ps1`（第 6 步 + manifest `deploy` 字段 + 台账列）、
  `BioanalysDesktop/tests/deploy_and_parity_guard.test.js`、`ops/README.md`。
- **验证测试名**：`deploy_and_parity_guard.test.js` 的「sync_and_verify_remote.ps1 含第 6 步部署一致性」
  与「sync manifest 与台账都要带部署一致性结论」。

### D-18 部署通道的校验必须单次 ssh 批量，且「链路失败」≠「文件缺失」

- **编号**：D-18
- **日期**：2026-10-21
- **问题背景与冲突点**：`ops/06_deploy_scripts.ps1` 原本对 58 个文件逐个 `ssh stat`（58 次）+ 逐个
  `ssh chmod`（58 次）。2026-10-21 真机部署时容器在窗口内重启一次，后半段 ssh 全部失败，
  脚本把**已经成功落盘**的文件报成 `MISSING` 并 exit 1（假红灯），而实际 55 个母版全部到位。
- **备选方案对比**：① 加 `Start-Sleep` 重试整个部署 —— 治不了根，窗口还在；② 逐文件 ssh 改成一次
  批量 ssh（选中），并给「ssh 连续两次非 0」单列一档 `校验链路失败`，与「远端明确回 MISSING」分开；
  ③ 干脆去掉校验 —— 直接违背部署通道的存在意义。
- **最终拍板结论**：采用 ②。校验用一条远端命令：`printf` 把路径喂给 `while IFS= read -r p`，
  逐个回 `FILE|<path>|<size>|<exec>` 或 `MISSING|<path>`，PS 侧解析成两张表（size / exec），
  再逐文件比对；可执行位也并入同一次 ssh。chmod 同样合并成一条 `chmod 755 p1 p2 ...`。
  ssh 非 0 先重试一次，仍非 0 才判「校验链路失败（不是文件缺失）」。
- **受影响条款**：部署通道契约（ops/README.md）；M1 DoD「本地远端 SHA256 一致」的取证方式。
- **同步修改文件清单**：`ops/06_deploy_scripts.ps1`（3.5 批量 chmod、第 4 步批量校验、第 5 步可执行位复核）、
  `BioanalysDesktop/tests/deploy_and_parity_guard.test.js`。
- **验证测试名**：`deploy_and_parity_guard.test.js` 的「校验阶段必须是单次 ssh 批量」「链路失败与文件缺失必须分开判定」
  「可执行位一次批量置位」。
