// 一次性审计脚本（不入库）：核对路由模块处理函数第 4 参解构出来的每个注入键，
// 在 index.js 的 routeCtx（含调用点展开的额外键）里是否真的存在。
// 缺一个键不会报错在加载期，而是跑到那条分支才 "X is not a function"，所以静态先查。
// 用法：node tools/audit/audit-ctx-keys.cjs
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'server', 'index.js');
const ROUTES_DIR = path.join(ROOT, 'server', 'routes');

function parse(file) {
  return parser.parse(fs.readFileSync(file, 'utf8'), {
    sourceType: 'module',
    allowReturnOutsideFunction: true,
    errorRecovery: true,
  });
}

// 1) index.js: routeCtx 的键 + 每个调用点额外并进的键
const indexAst = parse(INDEX);
const ctxKeys = new Set();
let routeCtxKeys = new Set();
traverse(indexAst, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.id.name === 'routeCtx'
      && p.node.init && p.node.init.type === 'ObjectExpression') {
      for (const prop of p.node.init.properties) {
        if (prop.type === 'ObjectProperty' && prop.key.type === 'Identifier') {
          routeCtxKeys.add(prop.key.name);
        }
      }
    }
  },
  // if (handleXRoutes(req, res, url, { ...routeCtx, adb })) 这类调用点
  CallExpression(p) {
    const callee = p.node.callee;
    if (!callee || callee.type !== 'Identifier' || !/^handle\w+Routes$/.test(callee.name)) return;
    const arg = p.node.arguments[3];
    if (!arg || arg.type !== 'ObjectExpression') return;
    for (const prop of arg.properties) {
      if (prop.type === 'ObjectProperty' && prop.key.type === 'Identifier') ctxKeys.add(prop.key.name);
    }
  },
});
for (const k of routeCtxKeys) ctxKeys.add(k);
console.log(`routeCtx 键 (${routeCtxKeys.size}): ${[...routeCtxKeys].sort().join(', ')}`);
console.log(`调用点额外键: ${[...ctxKeys].filter((k) => !routeCtxKeys.has(k)).sort().join(', ') || '(无)'}`);

// 2) 各路由模块处理函数第 4 参解构键
let problems = 0;
for (const name of fs.readdirSync(ROUTES_DIR).filter((n) => n.endsWith('.js')).sort()) {
  const file = path.join(ROUTES_DIR, name);
  const ast = parse(file);
  let checked = 0;
  traverse(ast, {
    Function(p) {
      const params = p.node.params;
      if (params.length !== 4) return;
      const ctx = params[3];
      if (!ctx || ctx.type !== 'ObjectPattern') return;
      const required = [];
      for (const prop of ctx.properties) {
        if (prop.type === 'ObjectProperty') {
          required.push(prop.value.type === 'Identifier' ? prop.value.name : null);
        } else if (prop.type === 'RestElement') {
          required.push(null);
        }
      }
      checked += 1;
      const missing = required.filter((k) => k && !ctxKeys.has(k));
      const used = new Set();
      p.traverse({
        ReferencedIdentifier(rp) {
          if (required.includes(rp.node.name)) used.add(rp.node.name);
        },
      });
      const unused = required.filter((k) => k && !used.has(k));
      const label = missing.length ? 'MISSING' : 'OK';
      console.log(`${label} ${name} 需要${required.filter(Boolean).length}键`
        + (missing.length ? ` 缺失: ${missing.join(', ')}` : '')
        + (unused.length ? `  [注: 解构但未使用 ${unused.join(', ')}]` : ''));
      if (missing.length) problems += missing.length;
    },
  });
  if (checked === 0) {
    console.log(`WARN ${name} 未找到 (req,res,url,{...}) 四参处理函数`);
    problems += 1;
  }
}
console.log(`\n缺失注入键合计: ${problems}`);
process.exit(problems > 0 ? 1 : 0);
