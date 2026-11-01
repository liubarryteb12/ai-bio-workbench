// 一次性普查脚本（不入库）：用 @babel 扫描 server/ routes/ src/ tests/ 下
// 对待搬符号的全部引用点，给出 文件:行号 级指针。
// 用法：node tools/audit/census-symbols.cjs
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const ROOT = path.resolve(__dirname, '..', '..');

const SYMBOLS = [
  // sinks.js
  'createSink', 'dropSink', 'sendEvent', 'closeSink',
  // ledger_fetch.js
  'fetchLedgerFromServer',
  // remote_exec.js
  'runRemoteRaw', 'listRemoteProcessed', 'runRemote', 'runRemoteStrict', 'sanitizeBridgeOutput',
  // query_views.js
  'resolveProjectParam', 'listProjectsWithMeta', 'listFiguresForLine',
  // portal_page.js
  'escapeHtml', 'renderFiguresPreview',
  // portal_inbox.js
  'PORTAL_INBOX', 'isSafeManifestName', 'readPackageManifest', 'listInboxManifests',
  // static_assets.js
  'DIST_DIR', 'STATIC_MIME', 'serveStatic',
  // task_input.js
  'remoteTaskInput', 'uploadPreparedFigureScripts', 'deployDataFiles',
  // leave-in symbols
  'validateTaskPaths', 'lineFromPipeline', 'isAuthorized', 'safeEqual',
  'AUTH_USER', 'AUTH_PASS', 'AUTH_ENABLED', 'IS_TEST_RUNTIME', 'DEV_NOAUTH',
  'PORT', 'REPO_ROOT', 'server',
  // shared helpers that routeCtx injects (defined in index.js, used from ctx)
  'json', 'uploadError',
  // context dependency
  'routeCtx', 'runningTasks', 'logSinks', 'adb',
  // probe entry
  'LINE_INFER_PROBE',
];

const SYMBOL_SET = new Set(SYMBOLS);

function collectFiles(dir, exts) {
  const result = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.tmp') continue;
        walk(full);
      } else if (entry.isFile() && exts.some((e) => entry.name.endsWith(e))) {
        result.push(full);
      }
    }
  };
  walk(dir);
  return result;
}

const SERVER_DIR = path.join(ROOT, 'server');
const ROUTES_DIR = path.join(SERVER_DIR, 'routes');
const TESTS_DIR = path.join(ROOT, 'tests');
const SRC_DIR = path.join(ROOT, 'src');

const allFiles = [
  ...collectFiles(SERVER_DIR, ['.js']),
  ...collectFiles(TESTS_DIR, ['.js', '.mjs']),
  ...collectFiles(SRC_DIR, ['.ts', '.tsx']),
];

for (const file of allFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  let code;
  try {
    code = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      errorRecovery: true,
      plugins: (file.endsWith('.ts') || file.endsWith('.tsx')) ? ['typescript', 'jsx'] : [],
    });
  } catch {
    continue;
  }

  const hits = [];
  traverse(ast, {
    Identifier(p) {
      const name = p.node.name;
      if (!SYMBOL_SET.has(name)) return;
      const line = p.node.loc ? p.node.loc.start.line : '?';
      const parent = p.parent;

      // 判断引用方式
      let kind = 'ref';
      if (parent.type === 'FunctionDeclaration' && parent.id === p.node) {
        kind = 'definition';
      } else if (parent.type === 'VariableDeclarator' && parent.id === p.node) {
        kind = 'definition';
      } else if (parent.type === 'ImportSpecifier' && parent.local === p.node) {
        kind = 'import';
      } else if (parent.type === 'ExportSpecifier') {
        kind = 'export';
      } else if (parent.type === 'ExportNamedDeclaration' && parent.declaration) {
        kind = 'export+def';
      } else if (parent.type === 'ObjectProperty' && parent.key === p.node && !parent.computed) {
        kind = 'obj-key';
      } else if (parent.type === 'ObjectProperty' && parent.value === p.node && parent.shorthand) {
        kind = 'obj-shorthand';
      } else if (parent.type === 'ExportDefaultDeclaration') {
        kind = 'export-default';
      }

      // 跳过成员访问的属性名 (a.foo 的 foo)
      if (parent.type === 'MemberExpression' && parent.property === p.node && !parent.computed) {
        return;
      }

      hits.push(`  ${rel}:${line}  ${name}  [${kind}]`);
    },
  });

  if (hits.length > 0) {
    console.log(`=== ${rel} ===`);
    for (const h of hits) console.log(h);
  }
}
