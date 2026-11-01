/**
 * 一次性路由抽取器（不入库）。
 *
 * 为什么要有它：处理体动辄三四百行且含模板字符串、正则与中文文案，手抄必错；
 * 上一轮就有一个子代理在 PowerShell 里抄 340 行抄到上下文耗尽。本脚本用
 * @babel/parser 做 AST 定位，保证「逐字搬运」是可验证的事实而不是口号：
 *   1. 处理体字节照抄，只改两类东西；
 *   2. 分支顶层（不在任何嵌套函数里）的 return：json()/uploadError() 调用改成
 *      先调用再显式 return true；裸 return; 改成 return true;
 *      嵌套回调（req.on('end')、map、setImmediate）内的 return 一律不碰；
 *   3. import 自动按原来源模块重算并加一层 ../，index.js 里搬空的符号自动摘掉；
 *   4. 任何识别不了的顶层依赖一律中止，不猜。
 *
 * 用法：node tools/audit/extract-route.cjs --from 789 --to 1255 \
 *        --module routes/projects.routes.js --handler handleProjectRoutes --label 项目路由
 */
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require(path.resolve(__dirname, '..', '..', 'node_modules', '@babel', 'parser'));

const SERVER = path.resolve(__dirname, '..', '..', 'server', 'index.js');
const ROUTES_DIR = path.resolve(__dirname, '..', '..', 'server', 'routes');

function arg(name, required = true) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) {
    if (required) {
      console.error(`缺少参数 --${name}`);
      process.exit(2);
    }
    return null;
  }
  return process.argv[i + 1];
}

const FROM = Number(arg('from'));
const TO = Number(arg('to'));
const MODULE_REL = arg('module');
const HANDLER = arg('handler');
const LABEL = arg('label', false) || HANDLER;
const NO_DISPATCH_RETURN_TRUE = process.argv.includes('--predicate');

if (!Number.isInteger(FROM) || !Number.isInteger(TO) || TO < FROM) {
  console.error('行区间参数非法');
  process.exit(2);
}

const raw = fs.readFileSync(SERVER, 'utf8');
if (raw.includes('\r\n')) {
  console.error('中止：index.js 含 CRLF');
  process.exit(1);
}
const lines = raw.split('\n');
const blockLines = lines.slice(FROM - 1, TO);
const blockText = blockLines.join('\n');

// ---- index.js 符号表：import 来源与顶层声明 ----
const importRe = /^import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+)|([\w$]+))?\s*from\s+'([^']+)';/gm;
const imports = [];
let im;
while ((im = importRe.exec(raw))) {
  const specifiers = [];
  if (im[1]) specifiers.push({ local: im[1], imported: 'default' });
  if (im[2]) {
    for (const part of im[2].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(t);
      if (!m) {
        console.error(`中止：import 规格无法解析：${t}`);
        process.exit(1);
      }
      specifiers.push({ local: m[2] || m[1], imported: m[1] });
    }
  }
  if (im[3]) specifiers.push({ local: im[3], imported: '*' });
  if (im[4]) specifiers.push({ local: im[4], imported: 'default' });
  imports.push({ source: im[5], specifiers, text: im[0] });
}
const importedByLocal = new Map();
for (const imp of imports) {
  for (const s of imp.specifiers) {
    if (!importedByLocal.has(s.local)) importedByLocal.set(s.local, { source: imp.source, imported: s.imported });
  }
}

const topLevel = new Set();
lines.forEach((line) => {
  let m = /^(?:export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/.exec(line);
  if (m) topLevel.add(m[1]);
  m = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line);
  if (m) topLevel.add(m[1]);
  m = /^(?:export\s+)?(?:const|let|var)\s*\{([^}]*)\}\s*=/.exec(line);
  if (m) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) topLevel.add(name);
    }
  }
});

