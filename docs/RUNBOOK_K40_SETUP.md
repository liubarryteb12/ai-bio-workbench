# K40 环境搭建与恢复一页式手册（RUNBOOK）

> Ticket 2（4 Argon 第二十一轮 Q5 第二批）。目标：一个没碰过这套设备的人，照着这一页
> 能从零把 K40 与工作台连起来，或从故障恢复到可用。细节文档不在这里复述，只给入口。

## 一、这台设备是什么

两层，故障时先判在哪一层：

| 层 | 是什么 | 监听 | 判活命令 |
|---|---|---|---|
| 宿主 | 安卓机上的 Termux，runit 监督四服务（sshd/crond/ssh-agent/ubuntu-sshd） | 8022 | `sv status $PREFIX/var/service/sshd` |
| 容器 | proot Ubuntu，里面跑 dropbear | 10022 | `ssh k40-ubuntu 'echo ALIVE'` |

`ssh k40` 走 8022 进 Termux；`ssh k40-ubuntu` 走 10022 进容器。分析代码只在容器里跑。

## 二、从零开始（第一次搭）

```sh
# 1) 宿主侧四服务：要有 runit 服务目录，四条 run 脚本用四段式模板
#    模板与判据见 docs/k40_service_contract.md（exec 2>&1 必须在 set -eu 之后）
ls /data/data/com.termux/files/usr/var/service/
#    期望看到 sshd/ crond/ ssh-agent/ ubuntu-sshd/ 各含 run（sshd 与 ubuntu-sshd 还有 log/run）

# 2) 点火：runsvdir 必须由 app 域拉起，且只有一份
bash ~/bin/boot_repair.sh          # 幂等：已在跑就什么都不做（见 ops/k40/ensure_runsvdir.sh）

# 3) 宿主 sshd 起来后，从 PC 侧验链路四段
pwsh -File ops/00_link_check.ps1    # 设备→forward→Termux sshd→容器 sshd，逐段报红绿
```

判据：`00_link_check.ps1` exit 0，且能看到「四段全通」。

## 三、每天开工前（30 秒）

```powershell
pwsh -File ops/preflight.mjs              # 宿主机依赖：node>=22 / ssh / scp 齐不齐
node ops/../.tmp/hb_probe.mjs             # 零 SSH 心跳（不经 sshd，断了也能读）
```

心跳 JSON 五层全通才算健康：`runsvdir_count=1`、`sshd_8022_listen=1`、
`dropbear_10022_listen=1`、`ssd_writable=1`、四服务 `run`。
判据与三种层间矛盾（RUN_NO_LISTEN / DOWN_STILL_LISTEN / STOP_IGNORED）见 `docs/k40_heartbeat.md`。

## 四、故障速查（按症状跳转）

| 症状 | 先做什么 | 别做什么 |
|---|---|---|
| PC 连不上 8022 | `ops/00_link_check.ps1`，看哪一段红 | 直接 reboot 手机 |
| 容器 10022 不通但 8022 通 | 容器里 `ps` 看 dropbear；Termux 侧 `sv status ubuntu-sshd` | 先 `sv down` 宿主 sshd（会一起断） |
| 服务显示 run 但端口不监听 | 九成是 host key 缺失：看 `docs/k40_hostkey_guard.md` | 反复 `sv up`（起不来的原因不会变） |
| host key 指纹变了 | 查 `ops/k40/env_lock/hostkey_fingerprints.json`，`ERR_HOSTKEY_ROTATED` | 直接 `ssh-keygen -R` 了事（要留证） |
| 双 runsvdir 抢锁 / 服务全挂 | `ops/fix_runsvdir.sh`（SELinux 域那一节必读） | 在 `run-as` 域里「手动补一条进程」 |
| `sv down` 后容器仍存活 | 正常：`got TERM` 只落在 proot 包装进程 | 以为服务没停而重复 down |

SELinux 域是这套设备最坑的一处：`adb exec-out run-as com.termux` 起的东西落在 `runas_app` 域，
该域 `runsvdir` 起 runsv 会 `access denied`，且跨域 `kill` 静默失败（返回 0 进程不动）。
正确恢复通道（`am force-stop` → monkey 重启 → `input text` 在 app 域点火）见
`docs/k40_runit_recovery.md` 第五节，别自己发明。

## 五、数据在哪

| 你以为 | 实际 |
|---|---|
| 容器里 `/mnt/ssd/bio_data` | 宿主 `$PREFIX/var/lib/proot-distro/containers/ubuntu/rootfs/mnt/ssd/bio_data` |

（没有 `installed-rootfs` 这个目录，宿主侧路径就是上面这条。）

## 六、交付包验收（客户侧或我方复验）

```sh
sha256sum -c <项目>_Client_Delivery.tar.gz.sha256   # 关 1：包本体
tar -xzf <项目>_Client_Delivery.tar.gz              # 关 2：解包
cd <项目>_Client_Delivery && sha256sum -c CHECKSUMS.sha256   # 关 3：逐文件
```

包内 `HOW_TO_VERIFY.txt` 是给客户照抄的那一页；我方一条命令版是
`npm run delivery:verify -- <tar>`（在 `BioanalysDesktop/` 下）。四关判据真源在
`ops/delivery_acceptance_core.mjs`，验收回执与脱敏审计流见 `docs/delivery_acceptance_spec.md` 第六、七节。

## 七、该读哪份文档

| 想知道 | 读 |
|---|---|
| 服务 run 脚本怎么写才对 | `docs/k40_service_contract.md` |
| 健康判据与心跳字段 | `docs/k40_heartbeat.md` |
| 8022 掉了怎么救（含 adb 旁路全流程） | `docs/k40_runit_recovery.md` |
| host key 缺失/轮换 | `docs/k40_hostkey_guard.md`、`docs/k40_hostkey_fingerprints.md` |
| 交付验收与回执 | `docs/delivery_acceptance_spec.md` |
| 三线隔离红线 | `docs/isolation.md` |

