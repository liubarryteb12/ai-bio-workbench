/**
 * 组装桌面运行时目录：release/runtime。
 *
 * 产物结构（resources/runtime）必须与后端 assetRoot 约定一致：
 *   runtime/BioanalysDesktop/server|dist
 *   runtime/shared|schemas|configs|tools|references|workspace|core
 *   runtime/node/node.exe
 *   runtime/BioanalysDesktop/node_modules/better-sqlite3
 *   runtime/platform-tools/adb.exe（可用时）
 *   runtime/python/python.exe（显式提供时）
 *
 * 只复制运行必需文件，references 与 workspace 仅复制 JSON 清单引用到的资产。
 * 构建产物不 undelete、不回写源码；重复运行先清空 release/runtime。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '..');
const RELEASE_ROOT = path.join(DESKTOP_ROOT, 'release');
const OUT_DIR = path.resolve(readArg('--out') || path.join(RELEASE_ROOT, 'runtime'));

// 自检基准文件清单以 server 的 CORE_SYNC_FILES 为单一事实源（需求 4：
// 引用关系成索引，打包清单跟着真源走，不在这里手工抄第二份）。
const { CORE_SYNC_FILES } = await import(
  pathToFileURL(path.join(REPO_ROOT, 'BioanalysDesktop', 'server', 'selfcheck.js')).href
);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function assertSafeOutput(target) {
  const resolved = path.resolve(target);
  if (resolved !== RELEASE_ROOT && !resolved.startsWith(RELEASE_ROOT + path.sep)) {
    throw new Error(`拒绝清理 release 之外的目录: ${resolved}`);
  }
}

function copyDir(source, target, options = {}) {
  if (!fs.existsSync(source)) {
    if (options.optional) return 0;
    throw new Error(`缺少必需目录: ${source}`);
  }
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter: options.filter,
  });
  return countFiles(target);
}

function copyFile(source, target, { optional = false } = {}) {
  if (!fs.existsSync(source)) {
    if (optional) return false;
    throw new Error(`缺少必需文件: ${source}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name));
    else count += 1;
  }
  return count;
}

function walkJsonStrings(value, sink) {
  if (typeof value === 'string') {
    sink(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkJsonStrings(item, sink);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) walkJsonStrings(item, sink);
  }
}

/**
 * 收集 tools/bio 下 JSON 引用的 references/ 与 workspace/ 资产。
 * 只收真实存在的文件，非法路径（绝对路径、..）一律跳过。
 */
function collectReferencedAssets() {
  const root = path.join(REPO_ROOT, 'tools', 'bio');
  const seen = new Set();
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.name.endsWith('.json')) continue;
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
      } catch {
        continue;
      }
      walkJsonStrings(parsed, (value) => {
        const candidate = value.replace(/\\/g, '/');
        if (!/^(references|workspace)\//.test(candidate)) return;
        if (candidate.includes('..') || path.isAbsolute(candidate)) return;
        seen.add(candidate);
      });
    }
  };
  visit(root);
  return [...seen].sort();
}

function copyReferencedAssets() {
  let copied = 0;
  const missing = [];
  for (const relative of collectReferencedAssets()) {
    const source = path.join(REPO_ROOT, relative);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      missing.push(relative);
      continue;
    }
    const target = path.join(OUT_DIR, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    copied += 1;
  }
  return { copied, missing };
}

function stageBetterSqlite() {
  const source = path.join(REPO_ROOT, 'BioanalysDesktop', 'node_modules', 'better-sqlite3');
  const target = path.join(OUT_DIR, 'BioanalysDesktop', 'node_modules', 'better-sqlite3');
  if (!fs.existsSync(source)) {
    throw new Error(`缺少 better-sqlite3: ${source}，请先在 BioanalysDesktop 执行 npm ci`);
  }
  fs.mkdirSync(target, { recursive: true });
  for (const item of ['lib', 'prebuilds', 'package.json', 'LICENSE']) {
    const from = path.join(source, item);
    if (!fs.existsSync(from)) continue;
    const to = path.join(target, item);
    if (fs.statSync(from).isDirectory()) copyDir(from, to);
    else copyFile(from, to);
  }
  const binding = path.join(target, 'prebuilds', 'win32-x64.node');
  if (!fs.existsSync(binding)) {
    throw new Error(`better-sqlite3 缺少 win32-x64 预编译绑定: ${binding}`);
  }
}

