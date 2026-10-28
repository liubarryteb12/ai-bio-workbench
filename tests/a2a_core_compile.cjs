#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { stripTypeScriptTypes } = require('node:module');

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
  const stripped = stripTypeScriptTypes(fs.readFileSync(input, 'utf8'), {
    mode: 'transform',
    sourceUrl: input,
  });
  const esm = stripped.replace(
    /^import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)';$/gm,
    "import * as $1 from '$2';"
  );
  fs.writeFileSync(path.join(OUT_DIR, path.basename(relative).replace(/\.ts$/, '.mjs')), esm);
}

console.log('A2A_CORE_COMPILE_OK');
