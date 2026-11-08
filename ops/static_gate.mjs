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
 *   node ops/static_gate.mjs                    跑全部门禁，任一失败 exit 1
 *   node ops/static_gate.mjs --only sh          只跑某一语种（sh|ps1|py|r）
 *   node ops/static_gate.mjs --allow-missing    宿主缺工具时显式降级为警告（exit 0）
 *
 * 设计约束（与 metrics_sync 同教训）：
 *   - 门禁只报**语法层**问题，不判语义、不判风格，避免假红；
 *   - 工具缺失（宿主没有 pwsh / python3 / Rscript）默认**计入失败**：
 *     跳过 16 个 .R 母版等于这 16 个文件一个都没查过，静默放行会让门禁变成装饰。
 *     只有在命令行显式写 --allow-missing 时才降级为警告（打降级清单 + 一行 WARN），
 *     让「本轮确实没查」这件事留在日志里，而不是混进绿色里。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 扫描面：这些目录下的文件参与门禁（与 .gitignore 口径一致） */
// T2-5：扫描面必须覆盖真正产出业务代码的四块（tests/src 是前端与其契约测试，
// portal 是门户，docs 里有可执行的 .sh 片段），否则语法回归只覆盖到一半仓库。
// 2026-11-08 W3：三线母版迁 tools/bio/，src/ 清空，扫描面换 tools/bio。
const SCAN_DIRS = ['ops', 'tools', 'shared', 'bin', 'BioanalysDesktop/server', 'BioanalysDesktop/tests', 'BioanalysDesktop/src', 'portal', 'docs'];
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

// ── 门禁 0.6：宿主机 /mnt/ssd 污染检查（2026-11-02，D:\Git\mnt 误触事故防线）──
// Git-bash 把 /mnt 映射到 <Git根>/mnt，一旦那里出现 ssd/bio_data，
// bridge_guard.sh 的 auto 模式就会误判「已在计算面」走 local 硬阻断（实测 7 条测试假红）。
function gateHostPollution() {
  if (process.platform !== 'win32') return { name: 'host-pollution', total: 1, failures: [], skipped: [] };
  const roots = [process.env.GIT_ROOT, 'D:/Git', 'C:/Program Files/Git'].filter(Boolean);
  const hits = [];
  for (const root of roots) {
    const suspect = path.join(root, 'mnt', 'ssd');
    if (fs.existsSync(suspect)) hits.push(suspect);
  }
  return {
    name: 'host-pollution', total: 1,
    failures: hits.map((h) => ({ file: h, reason: '宿主机 Git 目录下出现 mnt/ssd，会让 bridge_guard auto 模式误判在计算面；确认是探针残留后删除' })),
    skipped: [],
  };
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


// ── 门禁 5：远端命令插值必须引号化（2026-11-04，4 Argon 第三十三轮裁定为立即做）──
//
// 由来：T0-4 全量审查抓到 diagnostics 的 dir 参数直接拼进 `if [ -d '<x>' ]`，
// 修完探针后同一参数仍流进 ledger_fetch.js 与 query_views.js 的裸插值（余震），
// 全仓共 10 处。真 bash 复现 injection_executed=true。
//
// 这类缺陷的共同形态是「模板串里插了外部变量，没走 shellQuote」，单点修复必然会漏，
// 所以升级成静态门禁：凡 runRemote / runRemoteRaw / runRemoteStrict 的模板串，
// 每个 ${...} 必须整体是 shellQuote(...) 或列在 SAFE_INTERPOLATIONS 里。
// 新增漏网点会当场红，不再依赖人工 review。
const QUOTE_SCAN_FILES = [
  'ledger_fetch.js', 'query_views.js', 'task_input.js', 'task.js', 'run.js', 'pull.js', 'report.js',
  'routes/diagnostics.routes.js', 'routes/upload.routes.js', 'routes/figures.routes.js',
  'routes/tasks.routes.js', 'routes/report.routes.js', 'routes/projects.routes.js',
];

/** 不需要引号化的插值：本地常量，或已被证明不含 shell 元字符的编码串。 */
const SAFE_INTERPOLATIONS = new Map([
  ['SYSTEM_LOGS', 'domain.js 的固定远端路径常量'],
  ['SHA256_REMOTE_ROOT', '固定远端路径常量'],
  ['payload', 'Buffer.toString(base64)，字符集 [A-Za-z0-9+/=]，不含引号与分隔符'],
]);

const BACKTICK = String.fromCharCode(96);

/**
 * 所有「把命令交给远端执行」的函数名。
 *
 * 第三十四轮扩充理由：T1.5 把同步 scp/ssh 改成异步时新增了 runSshAsync /
 * runRemoteAsync 一类出口，而原正则只认 runRemote(Raw|Strict)?，新出口的模板串
 * 会**悄悄不受门禁保护**——这正是门禁最危险的失效形态：看着还在，其实漏了。
 * 所以这里改成按前缀匹配，任何 runRemote* / runSsh* / runExec* 都纳入扫描。
 */
const REMOTE_EXEC_PATTERN = 'run(?:Remote|Ssh|Exec)(?:Raw|Strict|Async|Stream|File)?';

function remoteTemplates(text) {
  const out = [];
  const re = new RegExp(REMOTE_EXEC_PATTERN + '\\s*\\(' + BACKTICK + '((?:[^' + BACKTICK + '\\\\]|\\\\.)*)' + BACKTICK, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ line: text.slice(0, m.index).split('\n').length, template: m[1] });
  }
  return out;
}

