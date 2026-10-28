#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');

// Node 22+ exposes stripTypeScriptTypes natively. The K40 Ubuntu container still
// ships Node 18, so fall back to the Termux Node 24 binary when it exists.
const TERMUX_NODE = '/data/data/com.termux/files/usr/bin/node';

function stripTypes(source, sourceUrl) {
  const native = require('node:module').stripTypeScriptTypes;
  if (typeof native === 'function') {
    return native(source, { mode: 'transform', sourceUrl });
  }
  const script =
    'const {stripTypeScriptTypes}=require("node:module");' +
    'process.stdout.write(stripTypeScriptTypes(process.argv[1],{mode:"transform"}));';
  return execFileSync(TERMUX_NODE, ['-e', script, source], { encoding: 'utf8' });
}

const ROOT = path.resolve(__dirname, '..');
const SOURCES = [
  'src/core/PathGuard.ts',
  'src/core/LedgerStore.ts',
  'src/core/CapabilityBus.ts',
  'src/core/ModLoader.ts',
];
const OUT_DIR = path.join(__dirname, '.build');

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const relative of SOURCES) {
  const input = path.join(ROOT, relative);
  const stripped = stripTypes(fs.readFileSync(input, 'utf8'), input);
  const esm = stripped.replace(
    /^import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)';$/gm,
    "import * as $1 from '$2';"
  );
  fs.writeFileSync(path.join(OUT_DIR, path.basename(relative).replace(/\.ts$/, '.mjs')), esm);
}

console.log('A2A_CORE_COMPILE_OK');
