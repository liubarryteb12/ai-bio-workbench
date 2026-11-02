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

它**每次都会重新解包**（先 `Remove-Item unpacked` 再 `tar -xzf`）。
所以想验证「CHECKSUMS 被篡改会不会被抓」，必须绕过验收脚本、用独立探针直接跑
检测逻辑，否则篡改会被重新解包覆盖掉，得到假绿。

## 四、打包器对环境变量的要求（fail-closed，不是 bug）

```text
BIO_ED25519_PUBLIC_KEY_PATH   = ops/secrets/ed25519_public.pem
BIO_ED25519_PRIVATE_KEY_PATH  = ops/secrets/ed25519_private.pem
```

缺任一即 exit 1 且不产出任何包。这是设计意图：凭证必须显式提供，不得静默降级。

## 五、实测性能

对 PRJ_AIMS_V3_20261027 真实打包签名 **4.5 秒**，产出 356 文件 / 335 图 / 36.7MB tar，
`CHECKSUMS.sig` 64 字节。Argon 原估 3 分钟，实际快约 40 倍。
