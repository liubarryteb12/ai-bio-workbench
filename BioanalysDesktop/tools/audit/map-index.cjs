// 一次性结构地图（不入库）：列出 index.js 顶层 import 与顶层声明的名字、起止行、行数。
// 用途：搬非路由前置层时按符号定位，不靠会漂移的固定行号。
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');

const ROOT = path.resolve(__dirname, '..', '..');
const rel = process.argv[2] || 'server/index.js';
const code = fs.readFileSync(path.resolve(ROOT, rel), 'utf8');
const ast = parser.parse(code, { sourceType: 'module', allowReturnOutsideFunction: true });

const rows = [];
let importLines = 0;
for (const node of ast.program.body) {
  const a = node.loc.start.line;
  const b = node.loc.end.line;
  if (node.type === 'ImportDeclaration') {
    importLines += b - a + 1;
    continue;
  }
  let names = [];
  if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') names = [node.id ? node.id.name : '(anon)'];
  else if (node.type === 'VariableDeclaration') names = node.declarations.map((d) => (d.id.type === 'Identifier' ? d.id.name : '(pattern)'));
  else if (node.type === 'ExpressionStatement') names = [`<${node.expression.type}>`];
  else names = [`<${node.type}>`];
  const exported = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration';
  const body = node.type === 'ExportNamedDeclaration' && node.declaration ? `<export ${node.declaration.type}>` : '';
  rows.push({ a, b, len: b - a + 1, names: names.join(','), exported, kind: node.type, body });
}
console.log(`${rel} 顶层 import 占用行数=${importLines} 顶层语句数=${rows.length}`);
for (const r of rows) {
  console.log(`L${String(r.a).padStart(4)}-L${String(r.b).padStart(4)} ${String(r.len).padStart(4)}行 ${r.exported ? 'EXPORT ' : '      '}${r.names}   [${r.kind}${r.body}]`);
}
