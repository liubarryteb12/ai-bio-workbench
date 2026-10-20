# 红米 K40 CPU 拓扑与亲和性行为（实测文档 v1.0，2026-10-20）

> 来源：`con_hf/2026-10-20_k40_linux_adaptation_plan.md` 阶段 0 实测。
> 本文所有结论均有实测命令输出支撑；未验证项明确标注。
> 读者：后续所有涉及绑核 / 线程封顶 / 性能预期的会话，动手前先读本文。

## 一、硬件拓扑（`/sys/devices/system/cpu/` 实测）

| 核 | 角色 | 最高频率 | 实测 |
|---|---|---|---|
| cpu0-3 | Cortex-A55 小核 | 1.8048 GHz | `taskset -c 3` OK |
| cpu4-6 | Cortex-A77 大核 | 2.4192 GHz | `taskset -c 4-6` OK，绑定完整 |
| cpu7 | Cortex-A77 Prime | 3.1872 GHz | **单绑恒失败**（见 §2） |

调度器：`schedutil`（无 root，不改 governor）；`online = 0-7`。
内存：12 GB（MemTotal 11783376 kB），Swap 8 GB（zram）。

## 二、亲和性实测行为（2026-10-20，Termux 与容器两侧一致）

### 2.1 taskset 组合绑定完整生效

| 请求 | 结果 | 子进程实际 `Cpus_allowed_list` |
|---|---|---|
| `taskset -c 4,5,6` | OK | `4-6`（三核完整） |
| `taskset -c 5,6` | OK | `5-6` |
| `taskset -c 7,6` | OK | — |
| `taskset -c 0-7` | OK | `0-7` |

⇒ aims 契约「绑大核 4,5,6」**名实相符**：三个大核都进入掩码，且负载实测被调度到
（`ps -o psr` 采样见 `c5:1` / `c6:1` / `c4:1` 频繁出现，见 §2.4）。

### 2.2 单绑隔离核恒失败（EINVAL）

| 请求 | 结果 |
|---|---|
| `taskset -c 7` | **FAIL** `Invalid argument` |
| `taskset -c 5` | **FAIL** `Invalid argument` |
| `taskset -c 5,7` | **FAIL** `Invalid argument` |

语义归纳：**只含「被隔离核」（5 和/或 7）的集合被拒；集合中至少含一个非隔离核即放行**。
这是典型的部分核隔离（isolcpus / MIUI 定制）行为。**隔离的具体机制未定位**
（`core_ctl` 接口不存在、cgroup v1 cpuset 显示 `top-app`、无 `/dev/cpuset`），
记录现象备查，不猜测机制。

推论：**不存在"只跑 Prime 单核"的加速路线**；Prime 只能与其他核组合使用
（如 `6,7`），收益待实测（阶段 0 第二轮）。

### 2.3 cpuset 允许集合存在动态性

同一链路先后观测：某 ssh shell 亲和性 = `0-4,6`（瞬时），其后 10 次采样全为 `0-7`。
⇒ 「可用核数」不是常量；任何依赖「全部 8 核可用」的假设都不成立。
对策略的含义：绑核集合必须**只用确定可用的核**（4,5,6 满足），
不能依赖"现在能用几个核"。

### 2.4 核分布实测（ps -o psr 高频采样）

5 分钟持续 matmul 负载期间，`Rscript`/`python3` 线程出现在 c0-c7 全谱，
其中 `c4/c5/c6/c7` 为主 ⇒ **cpu5 与 cpu7 在实际负载中确实被调度到**，
"空置超大核 7"是 aims 的主动策略选择，而非硬件不可用。

## 三、BLAS 实况（决定线程变量是否生效）

| 运行时 | BLAS 实现 | 线程控制变量 |
|---|---|---|
| R 4.3.3 | **OpenBLAS 0.3.26 pthread**（2026-10-20 用户采纳升级；apt 装 `libopenblas-pthread-dev` 时 alternatives auto 切换到位） | `OPENBLAS_NUM_THREADS` 等**现已对 R 生效**：3 线程 47.99 GFLOPS / 1 线程 20.98 |
| Python 3.12.3 / numpy 2.5.3 | scipy-openblas 0.3.34（`DYNAMIC_ARCH NO_AFFINITY`） | `OPENBLAS_NUM_THREADS` 有效 |

