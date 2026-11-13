/**
 * selfcheck.js: 五维环境自检的服务端实现（aims/20261026_0749_aims_v3_0_spec.md §3「五维环境自检界面」）
 *
 * 为什么单独成模块：
 *   自检的判据（阈值、单位换算、输出协议解析）全是纯逻辑，混在 index.js 的
 *   HTTP handler 里既没法单测，也说不清"哪一维按什么口径判"。这里把
 *   「命令构造 / 输出解析 / 判据评估」三段拆成纯函数，index.js 只负责
 *   runRemote 取原始文本再交给它们（D6 收敛，2026-10-21）。
 *
 * 输出协议（一行一条，跟 report.js 的交付门禁同款思路，便于单测）：
 *   LOAD|<1m>|<5m>|<15m>      /proc/loadavg 前三段
 *   CPUS|<n>                  nproc
 *   TEMP|<millidegree>        /sys/class/thermal/thermal_zone* 最大值
 *   MEM|<键>|<kB>             MemTotal: / MemAvailable:
 *   MEMMAX|<bytes|max>        cgroup v2 memory.max
 *   MEMCUR|<bytes>            cgroup v2 memory.current
 *   LINE|<line_id>|<rc>       跨线隔离门禁脚本逐线退出码
 *   BRIDGE|<present|missing>  桥接四项断言脚本是否部署
 *   END|                      输出完整标记（缺了就是 ssh 被截断，不许当通过）
 *
 * 阈值来源与理由（写死在代码里而不是拍脑袋改）：
 *   - 温度 85°C 告警 / 95°C 阻断：K40 实测长时间满载 46-86°C（踩坑台账 #201），
 *     85 以上属于降频区，95 是 Android 热保护关机区附近。
 *   - 内存 90% 告警 / 100% 阻断：容器 RLIMIT 是 7.5GB 软熔断（踩坑台账 #202），
 *     贴到 90% 再跑重型任务必被 LMK 杀（实测三次）。
 *   - 负载 1.5 倍核数告警：不绑核 + EAS 调度下负载短暂超核数是常态，
 *     超过 1.5 倍说明有并发重型任务在跑，自检要提示而不是直接判失败。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { LINES } from './domain.js';
import { runSync } from './proc.js';

/**
 * 宿主机工作区污染检查（2026-11-02，D-30 防线）
 *
 * 事故：本地探针在 D:\Git\mnt\ssd\bio_data 建了目录，Git-bash 里 /mnt/ssd 从此存在，
 * bridge_guard.sh 的 auto 模式据此误判「已在计算面」走 local 硬阻断，7 条测试成片红。
 * 这类污染不会自己消失，且每次全仓扫描都被误导，必须在自检里显式报警。
 * 判据：Git 安装根（GIT_ROOT 或 D:/Git）下出现 mnt/ssd 即返回告警路径列表。
 */
export function detectHostMntPollution(gitRoot = process.env.GIT_ROOT || 'D:/Git') {
  if (process.platform !== 'win32') return [];
  const suspects = [
    path.join(gitRoot, 'mnt', 'ssd'),
    path.join(gitRoot, 'mnt', 'ssd', 'bio_data'),
  ];
  return suspects.filter((dir) => { try { return fs.existsSync(dir); } catch { return false; } });
}

/** 项目 R 垫片绝对路径（layout_autoload 零重写外挂；母版实际执行的就是它） */
export const RSCRIPT_PROJECT_BIN = '/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript';

/**
 * 期望 R 版本。真源是 docs/software_versions.json 的 interpreters[name=R].version；
 * 这里写常量是为了自检热路径不读文件，由 tests/selfcheck.test.js 断言两处一致
 * （改 json 不改这里，测试判红——账实分离的口子从测试侧焊死）。
 */
export const EXPECTED_R_VERSION = '4.5.3';

