// 一次性审计脚本（不入库）：用 @babel 作用域分析找出「引用了但没有任何绑定」的标识符。
// 用途：搬移路由/前置层后，工具渲染偶发把标识符显示错乱，照抄进新文件会得到一个
// 拼错的标识符，node --check 查不出（语法合法），只有跑到那一行才 ReferenceError。
// 这条审计在跑测试之前先把这类雷扫掉。
// 用法：node tools/audit/audit-unbound.cjs [相对 BioanalysDesktop 的文件...]
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const ROOT = path.resolve(__dirname, '..', '..');

// Node/浏览器 ambient 名 + 本项目允许的隐式全局
const AMBIENT = new Set([
  'globalThis', 'undefined', 'NaN', 'Infinity', 'arguments', 'this',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'Proxy', 'Reflect', 'Promise',
  'Function', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'URIError', 'EvalError', 'AggregateError', 'JSON', 'Math', 'Date', 'RegExp',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'structuredClone',
  'ArrayBuffer', 'DataView', 'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams',
  'Uint8Array', 'Uint8ClampedArray', 'Int8Array', 'Uint16Array', 'Int16Array',
  'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array', 'BigInt64Array',
  'BigUint64Array', 'Buffer', 'process', 'console', 'module', 'exports',
  'require', '__dirname', '__filename',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
  'clearImmediate', 'queueMicrotask', 'performance', 'fetch', 'Headers', 'Request',
  'Response', 'AbortController', 'AbortSignal', 'FormData', 'Blob', 'File',
  'ReadableStream', 'WritableStream', 'TransformStream', 'Crypto', 'CryptoKey',
  'Event', 'EventTarget', 'CustomEvent', 'MessageChannel', 'MessagePort',
  'BroadcastChannel', 'Worker', 'stream', 'util', 'os', 'fs', 'path',
  'assert', 'Intl', 'WeakMap', 'escape', 'unescape', 'eval',
  // 前端 ambient（.tsx 走 tsc 单独把关，这里只兜 JS 文件）
  'window', 'document', 'location', 'navigator', 'localStorage', 'sessionStorage',
  'requestAnimationFrame', 'cancelAnimationFrame', 'alert', 'confirm', 'HTMLElement',
  'EventSource', 'WebSocket', 'HTMLElementTagNameMap', 'React', 'JSX',
]);

const files = process.argv.slice(2);
if (files.length === 0) {
  files.push('server/index.js');
  for (const n of fs.readdirSync(path.join(ROOT, 'server', 'routes'))) {
    if (n.endsWith('.js')) files.push(path.join('server', 'routes', n));
  }
}

let totalFindings = 0;
for (const rel of files) {
  const abs = path.resolve(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.log(`跳过（不存在）: ${rel}`);
    continue;
  }
  const code = fs.readFileSync(abs, 'utf8');
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      errorRecovery: true,
      plugins: rel.endsWith('.ts') || rel.endsWith('.tsx')
        ? ['typescript', 'jsx']
        : [],
    });
  } catch (err) {
    console.log(`解析失败: ${rel}: ${err.message}`);
    totalFindings += 1;
    continue;
  }

  const findings = new Map();
  traverse(ast, {
    ReferencedIdentifier(p) {
      const name = p.node.name;
      if (AMBIENT.has(name)) return;
      const parent = p.parent;
      // 非计算成员访问的右侧属性名不是引用
      if (parent && parent.type === 'MemberExpression' && parent.property === p.node && !parent.computed) return;
      // label
      if (parent && (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement')) return;
      if (p.scope.getBinding(name) || p.scope.getProgramParent().bindings[name]) return;
      const key = `${name}@${p.node.loc ? p.node.loc.start.line : '?'}`;
      if (!findings.has(key)) {
        findings.set(key, `L${p.node.loc ? p.node.loc.start.line : '?'} ${name}`);
      }
    },
  });

  if (findings.size === 0) {
    console.log(`OK  ${rel}`);
    continue;
  }
  totalFindings += findings.size;
  console.log(`FINDINGS ${rel} (${findings.size}):`);
  for (const line of findings.values()) console.log(`   ${line}`);
}
console.log(`\n合计可疑未绑定引用: ${totalFindings}`);
process.exit(totalFindings > 0 ? 1 : 0);
