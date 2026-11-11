/**
 * 链路探测（ADB 单通道，2026-11-11 P-29 冲突源收口）。
 *
 * 原实现四段探测里有三段直连 Termux/容器 sshd，外加 forward 重建与 host key
 * 指纹探针。P-29 台账实测：高频/并发 ssh 连接流是算力端 proot 每 15 秒 abort
 * 的充分条件。用户不使用 SSH，因此这里只保留两个不碰 sshd 的判据：
 * 设备在线，以及 ADB 能进容器执行命令。
 *
 * 对外导出名与返回形态保持兼容，前端与诊断路由无需改动。
 */

import { DEFAULT_SERIAL } from './domain.js';
import { runSync, findAdb } from './proc.js';

/** 去掉空白行与本机通道噪声，只留有效输出 */
function clean(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 段1：设备在线 */
export function checkDevice(adb = findAdb(), serial = DEFAULT_SERIAL) {
  const result = runSync([adb, 'devices'], { timeoutMs: 15000 });
  const lines = clean(result.stdout);
  const deviceLine = lines.find((line) => line.startsWith(serial));
  const pass = Boolean(deviceLine) && /device$/.test(deviceLine);
  return {
    pass,
    detail: deviceLine || `序列号 ${serial} 未出现在 adb devices 输出中`,
  };
}

/**
 * 段2：ADB 能进容器执行命令。
 * argv 形态沿用历史 ssh 调用，由 proc.js 在单接缝处重写成 ADB，不启动 sshd 连接。
 */
export function checkContainer() {
  const command = [
    'echo ADB_EXEC_OK',
    'echo "CPUS_AVAIL=$(nproc)"',
    'echo "CPUS_TOTAL=$(grep -c ^processor /proc/cpuinfo)"',
    'echo "MEM_TOTAL_MB=$(free -m | awk \'/^Mem:/{print $2}\')"',
    'echo "MEM_AVAIL_MB=$(free -m | awk \'/^Mem:/{print $7}\')"',
    'echo "DISK=$(df -h / | awk \'NR==2{print $2" total, "$4" avail"}\')"',
  ].join('; ');
  const result = runSync(
    ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', command],
    { timeoutMs: 25000 },
  );
  const lines = clean(result.stdout + '\n' + result.stderr);
  const pass = lines.includes('ADB_EXEC_OK');

  const pick = (key) => {
    const line = lines.find((candidate) => candidate.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : null;
  };
  const toGb = (mb) => {
    const value = Number(mb);
    return Number.isFinite(value) ? (value / 1024).toFixed(1) : null;
  };
  const compute = {
    cpus: pick('CPUS_AVAIL'),
    cpusTotal: pick('CPUS_TOTAL'),
    memoryGb: toGb(pick('MEM_TOTAL_MB')),
    memoryAvailGb: toGb(pick('MEM_AVAIL_MB')),
    disk: pick('DISK'),
  };
  const skip = ['CPUS_AVAIL=', 'CPUS_TOTAL=', 'MEM_TOTAL_MB=', 'MEM_AVAIL_MB=', 'DISK='];
  return {
    pass,
    compute,
    detail: lines.filter((line) => !skip.some((prefix) => line.startsWith(prefix))).join(' | ') || '无输出',
  };
}

/** 兼容旧调用方：SSH 服务探活已封存，返回空服务表。 */
export function checkServices() {
  return { services: [] };
}

/** 兼容旧调用方：不再重建端口转发。 */
export function checkForwards() {
  return { pass: true, entries: [], detail: 'SSH 端口转发已随 P-29 冲突源封存' };
}

/** 兼容旧调用方：不再探活 Termux sshd。 */
export function checkTermux() {
  return { pass: true, detail: 'Termux sshd 探活已随 P-29 冲突源封存' };
}

/** 总体结论判定点（纯函数，便于单测）。 */
export function resolveLinkOverall({ hardFail, serviceDown, logCrash, hostkeyCode }) {
  if (hardFail) return 'fail';
  if (serviceDown) return 'fail';
  if (logCrash) return 'warn';
  if (hostkeyCode) return 'warn';
  return 'pass';
}

/** 两段探测，给出总体结论。 */
export function checkLink() {
  const device = checkDevice();
  const container = checkContainer();
  const services = checkServices().services;
  const segments = [
    { name: '设备在线', ...device },
    { name: 'ADB 容器内执行', ...container },
  ];
  const hardFail = segments.some((segment) => !segment.pass);
  const overall = resolveLinkOverall({
    hardFail,
    serviceDown: services.some((service) => !service.running),
    logCrash: services.some((service) => service.running && service.logCrashLoop),
    hostkeyCode: null,
  });
  return {
    overall,
    segments,
    services,
    hostkeys: { code: 'SSH_RETIRED' },
    compute: container.compute,
    checkedAt: new Date().toISOString(),
  };
}