⇒ 容器 `/etc/profile.d/bio_limits.sh` 的 3 线程封顶现在**对 R 与 Python 两侧都生效**。
升级前 R 为 reference BLAS（单线程 2.94 GFLOPS，`OPENBLAS_*` 空转，lmFit 5000×50 ~0.032s/次）。
**升级收益 16.3 倍**（R dgemm 1500³×3：2.94 → 47.99 GFLOPS）。
**数值影响实测为零**（2026-10-20 严格 A/B，软链切换 + trap 恢复）：limma 全流程
（lmFit+eBayes+topTable，5000×50，seed 20261013）在 reference 与 OpenBLAS 下 6 个
%.10g 校验量（sum logFC / sum t / sum B / sum adjP / top1 / top5 哈希）**逐位一致**；
1500³ dgemm checksum 亦一致（-7600.0476）。⇒ 本项目统计路径无跨 BLAS 数值差异。

## 四、线程封顶的生效面（容易踩的三不管）

| 执行方式 | bio_limits 是否生效 | 说明 |
|---|---|---|
| 交互登录容器 | 生效 | `/etc/profile.d/` 正常加载 |
| `run_throttled_task.sh` 任务 | 生效 | 脚本内显式 `source /etc/profile.d/bio_limits.sh` |
| `ssh k40-ubuntu 'cmd'` 一次性命令 | **不生效** | 非登录 shell 不加载 profile.d |
| 工作台下发任务 | 生效 | 走 `run_throttled_task.sh` 或 task.js 注入 env |

⇒ 手工在容器里直跑分析时，线程数是**未封顶**的（numpy 默认吃满可见核）。

## 五、热行为

- 空闲：`thermal_zone0` ≈ 48°C，各 cpu zone 60-68°C。
- 5 分钟持续 CPU 负载（matmul 3 线程）：**全 zone 峰值 85.3°C**（26 次采样中最高值，
  具体 zone 未逐点记录，第二轮带 zone 名）。
- 含义：持续重算几分钟即接近降频区；aims「空置 7 防发热」与「3 线程封顶」
  有其热学依据；长任务（>10 min）必须关注温度曲线（会话#7 记录：满载 10 分钟 -21%）。

## 六、健壮性缺口：taskset 失败降级（2026-10-20 已修复 + 双路径实证）

`ops/run_throttled_task.sh` 原实现中 `taskset -c 4,5,6` 若在 Android 动态调整下返回
EINVAL，`set +e` 段照常走完但 `EXIT_CODE≠0` ⇒ 台账记 `failed`、**任务实际从未执行**
（风险已于 2026-10-20 基准中真实触发一次：`taskset -c 6,7` EINVAL）。

**修复（2026-10-20，母本 `ops/run_throttled_task.sh`，md5 `2633196e…`）**：执行前预探测
`taskset -c 4,5,6 true`，失败则 `AFFINITY_PIN=""` 降级为不绑核（保留 nice/ionice 降权），
降级事件打印 `[wrapper] … 降级` 到 stdout（task.js SSE 日志流可见）；**不改台账 JSON schema**
（`04_check_logs` 巡检零影响）。服务器副本已部署（旧版备份 `.bak_20261020_pinaffinity`）。

**双路径实证（2026-10-20 真跑，探针跑完已清理）**：

| 路径 | 结果 |
|---|---|
| 正路径（4,5,6 可用） | exit 0；探针 affinity=`4-6`（绑核完整）；无降级标记；台账 schema 原样 |
| 负路径（预探测必然失败，sed 造 `-c 99` 副本） | stdout 出 `[wrapper] … 降级`；exit 0；探针 affinity=`0-7`（真在执行）；台账 `completed`/`passed` |

## 七、效率基准实测（2026-10-20，两轮 + 交替验证）

测试方法：固定 seed=20261013；R 侧 dgemm 1500×1500×3 rep（reference BLAS 单线程）；
Python 侧 matmul 3000×3000×3 rep（scipy-openblas）；每配置 2 轮；温度每 3s 采样。
脚本母本：`cn_debug/2026-10-20_k40_bench/`（bench_r.R / bench_py.py / run_bench.sh /
bench_ab.sh / watch_thermal.sh），已部署容器 `/root/bio_workbench/_bench/`。

### 7.1 第一轮（顺序跑 A→H，**有温度顺序效应，仅参考**）

Python 3000³ matmul×3（wall 秒，越短越好）：

| 配置 | 均值 | 相对 A |
|---|---|---|
| A 不绑核+3 线程 | **3.56** | 基准 |
| B 4,5,6+3 线程（aims 契约） | 5.22 | +46.6% |
| E 0-7+3 线程 | 4.32 | +21.4% |
| G 不绑核+4 线程 | 5.24 | +47.2% |
| H 6,7+2 线程 | 5.86 | +64.6% |

R dgemm×3（单线程，只反映绑核）：

