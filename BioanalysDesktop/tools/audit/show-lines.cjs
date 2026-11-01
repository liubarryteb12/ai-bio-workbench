// 一次性查看脚本（不入库）：node tools/audit/show-lines.cjs <相对文件> <起> <止>
// 用途：绕开 PowerShell 字符串展开与工具渲染错乱，直接按行取原文。
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const [rel, a, b] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
if (!rel || !Number.isInteger(a) || !Number.isInteger(b)) {
  console.error('用法: node tools/audit/show-lines.cjs <file> <from> <to>');
  process.exit(2);
}
const lines = fs.readFileSync(path.resolve(ROOT, rel), 'utf8').split(/\r?\n/);
for (let i = a; i <= Math.min(b, lines.length); i += 1) console.log(`${i}: ${lines[i - 1]}`);