// ---- AST 定位：包装函数顶层的 return ----
const wrapped = `function __routeBody(req, res, url) {\n${blockText}\n}\n`;
const ast = parse(wrapped, { ecmaVersion: 'latest', sourceType: 'script', errorRecovery: false });
const wrapper = ast.program.body[0];
if (!wrapper || wrapper.type !== 'FunctionDeclaration') {
  console.error('中止：包装节点异常');
  process.exit(1);
}

const topReturns = [];
(function walk(node, fnDepth) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, fnDepth);
    return;
  }
  if (!node.type) return;
  const isFn = node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression'
    || node.type === 'ArrowFunctionExpression';
  const isWrapper = node === wrapper;
  if (node.type === 'ReturnStatement') {
    topReturns.push({ node, fnDepth: isWrapper ? 0 : fnDepth });
    return;
  }
  const nextDepth = isWrapper ? fnDepth : fnDepth + (isFn ? 1 : 0);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    walk(node[key], nextDepth);
  }
})(wrapper, 0);

// 无花括号的单语句体：`if (x) return json(...)`。直接换成两条语句会让第二条逃出 if，
// 实测把 /api/workflows/<seriesId> 的正常响应吞掉过（请求挂死到超时），所以这类必须补花括号。
const CONTROL_BODIES = new Map([
  ['IfStatement', ['consequent', 'alternate']],
  ['ForStatement', ['body']],
  ['ForInStatement', ['body']],
  ['ForOfStatement', ['body']],
  ['WhileStatement', ['body']],
  ['DoWhileStatement', ['body']],
  ['LabeledStatement', ['body']],
]);
const bareBodyReturns = new WeakSet();
(function markBare(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const c of node) markBare(c);
    return;
  }
  if (!node.type) return;
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') return;
  const keys = CONTROL_BODIES.get(node.type);
  if (keys) {
    for (const key of keys) {
      const child = node[key];
      if (child && child.type === 'ReturnStatement') bareBodyReturns.add(child);
    }
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    markBare(node[key]);
  }
})(wrapper.body);

const topLevelReturns = topReturns.filter((r) => r.fnDepth === 0);

// ---- 生成改写指令（按 start 逆序应用，偏移不漂移）----
const wrappedLines = wrapped.split('\n');
function offsetToLineCol(offset) {
  let line = 0;
  let acc = 0;
  for (let i = 0; i < wrappedLines.length; i++) {
    const next = acc + wrappedLines[i].length + 1;
    if (offset < next) return { line: i, col: offset - acc };
    acc = next;
  }
  return { line: wrappedLines.length - 1, col: 0 };
}

const edits = [];
for (const item of topLevelReturns) {
  const ret = item.node;
  const indentOf = (off) => {
    const { line } = offsetToLineCol(off);
    const text = wrappedLines[line];
    return text.slice(0, text.length - text.trimStart().length);
  };
  if (!ret.argument) {
    edits.push({ start: ret.start, end: ret.end, kind: 'bare', indent: indentOf(ret.start), bareBody: bareBodyReturns.has(ret) });
    continue;
  }
  const argNode = ret.argument;
  const calleeName = argNode.type === 'CallExpression' && argNode.callee.type === 'Identifier'
    ? argNode.callee.name : null;
  if (!calleeName) {
    console.error(`中止：顶层 return 返回的不是 ${'json/uploadError'} 直接调用，需人工决定（偏移 ${ret.start}）`);
    process.exit(1);
  }
  edits.push({
    start: ret.start, end: ret.end, kind: calleeName,
    indent: indentOf(ret.start), exprStart: argNode.start, exprEnd: argNode.end, bareBody: bareBodyReturns.has(ret),
  });
}

