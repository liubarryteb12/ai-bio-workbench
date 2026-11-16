#!/usr/bin/env node
/**
 * 绿色便携包构建器（B 路线：解压即用，不装 node/git/ssh）。
 *
 * 存在的理由：此前整条链路依赖「调用者自己把 node / ssh / git 放进 PATH」，
 * 换一台干净机器就散架。这里把四层内容打成一个自足目录：
 *
 *   L1 软件核心    BioanalysDesktop/ core/ schemas/ skills/ tools/ portal/ shared/ bin/ configs/ tests/ aims/ docs/
 *   L2 真源与台账  references/ ledger/ workspace/handoff/ cn_debug/ deliverables/
 *                  + 基准项目夹具 workspace/projects/PRJ_DCM_BENCH_20261105（显式复制，
 *                    projects/ 被 gitignore，但第 7 道消融门禁与工作台样例需要它）
 *   L3 便携运行时  vendor/tools/ -> runtime/（node + MSYS 工具链）
 *                  + vendor/python-win32/pythoncore -> runtime/python/（出图审计与变异门禁用）
 *   L4 运行时产物  .tmp/ outputs/ project_data/ node_modules/ .npmcache/ 一律不进包
 *
 * 判据不是「复制成功」，而是「净化 PATH 下 gate:all 28 道全绿」：
 * --verify 会把 PATH 缩到只有 runtime/ 与系统目录再跑一遍门禁。
 *
 * 纯 node:fs + 一次 git ls-files（打包机有 git，目标机不需要）。
 * 用法：
 *   node tools/dev/build_portable_package.mjs             构建到 software/BioanalysWorkbench
 *   node tools/dev/build_portable_package.mjs --verify    构建后净化 PATH 跑 gate:all --skip-tests
 *   node tools/dev/build_portable_package.mjs --out <dir> 指定输出目录
 *   node tools/dev/build_portable_package.mjs --keep      保留既有输出目录（默认先清）
 * 退出码：0 成功，1 失败，2 参数错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
// 发布包唯一落点。落点由构建器与 dist_parity_gate 共同引用，改一处两边同动，
// 避免仓库里并存两份会各自漂移的包（REJ-007）。
export const DEFAULT_OUT = path.join(REPO_ROOT, 'software', 'BioanalysWorkbench');

/** 四层划分。prefixes 是相对仓库根的路径前缀，layer 只用于清单与报告。 */
export const LAYERS = Object.freeze([
  { layer: 'L1-core', label: '软件核心', prefixes: ['BioanalysDesktop/', 'core/', 'schemas/', 'skills/', 'tools/', 'portal/', 'shared/', 'bin/', 'configs/', 'tests/', 'aims/', 'docs/', '.github/', 'AGENTS.md', '.gitattributes', '.gitignore', 'start_all.bat', 'start_portal.bat', 'start_workbench.bat'] },
  { layer: 'L2-truth', label: '真源与台账', prefixes: ['references/', 'ledger/', 'workspace/handoff/', 'cn_debug/', 'workspace/projects/', 'deliverables/'] },
]);

/** L4：一律不进包的路径前缀（未跟踪产物、依赖缓存、构建中间件）。 */
/**
 * 必须随包的 npm 依赖白名单（node_modules 整目录被排除，这里逐个复制）。
 *
 * - react / react-dom / scheduler 等：ui_render_smoke 等测试要真渲染 .tsx；
 * - better-sqlite3 + node-addon-api：租约服务的运行时原生模块。包内自带
 *   prebuilds/{win32-x64,linux-arm64,...}.node，干净机器无需编译；漏带会让
 *   服务在 import 阶段直接 MODULE_NOT_FOUND，2026-11-12 首次重建时踩到。
 */
export const TEST_DEPENDENCY_PACKAGES = Object.freeze([
  'react', 'react-dom', 'scheduler', 'loose-envify', 'js-tokens', 'esbuild', '@esbuild',
  'better-sqlite3', 'node-addon-api',
]);

