/**
 * 便携版 zip 打包（构建链最后一环）。
 *
 * 为什么需要单独一步：electron-builder 的 `zip` 目标在本机压缩阶段会死等
 * （实测 13 线程全部 Wait、CPU 零增长、无 7z 子进程），而它产出的
 * `release/win-unpacked` 本身完全正确。因此构建链只让 electron-builder 出目录，
 * 压缩改由本脚本完成，产物等价且可独立校验。
 *
 * 产物：release/BioanalysWorkbench-<version>-win.zip
 * 用法：node scripts/zip-portable.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, '..');
const RELEASE = path.join(DESKTOP_ROOT, 'release');
const SOURCE = path.join(RELEASE, 'win-unpacked');

const REQUIRED = [
  'BioanalysWorkbench.exe',
  'venv/Scripts/python.exe',
  'resources/runtime/node/node.exe',
  'resources/runtime/BioanalysDesktop/server/pi_runner.js',
];

function fail(message) {
  console.error(`[zip-portable] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(SOURCE)) fail(`缺少打包目录（先跑 npm run stage 与 electron-builder）: ${SOURCE}`);
for (const rel of REQUIRED) {
  const full = path.join(SOURCE, ...rel.split('/'));
  if (!fs.existsSync(full)) fail(`win-unpacked 缺少必需文件: ${rel}`);
}

const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_ROOT, 'package.json'), 'utf8'));
const target = path.join(RELEASE, `BioanalysWorkbench-${pkg.version}-win.zip`);
if (fs.existsSync(target)) fs.rmSync(target, { force: true });

// 在 win-unpacked 内部打包，压缩包顶层直接是应用文件（与 electron-builder 产出一致）。
const staging = path.join(RELEASE, `.zip-staging-${process.pid}`);
fs.mkdirSync(staging, { recursive: true });
try {
  for (const entry of fs.readdirSync(SOURCE)) {
    fs.renameSync(path.join(SOURCE, entry), path.join(staging, entry));
  }
  // Compress-Archive 对小文件多、体积大的目录比 electron-builder 更稳。
  execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `Compress-Archive -Path '${staging}\\*' -DestinationPath '${target}' -CompressionLevel Optimal`,
  ], { stdio: 'inherit', windowsHide: true });
} finally {
  // 无论成败都把内容挪回原位，避免 win-unpacked 被清空后再也跑不起来。
  if (fs.existsSync(staging)) {
    for (const entry of fs.readdirSync(staging)) {
      fs.renameSync(path.join(staging, entry), path.join(SOURCE, entry));
    }
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (!fs.existsSync(target)) fail('压缩未产出目标文件');

const stat = fs.statSync(target);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
console.log(`[zip-portable] 产物 ${path.basename(target)}`);
console.log(`[zip-portable] 体积 ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
console.log(`[zip-portable] sha256 ${sha256}`);
