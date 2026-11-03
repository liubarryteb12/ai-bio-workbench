# 交付包两套登记的分工（manifest 与 CHECKSUMS）

**结论：两套登记不合并。** 它们服务的消费方与依赖完全不同，合并会牺牲一边。

## 两套文件各自管什么

| 文件 | 契约层次 | 消费方 | 格式约束 |
|---|---|---|---|
| `CHECKSUMS.sha256` | 密码学与操作系统层 | 客户在任意 Linux/macOS/Git Bash 用系统自带 `sha256sum -c` + `openssl` 独立取证验签 | 必须是标准 `<64位hex>  <相对路径>` 纯文本，一旦塞进 JSON，系统工具链立刻失效 |
| `delivery_manifest.json` | 业务语义与编排层 | 18787 管理台、自动化验收脚本、客户报告索引器 | 结构化树：项目 ID、分类计数 counts、章节、模板映射 |

## 四级信任链

```
CHECKSUMS.sig  (Ed25519 私钥签名)
  └─ CHECKSUMS.sha256  (逐文件哈希，含 delivery_manifest.json 自身)
       └─ delivery_manifest.json  (业务分类索引)
            └─ 业务文件 (scripts / figures / tables / 解读报告)
```

manifest 本身被 CHECKSUMS 保护，所以「索引被篡改」也在签名覆盖范围内。
这也是验收脚本第 4 关里 `$coverageMeta` 只排除三件（CHECKSUMS.sha256、CHECKSUMS.sig、
公钥 .pem）而**不排除 manifest** 的原因。

## 打包器单源派生原则

内存里只允许有一个真源列表 `entries`，两套文件都从它派生：

1. 构建去重后的唯一条目表 `entries`
2. `entries` 分类序列化 → `delivery_manifest.json`
3. 对全部业务文件**加 manifest 自身**算 SHA256，按字典序 → `CHECKSUMS.sha256`
4. Ed25519 私钥签 `CHECKSUMS.sha256` → `CHECKSUMS.sig`

## 一致性由验收第 4 关兜住

`ops/delivery_acceptance.ps1` 第 4 关做三件事，把「两套会不会漂移」变成机器判定：

- **幽灵检测**：磁盘业务文件（扣掉三件签名元数据）凡不在 manifest 也不在白名单 → 点名判红
- **漂移检测**：manifest 每条按小节拼成磁盘路径后必须真实存在 → 缺失判红
- **覆盖完备性**：CHECKSUMS 保护集合与磁盘业务集合双向差集为空 → 漏保护或幽灵登记判红

## 客户交付包根目录 README 固定两句话

> `delivery_manifest.json` 管业务分类索引（有哪些图、多少张表、属于哪条线）。
> `CHECKSUMS.sha256` 与 `CHECKSUMS.sig` 管全包（含 manifest 自身）的密码学防篡改完整性。
> 校验只需系统自带命令：`sha256sum -c CHECKSUMS.sha256`。

## 历史缺陷记录（为什么必须写死这套分工）

2026-11-03 实测发现：打包器把 `figures/adapt/*.R` 在三条线的 adapted 列表里各登记一次，
导致 manifest 登记 386 条而磁盘唯一文件只有 352 个，`adapted_code` 计数 51 实际 17。
如果第 4 关当时只是 WARN 放过，这个 counts 虚胖 34 条的缺陷会永久潜伏。
修复方式是在拷贝循环加去重集合、manifest 列表用保序去重，之后 352 = 352 对齐。
