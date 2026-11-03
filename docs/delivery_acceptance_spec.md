# 交付验收专项进展（2026-11-02，第 35~36 轮）

## 一、四道关验收闭环（已落地并实测）

`ops/delivery_acceptance.ps1`，一次调用把「拿到一个 tar 到确认它可信」走完。
任一道红即整体红，成功打 `DELIVERY_ACCEPTANCE_OK`，失败打 `ACCEPTANCE_FAILED`。

| 关 | 判据 | 实测 |
|---|---|---|
| 1 | tar 本体 SHA256 与侧车一致 | 两种侧车命名都支持 |
| 2 | 解包成功且根目录含三件套 | — |
| 3 | 清单逐文件哈希 + Ed25519 验签 | VERIFIED 356 / 112 |
| 4a | 幽灵检测（磁盘多出的未登记文件） | 放入 ghost_leak.txt 当场点名 |
| 4b | 漂移检测（清单有、磁盘无） | 双向差集为空才通过 |
| 4c | CHECKSUMS 覆盖完备性 | 356 个业务文件全被哈希保护 |
| 4d | counts 与清单条目逐类一致 | 352 = 352 |

## 二、这次专项抓到的四个真实缺陷（都不是我预想的「防未来」）

1. **Prelude 命名空间污染**：`L2p_cellcomm_autocorr_code.py` 母版用裸
   `from matplotlib.path import Path`，覆盖了 prelude 的 `pathlib.Path`，
   导致 `Path(input_data).exists()` 被当图形路径解析。
   断言 `python overlays never shadow prelude symbols` 一加上就抓到。
2. **打包器清单重复登记**：`figures/adapt/*.R` 在三条线的 adapted 列表各出现一次，
   落盘与计数都各做一遍，导致清单 386 条只对应 352 个唯一文件、`adapted_code`
   计数 51 实际 17。已加去重集合与 `dict.fromkeys`。
3. **侧车命名两套**：演练包 `tar_sha256_sidecar.txt`、打包器 `<name>.tar.gz.sha256`。
   内容格式相同，验收改为两种都接受。
4. **覆盖检查的元数据口径**：`delivery_manifest.json` 其实是被 CHECKSUMS 保护的
   普通文件，把它当元数据排除会误判成幽灵登记。

## 三、验收脚本运行时的一个行为要记住

默认它**每次都会重新解包**（先 `Remove-Item unpacked` 再 `tar -xzf`），
所以篡改包内文件会被重新解包洗掉，验出假绿。实测证据：给
`01_Adapted_Code/_report.txt` 追加一行后，不带开关跑仍是 `DELIVERY_ACCEPTANCE_OK`
（第 3 关 `VERIFIED 357` 照过）。

要演练「有人改过包内文件」，加 `-SkipExtract` 复用既有 `unpacked`，篡改才会走到第 3 关：

```text
pwsh -File ops/delivery_acceptance.ps1 -DeliveryDir <dir>              # 首次：生成 unpacked
pwsh -File ops/delivery_acceptance.ps1 -DeliveryDir <dir> -SkipExtract # 探针：检验磁盘上的既有解包
```

同一份被篡改的解包，两种跑法结论相反，这正是开关存在的意义：

| 跑法 | 结果 |
|---|---|
| `-SkipExtract` | `[ RED ] 验签失败：VERIFICATION_FAILED hash_mismatch:01_Adapted_Code/_report.txt`，`ACCEPTANCE_FAILED 1 项`，exit 1 |
| 默认（重解包） | `DELIVERY_ACCEPTANCE_OK 四道关全绿`，exit 0 |

复用模式下 `unpacked` 不存在直接判红退出，绝不默默重建一份干净解包来顶替。
重解包只发生在 `else` 分支，这条花括号归属由
`BioanalysDesktop/tests/delivery_acceptance.test.js` 的结构断言钉住
（只比较 indexOf 顺序抓不到「两个分支都重解包」的写法）。