/**
 * 把 Pi CLI 的受控配置作为一等公民封入 runtime/picli/。
 *
 * 存在理由：Pi CLI 决定「模型能看到什么」。这份配置若只留在仓库里，
 * 客户机上跑的就是没有护栏的裸 CLI。所以配置、工具白名单与 QC 提示词
 * 必须随包分发，且打包后逐字节与仓库一致（由 dist_parity 负责关键资产）。
 *
 * 二进制本身按需携带：存在 BIO_PI_CLI_BIN 指向的可执行文件时一并复制，
 * 不存在只报 missing 而不让整包失败——guardrail 配置是硬依赖，二进制可由
 * 使用者在设置里指定。
 */
function stagePicli() {
  const sourceDir = path.join(DESKTOP_ROOT, 'runtime', 'picli');
  const targetDir = path.join(OUT_DIR, 'picli');
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`缺少 Pi 受控配置目录: ${sourceDir}`);
  }
  // auth.json 可能承载 OAuth 令牌，随包分发等于泄露凭证；运行时由环境变量注入。
  copyDir(sourceDir, targetDir, {
    filter: (src) => path.basename(src) !== 'auth.json',
  });
  for (const required of ['pi_config.json', 'tools_manifest.json', path.join('prompts', 'qc_sentinel_rules.md')]) {
    const file = path.join(targetDir, required);
    if (!fs.existsSync(file)) {
      throw new Error(`runtime/picli 缺少必备文件: ${required}`);
    }
  }

  const explicitBin = process.env.BIO_PI_CLI_BIN;
  if (explicitBin && fs.existsSync(explicitBin)) {
    const name = path.basename(explicitBin);
    copyFile(explicitBin, path.join(targetDir, name));
    return { mode: 'bundled', bin: name };
  }
  return { mode: 'config-only', bin: null };
}

function stageNode() {
  const target = path.join(OUT_DIR, 'node', 'node.exe');
  const source = process.execPath;
  if (!source.toLowerCase().endsWith('node.exe')) {
    throw new Error(`请用官方 node.exe 执行本脚本（当前 ${source}），否则无法随包携带后端运行时`);
  }
  copyFile(source, target);
}

function stagePython() {
  const explicitDir = process.env.BIO_DESKTOP_PYTHON_DIR;
  const explicitExe = process.env.BIO_DESKTOP_PYTHON_EXE;
  const target = path.join(OUT_DIR, 'python');
  if (explicitDir && fs.existsSync(explicitDir)) {
    copyDir(explicitDir, target);
    return 'bundled-dir';
  }
  if (explicitExe && fs.existsSync(explicitExe)) {
    copyFile(explicitExe, path.join(target, 'python.exe'));
    return 'bundled-exe';
  }
  return 'missing-js-fallback';
}

/**
 * 在 release/venv 构建自带 Python 运行环境（需求 3：venv 装在便携根目录）。
 * 基础解释器取仓库自带 vendor/python-win32/pythoncore-3.15-64，venv 内
 * 安装 pydantic（schema 网关真源依赖），清华镜像加速。
 */
/**
 * 在 release/venv 构建自带 Python 运行环境（需求 3：venv 装在便携根目录）。
 * 基础解释器取仓库自带 vendor/python-win32/pythoncore-3.15-64，venv 内
 * 安装 pydantic（schema 网关真源依赖），清华镜像加速。
 *
 * 为什么先在 ASCII 临时目录里建、装完再搬回 release/venv：
 * embedded Python 的 `-m venv` 会在目标目录里跑 ensurepip，而 ensurepip 在
 * 含中文的目标路径下直接返回 exit 1（实测路径 `...\AI辅助生信分析流程工作台\desktop\release\venv`）。
 * 搬到中文路径之后解释器本身工作正常（sys.prefix 与实际一致，pydantic 可导入），
 * 所以只在建环境这一瞬间避开非 ASCII 路径，不改变最终产物落点。
 */