/** 渲染冒烟（ui_render_smoke）需要的上传组件：按 package.json 依赖闭包整组进包。 */
export const UI_TEST_ROOT_PACKAGES = Object.freeze(['@uppy/core', '@uppy/dashboard']);

/** 从 node_modules 解析根包的传递依赖闭包（只收真实存在的目录）。 */
export function nodeModuleClosure({ repoRoot = REPO_ROOT, roots = [] }) {
  const nm = path.join(repoRoot, 'BioanalysDesktop', 'node_modules');
  const seen = new Set(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(nm, name, 'package.json'), 'utf8'));
      for (const dep of Object.keys(manifest.dependencies || {})) {
        if (seen.has(dep)) continue;
        if (fs.existsSync(path.join(nm, dep))) { seen.add(dep); queue.push(dep); }
      }
    } catch { /* 裸目录或缺 package.json：跳过 */ }
  }
  return [...seen].sort();
}

export const EXCLUDED_PREFIXES = Object.freeze([
  '.tmp/', 'outputs/', 'projects/', 'artifacts/', 'project_data/', 'node_modules/',
  'BioanalysDesktop/node_modules/', '.npmcache/', 'Python/', 'BioanalysDesktop/Python/',
  // 打包的 Python 运行时已从 BioanalysDesktop/Python/ 迁到 vendor/python-win32/（第 41 轮 Q4）。
  // 两条旧前缀留着是为了兼容尚未迁移的历史工作树，vendor/ 是迁移后的总闸。
  'vendor/', 'dist/', '.git/',
]);

export function classify(relPath) {
  const norm = relPath.split(path.sep).join('/');
  for (const layer of LAYERS) {
    for (const prefix of layer.prefixes) {
      if (norm === prefix || norm.startsWith(prefix)) return layer.layer;
    }
  }
  if (EXCLUDED_PREFIXES.some((p) => norm === p || norm.startsWith(p))) return 'L4-runtime-artifact';
  return 'L2-truth';
}

function isExcluded(norm) {
  return EXCLUDED_PREFIXES.some((p) => norm === p || norm.startsWith(p));
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function findGit(env) {
  return String(env.PATH || '').split(path.delimiter).filter(Boolean)
    .map((dir) => path.join(dir, 'git.exe'))
    .find((candidate) => { try { return fs.statSync(candidate).isFile(); } catch { return false; } }) || null;
}

/** 入库文件清单：以 git 为真源，避免把未跟踪产物打进包。 */
export function trackedFiles({ repoRoot = REPO_ROOT, env = process.env } = {}) {
  const git = findGit(env);
  if (!git) throw new Error('找不到 git.exe：打包机需要 git（目标机不需要）');
  const r = spawnSync(git, ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env, windowsHide: true });
  if (r.status !== 0) throw new Error('git ls-files 失败：' + ((r.stderr || '').trim()));
  return r.stdout.split(String.fromCharCode(0)).filter(Boolean);
}

export function runtimeFiles({ repoRoot = REPO_ROOT } = {}) {
  const dir = path.join(repoRoot, 'vendor', 'tools');
  if (!fs.existsSync(dir)) {
    throw new Error(
      '缺少 vendor/tools（便携运行时未就位）。' +
      'Argon 第二十八轮 Q1：二进制不进 Git——在构建机从本地受控缓存目录' +
      '（装机时的 Node 发行版 + Git for Windows 的 usr/bin 与其 msys-*.dll 全集）' +
      '复制到 ' + dir + '，该目录已在 .gitignore 内。');
  }
  const files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
  // 组装完整性预检：少一个关键 exe 时报「缺谁」，而不是到目标机才炸
  const REQUIRED_BINS = ['node.exe', 'ssh.exe', 'scp.exe', 'tar.exe', 'sha256sum.exe', 'openssl.exe'];
  const missing = REQUIRED_BINS.filter((n) => !files.includes(n));
  if (missing.length > 0) throw new Error('vendor/tools 缺关键二进制：' + missing.join(', ') + '（补齐后再打包）');
  return files;
}