| 配置 | 均值 | 相对 A |
|---|---|---|
| A 不绑核 | **6.90** | 基准 |
| H 6,7 | 6.89 | -0.1% |
| B 4,5,6 | 7.32 | +6.1% |
| C 4,6 | 7.61 | +10.3% |
| E 0-7 | 7.65 | +10.9% |

### 7.2 交替验证（A/B 轮换 3 轮，温度均匀化 —— **这是可信结论**）

| 轮 | A 不绑核+3 | B 4,5,6+3（契约） | A 领先 |
|---|---|---|---|
| 1 | 4.878 | 5.299 | 8.6% |
| 2 | 3.905 | 5.660 | 44.7% |
| 3 | 3.646 | 5.164 | 41.5% |
| **均值** | **4.14** | **5.37** | **+29.8%** |

**结论（Python 多线程负载）**：不绑核 + 3 线程每轮全胜，均值快 **~30%**。
机理：不绑核时 EAS 可把线程放到当时最优核（含 Prime 3.19GHz，psr 采样证实 c7 被用到），
绑 4,5,6（2.42GHz 上限）反而封顶了单线程性能上限；OpenBLAS 的 NO_AFFINITY 特性也意味着
它自己不抢核，与 EAS 配合比静态绑核更优。

**结论（R 单线程 reference BLAS）**：不绑核同样领先 6-11%（同为 EAS 选核优势）。

**线程数甜点**：3 线程 > 4 线程（G 比 A 慢 47%，首轮）——核间同步开销超过第 4 线程收益，
现有 `bio_limits.sh` 的 3 线程封顶是合理值，**不建议上调**。

**温度代价**：不绑核峰值温度更高（负载跑满更多核，含 Prime）；首轮全序列峰值 85.7°C
（cpu-1-1-step zone），均值 69.8°C。绑 4,5,6 的热学优势存在但本轮未做纯净对比（混杂）。

### 7.3 参考吞吐（GFLOPS，3000³ matmul / 1500³ dgemm）

- Python 3 线程不绑核：**45.7 GFLOPS**
- Python 4 线程不绑核：32.0 GFLOPS
- Python 2 线程（6,7）：25.3-30.5 GFLOPS
- R reference BLAS 单线程（升级前）：**2.94 GFLOPS**；R OpenBLAS 3 线程（2026-10-20 起）：**47.99 GFLOPS**（见 §3）

## 八、契约变更记录（2026-10-20 用户拍板，均已落地实测）

1. ~~**绑核策略（aims §六契约）待拍板**~~ **已变更落地**：`aims/aims.txt`（§三模块 D 卡片、
   §3 监控灯、§六.3 代码示例）+ `ops/run_throttled_task.sh` + `BioanalysDesktop`
   （task.js 注释 / App.tsx 文案，npm build 已重建）全部改为「**默认不绑核 + nice/ionice 降权**」，
   保留 `BIO_PIN_CPUS=4,5,6` 开关可恢复绑核。三路径实证（探针已删）：默认 affinity=`0-7`；
   开关 affinity=`4-6`；`BIO_PIN_CPUS=99` 必然失败 → stdout 降级标记 + affinity=`0-7` + exit 0；
   台账 `wrapper` 字段如实动态化。
2. ~~**R BLAS 升级待拍板**~~ **已完成**：`libopenblas-pthread-dev` 已装（apt auto 切 alternative），
   R 3 线程 47.99 GFLOPS（**16.3 倍**），数值零差异（§三 严格 A/B）。
3. ~~`run_throttled_task.sh` 绑核失败降级~~ **已修复并双路径实证**（见 §六）。

## 九、复现命令（可直接抄）

```bash
# 拓扑与频率
for c in 0 4 7; do echo "cpu$c max=$(cat /sys/devices/system/cpu/cpu$c/cpufreq/cpuinfo_max_freq)"; done
# 绑定语义
taskset -c 4,5,6 grep Cpus_allowed_list /proc/self/status   # -> 4-6
taskset -c 7 true                                            # -> Invalid argument
# 运行核分布（负载期间另开终端）
ps -eo psr,comm | awk '$2 ~ /^(Rscript|python3)$/ {c[$1]++} END {for (k in c) print k":"c[k]}'
# 温度
for z in /sys/class/thermal/thermal_zone*/temp; do echo "${z%temp}type=$(cat ${z%temp}type) temp=$(cat $z)"; done
# 唤醒锁（必须经 adb shell，Termux ssh 会话内 dumpsys power 无输出）
adb shell "dumpsys power | grep -A2 'Wake Locks'"
```
