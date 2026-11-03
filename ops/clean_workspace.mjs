#!/usr/bin/env node
/**
 * 工作区清理（Ticket 4，4 Argon 第二十一/二十二轮 Q5）。
 *
 * 它是唯一会**删东西**的脚本，所以四条安全护栏按裁定原样实现：
 *
 * 1. 默认只读演练：不传 --execute 时只扫描并打印「将要删什么、能释放多少」，
 *    磁盘零改动，退出码 0。破坏性动作必须显式要求。
 * 2. 白名单作用域：严禁全仓通扫。只清理三类显式目标：
 *    - 工作区 .tmp/ 与 BioanalysDesktop/.tmp/
 *    - 过期解包临时目录（deliverables/unpacked、deliverables/_unpacked_*）
 *    - 超过保留期的旧日志（*.log 且 mtime 早于保留天数）
 * 3. 神圣黑名单（双重保险）：目标路径只要**命中或包含**任一禁用路径，
 *    立即抛 ERR_SACRED_PATH_PROTECTED 熔断，不做任何删改。
 *    deliverables/acceptance_audit.jsonl、ops/、src/、server/、docs/、.git/、
 *    D:\Backup\k40_cold
 * 4. 删除顺序与幂等：先算清单再删；删不掉的单条只报告，不中断整轮。
 *
 * 用法：
 *   node ops/clean_workspace.mjs                     # 演练（默认）
 *   node ops/clean_workspace.mjs --execute           # 真删（必须显式）
 *   node ops/clean_workspace.mjs --keep-days 14      # 日志保留期（默认 7）
 *   node ops/clean_workspace.mjs --root <dir>        # 演练用：把根指向别处（测试注入）
 *   node ops/clean_workspace.mjs --json              # 机器读
 * 退出码：0 正常（含演练），1 被护栏拒绝，2 参数错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '..');
export const DEFAULT_KEEP_DAYS = 7;
export const SACRED_PATH_CODE = 'ERR_SACRED_PATH_PROTECTED';

/**
 * 神圣黑名单：出现即熔断。用「包含」判定（子路径同样禁止），大小写不敏感，
 * 分隔符统一成 / 后比较，避免 Windows 反斜杠漏判。
 */
export const SACRED_PATTERNS = Object.freeze([
  'deliverables/acceptance_audit.jsonl',
  'ops/',
  'src/',
  'server/',
  'docs/',
  '.git/',
  'backup/k40_cold',
  'd:\\backup\\k40_cold',
]);

function normalizeForMatch(p) {
  return String(p).split(String.fromCharCode(92)).join('/').toLowerCase();
}

/** 命中黑名单即抛；这是删除函数入口的第一道断言。 */
export function assertNotSacred(target) {
  const normalized = normalizeForMatch(target);
  for (const pattern of SACRED_PATTERNS) {
    const needle = String(pattern).split(String.fromCharCode(92)).join('/').toLowerCase();
    if (normalized.includes(needle)) {
      const error = new Error(SACRED_PATH_CODE + ': 目标命中神圣黑名单（' + pattern + '）：' + target);
      error.code = SACRED_PATH_CODE;
      throw error;
    }
  }
}

function dirSize(dir) {
  let total = 0;
  const walk = (current) => {
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      try {
        if (entry.isDirectory()) walk(full);
        else total += fs.statSync(full).size;
      } catch { /* 单条读不到不影响总量估算 */ }
    }
  };
  walk(dir);
  return total;
}

/**
 * 扫描候选清理目标（纯函数式：只读文件系统，不删）。
 * 返回 [{ kind, path, bytes, reason }]，kind ∈ tmp | unpack | log。
 */
