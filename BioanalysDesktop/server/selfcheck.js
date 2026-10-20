/**
 * selfcheck.js — 五维环境自检的服务端实现（aims/aims.txt §3「五维环境自检界面」）
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

import { LINES } from './domain.js';

/** 容器内存配额（aims §六.4：7.5GB 软熔断）；cgroup 未给出数值上限时的兜底 */
export const MEM_QUOTA_BYTES = 7.5 * 1024 * 1024 * 1024;

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
 * 第 3 维命令：SoC 算力 / 温度 / 7.5GB 内存水位，一次 ssh 取全。
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

  return { load, cpus, tempC, memTotalKb, memAvailKb, memMaxBytes, memCurBytes, sawEnd };
}

/** 把解析结果折算成灯：{status, value, detail} */
export function evaluateHardware(parsed) {
  if (!parsed.sawEnd) {
    return { status: 'unknown', value: '', detail: '远端输出缺 END 标记（疑似命令被截断，不能当作通过）' };
  }

  const quotaBytes = parsed.memMaxBytes ?? MEM_QUOTA_BYTES;
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

  const detailParts = [];
  detailParts.push(`温度告警 ${TEMP_WARN_C}°C / 阻断 ${TEMP_FAIL_C}°C`);
  detailParts.push(`内存配额 ${gb(quotaBytes)}GB，告警 ${Math.round(MEM_WARN_RATIO * 100)}%`);
  if (loadRatio !== null) detailParts.push(`负载 ${loadRatio.toFixed(2)} 核当量（告警 ${LOAD_WARN_RATIO}）`);

  const fail = (parsed.tempC !== null && parsed.tempC >= TEMP_FAIL_C)
    || (memRatio !== null && memRatio >= 1);
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
