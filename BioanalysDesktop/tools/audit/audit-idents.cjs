// 一次性审计脚本（不入库）：给定 server/index.js 的行区间，列出该区间用到的
// index.js 顶层标识符（搬移时必须注入或改 import），以及区间用到的 index.js import 符号。
// 用法：node tools/audit/audit-idents.cjs <起始行> <结束行>
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.resolve(__dirname, '..', '..', 'server', 'index.js');
const [from, to] = [Number(process.argv[2]), Number(process.argv[3])];
if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
  console.error('用法: node tools/audit/audit-idents.cjs <起始行> <结束行>');
  process.exit(2);
}
const lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/);
const block = lines.slice(from - 1, to).join('\n');

// index.js 顶层声明名
const topLevel = new Set();
const declRe = /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/;
lines.forEach((line, idx) => {
  const m = declRe.exec(line);
  if (m) topLevel.add(m[1]);
  // 解构 const { a, b } = ... 与 const { a: c } = ...
  const d = /^(?:export\s+)?(?:const|let|var)\s*\{([^}]*)\}\s*=/.exec(line);
  if (d) {
    for (const part of d[1].split(',')) {
      const name = part.split(':').pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) topLevel.add(name);
    }
  }
});

// import 符号（含多行 import）
const importSymbols = new Set();
let buf = '';
lines.forEach((line) => {
  if (/^import\b/.test(line) || buf !== '') {
    buf += ' ' + line;
    if (buf.includes('from') || /;\s*$/.test(buf)) {
      const braces = /import\s*(?:[^'"]*?\{([^}]*)\}|\*\s+as\s+([A-Za-z_$][\w$]*))?\s*from/.exec(buf);
      if (braces) {
        if (braces[1]) {
          for (const part of braces[1].split(',')) {
            const name = part.split(/\s+as\s+/).pop().trim();
            if (/^[A-Za-z_$][\w$]*$/.test(name)) importSymbols.add(name);
          }
        }
        if (braces[2]) importSymbols.add(braces[2]);
      }
      const bare = /^import\s+([A-Za-z_$][\w$]*)\s+from/.exec(buf.trim());
      if (bare) importSymbols.add(bare[1]);
      buf = '';
    }
  }
});

// 区间内本地声明的名字不算外部依赖
const localDecl = new Set();
const localDeclRe = /(?:^|[\s({])(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
let lm;
while ((lm = localDeclRe.exec(block))) localDecl.add(lm[1]);
// 箭头函数形参（粗粒度，只覆盖 (x) => 与 (x, y) => 与函数签名里的形参名）
const paramDecl = /(?:function\s*\w*|\(([^)]*)\)\s*=>)\s*|\(([^)]*)\)\s*\{/g;
let pm;
while ((pm = paramDecl.exec(block))) {
  const group = pm[1] || pm[2];
  if (!group) continue;
  for (const part of group.split(',')) {
    const name = part.split('=')[0].split(':').pop().trim().replace(/^\.\.\./, '');
    if (/^[A-Za-z_$][\w$]*$/.test(name)) localDecl.add(name);
  }
}

const used = new Set();
const idRe = /(?<![\w$.])((\$)?[A-Za-z_$][\w$]*)(?![\w$]*\s*:)/g;
let um;
while ((um = idRe.exec(block))) used.add(um[1]);

const needsInject = [...topLevel].filter((n) => used.has(n) && !localDecl.has(n)).sort();
const needsImport = [...importSymbols].filter((n) => used.has(n) && !localDecl.has(n)).sort();
const unknown = [...used].filter((n) => !topLevel.has(n) && !importSymbols.has(n) && !localDecl.has(n));

console.log(`区间 L${from}-L${to} 行数=${to - from + 1}`);
console.log(`\n需要注入的 index.js 顶层标识符 (${needsInject.length}):\n  ${needsInject.join(', ')}`);
console.log(`\n需要新模块 import 的符号 (${needsImport.length}):\n  ${needsImport.join(', ')}`);
console.log(`\n未识别标识符（人工核对，含 Node 内置与属性访问）:\n  ${unknown.join(', ')}`);