// 把 AST 偏移映射回 blockText 的行数组：wrapped 相对 blockText 偏移 +len('function ...{\n')
const PREFIX = 'function __routeBody(req, res, url) {\n'.length;
let out = blockText;
const sorted = edits.slice().sort((a, b) => b.start - a.start);
const applied = { bare: 0, json: 0, uploadError: 0, other: 0 };
for (const ed of sorted) {
  const s = ed.start - PREFIX;
  const e = ed.end - PREFIX;
  const stmtText = out.slice(s, e);
  if (ed.kind === 'bare') {
    out = out.slice(0, s) + (ed.bareBody ? `{\n${ed.indent}  return true;\n${ed.indent}}` : `return true;`) + out.slice(e);
    applied.bare += 1;
  } else {
    if (ed.kind === 'json') applied.json += 1;
    else if (ed.kind === 'uploadError') applied.uploadError += 1;
    else applied.other += 1;
    const expr = out.slice(ed.exprStart - PREFIX, ed.exprEnd - PREFIX);
    const terminated = /;\s*$/.test(stmtText) ? '' : ';';
    out = ed.bareBody
      ? out.slice(0, s) + `{\n${ed.indent}  ${expr};\n${ed.indent}  return true;\n${ed.indent}}` + out.slice(e)
      : out.slice(0, s) + `${expr};\n${ed.indent}return true;` + out.slice(e);
  }
}

// ---- 依赖分析：需要 import 与注入的符号 ----
const usedNames = new Set();
// 只统计「自由变量」：成员访问的属性名与对象字面量的键都不是依赖，
// 否则 pathname / error / id 这类会被误判成缺符号。
const SKIP_KEYS = new Set(['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments']);
(function collect(node, key, parent) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const c of node) collect(c, key, parent);
    return;
  }
  if (!node.type) return;
  if (SKIP_KEYS.has(key)) return;
  if (node.type === 'Identifier') {
    const isMemberProp = parent && (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && key === 'property' && !parent.computed;
    const isObjKey = parent && parent.type === 'ObjectProperty' && key === 'key' && !parent.computed;
    const isMethodKey = parent && parent.type === 'ObjectMethod' && key === 'key' && !parent.computed;
    const isLabel = parent && (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement');
    if (!isMemberProp && !isObjKey && !isMethodKey && !isLabel) usedNames.add(node.name);
    return;
  }
  if (node.type === 'Property') {
    if (node.computed) collect(node.key, 'key', node);
    collect(node.value, 'value', node);
    return;
  }
  for (const k of Object.keys(node)) {
    if (SKIP_KEYS.has(k)) continue;
    collect(node[k], k, node);
  }
})(wrapper.body, 'body', null);

// 局部声明（含形参）不算外部依赖：递归收集每个作用域声明的名字
const localNames = new Set(['req', 'res', 'url']);
(function collectLocal(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const c of node) collectLocal(c);
    return;
  }
  if (node.type === 'VariableDeclarator' && node.id) {
    if (node.id.type === 'Identifier') localNames.add(node.id.name);
    else JSON.stringify(node.id, (k, v) => {
      if (v && v.type === 'Identifier') localNames.add(v.name);
      return v;
    });
  }
  const addParams = (params) => {
    for (const p of params || []) {
      if (p.type === 'Identifier') localNames.add(p.name);
      else JSON.stringify(p, (k, v) => {
        if (v && v.type === 'Identifier') localNames.add(v.name);
        return v;
      });
    }
  };
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
    addParams(node.params);
    if (node.id) localNames.add(node.id.name);
  }
  if (node.type === 'CatchClause' && node.param) addParams([node.param]);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    collectLocal(node[key]);
  }
})(wrapper.body);