/** python 审计运行时：来自 vendor/python-win32 的 pythoncore（Q4 第 41 轮预留的打包总闸）。 */
export function pythonRuntimeFiles({ repoRoot = REPO_ROOT } = {}) {
  const core = path.join(repoRoot, 'vendor', 'python-win32', 'pythoncore-3.12-64');
  if (!fs.existsSync(path.join(core, 'python.exe'))) {
    throw new Error('缺少 vendor/python-win32/pythoncore-3.12-64/python.exe（便携包的出图审计门禁与变异门禁需要它）');
  }
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      out.push(path.relative(core, full).split(path.sep).join('/'));
    }
  };
  walk(core);
  return out;
}

/**
 * Pi CLI 运行时：把 desktop/runtime/picli 整目录带进便携包。
 * 该目录在 gitignore 内，构建机必须先 npm install 一次；缺失时返回空数组，
 * 不阻断其他产物的构建。
 */
export function picliRuntimeFiles({ repoRoot = REPO_ROOT } = {}) {
  const root = path.join(repoRoot, 'desktop', 'runtime', 'picli');
  if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const rel = path.relative(root, full).split(path.sep).join('/');
      // auth.json 可能承载 OAuth 令牌，随包分发等于泄露凭证；运行时由环境变量注入。
      if (rel === 'agent/auth.json') continue;
      out.push(rel);
    }
  };
  walk(root);
  return out;
}

/**
 * 基准项目夹具：workspace/projects 被 .gitignore 策略性忽略（大型数据资产本地留档），
 * 但第 7 道消融门禁的夹具与工作台样例项目都要用它的骨架。这里显式复制最小集合。
 */
export const BENCH_PROJECT_ID = 'PRJ_DCM_BENCH_20261105';
/** 第二个项目夹具：门户图实例对齐测试的 DCM_CHAIN 最新数据面（2026-11-14 实测 12.5MB）。 */
export const PORTAL_ALIGNMENT_PROJECT_ID = 'DCM_CHAIN_20261109';
export const BENCH_PROJECT_TOP_FILES = Object.freeze([
  'project.json',
  'BENCHMARK_REPORT.md',
  'INTEGRATED_REPORT.md',
  'FINAL_SEAL_REPORT.md',
  'scripts/resume_benchmark.sh',
]);

export function benchProjectFiles({ repoRoot = REPO_ROOT } = {}) {
  const projectRoot = path.join(repoRoot, 'workspace', 'projects', BENCH_PROJECT_ID);
  if (!fs.existsSync(path.join(projectRoot, 'project.json'))) {
    throw new Error('缺少基准项目 workspace/projects/' + BENCH_PROJECT_ID + '/project.json（第 7 道消融门禁需要它）');
  }
  const out = [...BENCH_PROJECT_TOP_FILES].filter((rel) => fs.existsSync(path.join(projectRoot, rel)));
  const figures = path.join(projectRoot, 'figures');
  if (fs.existsSync(figures)) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        out.push('figures/' + path.relative(figures, full).split(path.sep).join('/'));
      }
    };
    walk(figures);
  }
  return out;
}

/** 整项目夹具：按目录全量复制（用于 DCM_CHAIN 这类「整个项目就是数据面」的样例）。 */
export function wholeProjectFixtureFiles({ repoRoot = REPO_ROOT, projectId = PORTAL_ALIGNMENT_PROJECT_ID } = {}) {
  const projectRoot = path.join(repoRoot, 'workspace', 'projects', projectId);
  if (!fs.existsSync(projectRoot)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      out.push(path.relative(projectRoot, full).split(path.sep).join('/'));
    }
  };
  walk(projectRoot);
  return out;
}

/**
 * 出图模板真源字节：注册表（figure_templates.json）引用的母版、预览与
 * sample_project_output 必须随包，图件真源一致性测试在包内才能真实跑。
 * 2026-11-14 实测全集约 9.4MB，无需整项目复制。
 */
