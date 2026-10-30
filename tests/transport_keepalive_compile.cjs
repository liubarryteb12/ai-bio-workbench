#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(__dirname, '.transport_build');
const SOURCES = [
  'src/core/types.ts',
  'src/engines/transport-keepalive-engine/interface.ts',
  'src/engines/transport-keepalive-engine/implementation.ts',
  'src/engines/transport-keepalive-engine/adapters.ts',
];

function stripTypes(source, sourceUrl) {
  const native = require('node:module').stripTypeScriptTypes;
  if (typeof native === 'function') {
    return native(source, { mode: 'transform', sourceUrl });
  }
  const script =
    'const {stripTypeScriptTypes}=require("node:module");' +
    'process.stdout.write(stripTypeScriptTypes(process.argv[1],{mode:"transform"}));';
  return execFileSync('node', ['-e', script, source], { encoding: 'utf8' });
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const relative of SOURCES) {
  const input = path.join(ROOT, relative);
  if (!fs.existsSync(input)) {
    throw new Error(`missing source: ${relative}`);
  }
  const stripped = stripTypes(fs.readFileSync(input, 'utf8'), input);
  const esm = stripped.replace(
    /from\s+'(\.{1,2}\/[^']+)';/g,
    (match, specifier) => specifier.endsWith('.mjs')
      ? match
      : "from '" + specifier + ".mjs';"
  );
  const output = path.join(OUT_DIR, relative.replace(/\.ts$/, '.mjs'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, esm);
}

console.log('TRANSPORT_KEEPALIVE_COMPILE_OK');
