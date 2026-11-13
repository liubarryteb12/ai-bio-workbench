# S30 报告：上传扩展名白名单收敛为唯一权威 shared/data_formats.mjs

- 任务：共享任务板 task-2（S30），owner s30-upload
- 日期：2026-10-21
- 关联评审：架构评审 2.3 / A8「同一份数据走两个入口校验结论不同」
- 状态：实现与验证完成，等待 Lead 复核与统一构建

## 1. 任务理解

同一份数据有两个入口：8787 工作台（BioanalysDesktop/server/upload.js 的 ALLOWED_EXT，原 14 项）与 8080 用户提交台（portal/lib/archive.mjs 的 DATA_EXT，原 9 项）。两边各持一份字面量，扩展名白名单不一致，导致同一文件在两个入口得到不同校验结论，用户困惑。本次把白名单收敛到仓库根 shared/data_formats.mjs 作为唯一权威，两端改为 import 它；portal/index.html 因为是无打包的浏览器单文件页面，只能保留字面量副本，由测试把守一致性。

硬约束（派发单）：不改 App.tsx、server/index.js、server/task.js、server/run.js、ops/、src 三线；不新增依赖；不动 portal 上传/打包业务逻辑（只碰扩展名白名单相关）；不删既有导出名；保留 S28 未提交改动；不做 git 写操作；不跑 npm run build（Lead 统一构建）。

## 2. 实现摘要

1. 新建 shared/data_formats.mjs，零依赖 ESM，导出 DATA_EXT（两端并集 14 项，顺序固定）、MAX_DATA_BYTES（5 GiB）、extOf(name)、isAllowedDataFile(name)。文件头注释写清唯一权威地位、两端 import 路径、index.html 为何只能是副本、以及测试如何把守。
2. BioanalysDesktop/server/upload.js 改为 import 权威模块，保留 `export const ALLOWED_EXT = DATA_EXT`，extAllowed 委托 isAllowedDataFile，判定语义不变（附 138 用例等价探针，diffs=0）。
3. portal/lib/archive.mjs 改为 import 权威模块，保留 `export const DATA_EXT`，MAX_DATA_BYTES 仍支持 PORTAL_MAX_DATA_BYTES 覆盖，validateDataFiles 逻辑未改，只把私有 extOf 换成权威模块的 extOf（实现相同：basename 后 lastIndexOf('.') 取小写）。
4. portal/index.html 的 DATA_EXT 字面量更新为 14 项并加注释；两处提示文案与 accept 属性同步为 14 项。
5. 新增 BioanalysDesktop/tests/data_format_parity.test.js（11 条测试）把守副本与两端同判定。
6. 新增 cn_debug/2026-10-21_verification_s30_whitelist.mjs 一次性验证脚本，导入两端真实模块输出 28 个文件名的判定矩阵。

## 3. 文件变更清单

新增：

- shared/data_formats.mjs
  - 第 28-31 行 DATA_EXT 14 项（'.h5ad','.h5','.loom','.mtx','.tar','.gz','.zip','.txt','.tsv','.csv','.soft','.xlsx','.rds','.rdata'）
  - 第 39 行 MAX_DATA_BYTES = 5 * 1024 * 1024 * 1024（不读环境变量）
  - 第 42-44 行私有 basename；第 47-51 行 export function extOf(name)；第 61-63 行 export function isAllowedDataFile(name)
- BioanalysDesktop/tests/data_format_parity.test.js（11 条测试，见第 5 节）
- cn_debug/2026-10-21_verification_s30_whitelist.mjs（一次性验证脚本，非测试套件成员）

修改：

- BioanalysDesktop/server/upload.js（20 行 diff）
  - 第 16 行 `import { DATA_EXT, extOf, isAllowedDataFile } from '../../shared/data_formats.mjs';`
  - 第 24-29 行注释 + `export const ALLOWED_EXT = DATA_EXT;`（保留导出名）
  - 第 49-55 行 extAllowed 改为 `return isAllowedDataFile(name);`
  - sanitizeFilename / detectMagic / validateUpload 未动