/** 运行时内存上限：生产默认 7.5GB，单任务最高 8.0GB；cgroup 未给出数值上限时的兜底 */
export const DEFAULT_MEM_QUOTA_GB = 7.5;
export const MAX_MEM_QUOTA_GB = 8.0;
export const MEM_QUOTA_BYTES = DEFAULT_MEM_QUOTA_GB * 1024 * 1024 * 1024;

/**
 * 解析 BIO_MEM_LIMIT_GB，口径与 tools/ops/bio_memory_guard.py 保持一致。
 * cgroup 在 proot 下通常不可读，自检灯要靠这个兜底值判断水位。
 */
export function resolveMemQuotaBytes(env = process.env) {
  const raw = env?.BIO_MEM_LIMIT_GB;
  if (raw === undefined || raw === null || String(raw).trim() === '') return MEM_QUOTA_BYTES;
  const gb = Number(raw);
  if (!Number.isFinite(gb) || gb <= 0) return MEM_QUOTA_BYTES;
  return Math.min(gb, MAX_MEM_QUOTA_GB) * 1024 * 1024 * 1024;
}

/** 温度阈值（摄氏度） */
export const TEMP_WARN_C = 85;
export const TEMP_FAIL_C = 95;

/** 内存水位阈值（占配额比例） */
export const MEM_WARN_RATIO = 0.9;

/** 负载告警阈值（1 分钟负载 / 核数） */
export const LOAD_WARN_RATIO = 1.5;

/** 存储水位门禁（aims §3 第 2 条） */
export const STORAGE_MIN_FREE_PCT = 20;

/** 隔离门禁与桥接校验脚本的远端路径 */
export const ISOLATION_SCRIPT = '/mnt/ssd/bio_data/ops/check_storage_and_isolation.sh';
export const BRIDGE_SCRIPT = '/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py';

/**
 * 第 3 维命令：SoC 算力 / 温度 / 内存水位，一次 ssh 取全。
 * 每一步都带 `2>/dev/null`，缺传感器或非 cgroup v2 时只是少一行，不炸整条命令。
 */
export function buildHardwareCommand() {
  return [
    `cat /proc/loadavg | awk '{print "LOAD|" $1 "|" $2 "|" $3}'`,
    `nproc | sed 's/^/CPUS|/'`,
    `(cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | sort -n | tail -1 | sed 's/^/TEMP|/')`,
    `awk '/^MemTotal:|^MemAvailable:/ {print "MEM|" $1 "|" $2}' /proc/meminfo`,
    `(cat /sys/fs/cgroup/memory.max 2>/dev/null | sed 's/^/MEMMAX|/')`,
    `(cat /sys/fs/cgroup/memory.current 2>/dev/null | sed 's/^/MEMCUR|/')`,
    // RVER：用项目 R 垫片绝对路径取版本（不是裸 Rscript——那正是被防的漂移源）。
    // 容器里系统 R 4.3.3 与项目 4.5.3 并存（2026-11-02 实测），非交互 SSH 裸调必中 4.3.3。
    `(${RSCRIPT_PROJECT_BIN} --version 2>&1 | head -1 | sed 's/^/RVER|/')`,
    `echo 'END|'`,
  ].join('; ');
}

/**
 * 解析第 3 维输出。
 * @returns {{load: number[]|null, cpus: number|null, tempC: number|null,
 *   memTotalKb: number|null, memAvailKb: number|null,
 *   memMaxBytes: number|null, memCurBytes: number|null, sawEnd: boolean}}
 */
