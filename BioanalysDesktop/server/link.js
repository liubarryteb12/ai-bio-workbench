/**
 * 链路四段探测：设备 -> forward -> Termux sshd -> 容器 sshd
 *
 * 与 ops/00_link_check.ps1 同源同口径，这里是接口化实现。
 * 输出形状对齐"断在哪一段"的排查需求，不做笼统的布尔。
 */

import { DEFAULT_SERIAL, FORWARD_PAIRS, SERVICES } from './domain.js';
import { runSync, findAdb } from './proc.js';

/** 剥掉 ssh 首连接 warning 与空行，只留有效输出 */
function clean(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .filter((line) => !line.startsWith('Warning: Permanently added'))
    .filter((line) => !line.startsWith('Warning: Remote host identification'))
    .filter((line) => !line.startsWith('Pseudo-terminal will not be allocated'))
    .map((line) => line.trim());
}

/**
 * 段1：设备在线
 * @returns {{pass: boolean, detail: string}}
 */
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
 * 段2：forward 在位（缺则补，幂等）
 * adb forward --list 输出格式是 "serial local remote"，空格分隔，没有箭头。
 */
export function checkForwards(adb = findAdb(), pairs = FORWARD_PAIRS) {
  const listResult = runSync([adb, 'forward', '--list'], { timeoutMs: 15000 });
  const existing = clean(listResult.stdout);
  const entries = pairs.map((pair) => {
    const expected = new RegExp(
      `${escapeRegex(pair.local)}\\s+${escapeRegex(pair.remote)}`
    );
    const present = existing.some((line) => expected.test(line));
    let rebuilt = false;
    if (!present) {
      runSync([adb, 'forward', pair.local, pair.remote], { timeoutMs: 15000 });
      const after = runSync([adb, 'forward', '--list'], { timeoutMs: 15000 });
      rebuilt = clean(after.stdout).some((line) => expected.test(line));
    }
    return {
      ...pair,
      pass: present || rebuilt,
      action: present ? '在位' : rebuilt ? '已重建' : '重建失败',
    };
  });
  return { pass: entries.every((entry) => entry.pass), entries };
}

/**
 * 段3：Termux 底座 sshd 探活
 */
export function checkTermux() {
  const result = runSync(
    ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40', 'echo TERMUX_OK; uname -m'],
    { timeoutMs: 25000 }
  );
  const lines = clean(result.stdout + '\n' + result.stderr);
  const pass = lines.some((line) => line === 'TERMUX_OK');
  return { pass, detail: lines.join(' | ') || '无输出' };
}

/**
 * 段4：容器 sshd 探活（顺带取算力，这是"能不能跑大活"的直接证据）
 *
 * CPU 取两个数：nproc（当前进程**可用**核数，受 Android CPU 亲和性/热插拔影响，
 *   会随 MIUI 调度变化）与 cpuinfo 核数（**物理**核数，固定）。
 * 内存取两个数：MemTotal（**总量**，固定）与 MemAvailable（**可用**，实时变化）。
 * 只报单个数会让用户误以为"核心数/内存一直在变"，两个数并列才看得清。
 */
export function checkContainer() {
  const command = [
    'echo CONTAINER_OK',
    '/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript --version 2>&1 | head -1',
    '/usr/bin/python3 --version',
    'echo "CPUS_AVAIL=$(nproc)"',
    'echo "CPUS_TOTAL=$(grep -c ^processor /proc/cpuinfo)"',
    'echo "MEM_TOTAL_MB=$(free -m | awk \'/^Mem:/{print $2}\')"',
    'echo "MEM_AVAIL_MB=$(free -m | awk \'/^Mem:/{print $7}\')"',
    'echo "DISK=$(df -h / | awk \'NR==2{print $2" total, "$4" avail"}\')"',
  ].join('; ');
  const result = runSync(
    ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', command],
    { timeoutMs: 25000 }
  );
  const lines = clean(result.stdout + '\n' + result.stderr);
  const pass = lines.some((line) => line === 'CONTAINER_OK');

  const pick = (key) => {
    const line = lines.find((candidate) => candidate.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : null;
  };
  const toGb = (mb) => {
    const value = Number(mb);
    return Number.isFinite(value) ? (value / 1024).toFixed(1) : null;
  };

  const compute = {
    cpus: pick('CPUS_AVAIL'),                 // 可用核数（nproc，会变）
    cpusTotal: pick('CPUS_TOTAL'),            // 物理核数（固定）
    memoryGb: toGb(pick('MEM_TOTAL_MB')),     // 内存总量（固定）
    memoryAvailGb: toGb(pick('MEM_AVAIL_MB')),// 内存可用（实时）
    disk: pick('DISK'),
  };

  const skip = ['CPUS_AVAIL=', 'CPUS_TOTAL=', 'MEM_TOTAL_MB=', 'MEM_AVAIL_MB=', 'DISK='];
  return {
    pass, compute,
    detail: lines.filter((line) => !skip.some((s) => line.startsWith(s))).join(' | ') || '无输出',
  };
}

/** 底座侧 runit 服务状态（只读） */
export function checkServices() {
  const command =
    'export PREFIX=/data/data/com.termux/files/usr; ' +
    'export PATH=$PREFIX/bin:$PREFIX/bin/applets:$PATH; ' +
    'export SVDIR=$PREFIX/var/service; ' +
    `for s in ${SERVICES.join(' ')}; do echo "$s: $(sv status $s 2>&1)"; done`;
  const result = runSync(
    ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40', command],
    { timeoutMs: 25000 }
  );
  const lines = clean(result.stdout + '\n' + result.stderr);
  const services = SERVICES.map((name) => {
    const line = lines.find((candidate) => candidate.startsWith(`${name}:`));
    const state = line ? line.slice(name.length + 1).trim() : '';
    return {
      name,
      state,
      running: state.startsWith('run'),
      // log 子服务 crash-loop 是已知坑 #88 的形态，单独标出而不是笼统算失败
      logCrashLoop: /down:\s*log/.test(state),
    };
  });
  return { services };
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 一次跑完四段 + 服务状态，给出总体结论。
 * @returns {{overall: 'pass'|'warn'|'fail', segments: Array<object>, services: Array<object>, checkedAt: string}}
 */
export function checkLink() {
  const device = checkDevice();
  const forwards = checkForwards();
  const termux = checkTermux();
  const container = checkContainer();
  const services = checkServices().services;

  const segments = [
    { name: '设备在线', ...device },
    { name: 'forward 在位', ...forwards },
    { name: 'Termux 底座 sshd', ...termux },
    { name: '容器 sshd', ...container },
  ];

  const hardFail = segments.some((segment) => !segment.pass);
  const serviceDown = services.some((service) => !service.running);
  const logCrash = services.some((service) => service.running && service.logCrashLoop);

  let overall = 'pass';
  if (hardFail || serviceDown) overall = 'fail';
  else if (logCrash) overall = 'warn';

  return {
    overall,
    segments,
    services,
    compute: container.compute ?? { cpus: null, memoryGb: null, disk: null },
    checkedAt: new Date().toISOString(),
  };
}