function pickAsciiStagingRoot() {
  const candidates = [os.tmpdir(), process.env.ProgramData, 'C:\\Temp'];
  for (const candidate of candidates) {
    if (!candidate) continue;
    // eslint-disable-next-line no-control-regex
    if (/^[\x20-\x7E]+$/.test(candidate) && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function moveDir(source, target) {
  try {
    fs.renameSync(source, target);
  } catch {
    // 跨卷时 rename 不可用，退化为复制后删除
    fs.cpSync(source, target, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
}

function stageVenv() {
  const basePython = path.join(REPO_ROOT, 'vendor', 'python-win32', 'pythoncore-3.15-64', 'python.exe');
  if (!fs.existsSync(basePython)) {
    return { mode: 'missing-base', python: basePython };
  }
  const venvDir = path.join(RELEASE_ROOT, 'venv');
  fs.rmSync(venvDir, { recursive: true, force: true });

  const stagingRoot = pickAsciiStagingRoot();
  if (!stagingRoot) {
    throw new Error('找不到可用的 ASCII 临时目录（ensurepip 在非 ASCII 路径下会失败），请设置 TEMP 指向纯英文路径');
  }
  const stagingDir = path.join(stagingRoot, `bio_venv_${process.pid}_${Date.now()}`);
  fs.rmSync(stagingDir, { recursive: true, force: true });

  try {
    const created = spawnSync(basePython, ['-m', 'venv', stagingDir], {
      encoding: 'utf8',
      timeout: 120000,
      windowsHide: true,
    });
    if (created.status !== 0) {
      throw new Error(`venv 创建失败: ${created.stderr || created.stdout}`);
    }
    const stagingPython = path.join(stagingDir, 'Scripts', 'python.exe');
    const installed = spawnSync(stagingPython, [
      '-m', 'pip', 'install', '--quiet', '--disable-pip-version-check',
      '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple', 'pydantic',
    ], {
      encoding: 'utf8',
      timeout: 300000,
      windowsHide: true,
    });
    if (installed.status !== 0) {
      throw new Error(`pydantic 安装失败: ${installed.stderr || installed.stdout}`);
    }

    fs.mkdirSync(RELEASE_ROOT, { recursive: true });
    moveDir(stagingDir, venvDir);

    const venvPython = path.join(venvDir, 'Scripts', 'python.exe');
    const check = spawnSync(venvPython, ['-c', 'import pydantic; print(pydantic.__version__)'], {
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
    });
    if (check.status !== 0) {
      throw new Error(`pydantic 导入失败: ${check.stderr}`);
    }
    return { mode: 'ok', version: check.stdout.trim(), files: countFiles(venvDir) };
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function stageAdb() {
  const candidates = [
    process.env.BIO_DESKTOP_ADB_DIR,
    'C:\\adb\\platform-tools',
  ].filter(Boolean);
  const source = candidates.find((dir) => fs.existsSync(path.join(dir, 'adb.exe')));
  if (!source) return 'missing';
  const target = path.join(OUT_DIR, 'platform-tools');
  fs.mkdirSync(target, { recursive: true });
  for (const name of ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'NOTICE.txt', 'source.properties']) {
    copyFile(path.join(source, name), path.join(target, name), { optional: true });
  }
  return source;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeManifest() {
  const files = [];
  let totalBytes = 0;
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      const stat = fs.statSync(full);
      totalBytes += stat.size;
      files.push({
        path: path.relative(OUT_DIR, full).split(path.sep).join('/'),
        bytes: stat.size,
        sha256: sha256(full),
      });
    }
  };
  visit(OUT_DIR);
  const manifest = {
    schema_version: 1,
    built_at: new Date().toISOString(),
    node: process.version,
    file_count: files.length,
    total_bytes: totalBytes,
    files,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

/**
 * 运行时索引（需求 4）：manifest 之外再产出带来源关系的 app-index.json。
 * relations 记录"仓库源路径 -> 运行时落点"的引用关系，新增/删除文件
 * 在重新 stage 时自动更新。
 */
function writeAppIndex(venvInfo) {
  const relations = [
    { kind: 'runtime-source', from: 'BioanalysDesktop/server', to: 'BioanalysDesktop/server' },
    { kind: 'runtime-source', from: 'BioanalysDesktop/dist', to: 'BioanalysDesktop/dist' },
    { kind: 'runtime-source', from: 'shared', to: 'shared' },
    { kind: 'runtime-source', from: 'schemas', to: 'schemas' },
    { kind: 'runtime-source', from: 'tools/bio', to: 'tools/bio' },
    { kind: 'runtime-source', from: 'tools/reporting', to: 'tools/reporting' },
    { kind: 'runtime-source', from: 'tools/bin', to: 'tools/bin' },
    { kind: 'runtime-source', from: 'tools/dev/work_order_orchestrator.mjs', to: 'tools/dev/work_order_orchestrator.mjs' },
    { kind: 'runtime-source', from: 'tools/ops/adb_exec.ps1', to: 'tools/ops/adb_exec.ps1' },
    { kind: 'runtime-source', from: 'tools/ops/init_workspace_hierarchy.ps1', to: 'tools/ops/init_workspace_hierarchy.ps1' },
    { kind: 'runtime-source', from: 'tools/ops/pull_and_verify.ps1', to: 'tools/ops/pull_and_verify.ps1' },
    { kind: 'runtime-source', from: 'tools/ops/remote_pack.sh', to: 'tools/ops/remote_pack.sh' },
    { kind: 'runtime-source', from: 'tools/ops/wipe_remote.sh', to: 'tools/ops/wipe_remote.sh' },
    { kind: 'runtime-source', from: 'tools/ops/k40_mem_watchdog.sh', to: 'tools/ops/k40_mem_watchdog.sh' },
    { kind: 'node-runtime', from: 'bundled node.exe', to: 'node/node.exe' },
    { kind: 'sqlite-binding', from: 'BioanalysDesktop/node_modules/better-sqlite3', to: 'BioanalysDesktop/node_modules/better-sqlite3' },
    { kind: 'adb-tools', from: 'platform-tools', to: 'platform-tools' },
    { kind: 'venv', from: 'vendor/python-win32/pythoncore-3.15-64', to: venvInfo.mode === 'ok' ? 'release/venv' : 'missing' },
    { kind: 'core-sync', from: CORE_SYNC_FILES.map(item => item.repo).join(', '), to: 'same-path' },
  ];
  const files = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { visit(full); continue; }
      files.push({
        path: path.relative(OUT_DIR, full).split(path.sep).join('/'),
        bytes: fs.statSync(full).size,
        sha256: sha256(full),
      });
    }
  };
  visit(OUT_DIR);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const index = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entry_count: files.length,
    total_bytes: files.reduce((sum, item) => sum + item.bytes, 0),
    relations,
    entries: files,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'app-index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return index;
}

function main() {
  assertSafeOutput(OUT_DIR);
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  copyDir(
    path.join(REPO_ROOT, 'BioanalysDesktop', 'server'),
    path.join(OUT_DIR, 'BioanalysDesktop', 'server'),
    { filter: (src) => !src.includes(`${path.sep}tests${path.sep}`) },
  );
  copyDir(path.join(REPO_ROOT, 'BioanalysDesktop', 'dist'), path.join(OUT_DIR, 'BioanalysDesktop', 'dist'));
  copyDir(path.join(REPO_ROOT, 'shared'), path.join(OUT_DIR, 'shared'));
  copyDir(path.join(REPO_ROOT, 'schemas'), path.join(OUT_DIR, 'schemas'));
  copyDir(path.join(REPO_ROOT, 'configs'), path.join(OUT_DIR, 'configs'));
  copyDir(path.join(REPO_ROOT, 'core'), path.join(OUT_DIR, 'core'), { optional: true });
  copyDir(path.join(REPO_ROOT, 'tools', 'bio'), path.join(OUT_DIR, 'tools', 'bio'));
  copyDir(path.join(REPO_ROOT, 'tools', 'reporting'), path.join(OUT_DIR, 'tools', 'reporting'));
  copyDir(path.join(REPO_ROOT, 'tools', 'bin'), path.join(OUT_DIR, 'tools', 'bin'));
  copyFile(
    path.join(REPO_ROOT, 'portal', 'lib', 'archive.mjs'),
    path.join(OUT_DIR, 'portal', 'lib', 'archive.mjs'),
  );
  copyDir(path.join(REPO_ROOT, 'tools', 'dev'), path.join(OUT_DIR, 'tools', 'dev'), {
    optional: true,
    filter: (src) => {
      const name = path.basename(src);
      return name !== 'work_order_orchestrator.mjs' && name !== 'figure_ready_allowlist.json'
        ? src === path.join(REPO_ROOT, 'tools', 'dev')
        : true;
    },
  });
  // 里程碑 1 新增的四层收敛与传输脚本必须随包携带：
  // 缺少它们，便携端建目录、流式回搬、远端清零三条链路都无从执行。
  // 只复制运行必需的脚本，不整目录搬 tools/ops（那里还有一次性运维探针）。
  for (const opsScript of [
    'adb_exec.ps1',
    'init_workspace_hierarchy.ps1',
    'pull_and_verify.ps1',
    'remote_pack.sh',
    'wipe_remote.sh',
    'k40_mem_watchdog.sh',
  ]) {
    copyFile(
      path.join(REPO_ROOT, 'tools', 'ops', opsScript),
      path.join(OUT_DIR, 'tools', 'ops', opsScript),
    );
  }
  for (const item of CORE_SYNC_FILES) {
    copyFile(
      path.join(REPO_ROOT, ...item.repo.split('/')),
      path.join(OUT_DIR, ...item.repo.split('/')),
    );
  }
  copyDir(path.join(REPO_ROOT, 'tools', 'ops', 'secrets'), path.join(OUT_DIR, 'tools', 'ops', 'secrets'), { optional: true });
  copyDir(path.join(REPO_ROOT, 'tools', 'ops', 'k40'), path.join(OUT_DIR, 'tools', 'ops', 'k40'), { optional: true });
  copyDir(
    path.join(REPO_ROOT, 'references', '05.可参考生信代码', 'library'),
    path.join(OUT_DIR, 'references', '05.可参考生信代码', 'library'),
  );

  const referenced = copyReferencedAssets();
  stageBetterSqlite();
  stageNode();
  const python = stagePython();
  const picli = stagePicli();
  const adb = stageAdb();
  const venv = stageVenv();
  const manifest = writeManifest();
  const appIndex = writeAppIndex(venv);

  console.log(`[stage] runtime: ${OUT_DIR}`);
  console.log(`[stage] files: ${manifest.file_count}, bytes: ${manifest.total_bytes}`);
  console.log(`[stage] referenced assets: ${referenced.copied}, missing: ${referenced.missing.length}`);
  if (referenced.missing.length > 0) {
    console.log(`[stage] missing sample: ${referenced.missing.slice(0, 10).join(', ')}`);
  }
  console.log(`[stage] python: ${python}`);
  console.log(`[stage] picli: ${picli.mode}${picli.bin ? ' (' + picli.bin + ')' : '（仅受控配置，二进制由 BIO_PI_CLI_BIN 指定）'}`);
  console.log(`[stage] adb: ${adb}`);
  console.log(`[stage] venv: ${venv.mode}${venv.version ? ' pydantic ' + venv.version : ''} (${venv.files || 0} files)`);
  console.log(`[stage] app-index: ${appIndex.entry_count} entries`);
}

main();