export function parseHardwareOutput(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let load = null;
  let cpus = null;
  let tempMilli = null;
  let memTotalKb = null;
  let memAvailKb = null;
  let memMaxBytes = null;
  let memCurBytes = null;
  let rVersion = null;
  let sawEnd = false;

  for (const line of lines) {
    if (line === 'END|') { sawEnd = true; continue; }
    const parts = line.split('|');
    const tag = parts[0];
    if (tag === 'LOAD' && parts.length >= 4) {
      const nums = parts.slice(1, 4).map(Number);
      if (nums.every((n) => Number.isFinite(n))) load = nums;
      continue;
    }
    if (tag === 'CPUS') {
      const n = Number(parts[1]);
      if (Number.isFinite(n) && n > 0) cpus = n;
      continue;
    }
    if (tag === 'TEMP') {
      const n = Number(parts[1]);
      // 有的机器直接报摄氏度（< 1000），有的是毫摄氏度
      if (Number.isFinite(n)) tempMilli = n;
      continue;
    }
    if (tag === 'MEM' && parts.length >= 3) {
      const kb = Number(parts[2]);
      if (!Number.isFinite(kb)) continue;
      if (parts[1].startsWith('MemTotal')) memTotalKb = kb;
      else if (parts[1].startsWith('MemAvailable')) memAvailKb = kb;
      continue;
    }
    if (tag === 'RVER') {
      const m = String(parts[1] || '').match(/(\d+\.\d+\.\d+)/);
      if (m) rVersion = m[1];
      continue;
    }
    if (tag === 'MEMMAX') {
      const n = Number(parts[1]);
      if (Number.isFinite(n) && n > 0) memMaxBytes = n; // 'max' 字样自然被过滤
      continue;
    }
    if (tag === 'MEMCUR') {
      const n = Number(parts[1]);
      if (Number.isFinite(n) && n >= 0) memCurBytes = n;
      continue;
    }
  }

  const tempC = tempMilli === null
    ? null
    : (tempMilli > 1000 ? Math.round(tempMilli / 1000) : Math.round(tempMilli));

  return { load, cpus, tempC, memTotalKb, memAvailKb, memMaxBytes, memCurBytes, rVersion, sawEnd };
}

/** 把解析结果折算成灯：{status, value, detail} */
export function evaluateHardware(parsed) {
  if (!parsed.sawEnd) {
    return { status: 'unknown', value: '', detail: '远端输出缺 END 标记（疑似命令被截断，不能当作通过）' };
  }

  const quotaBytes = parsed.memMaxBytes ?? resolveMemQuotaBytes();
  const usedBytes = parsed.memCurBytes !== null
    ? parsed.memCurBytes
    : (parsed.memTotalKb !== null && parsed.memAvailKb !== null
      ? (parsed.memTotalKb - parsed.memAvailKb) * 1024
      : null);
  const memRatio = usedBytes === null || quotaBytes <= 0 ? null : usedBytes / quotaBytes;
  const loadRatio = parsed.load === null || !parsed.cpus ? null : parsed.load[0] / parsed.cpus;

  const gb = (bytes) => (bytes / (1024 ** 3)).toFixed(1);
  const valueParts = [];
  if (parsed.load !== null) {
    const [l1, l5, l15] = parsed.load;
    valueParts.push(`CPU ${l1.toFixed(2)}/${l5.toFixed(2)}/${l15.toFixed(2)}${parsed.cpus ? `（${parsed.cpus} 核）` : ''}`);
  }
  valueParts.push(parsed.tempC === null ? '温度 不可读' : `${parsed.tempC}°C`);
  valueParts.push(memRatio === null
    ? '内存 不可读'
    : `内存 ${gb(usedBytes)}/${gb(quotaBytes)}GB（${Math.round(memRatio * 100)}%）`);
  valueParts.push(parsed.rVersion === null
    ? 'R 版本 未探测'
    : `R ${parsed.rVersion}`);

  const detailParts = [];
  detailParts.push(`温度告警 ${TEMP_WARN_C}°C / 阻断 ${TEMP_FAIL_C}°C`);
  detailParts.push(`内存配额 ${gb(quotaBytes)}GB，告警 ${Math.round(MEM_WARN_RATIO * 100)}%`);
  if (loadRatio !== null) detailParts.push(`负载 ${loadRatio.toFixed(2)} 核当量（告警 ${LOAD_WARN_RATIO}）`);
  detailParts.push(parsed.rVersion === null
    ? `R 版本探针无输出（期望 ${EXPECTED_R_VERSION}，走 ${RSCRIPT_PROJECT_BIN}）`
    : `R 版本钉 ${EXPECTED_R_VERSION}（真源 docs/software_versions.json），实测 ${parsed.rVersion}${parsed.rVersion === EXPECTED_R_VERSION ? '' : ' ← 漂移，判失败'}`);

  /**
   * R 版本漂移 = fail（2026-11-02，Argon 双 R 锁死第二重）。
   * 判据：RVER 缺失（探针没跑出来/被截断）不判 fail 判 unknown 语义并入 detail——
   * 但读到非 EXPECTED_R_VERSION（如系统 4.3.3）必须 fail：跑错 R 意味着
   * 整棵包库都错，产出的统计结果不可信，比温度高更隐蔽也更致命。
   */
  const rVersionMismatch = parsed.rVersion !== null && parsed.rVersion !== EXPECTED_R_VERSION;
  const fail = (parsed.tempC !== null && parsed.tempC >= TEMP_FAIL_C)
    || (memRatio !== null && memRatio >= 1)
    || rVersionMismatch;
  const warn = (parsed.tempC !== null && parsed.tempC >= TEMP_WARN_C)
    || (memRatio !== null && memRatio >= MEM_WARN_RATIO)
    || (loadRatio !== null && loadRatio >= LOAD_WARN_RATIO);

  const status = fail ? 'fail' : warn ? 'warn' : 'pass';
  return { status, value: valueParts.join(' · '), detail: detailParts.join('；') };
}