export function registryFixtureFiles({ repoRoot = REPO_ROOT } = {}) {
  const registryPath = path.join(repoRoot, 'tools', 'bio', 'figure_templates.json');
  if (!fs.existsSync(registryPath)) return [];
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const templates = Array.isArray(registry) ? registry : (registry.templates || []);
  const files = new Set();
  for (const template of templates) {
    for (const key of ['source', 'preview', 'sample_project_output']) {
      if (typeof template[key] === 'string' && template[key]) files.add(template[key]);
    }
  }
  return [...files].filter((rel) => fs.existsSync(path.join(repoRoot, rel))).sort();
}

/** 门户图实例样例：figure_project_examples.json 引用的项目字节随包（2026-11-14 实测约 11.1MB）。 */
export function examplesFixtureFiles({ repoRoot = REPO_ROOT } = {}) {
  const examplesPath = path.join(repoRoot, 'tools', 'bio', 'figure_project_examples.json');
  if (!fs.existsSync(examplesPath)) return [];
  const text = fs.readFileSync(examplesPath, 'utf8');
  // JSON 里路径可能写成 \\ 转义，两种分隔符都要收，统一归一成 / 再比对
  const raw = [...new Set(text.match(/workspace[\/\\]+projects[\/\\]+[^"']+/g) || [])];
  const refs = raw.map((rel) => rel.split('\\').join('/'));
  return refs.filter((rel) => fs.existsSync(path.join(repoRoot, rel))).sort();
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

/** 启动器统一用正斜杠路径，避免生成器里再套一层反斜杠转义。 */
function launcherBody(lines) {
  return [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'cd /d "%~dp0"',
    'set "PATH=%~dp0runtime;%~dp0runtime\\python;%PATH%"',
    'if not exist "%~dp0.tmp" mkdir "%~dp0.tmp"',
    'set "TEMP=%~dp0.tmp"',
    'set "TMP=%~dp0.tmp"',
    ...lines,
    'set "EXITCODE=%ERRORLEVEL%"',
    'endlocal & exit /b %EXITCODE%',
    '',
  ].join(String.fromCharCode(13) + String.fromCharCode(10));
}

function writeLaunchers(outDir) {
  const files = {
    'gate.cmd': launcherBody(['"%~dp0runtime/node.exe" "%~dp0tools/dev/run_all_gates.mjs" %*']),
    'delivery.cmd': launcherBody(['"%~dp0runtime/node.exe" "%~dp0tools/reporting/delivery_acceptance_core.mjs" %*']),
    'toolchain.cmd': launcherBody(['"%~dp0runtime/node.exe" "%~dp0tools/dev/toolchain.mjs" %*']),
    'start-workbench.cmd': launcherBody([
      'set "BIO_ALLOW_DEV_NOAUTH=1"',
      'start "" "http://127.0.0.1:18787/"',
      '"%~dp0runtime/node.exe" "%~dp0BioanalysDesktop/server/index.js" %*',
    ]),
    // cwd 必须是 BioanalysDesktop：auth 等用例按相对路径拉起 server/index.js，
    // 在包根跑会 MODULE_NOT_FOUND（2026-11-14 便携自测实测）。
    'test.cmd': launcherBody([
      'pushd "%~dp0BioanalysDesktop"',
      '"%~dp0runtime/node.exe" --test --test-concurrency=1 tests/*.test.js %*',
      'popd',
    ]),
  };
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(outDir, name), text, 'utf8');
  }
  return Object.keys(files);
}

function writeReadme(outDir, stats) {
  const lines = [
    '# Bioanalys 工作台 · 绿色便携包',
    '',
    '解压即用：不需要安装 Node.js、git、ssh、python 或任何运行时。运行时在 runtime/ 里。',
    '',
    '## 先做这一步',
    '',
    '运行 gate.cmd（加 --skip-tests 可快检）。看到 GATE_ALL_OK 28 道全绿即表示这台机器上一切就绪。',
    '',
    '## 点三点开始分析',
    '',
    '1. 双击 start-workbench.cmd，浏览器自动打开管理工作台。',
    '2. 打开作业中心，选中门户提交包，客户已勾选的分析步骤会自动带入。',
    '3. 点击「一键分析并排队」，页面显示排队位置、执行状态、回执与产物清单。',
    '',
    '## 五个入口',
    '',
    '| 命令 | 作用 |',
    '| --- | --- |',
    '| gate.cmd | 28 道总门禁（按 GATES 清单顺序执行） |',
    '| delivery.cmd <tar.gz> | 交付包四关验收（侧车哈希、解包结构、签名、清单闭合），全绿才写回执 |',
    '| toolchain.cmd | 打印每个工具解析到了哪个路径 |',
    '| test.cmd | 只跑全量测试（约 140 秒，排查用） |',
    '| start-workbench.cmd | 自动打开管理工作台（默认 http://127.0.0.1:18787/） |',
    '',
    '## 连通算力端（可选）',
    '',
    'runtime/ 里的 ssh 是自带的，但 SSH 身份属于这台机器这个人，不随包走。',
    '需要连 K40 时，把私钥与 config 放到 %USERPROFILE%/.ssh/ 下即可，k40 与 k40-ubuntu 两个别名会被直接使用。',
    '没有配置时，依赖远端算力的用例会跳过而不是失败。',
    '',
    '## 内容清单',
    '',
    '- 入库文件：' + stats.tracked + ' 个（软件核心 / 真源与台账 / 便携运行时 / 运行时产物四层）',
    '- 运行时文件：' + stats.runtime + ' 个（Node.js ' + stats.nodeVersion + ' + MSYS 工具链）+ python 审计运行时 ' + stats.pythonFiles + ' 个',
    '- 包体积：约 ' + stats.totalMb + ' MB',
    '- MANIFEST.sha256 覆盖包内每一个文件，可用 sha256sum -c 或 certutil 校验完整性',
    '- 公开验签公钥：tools/ops/secrets/ed25519_public.pem（' + stats.publicKeyFiles + ' 个）。公钥不是机密，随包带走；私钥与访问 token 永不进包',
    '',
    '## 不包含什么',
    '',
    '工作目录（.tmp/、outputs/、project_data/）、依赖缓存（node_modules/、.npmcache/）、',
    '构建中间件（dist/）、私钥与访问 token 都不在包里。',
    '运行产物会在首次运行后自行生成；私钥按需从受控渠道单独领取。',
    '',
  ];
  fs.writeFileSync(path.join(outDir, '使用说明.md'), String.fromCharCode(0xFEFF) + lines.join('\n'), 'utf8');
}

export function buildPackage({ repoRoot = REPO_ROOT, outDir = DEFAULT_OUT, env = process.env, clean = true, verify = false, io = console } = {}) {
  const tracked = trackedFiles({ repoRoot, env });
  const sources = tracked;
  const runtime = runtimeFiles({ repoRoot });
  const pythonRuntime = pythonRuntimeFiles({ repoRoot });
  const picliRuntime = picliRuntimeFiles({ repoRoot });
  const benchProject = benchProjectFiles({ repoRoot });
  const registryFixture = registryFixtureFiles({ repoRoot });
  const examplesFixture = examplesFixtureFiles({ repoRoot });
  const alignmentProject = wholeProjectFixtureFiles({ repoRoot });
  if (clean && fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  // 清理器契约（clean_tmp_cache 的作用域根是 tools/.tmp）与测试都假定目录存在
  fs.mkdirSync(path.join(outDir, '.tmp'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'tools', '.tmp'), { recursive: true });

  const counts = { 'L1-core': 0, 'L2-truth': 0, 'L4-runtime-artifact': 0 };
  const manifest = [];
  for (const rel of sources) {
    const norm = rel.split(path.sep).join('/');
    if (isExcluded(norm)) { counts['L4-runtime-artifact'] += 1; continue; }
    const from = path.join(repoRoot, rel);
    if (!fs.existsSync(from)) continue;
    copyFile(from, path.join(outDir, rel));
    counts[classify(rel)] += 1;
    manifest.push([norm, sha256File(path.join(outDir, rel))]);
  }

  // 前端产物：dist 被 gitignore，但工作台没有它就跑不起来，打包时补上
  const distDir = path.join(repoRoot, 'BioanalysDesktop', 'dist');
  let distFiles = 0;
  if (fs.existsSync(distDir)) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        const rel = path.relative(repoRoot, full).split(path.sep).join('/');
        copyFile(full, path.join(outDir, rel));
        manifest.push([rel, sha256File(path.join(outDir, rel))]);
        distFiles += 1;
        counts['L1-core'] += 1;
      }
    };
    walk(distDir);
  }

  // L1 附加：测试运行依赖闭包（node_modules 整目录被排除，这里白名单复制）
  let depFiles = 0;
  const testPkgRoots = [...new Set([...TEST_DEPENDENCY_PACKAGES, ...nodeModuleClosure({ repoRoot, roots: UI_TEST_ROOT_PACKAGES })])];
  for (const pkgName of testPkgRoots) {
    const src = path.join(repoRoot, 'BioanalysDesktop', 'node_modules', pkgName);
    if (!fs.existsSync(src)) continue;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        const rel = 'BioanalysDesktop/node_modules/' + path.relative(path.join(repoRoot, 'BioanalysDesktop', 'node_modules'), full).split(path.sep).join('/');
        copyFile(full, path.join(outDir, rel));
        manifest.push([rel, sha256File(path.join(outDir, rel))]);
        depFiles += 1;
      }
    };
    walk(src);
  }
  counts['L1-core'] += depFiles;

  for (const name of runtime) {
    const rel = 'runtime/' + name;
    copyFile(path.join(repoRoot, 'vendor', 'tools', name), path.join(outDir, rel));
    manifest.push([rel, sha256File(path.join(outDir, rel))]);
  }

  for (const rel of picliRuntime) {
    const from = path.join(repoRoot, 'desktop', 'runtime', 'picli', rel);
    const to = path.join(outDir, 'runtime', 'picli', rel);
    copyFile(from, to);
    manifest.push([`runtime/picli/${rel}`, sha256File(to)]);
    counts['L1-core'] += 1;
  }
  // python 审计运行时：出图源码门禁（第 20 道）与变异门禁在净化 PATH 下都要跑 python。
  for (const name of pythonRuntime) {
    const rel = 'runtime/python/' + name;
    copyFile(path.join(repoRoot, 'vendor', 'python-win32', 'pythoncore-3.12-64', name), path.join(outDir, rel));
    manifest.push([rel, sha256File(path.join(outDir, rel))]);
  }
  // bash 侧母版按 POSIX 惯例调 python3；runtime/python 里补一个同名别名
  copyFile(path.join(repoRoot, 'vendor', 'python-win32', 'pythoncore-3.12-64', 'python.exe'), path.join(outDir, 'runtime', 'python', 'python3.exe'));
  manifest.push(['runtime/python/python3.exe', sha256File(path.join(outDir, 'runtime', 'python', 'python3.exe'))]);
  for (const name of examplesFixture) {
    copyFile(path.join(repoRoot, name), path.join(outDir, name));
    manifest.push([name.split(path.sep).join('/'), sha256File(path.join(outDir, name))]);
    counts['L2-truth'] += 1;
  }
  for (const name of alignmentProject) {
    const rel = 'workspace/projects/' + PORTAL_ALIGNMENT_PROJECT_ID + '/' + name;
    copyFile(path.join(repoRoot, 'workspace', 'projects', PORTAL_ALIGNMENT_PROJECT_ID, name), path.join(outDir, rel));
    manifest.push([rel.split(path.sep).join('/'), sha256File(path.join(outDir, rel))]);
    counts['L2-truth'] += 1;
  }
  for (const name of benchProject) {
    const rel = 'workspace/projects/' + BENCH_PROJECT_ID + '/' + name;
    copyFile(path.join(repoRoot, 'workspace', 'projects', BENCH_PROJECT_ID, name), path.join(outDir, rel));
    manifest.push([rel, sha256File(path.join(outDir, rel))]);
    counts['L2-truth'] += 1;
  }
  for (const name of registryFixture) {
    copyFile(path.join(repoRoot, name), path.join(outDir, name));
    manifest.push([name.split(path.sep).join('/'), sha256File(path.join(outDir, name))]);
    counts['L2-truth'] += 1;
  }
  // 公开验签公钥：公钥不是机密，随包带走，让干净机器上 delivery.cmd 开箱即可验签。
  // 私钥永不进包（tools/ops/secrets/ 整目录被 .gitignore 忽略，这里只挑出 *_public.pem）。
  let publicKeyFiles = 0;
  for (const name of ['ed25519_public.pem']) {
    const rel = 'tools/ops/secrets/' + name;
    const from = path.join(repoRoot, rel);
    if (!fs.existsSync(from)) continue;
    copyFile(from, path.join(outDir, rel));
    manifest.push([rel, sha256File(path.join(outDir, rel))]);
    publicKeyFiles += 1;
  }

  const launchers = writeLaunchers(outDir);
  for (const name of launchers) manifest.push([name, sha256File(path.join(outDir, name))]);

  const nodeVersion = (() => {
    try {
      const r = spawnSync(path.join(repoRoot, 'vendor', 'tools', 'node.exe'), ['-v'], { encoding: 'utf8', windowsHide: true });
      return (r.stdout || '').trim() || 'unknown';
    } catch { return 'unknown'; }
  })();
  let totalBytes = 0;
  for (const [rel] of manifest) { try { totalBytes += fs.statSync(path.join(outDir, rel)).size; } catch { /* 跳过 */ } }
  const stats = { tracked: tracked.length, runtime: runtime.length, pythonFiles: pythonRuntime.length, nodeVersion, totalMb: (totalBytes / 1048576).toFixed(0), distFiles, publicKeyFiles };
  writeReadme(outDir, stats);
  manifest.push(['使用说明.md', sha256File(path.join(outDir, '使用说明.md'))]);

  fs.writeFileSync(path.join(outDir, 'MANIFEST.sha256'),
    manifest.map(([rel, hash]) => hash + '  ' + rel).join('\n') + '\n', 'utf8');

  const result = { outDir, counts, stats, manifestCount: manifest.length, totalMb: stats.totalMb };
  io.log('便携包已生成：' + outDir);
  io.log('  L1 软件核心 ' + counts['L1-core'] + ' 个（含前端产物 ' + distFiles + ' 个）');
  io.log('  L2 真源与台账 ' + counts['L2-truth'] + ' 个（含基准项目夹具 ' + benchProject.length + ' 个、注册表真源字节 ' + registryFixture.length + ' 个）');
  io.log('  L3 便携运行时 ' + runtime.length + ' 个（' + nodeVersion + '）+ python 审计运行时 ' + pythonRuntime.length + ' 个');
  io.log('  L1 附加：测试依赖闭包 ' + depFiles + ' 个文件（含 UI 测试闭包 ' + testPkgRoots.length + ' 个包）');
  io.log('  公开验签公钥 ' + publicKeyFiles + ' 个（仅 tools/ops/secrets/ed25519_public.pem，私钥不进包）');
  io.log('  L4 已排除 ' + counts['L4-runtime-artifact'] + ' 个');
  io.log('  清单 MANIFEST.sha256 覆盖 ' + manifest.length + ' 个文件，合计约 ' + stats.totalMb + ' MB');
  if (verify) result.verify = verifyPackage({ outDir, io });
  return result;
}