- portal/lib/archive.mjs（29 行 diff）
  - 第 12-14 行头注释说明白名单与上限默认值来自 shared
  - 第 17-21 行 `import { DATA_EXT as SHARED_DATA_EXT, MAX_DATA_BYTES as SHARED_MAX_DATA_BYTES, extOf } from '../../shared/data_formats.mjs';`
  - 第 34 行 `export const DATA_EXT = SHARED_DATA_EXT;`
  - 第 43-45 行 MAX_DATA_BYTES 保留 PORTAL_MAX_DATA_BYTES 覆盖，默认取 SHARED_MAX_DATA_BYTES
  - 删除原私有 extOf，validateDataFiles 第 134 行继续用 `!DATA_EXT.includes(extOf(name))`
- portal/index.html（12 行 diff）
  - 第 412 行提示文案改为 14 项
  - 第 428 行 accept 属性改为 14 项
  - 第 429 行提示文案改为 14 项
  - 第 1236-1238 行两行注释 + DATA_EXT 字面量 14 项
  - 第 1239-1240 行 MAX_DATA_BYTES 注释指向 shared

未触碰（确认保留 S28 未提交改动）：BioanalysDesktop/server/index.js、server/task.js（git status 仍为 M，内容未被本次改动覆盖）、App.tsx、server/run.js、ops/、src/ 三线、portal 上传/打包业务逻辑。

## 4. 接口与交互实现说明

- 权威接口（shared/data_formats.mjs）：
  - DATA_EXT: string[]，14 项，顺序固定，两端并集
  - MAX_DATA_BYTES: number，5368709120
  - extOf(name: unknown): string，取 basename 后最后一段小写扩展名，无点返回 ''
  - isAllowedDataFile(name: unknown): boolean，等价于 DATA_EXT.includes(extOf(name))
- 兼容性：ALLOWED_EXT（upload.js）与 DATA_EXT（archive.mjs）都保留原导出名，且与权威模块是同一数组引用（严格相等），既有 import 方（server/index.js、portal/serve.mjs、既有测试）无需改动。
- 语义等价：工作台旧实现是 `ALLOWED_EXT.some((e) => lower.endsWith(e))`，权威实现是「最后一段扩展名精确匹配」。白名单项都以 '.' 开头且自身不含第二个点，因此两者等价；双扩展名 .mtx.gz / .tar.gz 两边都取最后一段 .gz 放行。用 138 个构造用例对比新旧实现，diffs=0（见第 5 节）。
- 提交台环境变量：PORTAL_MAX_DATA_BYTES 覆盖语义不变，仍是「> 0 才覆盖，否则用默认 5 GiB」，validateDataFiles 与 serve.mjs 共用同一常量，覆盖后两端同步生效。
- index.html 副本：浏览器 inline script 无法 import ESM，只能保留字面量；DATA_EXT、accept 属性、两处提示文案三处都同步为 14 项，任何一处漏改会被 data_format_parity.test.js 抓到。

## 5. 测试与验证记录

### 5.1 语法检查（全部 exit 0）

命令：

```
node --check portal/serve.mjs; node --check portal/lib/archive.mjs; node --check BioanalysDesktop/server/upload.js; node --check shared/data_formats.mjs; node --check BioanalysDesktop/tests/data_format_parity.test.js
```

输出摘要：serve=0 archive=0 upload=0 shared=0 test=0。

### 5.2 全量测试（基线 296，当前 322 全绿）

命令：`cd BioanalysDesktop; npm test`

输出尾行：

```
ℹ tests 322
ℹ suites 0
ℹ pass 322
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3952.6927
NPM_TEST_EXIT=0
```

说明：322 = 基线 296 + 本任务新增 11 条（307）+ 并发队友新增 15 条。首次运行时曾出现一次与本次改动无关的失败：tests/consistency.test.js:24「Node 判定与服务器 bash 判定结论一致」，错误为 `scp task_ok.json 失败: Connection closed by 127.0.0.1 port 10022`，系 算力节点 SSH 隧道瞬时断开；随后 `ssh -o BatchMode=yes k40-ubuntu 'echo SSH_OK; hostname'` 返回 SSH_OK / localhost，重跑即全绿。

### 5.3 新增测试（11 条，隔离运行全通过）

命令：`cd BioanalysDesktop; node --test tests/data_format_parity.test.js`

输出：`ℹ tests 11 / pass 11 / fail 0`。

11 条测试（文件 BioanalysDesktop/tests/data_format_parity.test.js）：