/**
 * 第 4 维命令：三条线逐线跑隔离门禁（原来只写死 line1_bulk），再探桥接脚本是否部署。
 * 用 `rc=$?` 显式接退出码，避免 `echo "LINE|$l|$?"` 被中间命令改掉。
 */
export function buildIsolationCommand() {
  const loop = LINES
    .map((line) => `bash ${ISOLATION_SCRIPT} ${line} >/dev/null 2>&1; rc=$?; echo "LINE|${line}|$rc"`)
    .join('; ');
  const bridge = `if [ -f ${BRIDGE_SCRIPT} ]; then echo 'BRIDGE|present'; else echo 'BRIDGE|missing'; fi`;
  return `${loop}; ${bridge}; echo 'END|'`;
}

/**
 * 解析第 4 维输出。
 * @returns {{lines: Array<{line: string, rc: number}>, bridgePresent: boolean|null, sawEnd: boolean}}
 */
export function parseIsolationOutput(text) {
  const rows = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lines = [];
  let bridgePresent = null;
  let sawEnd = false;
  for (const row of rows) {
    if (row === 'END|') { sawEnd = true; continue; }
    const parts = row.split('|');
    if (parts[0] === 'LINE' && parts.length >= 3) {
      const rc = Number(parts[2]);
      if (Number.isFinite(rc)) lines.push({ line: parts[1], rc });
      continue;
    }
    if (parts[0] === 'BRIDGE') {
      bridgePresent = parts[1] === 'present';
    }
  }
  return { lines, bridgePresent, sawEnd };
}

/** 把第 4 维解析结果折算成灯 */
export function evaluateIsolation(parsed) {
  if (!parsed.sawEnd) {
    return { status: 'unknown', value: '', detail: '远端输出缺 END 标记（疑似命令被截断）' };
  }
  if (parsed.lines.length === 0) {
    return {
      status: 'unknown',
      value: '',
      detail: `门禁脚本未产出结果（可能未部署：${ISOLATION_SCRIPT}）`,
    };
  }
  const failed = parsed.lines.filter((item) => item.rc !== 0);
  const value = parsed.lines.map((item) => `${item.line}:${item.rc === 0 ? 'ok' : `FAIL(rc=${item.rc})`}`).join(' | ');
  const bridgeText = parsed.bridgePresent === null
    ? '桥接四项断言脚本状态未知'
    : parsed.bridgePresent
      ? '桥接四项断言脚本已部署（提交层已接线：POST /api/tasks/submit）'
      : '桥接四项断言脚本未部署（提交层已接线，脚本缺失时该层会报链路错误）';
  const status = failed.length > 0 ? 'fail' : parsed.bridgePresent === false ? 'warn' : 'pass';
  return {
    status,
    value,
    detail: failed.length > 0
      ? `${failed.length} 条线隔离门禁未过；${bridgeText}`
      : `三线隔离门禁全部通过；${bridgeText}`,
  };
}