/** 净化 PATH：只留包内 runtime + 系统必需目录，模拟没装 node/git/ssh 的干净机器。 */
export function sanitizedEnv({ outDir, base = process.env } = {}) {
  const systemRoot = base.SystemRoot || base.windir || 'C:\\Windows';
  const pathEntries = [
    path.join(outDir, 'runtime'),
    path.join(outDir, 'runtime', 'python'),
    path.join(systemRoot, 'System32'),
    systemRoot,
    path.join(systemRoot, 'System32', 'Wbem'),
  ];
  return {
    SystemRoot: systemRoot,
    windir: base.windir || systemRoot,
    // 只留 USERPROFILE：msys ssh 在 HOME 指向 Windows 路径时反而不读 ~/.ssh/config
    // （实测别名解析失败），不设 HOME 时它按 USERPROFILE 找配置，与开发机一致。
    USERPROFILE: base.USERPROFILE || '',
    // TEMP/TMP 指向包内 .tmp：便携包不依赖系统临时目录（只读机器、受限账户、
    // 以及本会话实测的系统 TEMP EPERM 都因此不再影响测试与门禁）。
    TEMP: path.join(outDir, '.tmp'),
    TMP: path.join(outDir, '.tmp'),
    PATHEXT: base.PATHEXT || '.COM;.EXE;.BAT;.CMD',
    COMSPEC: base.COMSPEC || path.join(systemRoot, 'System32', 'cmd.exe'),
    PATH: pathEntries.join(path.delimiter),
    PATH_ORIGINAL: base.PATH || '',
  };
}