1. 第 90 行 shared：DATA_EXT 是两端并集 14 项且顺序固定
2. 第 97 行 shared：extOf 取最后一段小写扩展名，路径只取 basename
3. 第 107 行 shared：isAllowedDataFile 14 项全通过，脚本/可执行/伪装后缀全拒
4. 第 120 行 index.html：DATA_EXT 字面量与权威逐项相等
5. 第 126 行 index.html：提示文案与 accept 属性覆盖全部 14 项，无 9 项旧文案残留
6. 第 135 行 index.html：MAX_DATA_BYTES 副本等于权威默认值
7. 第 141 行 工作台 upload.js：ALLOWED_EXT 与权威同引用同内容
8. 第 146 行 提交台 archive.mjs：DATA_EXT 与权威同引用同内容
9. 第 151 行 提交台 archive.mjs：MAX_DATA_BYTES 默认值同权威，env 覆盖语义不变
10. 第 163 行 两端同判定：14 项合法文件名两端都放行
11. 第 171 行 两端同判定：非法扩展名两端都拒绝

实现要点：读 portal/index.html 文本，用正则 `/var DATA_EXT\s*=\s*\[([^\]]*)\]\s*;/g` 取出字面量并解析成数组，与权威逐项断言；MAX_DATA_BYTES 副本同样从 HTML 文本解析求积；合法文件名 16 个（14 项各一 + matrix.mtx.gz + '分组 情况.txt'），非法 8 个（evil.sh、run.exe、script.bat、app.js、notes.py、noext、x.h5ad.bak、x.tar.gz.exe）。

### 5.4 一次性验证脚本：两端判定矩阵

命令：`node cn_debug/2026-10-21_verification_s30_whitelist.mjs`

输出（原样摘录，EXIT=0）：

```
=== S30 两端白名单判定矩阵 ===
权威模块: shared/data_formats.mjs
工作台判定: BioanalysDesktop/server/upload.js extAllowed()
提交台判定: portal/lib/archive.mjs validateDataFiles()（空 payload，仅白名单层）

#   文件名                              extOf     8787    8080    一致
--------------------------------------------------------------------------------
1   counts.h5ad                         .h5ad     放行    放行    是
2   filtered_feature_bc_matrix.h5       .h5       放行    放行    是
3   adata.loom                          .loom     放行    放行    是
4   matrix.mtx                          .mtx      放行    放行    是
5   raw_bundle.tar                      .tar      放行    放行    是
6   GSE277173_series_matrix.txt.gz      .gz       放行    放行    是
7   supplementary.zip                   .zip      放行    放行    是
8   GPL11532-32230.txt                  .txt      放行    放行    是
9   mouse_cortex.tsv                    .tsv      放行    放行    是
10  sample_sheet.csv                    .csv      放行    放行    是
11  GPL11532_family.soft                .soft     放行    放行    是
12  样本信息.xlsx                       .xlsx     放行    放行    是
13  seurat_obj.rds                      .rds      放行    放行    是
14  workspace.rdata                     .rdata    放行    放行    是
15  matrix.mtx.gz                       .gz       放行    放行    是
16  raw data.tar.gz                     .gz       放行    放行    是
17  UPPER.H5AD                          .h5ad     放行    放行    是
18  分组 情况.txt                       .txt      放行    放行    是
19  dir/sub/x.tsv                       .tsv      放行    放行    是
20  evil.sh                             .sh       拒绝    拒绝    是
21  run.exe                             .exe      拒绝    拒绝    是
22  script.bat                          .bat      拒绝    拒绝    是
23  app.js                              .js       拒绝    拒绝    是
24  notes.py                            .py       拒绝    拒绝    是
25  noext                               (无)      拒绝    拒绝    是
26  x.h5ad.bak                          .bak      拒绝    拒绝    是
27  x.tar.gz.exe                        .exe      拒绝    拒绝    是
28  .hidden                             .hidden   拒绝    拒绝    是
--------------------------------------------------------------------------------
共 28 个文件名，判定一致 28 个，不一致 0 个

=== 常量与副本核对 ===
shared DATA_EXT 项数 = 14: .h5ad .h5 .loom .mtx .tar .gz .zip .txt .tsv .csv .soft .xlsx .rds .rdata
工作台 ALLOWED_EXT 与 shared 同内容 = true，同引用 = true
提交台 DATA_EXT 与 shared 同引用 = true
portal/index.html DATA_EXT 副本项数 = 14，与 shared 逐项相等 = true
shared MAX_DATA_BYTES = 5368709120（5 GiB）
提交台 MAX_DATA_BYTES = 5368709120（env 覆盖 = 否）

本次并集新增（提交台旧白名单没有、工作台旧白名单已有）: .h5 .loom .tar .soft .rdata

RESULT: PASS（两端判定一致，副本与常量均对齐）
EXIT=0
```