/**
 * 第 4 维的 SHA256 一致性比对（aims §三.3：本地与远端核心文件哈希必须一致）。
 *
 * 口径见 SPEC_DECISIONS D-07：
 *   本地与远端都存在但哈希不同 -> fail（reason 带两个哈希前 12 位）
 *   远端文件不存在             -> warn（reason 写 MISSING）
 *   ssh 不可达 / 输出缺哨兵     -> unknown（reason 写 UNREACHABLE / NO_SENTINEL）
 * 不可达绝不判 fail：一次网络抖动就让自检全红，值班会失去对红灯的信任。
 *
 * 解析纪律（踩坑台账 P-04 / P-10）：
 *   ssh 非 tty 时会把 "Warning: Permanently added ..." 写到 stderr，调用方 2>&1
 *   合并后顶掉首行。所以这里逐行匹配特征白名单（64 位 hex + 空白 + 路径），
 *   先过滤 Warning 行，禁止整段锚定正则。
 */

/** 仓库根：BioanalysDesktop/server/ 上两级；用模块 URL 推导，与进程 cwd 无关 */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** 远端 ssh 目标与部署根（与 tools/ops/sync_and_verify_remote.ps1 的默认值一致） */
export const SHA256_SSH_TARGET = 'k40-ubuntu';
export const SHA256_REMOTE_ROOT = '/mnt/ssd/bio_data';

/** 远端输出完整标记：缺了就是 ssh 被截断，不许当通过 */
export const SHA256_SENTINEL = 'SHA256END|';

/**
 * 参与比对的核心里程碑文件。repo 是仓库根相对路径，remote 是远端绝对路径。
 * 守卫有两份：仓库 core/bridge_guard.sh 同步到远端，再镜像一份到远端 ops/
 * （部署布局下母版按候选路径列表找守卫，见 SPEC_DECISIONS D-04）。
 */
export const CORE_SYNC_FILES = Object.freeze([
  Object.freeze({ repo: 'core/bridge_guard.sh', remote: '/mnt/ssd/bio_data/core/bridge_guard.sh', note: '守卫母版' }),
  Object.freeze({ repo: 'core/bridge_guard.sh', remote: '/mnt/ssd/bio_data/ops/bridge_guard.sh', note: '守卫镜像' }),
  Object.freeze({ repo: 'tools/ops/check_storage_and_isolation.sh', remote: '/mnt/ssd/bio_data/ops/check_storage_and_isolation.sh', note: '跨线隔离门禁' }),
  Object.freeze({ repo: 'tools/reporting/verify_bridge_checkpoint.py', remote: '/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py', note: '桥接四项断言' }),
]);

/** 四档状态（D-07 口径，禁止新造状态名） */
export const SELFCHECK_STATUSES = Object.freeze(['pass', 'warn', 'fail', 'unknown']);

/** 构造远端哈希探测命令：文件不存在时打印 MISSING 而不是让 sha256sum 报错 */
export function buildSha256Command(targets = CORE_SYNC_FILES) {
  const probes = targets.map(({ remote }) => (
    `if [ -f '${remote}' ]; then sha256sum '${remote}'; else echo 'MISSING ${remote}'; fi`
  ));
  return `${probes.join('; ')}; echo '${SHA256_SENTINEL}'`;
}

/**
 * 逐行解析远端输出。
 * @returns {{hashes: Map<string, string>, missing: string[], sawSentinel: boolean}}
 */
