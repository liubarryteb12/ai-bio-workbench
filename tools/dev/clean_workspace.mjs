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
 *   node tools/dev/clean_workspace.mjs                     # 演练（默认）
 *   node tools/dev/clean_workspace.mjs --execute           # 真删（必须显式）
 *   node tools/dev/clean_workspace.mjs --keep-days 14      # 日志保留期（默认 7）
 *   node tools/dev/clean_workspace.mjs --root <dir>        # 演练用：把根指向别处（测试注入）
 *   node tools/dev/clean_workspace.mjs --json              # 机器读
 * 退出码：0 正常（含演练），1 被护栏拒绝，2 参数错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '..');
export const DEFAULT_KEEP_DAYS = 7;
export const SACRED_PATH_CODE = 'ERR_SACRED_PATH_PROTECTED';

/**
 * Q4 配额保护（第 41 轮，抄 pytest 的 tmp_path_retention_count 思路）：
 * .tmp/ 的文件数超过 TMP_QUOTA_FILES 就给明确提示，避免 1.8 万个陈年夹具
 * 拖慢全仓扫描与 IDE 索引。刻意**只提示不自动删**：清理器无法知道哪些目录
 * 正被并行测试占用，自动 GC 会误伤运行中的用例。真删由人显式执行
 * node tools/dev/clean_workspace.mjs --execute。
 */
export const TMP_QUOTA_FILES = 500;

/**
 * 统计 .tmp/ 下的文件数，返回 { count, over, quota }。
 * 目录不存在或读不到时返回 count=0，绝不因此抛错打断门禁。
 */
export function tmpQuota({ root = DEFAULT_ROOT, quota = TMP_QUOTA_FILES } = {}) {
  const tmp = path.join(root, '.tmp');
  let count = 0;
  try {
    if (fs.existsSync(tmp)) count = fs.readdirSync(tmp, { recursive: true }).length;
  } catch {
    return { count: 0, over: false, quota };
  }
  return { count, over: count > quota, quota };
}

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
  // T2-1：桌面端整棵子树都是受控区，其 .tmp 又是清理目标（:101），
  // 名单漏掉它就会让「护栏放行、清理照删」自相矛盾。按包含判定加一条即可覆盖其下全部路径。
  'BioanalysDesktop/',
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

/** 绝对路径 -> 相对 root 的仓库相对路径（posix 分隔符），与 git ls-files 输出可比。 */
function toRepoRelative(root, full) {
  return path.relative(root, full).split(path.sep).join('/');
}

/**
 * 收集 root 下 git 索引里的仓库相对路径。
 *
 * 判定失败（非仓库、无 git、git 报错）时返回空集合并在 onWarn 打一行 WARN：
 * 此时退化为「不跳过任何文件」，即旧行为，但这行 WARN 让退化本身可见，
 * 不会被误读成「已确认没有跟踪文件」。
 */
export function trackedFiles(root, onWarn = (m) => console.error('[ WARN ] ' + m)) {
  const result = spawnSync('git', ['ls-files', '--full-name', '-z'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  const output = result.stdout || '';
  if (result.error || result.status !== 0) {
    onWarn('git 不可用（' + String(result.error ? 'spawn 失败' : 'exit ' + result.status) + '），无法判定跟踪状态；过期日志一律按未跟踪处理');
    return new Set();
  }
  if (output === '') {
    // status=0 但没有输出：空索引（刚 git init、尚未 add）。索引为空不等于「没有风险」，
    // 说明此刻没有任何文件受 git 保护，需要人知道。
    onWarn('git 索引为空，此刻没有文件受跟踪保护；过期日志一律按未跟踪处理');
    return new Set();
  }
  return new Set(output.split('\u0000').filter(Boolean));
}

/**
 * 扫描候选清理目标（纯函数式：只读文件系统，不删）。
 * 返回 [{ kind, path, bytes, reason }]，kind ∈ tmp | unpack | log。
 */
export function scanTargets({ root = DEFAULT_ROOT, keepDays = DEFAULT_KEEP_DAYS, now = Date.now(), onWarn = (m) => console.error('[ WARN ] ' + m) } = {}) {
  const targets = [];
  const warnings = [];
  const sacredHits = [];
  const addIfExists = (kind, full, reason) => {
    if (!fs.existsSync(full)) return;
    try {
      assertNotSacred(full);                     // 扫描阶段就熔断，删之前已知有危险
    } catch (error) {
      if (error.code !== SACRED_PATH_CODE) throw error;
      // 单个候选踩中神圣路径时只跳过它并留证，不整轮熔断：
      // BioanalysDesktop/ 现在整棵是受控区，若因它一个就中止，工作区 .tmp 与过期解包
      // 这些真正该清的目标也跟着清不掉，清理脚本会退化成「什么都不做」。
      // 删除入口 executeTargets 仍是硬熔断，扫描阶段的放行不许被当成删除授权。
      sacredHits.push({ path: full, reason });
      return;
    }
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
  // T2-1：仓库里 29 个 .log 是 git 已跟踪的历史证据（mtime 早已过保留期），
  // 只按 mtime 挑会把它们当垃圾删掉。删除集必须先问 git 归属：已跟踪的一律不删。
  const cutoff = now - keepDays * 24 * 3600 * 1000;
  const tracked = trackedFiles(root, (message) => warnings.push(message));
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
      // 命中 git 索引就必须 continue 而不是 return：return 会把整棵子树剩下的日志一起放过，
      // 清理脚本退化成「一个都不删」还能骗过「已跟踪文件不得入目」的那条断言。
      if (tracked.size > 0 && tracked.has(toRepoRelative(root, full))) continue;
      try {
        if (fs.statSync(full).mtimeMs < cutoff) addIfExists('log', full, '超过 ' + keepDays + ' 天的日志');
      } catch { /* 忽略单条 */ }
    }
  };
  scanLogs(root);
  for (const hit of sacredHits) {
    const relPath = toRepoRelative(root, hit.path);
    onWarn('目标命中神圣黑名单，已跳过：' + relPath + '（' + hit.reason + '）');
  }
  for (const message of warnings) onWarn(message);
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
  // 扫描期告警（神圣跳过、git 不可用）必须进最终产物：--json 时是 payload 里的 warnings 字段，
  // 人读时是 stderr 上的 [ WARN ] 行。两条路径都留证，「本机少删了什么」不会静默消失。
  const warnings = [];
  let targets;
  try {
    targets = scanTargets({ root, keepDays, onWarn: (message) => warnings.push(message) });
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
      warnings,
    }, null, 2));
    return 0;
  }

  for (const message of warnings) io.error('[ WARN ] ' + message);
  for (const message of warnings) io.error('[ WARN ] ' + message);
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
