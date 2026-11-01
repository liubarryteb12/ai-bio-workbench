// 一次性审计脚本（不入库）：路由模块「响应后必须显式 return true」审计。
// 背景：约定是 json()/uploadError() 返回 undefined，不能当命中信号；分支里响应完必须
// 紧跟 return true，否则会继续往下派发，造成二次响应或请求悬挂。
// 已踩过的真实回归：无花括号的 `if (x) return json(...)` 被搬成
// `if (x) json(...); return true;`，语义变成「无条件 return true」，
// 结果是 GET /api/workflows/:seriesId 成功响应被吞。本脚本来静态钉死这一类。
// 用法：node tools/audit/audit-hit-return.cjs
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const ROOT = path.resolve(__dirname, '..', '..');
const ROUTES_DIR = path.join(ROOT, 'server', 'routes');
const RESPONDERS = new Set(['json', 'uploadError']);

function isReturnTrue(node) {
  return !!node && node.type === 'ReturnStatement'
    && !!node.argument && node.argument.type === 'BooleanLiteral' && node.argument.value === true;
}

let problems = 0;
for (const name of fs.readdirSync(ROUTES_DIR).filter((n) => n.endsWith('.js')).sort()) {
  const file = path.join(ROUTES_DIR, name);
  const code = fs.readFileSync(file, 'utf8');
  const ast = parser.parse(code, { sourceType: 'module', errorRecovery: true });
  const found = [];

  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      if (!callee || callee.type !== 'Identifier' || !RESPONDERS.has(callee.name)) return;
      const stmt = p.getStatementParent();
      if (!stmt) return;
      // 兄弟节点取 stmt 自己的 container（语句所在块体数组），
      // 用 stmt.parentPath.container 会取到祖父节点（TryStatement/CatchClause），恒非数组。
      const siblings = stmt.container;
      const idx = stmt.key;
      const inBlock = Array.isArray(siblings);
      const next = siblings[idx + 1];
      if (isReturnTrue(next)) return;

      // 响应调用所在的最内层函数是不是路由处理函数本身？
      // 嵌套回调（req.on('end')、map、setImmediate）里的 return 是回调返回值，另判。
      const fn = p.getFunctionParent();
      const isHandler = !!fn && fn.node.params.length === 4;
      // 无花括号 if 的裸语句：stmt 是 IfStatement.consequent 且不是 BlockStatement
      const parent = stmt.parentPath.node;
      const isBareIfBody = (parent.type === 'IfStatement' || parent.type === 'Loop'
        || /^For/.test(parent.type) || parent.type === 'WhileStatement')
        && parent.consequent === stmt.node;
      const notInBlock = !inBlock;
      // return json(...) 形式也算正确（由外层 await 调用方判定命中）
      const wrappedInReturn = stmt.node.type === 'ReturnStatement';
      found.push({
        line: stmt.node.loc ? stmt.node.loc.start.line : '?',
        kind: callee.name,
        isHandler,
        isBareIfBody,
        notInBlock,
        wrappedInReturn,
        next: next ? next.type : '(end of block)',
      });
    },
  });

  // 处理函数顶层的响应点后必须紧跟 return true。
  // 注意 `return json(...)` 形式同样算问题：json() 返回 undefined，
  // 处理函数返回 undefined 等于「未命中」，派发会继续往下走造成二次响应。
  const risky = found.filter((f) => f.isHandler);
  const okCount = found.length - risky.length;
  if (risky.length === 0) {
    console.log(`OK  ${name}  响应点 ${found.length}（已确认 return true / return 形式 ${okCount}）`);
    continue;
  }
  console.log(`FINDINGS ${name}: ${risky.length} 个响应点后没有显式 return true`);
  for (const r of risky) {
    console.log(`   L${r.line} ${r.kind}(...) 后一条语句=${r.next}`
      + (r.wrappedInReturn ? '  [return json() 形式：返回 undefined 等于未命中]' : '')
      + (r.notInBlock ? '  [语句不在块体数组里]' : '')
      + (r.isBareIfBody ? '  [裸 if 体，疑似把 return 丢了]' : ''));
  }
  problems += risky.length;
}
console.log(`\n合计可疑漏派点: ${problems}`);
process.exit(problems > 0 ? 1 : 0);