export function parseSha256Output(text) {
  const hashes = new Map();
  const missing = [];
  let sawSentinel = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // P-04 / P-10：known_hosts 提示会混进合并输出，必须逐行剔除
    if (line.startsWith('Warning: Permanently added')) continue;
    if (line === SHA256_SENTINEL) { sawSentinel = true; continue; }
    const hashMatch = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (hashMatch) {
      hashes.set(hashMatch[2].trim(), hashMatch[1].toLowerCase());
      continue;
    }
    const missMatch = /^MISSING\s+(.+)$/.exec(line);
    if (missMatch) missing.push(missMatch[1].trim());
  }
  return { hashes, missing, sawSentinel };
}

/**
 * 计算本地核心文件 SHA256。
 * @returns {Map<string, string|null>} key 为仓库根相对路径，null 表示本地缺失
 */
export function collectLocalSha256(targets = CORE_SYNC_FILES, options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const readFile = options.readFile ?? ((abs) => fs.readFileSync(abs));
  const result = new Map();
  for (const target of targets) {
    try {
      const buf = readFile(path.join(repoRoot, target.repo));
      result.set(target.repo, crypto.createHash('sha256').update(buf).digest('hex'));
    } catch {
      result.set(target.repo, null);
    }
  }
  return result;
}

/**
 * 把本地哈希 + 远端解析结果折算成灯。
 * 优先级 fail > warn > unknown > pass：已测出坏的就报坏，不因为别处没测出来而降级。
 */
export function evaluateSha256Parity({
  targets = CORE_SYNC_FILES,
  localHashes = new Map(),
  parsed = { hashes: new Map(), missing: [], sawSentinel: false },
  sshExitCode = 0,
} = {}) {
  if (sshExitCode !== 0) {
    return {
      status: 'unknown',
      value: '',
      detail: `UNREACHABLE: ssh 退出码 ${sshExitCode}（远端不可达，不能当作失败）`,
    };
  }
  if (!parsed.sawSentinel) {
    return {
      status: 'unknown',
      value: '',
      detail: 'NO_SENTINEL: 远端输出缺 SHA256END 哨兵（疑似命令被截断，不能当作通过）',
    };
  }

  const rows = targets.map((target) => {
    const local = localHashes.get(target.repo) ?? null;
    if (local === null) {
      return { status: 'unknown', detail: `${target.remote} 本地文件缺失（LOCAL_MISSING）` };
    }
    if (parsed.missing.includes(target.remote)) {
      return { status: 'warn', detail: `${target.remote} 远端文件不存在（MISSING）` };
    }
    const remote = parsed.hashes.get(target.remote) ?? null;
    if (remote === null) {
      return { status: 'unknown', detail: `${target.remote} 远端无回读（NO_OUTPUT）` };
    }
    if (remote !== local) {
      return {
        status: 'fail',
        detail: `${target.remote} 哈希不一致（本地 ${local.slice(0, 12)} != 远端 ${remote.slice(0, 12)}）`,
      };
    }
    return { status: 'pass', detail: `${target.remote} 一致（${local.slice(0, 12)}）` };
  });

  const matched = rows.filter((row) => row.status === 'pass').length;
  const value = `${matched}/${targets.length} 一致`;
  const status = rows.some((row) => row.status === 'fail')
    ? 'fail'
    : rows.some((row) => row.status === 'warn')
      ? 'warn'
      : rows.some((row) => row.status === 'unknown')
        ? 'unknown'
        : 'pass';
  const detail = status === 'pass'
    ? '本地与远端核心文件哈希一致（含 ops/ 镜像）'
    : rows.filter((row) => row.status !== 'pass').map((row) => row.detail).join('；');
  return { status, value, detail };
}

