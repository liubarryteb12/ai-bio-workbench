#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(
  ROOT,
  'BioanalysDesktop',
  'server',
  'runtime',
  '.generated'
);
const TERMUX_NODE = '/data/data/com.termux/files/usr/bin/node';

function stripTypes(source, sourceUrl) {
  const native = globalThis.process.getBuiltinModule('node:module').stripTypeScriptTypes;
  if (typeof native === 'function') {
    return native(source, { mode: 'transform', sourceUrl });
  }
  const script =
    'const {stripTypeScriptTypes}=require("node:module");' +
    'process.stdout.write(stripTypeScriptTypes(process.argv[1],{mode:"transform"}));';
  return execFileSync(TERMUX_NODE, ['-e', script, source], { encoding: 'utf8' });
}

function sourceFiles() {
  const files = [
    'src/core/types.ts',
    'src/core/LedgerStore.ts',
    'src/core/ModLoader.ts',
    'src/core/SlotManager.ts',
  ];
  const modsRoot = path.join(ROOT, 'src', 'mods');
  for (const entry of fs.readdirSync(modsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const modRoot = path.join(modsRoot, entry.name);
    const manifest = path.join(modRoot, 'manifest.ts');
    if (fs.existsSync(manifest)) {
      files.push(path.relative(ROOT, manifest).split(path.sep).join('/'));
    }
    const slotsRoot = path.join(modRoot, 'slots');
    if (!fs.existsSync(slotsRoot)) {
      continue;
    }
    for (const slotFile of fs.readdirSync(slotsRoot)) {
      if (!slotFile.endsWith('.ts')) {
        continue;
      }
      files.push(path.relative(ROOT, path.join(slotsRoot, slotFile)).split(path.sep).join('/'));
    }
  }
  return [...new Set(files)].sort();
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const relative of sourceFiles()) {
  const input = path.join(ROOT, relative);
  const stripped = stripTypes(fs.readFileSync(input, 'utf8'), input);
  const esm = stripped.replace(
    /from\s+'(\.{1,2}\/[^']+)';/g,
    (match, specifier) => specifier.endsWith('.mjs')
      ? match
      : `from '${specifier}.mjs';`
  );
  const generatedRelative = relative.replace(/^src\//, '').replace(/\.ts$/, '.mjs');
  const output = path.join(OUT_DIR, generatedRelative);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, esm, 'utf8');
}

console.log(`RUNTIME_CORE_BUILD_OK files=${sourceFiles().length}`);
