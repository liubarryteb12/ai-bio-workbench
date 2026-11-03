# K40 host key 指纹台账

落点：`ops/k40/env_lock/hostkey_fingerprints.json`（台账）、`BioanalysDesktop/server/hostkey.js`（解析与比对）。
测试：`BioanalysDesktop/tests/hostkey_fingerprints.test.js`（13 条）与
`BioanalysDesktop/tests/diagnostics_routes_contract.test.js`（链路灯两条）。
来源：4 Argon 第十九轮 Q3 裁定。

## 一、为什么要有指纹台账

hostkey 守卫（见 [k40_hostkey_guard.md](k40_hostkey_guard.md)）在密钥丢失时就地重新生成。
这在可达性上是修复，在身份上是**轮换**：客户端 `known_hosts` 里的旧指纹从此失效。两条后续路径都不体面：

| 客户端配置 | 轮换后的结果 |
|---|---|
| `StrictHostKeyChecking=no` | 静默接受新身份，中间人风险无人知晓 |
| strict（默认） | 直接连不上，报 `REMOTE HOST IDENTIFICATION HAS CHANGED` |

所以轮换必须是一个**可查询的事实**，而不是一次沉默的状态漂移。台账是期望值的真源，比对是检测。

## 二、为什么不进 SYSTEM_LEDGER.json

`docs/generated/SYSTEM_LEDGER.json` 由 `ops/ledger_gen.mjs` 纯离线、确定性生成，CI 在没有真机的环境里
重跑它并做 `git diff` 校验。指纹是**硬件运行态**：设备重装、密钥重建、换机都会改它，而且改得合法。
把运行态写进确定产物会让每次真机变动都污染 CI 判据，把「代码漂移」和「设备状态变化」搅成同一个红。

指纹与 `r_packages.csv`、`pip_freeze.txt`、`apt_manual.txt` 同属**算力面环境锁**，落
`ops/k40/env_lock/`，由 `ledger_gen.mjs` 的 `k40HostAssets` 以资产形式追踪（清单对得上，内容不参与 diff 校验）。

## 三、台账形态

```json
{
  "schema": "k40_hostkey_fingerprints/v1",
  "hosts": [
    {
      "host": "k40",
      "port": 8022,
      "algorithm": "ED25519",
      "key_path": "/data/data/com.termux/files/usr/etc/ssh/ssh_host_ed25519_key.pub",
      "probe": "…ssh-keygen -lf $PREFIX/etc/ssh/ssh_host_ed25519_key.pub",
      "fingerprint": "SHA256:mKwIdn9qAXN73WVRYnH6aMrRC37LTUkaNl276UpSrKE"
    }
  ]
}
```

每个字段都有校验，不是摆设：

- `schema` 必须精确相等，换版本要改代码，防止旧解析器吃新格式。
- `host` 是 ssh config 里的别名，直接当探测目标。
- `probe` 是**取指纹的确切命令**，跑在目标机上（经 `ssh <host> <probe>`）。放在数据里而不是代码里，
  因为两把钥匙的取法本就不同：Termux 用 `ssh-keygen -lf <pub>`；容器里是 dropbear 原生格式，
  先 `dropbearkey -y` 导出公钥再喂给 `ssh-keygen -lf -`。
- `fingerprint` 只收 `SHA256:` 形态（base64 32 字节，43 字符，可能带一个 `=`）。MD5 与空串一律判台账无效：
  空指纹会让「所有比对都失配」，MD5 根本不可与本表的 SHA256 相比，两种错都该在启动时炸掉而不是逐条报红。
- `key_path` 与 `port` 是给人看的定位信息，不参与判据。

## 四、诊断码与链路结论

| 诊断码 | 触发条件 | 含义 |
|---|---|---|
| `ERR_HOSTKEY_ROTATED` | 探测到的指纹与台账不同 | 真轮换，需同步 `known_hosts` 与台账 |
| `ERR_HOSTKEY_PROBE_UNREADABLE` | 探测命令抛错，或输出里没有 SHA256 指纹 | 读不到，不能当通过 |
| `ERR_HOSTKEY_LEDGER_MISSING` | 台账文件读不到 | 首次部署或路径搬移 |
| `ERR_HOSTKEY_LEDGER_INVALID` | schema / hosts / 指纹形态 / probe 缺字段 | 台账本身坏了，点名到具体 host |

