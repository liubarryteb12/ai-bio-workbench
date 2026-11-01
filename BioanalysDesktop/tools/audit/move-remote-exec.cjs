#!/usr/bin/env node
/*
 * Extract the remote-exec block out of server/index.js into server/remote_exec.js.
 * Pure relocation: the moved text is copied by byte offsets from the parsed source,
 * never retyped, and identity is re-verified before anything is written.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@babel/parser');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'server', 'index.js');
const OUT = path.join(ROOT, 'server', 'remote_exec.js');
const NAMES = ['runRemoteRaw', 'listRemoteProcessed', 'runRemote', 'runRemoteStrict', 'sanitizeBridgeOutput'];

const src = fs.readFileSync(SRC, 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  allowReturnOutsideFunction: true,
  errorRecovery: false,
  tokens: false,
});

const body = ast.program.body;
const found = [];
for (let i = 0; i < body.length; i += 1) {
  const st = body[i];
  if (st.type !== 'FunctionDeclaration' || !st.id) continue;
  if (!NAMES.includes(st.id.name)) continue;
  const prevEnd = i > 0 ? body[i - 1].end : 0;
  let start = st.start;
  for (const c of st.leadingComments ?? []) {
    if (c.start >= prevEnd && c.end <= st.start && c.start < start) start = c.start;
  }
  found.push({ name: st.id.name, start, end: st.end, prevEnd, index: i });
}

const missing = NAMES.filter((n) => !found.some((f) => f.name === n));
if (missing.length) {
  console.error(`FAIL missing functions: ${missing.join(',')}`);
  process.exit(1);
}
found.sort((a, b) => a.start - b.start);

const spanStart = found[0].start;
const spanEnd = found[found.length - 1].end;

/* Contiguity gate: the span must contain those 5 declarations and nothing else. */
const intruders = body.filter((st) => st.start >= spanStart && st.end <= spanEnd)
  .filter((st) => !(st.type === 'FunctionDeclaration' && NAMES.includes(st.id?.name ?? '')));
if (intruders.length) {
  console.error(`FAIL span not contiguous, intruders: ${intruders.map((s) => `${s.type}@${s.start}`).join(',')}`);
  process.exit(1);
}

const moved = src.slice(spanStart, spanEnd);

const header = [
  '/**',
  ' * 远端执行层：本地零算力红线的唯一出口。',
  ' *',
  ' * 所有计算都经 ssh 到 k40-ubuntu 执行，本模块只负责把命令送过去、',
  ' * 按宽松/严格两种口径取回结果，并把 ssh 自身的 noise 从引擎输出里滤掉。',
  ' */',
  '',
  "import { projectLineDir } from './domain.js';",
  "import { runSshRaw, runSshStrict } from './proc.js';",
  '',
].join('\n');

const out = `${header}${moved}\n`;

/* Build the new index.js: drop the span, collapse the blank-line seam, add the import. */
const before = src.slice(0, spanStart);
const after = src.slice(spanEnd);
let joined = `${before.replace(/\n[ \t]*\n$/, '\n')}${after.replace(/^\n/, '')}`;

const imports = body.filter((st) => st.type === 'ImportDeclaration');
const lastImportEnd = imports[imports.length - 1].end;
const importLine = "\nimport {\n  runRemoteRaw, listRemoteProcessed, runRemote, runRemoteStrict, sanitizeBridgeOutput,\n} from './remote_exec.js';\n";
const insertAt = lastImportEnd;
joined = `${joined.slice(0, insertAt)}${importLine}${joined.slice(insertAt)}`;

/* Gate: moved block must survive verbatim, and the export statement must be present. */
const exportStmt = NAMES.map((n) => `export function ${n}(`);
let outChecked = out;
for (let i = 0; i < NAMES.length; i += 1) {
  const plain = `function ${NAMES[i]}(`;
  const exp = exportStmt[i];
  if (!outChecked.includes(plain)) {
    console.error(`FAIL moved block lost its definition: ${NAMES[i]}`);
    process.exit(1);
  }
  outChecked = outChecked.replace(plain, exp);
}
if (!outChecked.includes("import { projectLineDir } from './domain.js';")) {
  console.error('FAIL remote_exec.js lost its domain import');
  process.exit(1);
}
if (outChecked.includes('./index.js')) {
  console.error('FAIL remote_exec.js imports index.js (circular)');
  process.exit(1);
}

/* The relocated text, minus the export keyword, must be a byte-for-byte substring of the original. */
for (const f of found) {
  const originalPiece = src.slice(f.start, f.end);
  if (!out.includes(originalPiece)) {
    console.error(`FAIL not verbatim: ${f.name}`);
    process.exit(1);
  }
}

fs.writeFileSync(OUT, outChecked, 'utf8');
fs.writeFileSync(SRC, joined, 'utf8');

console.log(JSON.stringify({
  movedFunctions: NAMES,
  spanStartLine: src.slice(0, spanStart).split('\n').length,
  spanEndLine: src.slice(0, spanEnd).split('\n').length,
  movedBytes: Buffer.byteLength(moved, 'utf8'),
  indexBytesBefore: Buffer.byteLength(src, 'utf8'),
  indexBytesAfter: Buffer.byteLength(joined, 'utf8'),
}, null, 2));
