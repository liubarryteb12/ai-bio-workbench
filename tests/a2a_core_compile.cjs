#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('./typescript.js');

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
  const output = ts.transpileModule(fs.readFileSync(input, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
      esModuleInterop: true,
    },
    fileName: input,
  });
  fs.writeFileSync(path.join(OUT_DIR, path.basename(relative).replace(/\.ts$/, '.js')), output.outputText);
}

console.log('A2A_CORE_COMPILE_OK');