export function scanTargets({ root = DEFAULT_ROOT, keepDays = DEFAULT_KEEP_DAYS, now = Date.now() } = {}) {
  const targets = [];
  const addIfExists = (kind, full, reason) => {
    if (!fs.existsSync(full)) return;
    assertNotSacred(full);                       // 扫描阶段就熔断，删之前已知有危险
    const stat = fs.statSync(full);
    const bytes = stat.isDirectory() ? dirSize(full) : stat.size;
    targets.push({ kind, path: full, bytes, reason });
  };

  // ① 工作区 .tmp（两处都认）
  addIfExists('tmp', path.join(root, '.tmp'), '工作区临时目录');
  addIfExists('tmp', path.join(root, 'BioanalysDesktop', '.tmp'), '前后端临时目录');

  // ② 过期解包临时目录：只在 local_projects/<pid>/deliverables 下找
  const projectsDir = path.join(root, 'local_projects');
  if (fs.existsSync(projectsDir)) {
    for (const pid of fs.readdirSync(projectsDir)) {
      const delDir = path.join(projectsDir, pid, 'deliverables');
      if (!fs.existsSync(delDir)) continue;
      for (const name of fs.readdirSync(delDir)) {
        if (name === 'unpacked' || name.startsWith('_unpacked_')) {
          addIfExists('unpack', path.join(delDir, name), '过期解包临时目录');
        }
      }
    }
  }

  // ③ 超保留期日志：只认 *.log 且 mtime 早于 keepDays
  const cutoff = now - keepDays * 24 * 3600 * 1000;
  const scanLogs = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
        scanLogs(full);
        continue;
      }
      if (!entry.name.endsWith('.log')) continue;
      try {
        if (fs.statSync(full).mtimeMs < cutoff) addIfExists('log', full, '超过 ' + keepDays + ' 天的日志');
      } catch { /* 忽略单条 */ }
    }
  };
  scanLogs(root);
  return targets;
}

/** 真删：逐条删，单条失败只记录不中断（幂等，可重复跑）。 */
export function executeTargets(targets) {
  const deleted = [];
  const failed = [];
  for (const target of targets) {
    assertNotSacred(target.path);               // 删除函数入口再断言一次（双重保险）
    try {
      fs.rmSync(target.path, { recursive: true, force: true });
      deleted.push(target);
    } catch (cause) {
      failed.push({ ...target, error: cause.message });
    }
  }
  return { deleted, failed };
}

function humanBytes(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

export function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const root = value('--root') ? path.resolve(value('--root')) : DEFAULT_ROOT;
  const keepDays = value('--keep-days') ? Number(value('--keep-days')) : DEFAULT_KEEP_DAYS;
  if (!Number.isFinite(keepDays) || keepDays < 0) {
    io.error('--keep-days 必须是 >= 0 的数字');
    return 2;
  }
  const execute = argv.includes('--execute');
  let targets;
  try {
    targets = scanTargets({ root, keepDays });
  } catch (cause) {
    io.error('[ RED ] ' + cause.message);
    return 1;
  }
  const totalBytes = targets.reduce((sum, t) => sum + t.bytes, 0);

  if (argv.includes('--json')) {
    let result = null;
    if (execute) {
      try { result = executeTargets(targets); } catch (cause) { io.error('[ RED ] ' + cause.message); return 1; }
    }
    io.log(JSON.stringify({
      mode: execute ? 'execute' : 'dry-run', root, keepDays,
      targets: targets.map((t) => ({ kind: t.kind, path: path.relative(root, t.path).split(path.sep).join('/'), bytes: t.bytes, reason: t.reason })),
      totalBytes_estimate: totalBytes,
      deleted: result ? result.deleted.length : 0,
      failed: result ? result.failed.length : 0,
    }, null, 2));
    return 0;
  }

  io.log('工作区清理（' + (execute ? '执行模式' : '演练模式，磁盘不会变化') + '）');
  io.log('根目录: ' + root + '｜日志保留期: ' + keepDays + ' 天');
  if (targets.length === 0) {
    io.log('没有需要清理的目标。');
    io.log(execute ? 'CLEAN_OK 无可清理项' : 'CLEAN_DRY_RUN 无可清理项');
    return 0;
  }
  for (const target of targets) {
    io.log('  [' + target.kind + '] ' + path.relative(root, target.path).split(path.sep).join('/')
      + ' (' + humanBytes(target.bytes) + ') — ' + target.reason);
  }
  io.log('合计可释放约 ' + humanBytes(totalBytes) + '（' + targets.length + ' 项）');

  if (!execute) {
    io.log('CLEAN_DRY_RUN 以上仅演练；确认后加 --execute 才会真删');
    return 0;
  }
  let result;
  try { result = executeTargets(targets); } catch (cause) { io.error('[ RED ] ' + cause.message); return 1; }
  for (const item of result.failed) io.error('  [ FAIL ] ' + item.path + '：' + item.error);
  io.log('CLEAN_OK 已删除 ' + result.deleted.length + ' 项'
    + (result.failed.length ? '，失败 ' + result.failed.length + ' 项' : ''));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
