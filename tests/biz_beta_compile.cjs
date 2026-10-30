#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');

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
const OUT_DIR = path.join(__dirname, '.biz_beta_build');
const SOURCES = [
  'src/core/types.ts',
  'src/engines/bridge-engine/implementation.ts',
  'src/mods/mod-biz-beta/schema.ts',
  'src/mods/mod-biz-beta/implementation.ts',
  'src/mods/mod-biz-beta/slots/BetaSlots.ts',
  'src/mods/mod-biz-beta/manifest.ts',
];

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const relative of SOURCES) {
  const input = path.join(ROOT, relative);
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

console.log('BIZ_BETA_COMPILE_OK');
