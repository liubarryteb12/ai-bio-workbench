/**
 * Electron 端到端冒烟：真实启动桌面壳，等它拉起后端并渲染首页，然后退出。
 *
 * 用法：node scripts/verify-electron.mjs
 * 可选环境变量：
 *   BIO_DESKTOP_ELECTRON       指定 electron.exe（构建机沙箱可用）
 *   BIO_DESKTOP_ELECTRON_ARGS  额外参数，例如 "--no-sandbox --disable-gpu"
 *   BIO_DESKTOP_DATA_HOME      冒烟数据目录（默认 release/.electron-smoke）
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, '..');
const ELECTRON = process.env.BIO_DESKTOP_ELECTRON
  || path.join(DESKTOP_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const DATA_HOME = path.resolve(process.env.BIO_DESKTOP_DATA_HOME || path.join(DESKTOP_ROOT, 'release', '.electron-smoke'));
const EXTRA_ARGS = String(process.env.BIO_DESKTOP_ELECTRON_ARGS || '').split(/\s+/).filter(Boolean);

if (!fs.existsSync(ELECTRON)) {
  console.error(`[electron-smoke] 找不到 Electron: ${ELECTRON}`);
  process.exit(1);
}
fs.mkdirSync(DATA_HOME, { recursive: true });

const args = [...EXTRA_ARGS, '.', '--smoke-test'];
const child = spawn(ELECTRON, args, {
  cwd: DESKTOP_ROOT,
  env: {
    ...process.env,
    BIO_DESKTOP_DATA_HOME: DATA_HOME,
    BIO_DEV_NODE: process.execPath,
    ELECTRON_ENABLE_LOGGING: '1',
  },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
const capture = (chunk) => { output += chunk.toString(); };
child.stdout.on('data', capture);
child.stderr.on('data', capture);

const timeout = setTimeout(() => {
  console.error('[electron-smoke] 超时，强制结束');
  child.kill();
}, 90000);

child.once('exit', (code) => {
  clearTimeout(timeout);
  const loaded = output.match(/\[smoke\] loaded title=(.+)/);
  const body = output.match(/\[smoke\] body=(.+)/);
  if (code === 0 && loaded && body && /首页/.test(body[1]) && /Bioanalys/.test(body[1])) {
    console.log(`[electron-smoke] PASS title=${loaded[1].trim()}`);
    console.log(`[electron-smoke] body=${body[1].trim().slice(0, 180)}`);
    process.exit(0);
  }
  console.error(`[electron-smoke] FAIL exit=${code}`);
  console.error(output.slice(-4000));
  process.exit(1);
});