优先级：**轮换 > 探测不可读**。轮换是根因候选，探测失败多半是它的后果（或同一台设备上的连带现象）。

**链路总体结论**（`server/link.js` 的 `resolveLinkOverall`，纯函数、单独可测）：

- 四段探测有任一段失败，或任一主服务 down → `fail`
- 日志子服务 crash-loop，或指纹侧**任何**非空诊断码 → `warn`
- 其余 → `pass`

指纹不进 `segments`、不参与 `hardFail`：轮换之后连接常常仍然可用（`StrictHostKeyChecking=no`），
把它判成 fail 会让「链路是否可用」这个判据失真。但也不给「探测读不到指纹」单开更宽的口子：
读不到和变了都该有人看一眼，所以任何非空诊断码都抬 warn。
`/api/selfcheck` 的链路灯把诊断码拼进 `detail`（`CPU=… ; ERR_HOSTKEY_ROTATED: …`），并额外带
`hostkeys` 结构化字段；无诊断码时 `detail` 保持原样，不留空分隔符。

## 五、轮换后的同步步骤

1. 从设备取新指纹（两台都要，只轮换一台很常见）：

   ```sh
   ssh k40 'ssh-keygen -lf $PREFIX/etc/ssh/ssh_host_ed25519_key.pub'
   ssh k40-ubuntu "dropbearkey -y -f /etc/dropbear/dropbear_ed25519_host_key | ssh-keygen -lf -"
   ```

2. 更新 `ops/k40/env_lock/hostkey_fingerprints.json` 的 `fingerprint` 与 `observed_at`。
3. 清掉本地 `known_hosts` 里对应条目（`ssh-keygen -R '[127.0.0.1]:8022'`、`ssh-keygen -R '[127.0.0.1]:10022'`，
   按实际连接用的地址来），首次连接时按新指纹登记。
4. 重跑链路自检，确认 `hostkeys.code === null`。

台账与设备**同时存在两份真源**这件事无法消除（设备上的密钥、仓库里的期望值），所以判据只能比对。
本条优先于「改台账让人肉记忆消失」：失配必须由人确认是授权轮换还是一次入侵。

## 六、真机实测（2026-11-03）

两台实测指纹与台账一致，探针走真实 ssh：

```
REAL_PASS=true code=null
  k40         port=8022  observed=SHA256:mKwIdn9qAXN73WVRYnH6aMrRC37LTUkaNl276UpSrKE
  k40-ubuntu  port=10022 observed=SHA256:c0Lm97OYp7up92tIKMXJ7lEKW5crWBLELkHZAUUTQ4A
```

红路径用「把期望值换成假指纹、设备不动」的方式验证（不动生产密钥，这是刻意的：删钥演练只在容器侧做过，
见 hostkey 文档）：

```
RED_PASS=false code=ERR_HOSTKEY_ROTATED
RED_DETAIL=k40: 期望 SHA256:AAAA…，实际 SHA256:mKwI…；host key 已轮换…
```

## 七、变异反证（8 条全红）

`node .tmp/mutate_hostkey.mjs`（基线绿 → 逐条变异 → 恢复 → 校验逐字节复原）：

| 变异 | 结果 |
|---|---|
| M1 `compareFingerprint` 恒判通过 | KILLED |
| M2 探测抛错当成可读成功 | KILLED |
| M3 台账指纹形态校验放宽成任意串 | KILLED |
| M4 去掉 probe 缺失校验 | KILLED |
| M5 轮换从总体判定里拿掉 | KILLED |
| M6 优先级反转成探测失败优先 | KILLED |
| M7 自检链路灯吞掉指纹诊断码 | KILLED |
| M8 台账里 k40 的 probe 串到容器钥匙 | KILLED |

## 八、边界

- 探针要能 ssh 上去。设备离线时拿到的是 `ERR_HOSTKEY_PROBE_UNREADABLE`，不是「指纹正常」，
  但它与链路四段失败会同时出现，看 `segments` 定位即可。
- 台账只收 ed25519。`ssh-keygen -A` 会顺带生成 mldsa44 / rsa 等额外钥匙（见 hostkey 文档第六节），
  它们不在台账里，轮换也不会触发告警；需要时按同样办法加条目。
- 指纹比对的是**身份**，不是权限或配置。密钥长度、算法变更这类改动，只要指纹不一致就会命中
  `ERR_HOSTKEY_ROTATED`，同步步骤相同。