const needImport = new Map();
const needInject = [];
const unknown = [];
const RESERVED = new Set(['undefined', 'null', 'true', 'false', 'NaN', 'Infinity', 'globalThis', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'String', 'Number', 'Boolean', 'Object', 'Array', 'JSON', 'Math', 'Date', 'RegExp', 'Map', 'Set', 'WeakMap', 'Promise', 'Symbol', 'Buffer', 'console', 'process', 'URL', 'URLSearchParams', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate', 'encodeURIComponent', 'decodeURIComponent', 'parseInt', 'parseFloat', 'isNaN', 'Intl', 'structuredClone', 'require', 'arguments']);
for (const name of usedNames) {
  if (localNames.has(name) || RESERVED.has(name)) continue;
  if (importedByLocal.has(name)) {
    const info = importedByLocal.get(name);
    if (!needImport.has(info.source)) needImport.set(info.source, []);
    needImport.get(info.source).push(info.imported === name ? name : `${info.imported} as ${name}`);
    continue;
  }
  if (topLevel.has(name)) {
    needInject.push(name);
    continue;
  }
  unknown.push(name);
}
if (unknown.length) {
  console.error(`中止：以下顶层依赖无法归类，需人工确认：\n  ${unknown.join(', ')}`);
  process.exit(1);
}

// 新模块 import 行：路径加一层 ../
const importLines = [];
for (const [source, names] of [...needImport.entries()].sort()) {
  const rel = source.startsWith('./') ? `../${source.slice(2)}` : source;
  const uniq = [...new Set(names)].sort();
  const defaults = uniq.filter((n) => n.startsWith('default as ')).map((n) => `import ${n.slice('default as '.length)} from '${rel}';`);
  const named = uniq.filter((n) => !n.startsWith('default as '));
  if (defaults.length) importLines.push(...defaults);
  if (named.length) {
    const joined = named.join(', ');
    importLines.push(joined.length > 72
      ? `import {\n  ${named.join(', ')},\n} from '${rel}';`
      : `import { ${joined} } from '${rel}';`);
  }
}

const HEADER = process.env.ROUTE_HEADER_NOTE
  ? String(process.env.ROUTE_HEADER_NOTE)
  : `${LABEL}：处理体从 server/index.js 逐字搬来，函数体未做改写。\n`
    + '// 注入项的定义仍在 index.js（守卫与测试按 index.js 统计那些符号），此处不复制第二份。\n'
    + '// 返回约定：命中本模块管辖的 pathname 就返回 true。json() 与 uploadError() 返回\n'
    + '// undefined，不能当命中信号，所以分支顶层的 return 一律改成「先响应、再显式 return true」。\n'
    + '// 嵌套回调（req.on(\'end\')、map、setImmediate）里的 return 是回调返回值，保持原样。';

const injectList = needInject.slice().sort();
const sigLines = [];
for (let i = 0; i < injectList.length; i += 4) {
  sigLines.push(`  ${injectList.slice(i, i + 4).join(', ')}${i + 4 < injectList.length ? ',' : ','}`);
}
const moduleText = [
  `// ${LABEL}。`,
  `//`,
  ...HEADER.split('\n').map((l) => (l.startsWith('//') ? l : `// ${l}`).trimEnd()),
  ...importLines,
  '',
  `export function ${HANDLER}(req, res, url, {`,
  ...sigLines,
  '}) {',
  out,
  '',
  '  return false;',
  '}',
  '',
].join('\n');

const OUT_FILE = path.join(ROUTES_DIR, MODULE_REL);
if (fs.existsSync(OUT_FILE)) {
  console.error(`中止：目标模块已存在，不覆盖：${OUT_FILE}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, moduleText, 'utf8');

const dispatch = [
  `  // ${LABEL}，处理体在 routes/${path.basename(MODULE_REL)}`,
  `  if (${HANDLER}(req, res, url, routeCtx)) {`,
  '    return;',
  '  }',
];
const nextLines = [...lines.slice(0, FROM - 1), ...dispatch, ...lines.slice(TO)];
fs.writeFileSync(SERVER, nextLines.join('\n'), 'utf8');

console.log(JSON.stringify({
  module: MODULE_REL,
  moduleLines: moduleText.split('\n').length,
  indexLines: nextLines.length,
  topLevelReturnsConverted: {
    json: applied.json, uploadError: applied.uploadError, bareReturn: applied.bare,
  },
  injected: injectList,
  imports: Object.fromEntries(needImport),
}, null, 2));
