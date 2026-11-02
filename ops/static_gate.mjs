#!/usr/bin/env node
/**
 * static_gate.mjs —— 四语种静态语法门禁（2026-11-01，技术债 5.5 收口）
 *
 * 解决的问题：CI 只覆盖 LF 检查 / 隔离检查 / npm test / tsc / build，
 * 而真正产生业务价值的 55 个生信母版（bash/R/Python）与 26 个 Windows 运维 .ps1
 * 完全没有语法回归，全靠本地手动 + 真机。这是「控制面钢筋混凝土、算力面泥巴墙」的倒挂。
 *
 * 四个门禁（全部零真机依赖，单机 Ubuntu runner 可跑）：
 *   1. PowerShell (.ps1)：pwsh 的 [Parser]::ParseFile 做 AST 解析。
 *      PowerShell 是动态绑定语言，ParseFile 阶段只认语法，不会去查 Get-WmiObject 这类
 *      Cmdlet 是否存在、HKLM: 驱动器是否可访问——所以 Ubuntu runner 不需要任何 Windows 模块。
 *   2. Shell (.sh)：CRLF 字节检查（纯 Node，0 毫秒）+ bash -n 语法检查。
 *   3. Python (.py)：python3 -m py_compile（不 import 重型科学包）。
 *   4. R (.R)：Rscript 单进程内 for 循环 parse(file=f)，任何语法错误 quit(1)。
 *
 * 用法：
 *   node ops/static_gate.mjs            跑全部门禁，任一失败 exit 1
 *   node ops/static_gate.mjs --only sh  只跑某一语种（sh|ps1|py|r）
 *
 * 设计约束（与 metrics_sync 同教训）：
 *   - 门禁只报**语法层**问题，不判语义、不判风格，避免假红；
 *   - 工具缺失（宿主没有 pwsh / python3 / Rscript）时该语种报 skip 而不是 fail，
 *     但仍会在汇总里明示 skip 数量，避免「静默全绿」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 扫描面：这些目录下的文件参与门禁（与 .gitignore 口径一致） */
const SCAN_DIRS = ['ops', 'src', 'shared', 'bin', 'BioanalysDesktop/server'];
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'encoding_backup', '_archive', 'artifacts', 'test-results', '.tmp', '__pycache__']);

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function collect(ext) {
  const all = [];
  for (const dir of SCAN_DIRS) walk(path.join(REPO, dir), all);
  return all.filter((f) => f.endsWith(ext)).sort();
}

function rel(file) { return path.relative(REPO, file).split(path.sep).join('/'); }

function hasCommand(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20000, shell: false });
  return !r.error;
}

