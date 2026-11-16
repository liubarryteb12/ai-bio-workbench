/**
 * 桌面结构门禁（静态面）。
 *
 * 检查 Electron 安全开关、打包目标、运行时清单与脚本入口。
 * 不修改任何文件，不执行安装；运行面冒烟由 verify-package.mjs 负责。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, '..');
const errors = [];

function read(relative) {
  const full = path.join(DESKTOP_ROOT, relative);
  if (!fs.existsSync(full)) {
    errors.push(`缺少文件: ${relative}`);
    return '';
  }
  return fs.readFileSync(full, 'utf8');
}

const pkg = JSON.parse(read('package.json') || '{}');
if (pkg.main !== 'src/main/index.js') errors.push('package.json main 必须指向 src/main/index.js');
if (!pkg.devDependencies?.electron) errors.push('缺少 electron 依赖');
if (!pkg.devDependencies?.['electron-builder']) errors.push('缺少 electron-builder 依赖');
for (const script of ['stage', 'pack', 'dist', 'verify', 'gate']) {
  if (!pkg.scripts?.[script]) errors.push(`package.json 缺少脚本: ${script}`);
}

const builder = read('electron-builder.yml');
for (const token of ['zip', 'extraResources', 'extraFiles', 'release/runtime', 'release/venv', 'requestedExecutionLevel: asInvoker']) {
  if (!builder.includes(token)) errors.push(`electron-builder.yml 缺少: ${token}`);
}
if (/target: nsis/.test(builder)) errors.push('electron-builder.yml 已裁定放弃安装版，不得包含 nsis target');
if (/target: portable/.test(builder)) errors.push('electron-builder.yml 已裁定放弃安装版，不得包含 portable target');

const main = read('src/main/index.js');
for (const token of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'setPermissionRequestHandler', 'setWindowOpenHandler']) {
  if (!main.includes(token)) errors.push(`主进程缺少安全开关: ${token}`);
}
if (/BIO_ALLOW_DEV_NOAUTH\s*:\s*['"]1['"]/.test(main)) errors.push('桌面主进程不得注入 BIO_ALLOW_DEV_NOAUTH');
if (/nodeIntegration\s*:\s*true/.test(main)) errors.push('桌面主进程不得开启 nodeIntegration');

const preload = read('src/preload/index.cjs');
for (const token of ['contextBridge.exposeInMainWorld', 'ipcRenderer.invoke', 'bioanlysDesktop']) {
  if (!preload.includes(token)) errors.push(`preload 缺少: ${token}`);
}
if (/require\(['"]node:(fs|child_process|http|net)['"]\)/.test(preload)) {
  errors.push('preload 不得直接暴露 Node 文件/进程/网络模块');
}

const stage = read('scripts/stage-runtime.mjs');
for (const token of ['BioanalysDesktop', 'server', 'dist', 'node.exe', 'adb_exec.ps1', 'manifest.json']) {
  if (!stage.includes(token)) errors.push(`组装脚本缺少: ${token}`);
}

const verify = read('scripts/verify-package.mjs');
for (const token of ['api/health', 'api/projects/list', 'api/figures/templates', 'taskkill', 'shutdown']) {
  if (!verify.includes(token)) errors.push(`冒烟脚本缺少: ${token}`);
}

const functions = read('scripts/verify-functions.mjs');
for (const token of ['PRJ_GSE316126_SANITY', 'api/work-orders', 'raw_data', 'BIO_PYTHON_PATH']) {
  if (!functions.includes(token)) errors.push(`功能矩阵脚本缺少: ${token}`);
}

if (errors.length > 0) {
  console.error('[desktop-gate] FAIL');
  for (const item of errors) console.error(`- ${item}`);
  process.exit(1);
}
console.log('[desktop-gate] PASS');