### 5.5 extAllowed 语义等价探针

用旧实现 `ALLOWED_EXT.some((e) => String(name).toLowerCase().endsWith(e))` 与新 extAllowed 对 138 个构造用例（14 项 × 9 种前缀 + 12 个边界名）逐一对比，输出 `cases=138 diffs=0`，确认工作台行为未变。

### 5.6 旧文案清理确认

grep `支持 .tsv`（portal 目录）：0 处命中；grep `9 项|9项`（portal/index.html）：0 处命中，确认 9 项旧提示与旧文案没有残留。

### 5.7 未运行的验证

- 未运行 `npm run build`：按派发单要求，dist 由 Lead 统一构建，避免与并发队友冲突。
- 未做 8787 / 8080 端到端启动联调：本任务只改白名单来源与文案，两端模块均已用真实 import 覆盖（判定矩阵直接调用两端真实函数），启动联调留给 Lead 统一验收。

## 6. 假设与风险

1. 假设：白名单项都以 '.' 开头且不含第二个点（现有 14 项满足），这是 endsWith 与 extOf 精确匹配等价的前提。若未来加入像 '.tar.gz' 这样的多项扩展名，等价关系会被打破，届时必须同时改 extAllowed 语义与测试。已在 shared/data_formats.mjs 头注释记录该前提。
2. 风险：portal/index.html 是副本，靠测试把守而不是编译器。新增白名单项时若只改 shared 而漏改 index.html，测试会红，但前提是有人跑 npm test。已把「改动必须同步」写进注释与报告。
3. 风险：index.html 的 MAX_DATA_BYTES 副本不感知 PORTAL_MAX_DATA_BYTES 环境变量覆盖（既有行为，本次未改）。若运维用环境变量改小上限，前端提示仍是 5 GiB，用户可能先上传后收到服务端拒绝。属既有不一致，不在本次范围。
4. 风险：upload.js 按派发单 import 了 extOf 但当前未使用（extAllowed 已委托 isAllowedDataFile）。Node ESM 允许未使用的命名 import，不影响运行；若担心 lint 噪音，可后续删掉 extOf 的 import（会偏离派发单字面要求，故保留并在此说明）。
5. 兼容性：ALLOWED_EXT 与 DATA_EXT 仍是同一数组引用，外部若有人 push 修改该数组会同时影响两端（旧代码里也是导出的可变数组，风险等级不变）。
6. 远端 算力节点 只读探测：仅做 SSH 连通性验证，未改远端环境或数据；探测临时文件已清理，无残留。

## 7. 架构/接口变更建议

1. shared/ 目录可作为后续「两端共用契约」的落点（如角色枚举 DATA_ROLES、单文件上限、允许的 MIME）。本次只收敛白名单与上限默认值，其余规则仍留在各自模块，避免一次改动面过大。
2. 若未来前端引入打包步骤，portal/index.html 可以改为 import 权威模块，届时删掉副本与对应的 HTML 解析测试，只保留模块级测试。
3. 可考虑在 CI 或 Lead 的统一验收脚本里固定跑 data_format_parity.test.js，降低「只改一侧」的漏改概率。

## 8. 待主 Agent 决策事项

1. 是否把 cn_debug/2026-10-21_verification_s30_whitelist.mjs 保留为长期回归脚本（当前按一次性脚本处理，未纳入 npm test）。
2. upload.js 中未使用的 extOf import 是否删除（派发单字面要求 import，故保留；删除属微调，请 Lead 定）。
3. portal/index.html 的 MAX_DATA_BYTES 副本是否要跟随 PORTAL_MAX_DATA_BYTES 覆盖做提示（既有不一致，本次未动，建议单列任务）。

## 9. 建议下一步

1. Lead 复核本次 diff（server/upload.js、portal/lib/archive.mjs、portal/index.html、shared/、tests/），确认 S28 未提交改动未被覆盖。
2. Lead 统一执行 npm run build，并在 8787 工作台与 8080 提交台各做一次真实上传冒烟（选 .h5 或 .loom 这类本次新增放行的扩展名，确认两端都放行）。
3. 更新台账（S30 条）与架构评审 2.3 / A8 的处置状态。