// ── 门禁 0：Shebang 与扩展名一致性（2026-11-02，Argon 裁定为立即做）──
//
// 抓到过的真实缺陷：src/*/checkpoint/checkpoint_*_bridge.py 首行是 bash shebang、
// 内容是合法 bash（316 行），却被命名成 .py。静态门禁按扩展名分流就会把它送进
// py_compile，编辑器 LSP 与 bridge_guard.sh 也会按扩展名推断执行器，全部静默出错。
// 因此把「解释器声明与扩展名一致」升级为字节级机器断言，在分流之前先跑。
const SHEBANG_RULES = [
  { re: /^#!.*\b(?:ba|z)?sh\b/, exts: new Set(['.sh']), label: 'shell' },
  { re: /^#!.*\bpython[23]?\b/, exts: new Set(['.py']), label: 'python' },
  { re: /^#!.*\bRscript\b/i, exts: new Set(['.R']), label: 'R' },
  { re: /^#!.*\bnode\b/, exts: new Set(['.js', '.mjs', '.cjs']), label: 'node' },
];

/** 读每个文件前 128 字节取首行：零内存开销，比 readFileSync 快，且足够覆盖 shebang */
function firstLineOf(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(128);
    const n = fs.readSync(fd, buf, 0, 128, 0);
    return buf.subarray(0, n).toString('utf8').split(/\r?\n/)[0];
  } finally {
    fs.closeSync(fd);
  }
}

function gateShebang(allFiles) {
  const failures = [];
  // 只对可能带 shebang 的脚本类文件判定；.md/.json 等自然跳过
  const candidates = allFiles.filter((f) => /\.(sh|py|R|r|js|mjs|cjs)$/.test(f));
  for (const file of candidates) {
    const firstLine = firstLineOf(file);
    if (!firstLine.startsWith('#!')) continue;
    const rule = SHEBANG_RULES.find((r) => r.re.test(firstLine));
    if (!rule) continue; // 未知解释器（如 perl/awk）不强断，避免误伤
    const ext = path.extname(file);
    if (!rule.exts.has(ext)) {
      failures.push({
        file: rel(file),
        reason: 'Shebang (' + firstLine.trim() + ') 与扩展名 (' + ext + ') 冲突，应改为 ' + [...rule.exts].join('/'),
      });
    }
  }
  return { name: 'shebang', total: candidates.length, failures, skipped: [] };
}

// ── 门禁 0.5：Rscript 裸调拦截（2026-11-02，Argon 双 R 三重锁死第一重）──
//
// 容器里系统 R 4.3.3（/usr/bin）与项目 R 4.5.3（layout_autoload 垫片）并存。
// 非交互 SSH 不加载 profile，PATH 退化为 /usr/bin 优先——脚本里裸写 Rscript
// 会 100% 掉进 4.3.3，且结果「看起来正常」，属静默版本漂移（盲点二活例）。
// 规则：.sh 文件里出现 `Rscript --xxx` / `Rscript 某.R` 形态的调用，
// 但调用名不是 ${RSCRIPT_BIN} / ${R_PREFIX}... / 绝对路径，即判红。
const BARE_RSCRIPT_RE = /(^|[\s;&|(`$])(Rscript)\s+--/;

function gateBareRscript(shFiles) {
  const failures = [];
  for (const file of shFiles) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      // 注释与垫片自身（含 REAL_RSCRIPT 赋值/说明）不判
      if (trimmed.startsWith('#')) return;
      // 合法形态：${RSCRIPT_BIN} / $RSCRIPT_BIN / 绝对路径 / ${R_PREFIX} 派生路径
      if (/\$\{?RSCRIPT_BIN|\/bin\/Rscript|\$\{?R_PREFIX|REAL_RSCRIPT/.test(line)) return;
      if (BARE_RSCRIPT_RE.test(line)) {
        failures.push({ file: rel(file) + ':' + (idx + 1), reason: '裸调 Rscript 会命中系统 4.3.3，必须走 ${RSCRIPT_BIN} 或绝对路径' });
      }
    });
  }
  return { name: 'rscript-bare', total: shFiles.length, failures, skipped: [] };
}

// ── 门禁 1：Shell ──
function gateShell(files, bash) {
  const failures = [];
  const skipped = [];
  if (!bash) return { name: 'sh', total: files.length, failures: [], skipped: files.map(rel), note: '宿主无 bash' };
  for (const file of files) {
    // CRLF 零容忍：纯 Node 读字节，比任何工具都快且不依赖平台
    const buf = fs.readFileSync(file);
    if (buf.includes(0x0d)) {
      failures.push({ file: rel(file), reason: 'CRLF 行尾（会让 bash 数值比较退化为字符串比较，坑 #103）' });
      continue;
    }
    const r = spawnSync(bash, ['-n', file], { encoding: 'utf8', timeout: 30000 });
    if (r.status !== 0) {
      failures.push({ file: rel(file), reason: (r.stderr || '').trim().split('\n').slice(0, 2).join(' ') });
    }
  }
  return { name: 'sh', total: files.length, failures, skipped };
}

// ── 门禁 2：PowerShell ──
function gatePwsh(files, pwsh) {
  if (!pwsh) return { name: 'ps1', total: files.length, failures: [], skipped: files.map(rel), note: '宿主无 pwsh（GitHub ubuntu-latest 预装 pwsh 7）' };
  // 一次 pwsh 进程内循环所有文件，避免 26 次进程启动开销
  const script = [
    '$files = @(' + files.map((f) => "'" + f.replace(/'/g, "''") + "'").join(',') + ')',
    '$bad = @()',
    'foreach ($f in $files) {',
    '  $errs = $null',
    '  $tokens = $null',
    '  $null = [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$tokens, [ref]$errs)',
    '  if ($errs -and $errs.Count -gt 0) {',
    '    $msg = ($errs | ForEach-Object { $_.Message } | Select-Object -First 2) -join " | "',
    '    $bad += ($f + " :: " + $msg)',
    '  }',
    '}',
    'if ($bad.Count -gt 0) { $bad | ForEach-Object { Write-Output $_ }; exit 1 }',
    'exit 0',
  ].join('\n');
  const r = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 120000 });
  const failures = r.status === 0 ? [] : (r.stdout || '').trim().split('\n').filter(Boolean)
    .map((line) => { const [f, reason] = line.split(' :: '); return { file: f, reason: reason || 'AST 解析失败' }; });
  return { name: 'ps1', total: files.length, failures, skipped: [] };
}

// ── 门禁 3：Python ──
function gatePython(files, python) {
  if (!python) return { name: 'py', total: files.length, failures: [], skipped: files.map(rel), note: '宿主无 python3' };
  const failures = [];
  const r = spawnSync(python, ['-m', 'py_compile', ...files], { encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0) {
    for (const line of (r.stderr || '').split('\n')) {
      const m = line.match(/(\S+\.py):\s*(.*)/);
      if (m) failures.push({ file: rel(m[1]), reason: m[2].slice(0, 160) });
    }
    if (failures.length === 0 && r.stderr) failures.push({ file: '(批量)', reason: r.stderr.trim().slice(0, 300) });
  }
  return { name: 'py', total: files.length, failures, skipped: [] };
}

// ── 门禁 4：R ──
function gateR(files, rscript) {
  if (!rscript) return { name: 'r', total: files.length, failures: [], skipped: files.map(rel), note: '宿主无 Rscript' };
  // 单进程内遍历：55 个母版总耗时通常 < 2 秒，避免 55 次 R 启动（每次约 200ms）
  const script = [
    'errs <- 0',
    'fs <- commandArgs(trailingOnly = TRUE)',
    'for (f in fs) {',
    '  r <- tryCatch({ parse(file = f); TRUE }, error = function(e) { message(f, " :: ", conditionMessage(e)); FALSE })',
    '  if (!r) errs <- errs + 1',
    '}',
    'quit(status = ifelse(errs > 0, 1, 0))',
  ].join('\n');
  const r = spawnSync(rscript, ['--vanilla', '-e', script, '--args', ...files], { encoding: 'utf8', timeout: 180000 });
  const failures = [];
  if (r.status !== 0) {
    for (const line of ((r.stderr || '') + (r.stdout || '')).split('\n')) {
      const m = line.match(/(\S+\.[Rr])\s*::\s*(.*)/);
      if (m) failures.push({ file: rel(m[1]), reason: m[2].slice(0, 160) });
    }
    if (failures.length === 0) failures.push({ file: '(批量)', reason: (r.stderr || '').trim().slice(0, 300) });
  }
  return { name: 'r', total: files.length, failures, skipped: [] };
}

function main() {
  const only = (() => {
    const i = process.argv.indexOf('--only');
    return i > -1 ? (process.argv[i + 1] || '').toLowerCase() : null;
  })();

  const bash = ['bash', 'D:/Git/bin/bash.exe', 'D:/Git/usr/bin/bash.exe'].find((c) => hasCommand(c, ['-c', ':']));
  const pwsh = ['pwsh', 'D:/Program Files/PowerShell/7/pwsh.exe'].find((c) => hasCommand(c, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']));
  const python = ['python3', 'python', 'py'].find((c) => hasCommand(c, ['--version']));
  const rscript = ['Rscript'].find((c) => hasCommand(c, ['--version']));

  const allFiles = SCAN_DIRS.flatMap((dir) => walk(path.join(REPO, dir), []));
  const results = [];
  results.push(gateShebang(allFiles));
  if (!only || only === 'sh') {
    results.push(gateBareRscript(collect('.sh')));
    results.push(gateShell(collect('.sh'), bash));
  }
  if (!only || only === 'ps1') results.push(gatePwsh(collect('.ps1'), pwsh));
  if (!only || only === 'py') results.push(gatePython(collect('.py'), python));
  if (!only || only === 'r') results.push(gateR(collect('.R'), rscript));

  let failed = 0;
  let skippedTotal = 0;
  for (const r of results) {
    skippedTotal += (r.skipped || []).length;
    if (r.failures.length === 0) {
      const note = r.note ? '  [' + r.note + ']' : '';
      console.log('[ OK ] ' + r.name + ' : ' + r.total + ' 个文件' + note);
    } else {
      failed += r.failures.length;
      console.log('[FAIL] ' + r.name + ' : ' + r.failures.length + '/' + r.total + ' 个文件有语法问题');
      for (const f of r.failures.slice(0, 20)) console.log('        - ' + f.file + ' :: ' + f.reason);
      if (r.failures.length > 20) console.log('        ... 另有 ' + (r.failures.length - 20) + ' 处');
    }
  }

  if (skippedTotal > 0) console.log('[INFO] ' + skippedTotal + ' 个文件因宿主缺工具而跳过（CI 上有 pwsh7/r-base 时不会跳过）');
  console.log(failed === 0 ? '静态门禁通过' : '静态门禁失败：' + failed + ' 处');
  return failed === 0 ? 0 : 1;
}

process.exit(main());