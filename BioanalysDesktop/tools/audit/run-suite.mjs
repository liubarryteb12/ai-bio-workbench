/**
 * 全量测试跑批器（后台）：显式展开 tests/*.test.js，显式用 PATH 上的 node。
 * 用法: node tools/audit/run-suite.mjs <logFile> <codeFile>
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const logPath = process.argv[2] || path.join(HERE, 'suite.log');
const codePath = process.argv[3] || path.join(HERE, 'suite.code');
const only = process.argv[4];

const all = fs.readdirSync(path.join(ROOT, 'tests'))
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join('tests', f));
const files = only ? only.split(',').map((n) => path.join('tests', n)) : all;

const out = fs.openSync(logPath, 'w');
const started = Date.now();
const child = spawn('node', ['--test', '--test-concurrency=1', ...files], {
  cwd: ROOT,
  stdio: ['ignore', out, out],
  windowsHide: true,
});
child.on('exit', (code) => {
  fs.writeFileSync(codePath, JSON.stringify({ code, elapsedMs: Date.now() - started, count: files.length }), 'utf8');
  fs.closeSync(out);
});
child.on('error', (err) => {
  fs.writeFileSync(codePath, JSON.stringify({ code: -1, error: String(err) }), 'utf8');
});