export function verifyPackage({ outDir, io = console } = {}) {
  const env = sanitizedEnv({ outDir });
  const nodeExe = path.join(outDir, 'runtime', 'node.exe');
  const pre = spawnSync(nodeExe, ['tools/dev/preflight.mjs', '--json'], { cwd: outDir, encoding: 'utf8', env, windowsHide: true, timeout: 60000 });
  const preJson = (() => { try { return JSON.parse(pre.stdout || '{}'); } catch { return null; } })();
  const gate = spawnSync(nodeExe, ['tools/dev/run_all_gates.mjs', '--skip-tests'], { cwd: outDir, encoding: 'utf8', env, windowsHide: true, timeout: 300000 });
  const gateOut = ((gate.stdout || '') + (gate.stderr || '')).trim();
  const ok = gate.status === 0 && /GATE_ALL_OK/.test(gateOut);
  io.log('');
  io.log('自检（净化 PATH = runtime + 系统目录，无 node/git/ssh）：');
  io.log('  preflight exit ' + pre.status + (preJson ? ('，缺必需项 ' + JSON.stringify(preJson.missingRequired || [])) : ''));
  io.log('  gate:all --skip-tests exit ' + gate.status + ' ' + (ok ? 'GATE_ALL_OK' : 'GATE_ALL_FAILED'));
  if (!ok) io.error(gateOut.split(/\r?\n/).slice(-12).join('\n'));
  return { ok, preflightExit: pre.status, preflightJson: preJson, gateExit: gate.status, gateTail: gateOut.split(/\r?\n/).slice(-12) };
}

export function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  const outIdx = argv.indexOf('--out');
  const outDir = outIdx >= 0 ? path.resolve(argv[outIdx + 1] || '') : DEFAULT_OUT;
  if (outIdx >= 0 && !argv[outIdx + 1]) { io.error('--out 需要一个目录'); return 2; }
  try {
    const result = buildPackage({ outDir, clean: !argv.includes('--keep'), verify: argv.includes('--verify'), io });
    if (result.verify && !result.verify.ok) { io.error('PORTABLE_VERIFY_FAILED'); return 1; }
    io.log('PORTABLE_PACKAGE_OK ' + result.manifestCount + ' 个文件');
    return 0;
  } catch (error) {
    io.error('PORTABLE_PACKAGE_FAILED ' + (error && error.message ? error.message : String(error)));
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
