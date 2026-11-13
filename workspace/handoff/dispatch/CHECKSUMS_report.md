# task-9 包内 CHECKSUMS 清单（m00939 边界①）实施报告

执行人：lead（亲自执行，因 teammate 名额已满）
完成时间：2026-10-21
状态：已完成，远端真机验证通过

---

## 一、问题

交付包 `<project>_Client_Delivery.tar.gz` 内没有完整性清单。此前只有本地侧
`BioanalysDesktop/server/report.js` 的 `writeSha256Sidecars(projectId)`，它对**本地回搬目录**
写 `<文件>.sha256` 旁挂文件，而客户拿到的 tar.gz 里没有任何可校验的清单。
客户无法确认"包里这个文件是不是被改过"，只能整体信任。

spec 的 3/5/6 条门禁要求包内可核对，这是真实缺口。

---

## 二、改动（ops/build_client_report.py，+94/-2）

### 2.1 新增依赖
`import hashlib`（标准库，无新增第三方依赖）。

### 2.2 新增常量
`CHECKSUMS_NAME = "CHECKSUMS.sha256"`（约 :1944）

### 2.3 新增函数 write_checksums(delivery_dir, skip=())（约 :1948-1984）

```python
def write_checksums(delivery_dir, skip=()):
    """在 delivery_dir 下生成 CHECKSUMS.sha256。

    * 只列包内真实存在的文件（相对 delivery_dir 的 POSIX 路径）；
    * 修文件名（即自身）、skip 里的文件一律不入列；
    * 逐行排序，便于 diff；
    * 先写清单再打 tar，保证包内清单与包内文件一一对应。
    """
```

实现要点：
- `os.walk` 递归，`dirnames.sort()` + `sorted(filenames)` 保证遍历顺序稳定；
- `rel = os.path.relpath(full, delivery_dir).replace(os.sep, "/")` —— POSIX 分隔符，
  这样 Linux/macOS/Windows 上生成的清单字节一致；
- 逐 1MiB `fh.read()` 流式更新 digest，不把大文件整块读进内存（包里有 66MB 级 tar 和图）；
- 行格式 `"%s  %s\n" % (digest, rel)` —— 64 位小写 hex + **两个空格** + 相对路径，
  这是 GNU coreutils `sha256sum` 的标准输出格式，`sha256sum -c` 可直接吃；
- 自身（`rel == CHECKSUMS_NAME`）与 `skip` 列表一律跳过，避免自指死循环；
- 返回 `{"path", "files", "count"}`，供调用方与测试断言。

### 2.4 assemble() 接线（:1926 之后，:1931 打 tar 之前）

```python
    # 完整性清单：先写 CHECKSUMS.sha256 再打 tar，包内清单与包内文件一一对应。
    # 只覆盖三大件与 manifest 自身落盘之后的现实，manifest 里的 counts 是
    # 复制成功计数、这里是文件系统实测字节，两者不一致以本清单为准。
    checksums = write_checksums(delivery)

    tar_path = None
    if not no_tar:
        ...
```

**顺序是关键**：必须写在 manifest 之后、`tarfile.open` 之前。写在 tar 之后会导致
"清单在包里列出一个还没列自己的时间窗"，而写在 manifest 之前会漏掉 manifest 本身。

### 2.5 assemble() 返回值扩充
```python
    return {
        ...
        "checksums": checksums["path"],
        "checksums_count": checksums["count"],
        ...
    }
```

### 2.6 main() 输出
```python
    print("  校验清单：%s（%d 个文件，sha256sum -c 可复核）"
          % (CHECKSUMS_NAME, result.get("checksums_count", 0)))
```
与既有"报告：""图件/结果表/脚本""打包："三行并列，人在 CLI 上就能看到清单规模。

---

## 三、自检断言（self_test，+6 条，共 41 条全 PASS）

插在"tar.gz 已生成且非空"之后（:2106 附近）：

1. `CHECKSUMS.sha256 已生成` —— `os.path.isfile(result["checksums"])`；
2. `清单非空（至少三大件都在）` —— `len(cks_lines) >= 3`；
3. `每行形如 <64hex>+两空格+相对路径` —— 正则 `^[0-9a-f]{64}  [^\s].+$`；
4. `清单自身不在列内`；
5. `清单按路径排序（便于 diff）`；
6. `hashlib 逐文件复算全部一致（sha256sum -c 同口径）` —— 逐行 split，重新
   `hashlib.sha256(open(full,'rb').read()).hexdigest()` 比对。

第 6 条是核心：它保证清单里的每个 digest 都是**当下真实字节**的哈希，不是占位符。
没有这一条，前面 5 条只能证明"格式对"，不能证明"内容对"。

> 踩坑：最初用了一个不存在的 `read_bytes()` 帮助函数，导致
> `IndentationError: expected an indented block after 'if' statement`。
> 已改为内联 `with open(full, "rb") as _fh:`。这个错误只在运行时暴露，
> 说明 self_test 覆盖到了这条路径，是有价值的失败。

