#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = { source: '', bin: '', strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source') out.source = argv[++index] ?? '';
    else if (arg === '--bin') out.bin = argv[++index] ?? '';
    else if (arg === '--strict') out.strict = true;
    else throw new Error(`ERR_ALIGN_UNKNOWN_ARG: ${arg}`);
  }
  if (!out.source || !out.bin) {
    throw new Error('ERR_ALIGN_MISSING_ARGS: --source and --bin are required');
  }
  return out;
}

function walk(root, prefix = '') {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walk(path.join(root, entry.name), relative));
    else if (entry.isFile() && !entry.name.startsWith('.')) files.push(relative);
  }
  return files.sort();
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceRoot = path.resolve(options.source);
  const binRoot = path.resolve(options.bin);
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`ERR_ALIGN_SOURCE_NOT_DIR: ${sourceRoot}`);
  }
  if (!fs.existsSync(binRoot) || !fs.statSync(binRoot).isDirectory()) {
    throw new Error(`ERR_ALIGN_BIN_NOT_DIR: ${binRoot}`);
  }

  const sourceFiles = walk(sourceRoot).filter((file) => !file.endsWith('README.md'));
  const binFiles = walk(binRoot).filter((file) => !file.endsWith('README.md'));
  const sourceSet = new Set(sourceFiles);
  const binSet = new Set(binFiles);
  const missing = sourceFiles.filter((file) => !binSet.has(file));
  const extra = binFiles.filter((file) => !sourceSet.has(file));
  const mismatched = [];
  for (const relative of sourceFiles) {
    if (!binSet.has(relative)) continue;
    const sourceHash = sha256(path.join(sourceRoot, relative));
    const binHash = sha256(path.join(binRoot, relative));
    if (sourceHash !== binHash) {
      mismatched.push({ file: relative, sourceHash, binHash });
    }
  }
  const ok = missing.length === 0 && mismatched.length === 0 && (!options.strict || extra.length === 0);
  console.log(JSON.stringify({
    ok,
    strict: options.strict,
    source: sourceRoot,
    bin: binRoot,
    compared: sourceFiles.length - missing.length,
    missing,
    extra,
    mismatched,
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

try {
  main();
} catch (cause) {
  console.error(JSON.stringify({
    ok: false,
    error: cause instanceof Error ? cause.message : String(cause),
  }));
  process.exit(2);
}