function unsafeInterpolations(template) {
  const bad = [];
  const re = /\$\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(template)) !== null) {
    const inner = m[1].trim();
    if (/^shellQuote\(/.test(inner)) continue;
    if (SAFE_INTERPOLATIONS.has(inner)) continue;
    bad.push(inner);
  }
  return bad;
}

function gateRemoteQuoting() {
  const failures = [];
  const serverDir = path.join(REPO, 'BioanalysDesktop', 'server');
  let total = 0;
  for (const relPath of QUOTE_SCAN_FILES) {
    const file = path.join(serverDir, relPath);
    if (!fs.existsSync(file)) continue;
    total += 1;
    const text = fs.readFileSync(file, 'utf8');
    for (const item of remoteTemplates(text)) {
      const bad = unsafeInterpolations(item.template);
      if (bad.length > 0) {
        failures.push({
          file: 'BioanalysDesktop/server/' + relPath.replace(/\\/g, '/') + ':' + item.line,
          reason: '未加引号的远端插值: ' + bad.join(' | '),
        });
      }
    }
  }
  return { name: 'remote-quoting', total, failures, skipped: [] };
}
/**
 * 门禁：backed 对象禁止整层物化（2026-11-05，Argon 第 38 轮 Q4 要求）。
 *
 * 背景（真机实测，不是推测）：anndata 在 backed 模式下做子集物化时，会先把整个
 * layers 里的稀疏矩阵读进内存再切片。本基准 nnz = 2.1 亿，单 indices 就 802 MiB，
 * 单层约 2.4 GB，直接触发 Android 内核 lowmemorykiller 杀掉 Termux：
 *   lowmemorykiller: Kill "com.termux", oom_score_adj 0, reason: device is in direct reclaim
 * Python RSS 在 12 秒内从 476MB 涨到 9,063MB。换成 h5_rows 行块读取后峰值 792MB。
 *
 * 判定：同一文件里既出现 backed="r" 打开，又出现对该对象的 .to_memory() 调用或
 * 显式全量 .X[...] 切片，即判失败，要求改走 h5_rows / spatial_stats 的流式读取器。
 * 只报「同一文件内同时出现」，避免跨文件误伤。
 */