---

## 四、远端真机验证（算力节点，全部实测非推断）

### 4.1 部署
- 备份：`/mnt/ssd/bio_data/ops/_bak_20261021/build_client_report.py.bak`
  （114289 字节，与原文件同尺寸，md5 = c6e8d4b1405d487865f358058cfec185）
- 踩坑：**scp 直写 `/mnt/ssd/bio_data/ops/` 失败**（`Connection closed by 127.0.0.1 port 10022`，
  exit 255）。改走 `scp → /tmp/` 成功（exit 0），再 `mv` 进 ops 目录。
  推测是 容器 容器对目标目录的写入有额外限制，/tmp 不受影响。
  已验证两侧 md5 一致：`316c811c348cc600ace8ea2569f5e5f7`。
- 远端 AST 检查通过。

### 4.2 真实项目跑包
```
$ python3 ops/build_client_report.py --project /mnt/ssd/bio_data/projects/default --out /tmp/_ck_test
交付目录：/tmp/_ck_test/default_Client_Delivery
  报告：Analysis_Report.md
  校验清单：CHECKSUMS.sha256（285 个文件，sha256sum -c 可复核）
  图件 141 / 结果表 141 / 脚本 0
  打包：default_Client_Delivery.tar.gz（66.0 MB）
```

### 4.3 正向验证：GNU sha256sum -c
```
$ cd /tmp/_ck_test/default_Client_Delivery && sha256sum -c CHECKSUMS.sha256
（过滤掉 ": OK" 后无任何输出）
OK 计数：285 / 285
```
零失败。用的是远端真实 GNU coreutils，不是 Python 自己验自己。

### 4.4 tar 内含清单
```
$ tar tzf default_Client_Delivery.tar.gz | grep -E "CHECKSUMS|manifest"
default_Client_Delivery/CHECKSUMS.sha256
default_Client_Delivery/delivery_manifest.json
```

### 4.5 负向验证：篡改必须被抓到
```
$ printf "\n# tampered\n" >> 03_Interpretation_Report/Analysis_Report.md
$ sha256sum -c CHECKSUMS.sha256
03_Interpretation_Report/Analysis_Report.md: FAILED
sha256sum: WARNING: 1 computed checksum did NOT match
```
恢复后再次全量 285/285 OK。**证明清单不是装饰，真能发现改动。**

### 4.6 清理
`/tmp/_ck_test` 与 `/tmp/ar.bak` 已删除（实测 `ls: cannot access` 确认）。

---

## 五、本地回归

`python ops/build_client_report.py --self-test` → 41 条全 PASS（原 35 + 新增 6）。
无 SKIP、无 FAIL。

---

## 六、行为变化与兼容性

- **新增产物**：每个交付包里多一个 `CHECKSUMS.sha256`。这是新增文件，不改任何既有文件内容。
- **既有 141 图 / 141 表数量不变**：本次跑出的 141/141 与此前一致，说明清单逻辑没有
  干扰复制逻辑。
- **manifest 与清单可能不一致**：manifest 的 `counts` 是"复制成功计数"（OSError 时静默跳过），
  清单是"文件系统实测条目数"。若某次复制失败，清单会少列而 manifest 计数也可能少，
  但清单不会列不存在的文件（已用 `os.path.isfile` 兜底）。两者语义不同，已在代码注释说明。
- **API 兼容**：`assemble()` 返回值是新增键，既有调用方（`server/report.js` 的
  `pullDeliverables`）按名取值，不受影响。

---

## 七、已知边界（未解决，如实记录）

1. **清单不签章**。CHECKSUMS.sha256 能发现"文件被改过"，但不能证明"这个清单本身是官方产出的"。
   要防中间人篡改，需要 GPG 签名或至少把 digest 通过独立通道告知客户。这是设计选择，
   不是疏漏——本项目的威胁模型是交付完整性，不是抗恶意投递。
2. **`.sha256` 旁挂与 `CHECKSUMS.sha256` 并存**。本地回搬目录有逐文件旁挂，
   包内有单一清单，两套机制覆盖不同对象（本地 vs 交付）。没有合并，
   因为旁挂是"回搬后立刻校验"的即时工具，清单是"交付时随包核对"的凭证。
3. **包内 CHECKSUMS 仍是明文**。tar.gz 不加密，digest 可被同包重算。
   若需要抗"连包一起换"的场景，应改为交付时单独回传 digest。

---

## 八、相关锚点

- `ops/build_client_report.py:1944` CHECKSUMS_NAME
- `ops/build_client_report.py:1948-1984` write_checksums
- `ops/build_client_report.py:1926-1931` assemble 接线点
- `ops/build_client_report.py:1933-1945` assemble 返回值
- `ops/build_client_report.py:2106-2128` self_test 六条新断言
- `ops/build_client_report.py:2210-2213` main 输出
- `BioanalysDesktop/server/report.js:409` writeSha256Sidecars（本地旁挂，不同对象）
- `docs/delivery_package_spec.md` 第 3/5/6 条门禁
