// 一次性验收脚本（不入库）：证明「搬移是搬运不是重写」。
// 做法：把旧 index.js 的对应行区间与新路由模块的处理体各做同一套归一化后逐行比对。
// 归一化只吃掉两类「约定内的必要改动」：
//   1) 派发约定：`return json(...)` → `json(...)` + 独立一行 `return true;`
//   2) 无花括号 if 自动补括号（extract-route.cjs 的 bareBodyReturns 修正）
// 其余任何 token 差异都算搬运中被改写的内容，必须逐条列出人工裁定。
// 用法：node tools/audit/verbatim-diff.cjs <旧文件> <旧起> <旧止> <新文件> <新起> <新止>
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');

const [oldRel, a, b, newRel, c, d] = [
  process.argv[2], Number(process.argv[3]), Number(process.argv[4]),
  process.argv[5], Number(process.argv[6]), Number(process.argv[7]),
];
if (!oldRel || !newRel || [a, b, c, d].some((n) => !Number.isInteger(n))) {
  console.error('用法: node tools/audit/verbatim-diff.cjs <old> <from> <to> <new> <from> <to>');
  process.exit(2);
}

function read(rel) {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf8').split(/\r?\n/);
}

function normalize(lines) {
  const out = [];
  const brace = (line) => line.replace(/\{$/, '').replace(/\}\);$/, ');').trim();
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    if (line === 'return true;') continue;
    // 裸 if 直接 return json(...) 的旧写法：新模块拆成「if (cond)」+「json(...)」两行，
    // 这里做同样拆分，否则会把约定内的补括号误判成改写。
    const bareIf = /^if \((.*)\) return (json|uploadError)\(/.exec(line);
    if (bareIf) {
      out.push(brace(`if (${bareIf[1]})`));
      out.push(brace(`${bareIf[2]}(${line.slice(line.indexOf('(', line.indexOf('return')) + 1)}`));
      continue;
    }
    let n = /^return (json|uploadError)\(/.test(line) ? line.replace(/^return /, '') : line;
    // 吃掉括号结构差异：结构由三个 AST 审计单独管
    if (n === '{' || n === '}' || n === '});' || n === '};') continue;
    n = brace(n);
    if (n === '') continue;
    out.push(n);
  }
  return out;
}

const oldLines = normalize(read(oldRel).slice(a - 1, b));
const newLines = normalize(read(newRel).slice(c - 1, d));
console.log(`归一化后行数 旧=${oldLines.length} 新=${newLines.length}`);

// 顺序保留的最长公共子序列 diff（区域不大，O(nm) 够用）
const n = oldLines.length;
const m = newLines.length;
const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
for (let i = n - 1; i >= 0; i -= 1) {
  for (let j = m - 1; j >= 0; j -= 1) {
    dp[i][j] = oldLines[i] === newLines[j]
      ? dp[i + 1][j + 1] + 1
      : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
}
const onlyOld = [];
const onlyNew = [];
let i = 0;
let j = 0;
while (i < n && j < m) {
  if (oldLines[i] === newLines[j]) { i += 1; j += 1; continue; }
  if (dp[i + 1][j] >= dp[i][j + 1]) { onlyOld.push(oldLines[i]); i += 1; } else { onlyNew.push(newLines[j]); j += 1; }
}
while (i < n) { onlyOld.push(oldLines[i]); i += 1; }
while (j < m) { onlyNew.push(newLines[j]); j += 1; }

console.log(`相同行 ${n - onlyOld.length} / 旧共 ${n}`);
console.log(`仅旧侧存在 (${onlyOld.length}):`);
for (const line of onlyOld) console.log(`  - ${line}`);
console.log(`仅新侧存在 (${onlyNew.length}):`);
for (const line of onlyNew) console.log(`  + ${line}`);
const delta = onlyOld.length + onlyNew.length;
console.log(`\nVERDICT delta=${delta}`);
process.exit(delta > 0 ? 1 : 0);