## 四、打包器对环境变量的要求（fail-closed，不是 bug）

```text
BIO_ED25519_PUBLIC_KEY_PATH   = ops/secrets/ed25519_public.pem
BIO_ED25519_PRIVATE_KEY_PATH  = ops/secrets/ed25519_private.pem
```

缺任一即 exit 1 且不产出任何包。这是设计意图：凭证必须显式提供，不得静默降级。

## 五、实测性能

对 PRJ_AIMS_V3_20261027 真实打包签名 **4.5 秒**，产出 356 文件 / 335 图 / 36.7MB tar，
`CHECKSUMS.sig` 64 字节。Argon 原估 3 分钟，实际快约 40 倍。

## 六、第二十轮 Q1 落地：判据真源进 Node 核心，内联为打包后置条件（2026-11-03）

Argon 裁定：放弃「人记得敲的命令」形态，四关验收成为打包链路的
最后一步后置条件（Post-condition），且未持有效回执禁止放行交付。

| 件 | 职责 |
|---|---|
| `ops/delivery_acceptance_core.mjs` | 四道关判据的唯一真源：侧车 → 解包 → 验签 → 双向差集/覆盖/counts，纯 Node（zlib + ustar，进程接缝门禁不许 server 起子进程） |
| `ops/delivery_acceptance.ps1` | 人用的一行包装：找 tar、透传开关、透传退出码。判据词（ghosts/missingFiles/Get-FileHash 等）已不在其中，测试钉住这条委托关系 |
| `server/report.js` `runInlineAcceptance` | 打包末尾后置条件：全绿才写回执，红时路由回 500 且回执绝不落盘 |
| `server/routes/report.routes.js` | 下载门禁：放行前校验回执存在且 `tar_sha256` == 当前包实时哈希，否则 409 `ERR_DELIVERY_UNVERIFIED`；`/api/report/files` 同响应带 `delivery_verified` 供前端先显示再点 |
| `npm run delivery:verify -- <tar>` | 外部抽检口（Argon Q1 点名要的那条） |

回执 schema（落 `<deliverables>/acceptance/<pid>.receipt.json`，业务运行时产物不进仓库；
CLI 加 `--project-id` 可落 `ops/delivery_acceptance/records/` 受控区留档演练回执）：

```json
{ "schema_version": 1, "project_id": "…", "tar_sha256": "…", "verified_count": 357,
  "coverage_ok": true, "verified_at": "…", "verifier_version": "delivery-acceptance-core/1.0.0" }
```

实测（2026-11-03，PRJ_AIMS_V3_20261027 真包 38MB）：内联验收 0.7 秒，
VERIFIED 357，双向差集/覆盖/counts 全绿，回执落盘后 `deliveryGateStatus` 放行。
探针三件套在同一真包上红得其所：包内翻字节 → 关 3 点名 hash_mismatch；
tar 体翻字节 → 关 1 点名 SHA256 不一致；塞幽灵文件 → 关 4 点名 ghosts。

### 落地时踩到的两个坑（都是实测，不是预防）

1. **PS5.1 无 BOM 的 UTF-8 中文脚本会断语法**：本机没有 pwsh 7，包装脚本喂进
   Windows PowerShell 5.1 时按 ANSI 代码页解码，中文注释尾字节吃掉紧邻引号，
   node 收到残缺 argv（`bad option: --project-id`）。解法：ps1 存为 UTF-8 带 BOM，
   `delivery_acceptance.test.js` 钉住 BOM 字节（EF BB BF）。
2. **GNU tar 的 PAX 扩展头**：演练包长路径走 `././@PaxHeader`（type 'x'）与 `L`/`K` 机制，
   只认经典 ustar 的解析器把数据块当主头，当场 `bad_octal_field`。核心按
   POSIX.1-2017 消费四种扩展头并应用 `path=`/`size=`；同时 zip-slip 防护
   （`..` 段、绝对路径、盘符名在写盘前拒）用恶意 tar 实测过。

