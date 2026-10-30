#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(ROOT, 'aims', 'K40', 'aims.txt');
const outRoot = path.join(ROOT, 'docs', 'modules');
const lines = fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/);
const heading = /^### 3\.\d+\.\d+ `([^`]+)`\s*$/;
const sections = [];

for (let index = 0; index < lines.length; index += 1) {
  const match = lines[index].match(heading);
  if (match) sections.push({ index, filename: match[1] });
}

fs.mkdirSync(outRoot, { recursive: true });
const written = [];
for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
  const section = sections[sectionIndex];
  const next = sections[sectionIndex + 1]?.index ?? lines.length;
  let body = lines.slice(section.index + 1, next).join('\n').trim();
  body = body.replace(/^```(?:text)?\r?\n/, '').replace(/\r?\n```\s*$/, '').trim();
  const moduleMatch = section.filename.match(/^(mod-[a-z-]+)-aims/);
  if (!moduleMatch) throw new Error(`ERR_MODULE_DOC_NAME: ${section.filename}`);
  const moduleDir = path.join(outRoot, moduleMatch[1]);
  fs.mkdirSync(moduleDir, { recursive: true });
  const target = path.join(moduleDir, section.filename);
  fs.writeFileSync(target, `${body}\n`, 'utf8');
  written.push(path.relative(ROOT, target).split(path.sep).join('/'));
}

const readme = [
  '# Module Documents',
  '',
  '> Generated from `aims/K40/aims.txt` by `ops/extract_module_docs.mjs`.',
  '> The source constitution remains the single source of truth.',
  '',
  `Generated files: ${written.length}`,
  '',
  ...[...new Set(written.map((file) => file.split('/')[2]))].sort().map((module) => `- ${module}`),
  '',
].join('\n');
fs.writeFileSync(path.join(outRoot, 'README.md'), readme, 'utf8');
console.log(JSON.stringify({ ok: true, written: written.length, files: written }, null, 2));