function gateBackedMaterialize(files) {
  const PY_TARGETS = files.filter((f) => /\.py$/.test(f)
    && /src[\\/](line2_scrna|line3_spatial)[\\/]/.test(f)
    && !/[\\/]tests[\\/]/.test(f)
    && !/h5_rows\.py$/.test(f));
  const failures = [];
  for (const file of PY_TARGETS) {
    const text = fs.readFileSync(file, "utf8");
    const backedLines = text.split("\n").filter((l) => /backed\s*=\s*['"]r['"]/.test(l));
    if (backedLines.length === 0) continue;
    const offenders = [];
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*#/.test(line)) continue;
      if (/\.to_memory\s*\(/.test(line)) {
        offenders.push("L" + (i + 1) + " .to_memory() 会整层加载 layers");
      } else if (/\.X\s*\[\s*(:\.*)?\s*\]/.test(line) && !/h5py|read_csr_rows/.test(line)) {
        offenders.push("L" + (i + 1) + " 全量 .X[...] 切片");
      }
    }
    if (offenders.length > 0) {
      failures.push({
        file: path.relative(REPO, file),
        reason: "backed 模式下整层物化（应改用 h5_rows 行块读取）：" + offenders.join("；"),
      });
    }
  }
  return { name: "backed-materialize", total: PY_TARGETS.length, failures, skipped: [] };
}
function main() {
  const only = (() => {
    const i = process.argv.indexOf('--only');
    return i > -1 ? (process.argv[i + 1] || '').toLowerCase() : null;
  })();
  const allowMissing = process.argv.includes('--allow-missing');

  const bash = ['bash', 'D:/Git/bin/bash.exe', 'D:/Git/usr/bin/bash.exe'].find((c) => hasCommand(c, ['-c', ':']));
  const pwsh = ['pwsh', 'D:/Program Files/PowerShell/7/pwsh.exe'].find((c) => hasCommand(c, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']));
  const python = ['python3', 'python', 'py'].find((c) => hasCommand(c, ['--version']));
  const rscript = ['Rscript'].find((c) => hasCommand(c, ['--version']));

  const allFiles = SCAN_DIRS.flatMap((dir) => walk(path.join(REPO, dir), []));
  const results = [];
  results.push(gateShebang(allFiles));
  results.push(gateHostPollution());
  results.push(gateRemoteQuoting());
  results.push(gateBackedMaterialize(allFiles));
  if (!only || only === 'sh') {
    results.push(gateBareRscript(collect('.sh')));
    results.push(gateShell(collect('.sh'), bash));
  }
  if (!only || only === 'ps1') results.push(gatePwsh(collect('.ps1'), pwsh));
  if (!only || only === 'py') results.push(gatePython(collect('.py'), python));
  if (!only || only === 'r') results.push(gateR(collect('.R'), rscript));

  // `MISSING_TOOL_GATE`（锚点：mutation_gate 的 M4 会把本判定改回「跳过即通过」，要求 T2-5 红测变红）
  // 缺工具 = 这批文件一个都没查过，必须计入失败。--allow-missing 是唯一的显式降级开关：
  // 降级时打印降级清单与一行 WARN，让「本轮确实没查」留在日志里，而不是混进绿灯里。
  let failed = 0;
  const missing = [];
  for (const r of results) {
    const skipped = (r.skipped || []).length;
    if (skipped > 0) missing.push({ name: r.name, count: skipped, note: r.note || '' });
    if (r.failures.length === 0 && skipped === 0) {
      const note = r.note ? '  [' + r.note + ']' : '';
      console.log('[ OK ] ' + r.name + ' : ' + r.total + ' 个文件' + note);
    } else if (r.failures.length === 0 && skipped > 0) {
      // 工具缺失既不算通过也不算语法失败，先把「没查」的事实亮出来
      console.log('[SKIP] ' + r.name + ' : 宿主缺工具，' + skipped + '/' + r.total + ' 个文件未检查'
        + (r.note ? '  [' + r.note + ']' : ''));
    } else {
      failed += r.failures.length;
      console.log('[FAIL] ' + r.name + ' : ' + r.failures.length + '/' + r.total + ' 个文件有语法问题'
        + (skipped > 0 ? '，另有 ' + skipped + ' 个文件因缺工具未检查' : ''));
      for (const f of r.failures.slice(0, 20)) console.log('        - ' + f.file + ' :: ' + f.reason);
      if (r.failures.length > 20) console.log('        ... 另有 ' + (r.failures.length - 20) + ' 处');
    }
  }

  if (missing.length > 0) {
    const lines = missing.map((m) => '  - ' + m.name + ' : ' + m.count + ' 个文件' + (m.note ? '（' + m.note + '）' : ''));
    if (allowMissing) {
      console.log('[ WARN ] 显式降级（--allow-missing）：以下 ' + missing.reduce((sum, m) => sum + m.count, 0) + ' 个文件本轮跳过未检查，不计入失败');
      for (const line of lines) console.log(line);
      console.log('  降级清单必须随本轮结果一起留档，不写 --allow-missing 的调用不享受降级');
    } else {
      failed += missing.reduce((sum, m) => sum + m.count, 0);
      console.log('[FAIL] 宿主缺工具：以下 ' + missing.reduce((sum, m) => sum + m.count, 0) + ' 个文件本轮跳过未检查（默认计入失败）');
      for (const line of lines) console.log(line);
      console.log('  确属环境限制时显式加 --allow-missing 降级为警告；CI runner 应装齐 pwsh7 / r-base / python3');
    }
  }
  console.log(failed === 0 ? '静态门禁通过' : '静态门禁失败：' + failed + ' 处');
  return failed === 0 ? 0 : 1;
}

process.exit(main());