/**
 * 第 4 维新增检查的入口：算本地哈希 + ssh 取远端哈希 + 判定。
 * 返回结构与 /api/selfcheck 的 checks 元素一致（id / label / status / value / detail）。
 * 注意：ssh 走 proc.js 的 runSync（SPEC_DECISIONS D-08 的单接缝口径）。测试既可用
 * mock.method(childProcess,'spawnSync') 在接缝底层拦，也可用 BIO_COMPUTE_ADAPTER=mock
 * 在接缝顶层短路，两种都不真连 K40。
 */
/**
 * 四档严重度排序：fail > warn > unknown > pass（D-07 口径）。
 * 为什么 unknown 比 pass 重：自检是门禁，没测出来就不能当通过。
 */
const STATUS_SEVERITY = Object.freeze({ pass: 0, unknown: 1, warn: 2, fail: 3 });

/** 取一组状态里最坏的那个；空数组返回 pass */
export function worstStatus(statuses = []) {
  let worst = 'pass';
  for (const status of statuses) {
    const severity = STATUS_SEVERITY[status] ?? STATUS_SEVERITY.unknown;
    if (severity > STATUS_SEVERITY[worst]) worst = status in STATUS_SEVERITY ? status : 'unknown';
  }
  return worst;
}

/**
 * 把第 4 维的两盏子灯合成一盏（aims §三.3 第 4 维：
 * 「跨线隔离、桥接引擎与远端版本一致性灯」本来就是一条，不是两条）。
 *
 * 分开算、合并报的理由：两件事的失败原因完全不同（门禁脚本退出码 vs 哈希漂移），
 * detail 必须能点名到具体哪一条，但界面上仍只占一格（前端按 checks 数组渲染灯位）。
 */
export function mergeIsolationChecks(isolation, sha, overrides = {}) {
  const status = worstStatus([isolation?.status, sha?.status]);
  const value = [isolation?.value, sha?.value].filter(Boolean).join(' | ');
  const parts = [];
  if (isolation?.status && isolation.status !== 'pass' && isolation.detail) parts.push(isolation.detail);
  if (sha?.status && sha.status !== 'pass' && sha.detail) parts.push(sha.detail);
  // 结构化子灯（P17）：前端可逐盏渲染「坏在隔离还是版本漂移」，不再靠字符串拆 value。
  // value 仍是 ' | ' 拼接的字符串，保持旧前端与既有断言兼容。
  const subChecks = [];
  if (isolation && typeof isolation === 'object') {
    subChecks.push({
      id: 'isolation',
      label: '跨线隔离门禁',
      status: isolation.status ?? 'unknown',
      value: isolation.value ?? '',
      detail: isolation.detail ?? '',
    });
  }
  if (sha && typeof sha === 'object') {
    subChecks.push({
      id: 'sha256',
      label: '远端版本一致性',
      status: sha.status ?? 'unknown',
      value: sha.value ?? '',
      detail: sha.detail ?? '',
    });
  }
  return {
    id: overrides.id ?? 'isolation',
    label: overrides.label ?? '跨线隔离/桥接/版本',
    status,
    value,
    detail: parts.length > 0 ? parts.join('；') : '三线隔离门禁、桥接引擎与版本一致性均通过',
    subChecks,
  };
}

export function runSha256ParityCheck(options = {}) {
  const targets = options.targets ?? CORE_SYNC_FILES;
  const localHashes = collectLocalSha256(targets, options);
  const command = buildSha256Command(targets);
  let exitCode = 1;
  let stdout = '';
  try {
    const result = runSync(
      ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', options.sshTarget ?? SHA256_SSH_TARGET, command],
      { timeoutMs: options.timeoutMs ?? 30000 },
    );
    exitCode = typeof result?.code === 'number' ? result.code : 1;
    stdout = String(result?.stdout ?? '');
  } catch {
    exitCode = 1;
  }
  const evaluated = evaluateSha256Parity({
    targets,
    localHashes,
    parsed: parseSha256Output(stdout),
    sshExitCode: exitCode,
  });
  return { id: 'isolation_sha256', label: '隔离同步 SHA256', ...evaluated };
}

