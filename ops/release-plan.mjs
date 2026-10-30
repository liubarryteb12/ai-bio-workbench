#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BATCHES = [
  { id: 'core-engines', label: 'core & engines' },
  { id: 'mods', label: 'mods implementation' },
  { id: 'tests-ledger', label: 'matrix tests & ledger' },
  { id: 'docs-release', label: 'docs & release' },
];

export function classifyFile(filePath) {
  const raw = filePath;
  const normalized = raw.replaceAll('\\', '/');
  if (
    normalized.startsWith('src/core/')
    || normalized.startsWith('src/engines/')
    || normalized === 'tsconfig.core.json'
  ) {
    return 'core-engines';
  }
  if (
    normalized.startsWith('bin/')
    || normalized === 'src/figure_templates.json'
    || normalized === 'src/workflows.json'
    || normalized.startsWith('src/figure_sources/')
    || normalized.startsWith('src/figure_previews/')
    || normalized.startsWith('portal/')
    || normalized.startsWith('BioanalysDesktop/server/')
    || normalized.startsWith('BioanalysDesktop/src/')
    || normalized.startsWith('configs/a2a/')
    || normalized.startsWith('src/config/')
    || normalized.startsWith('src/mods/')
    || normalized.startsWith('src/line1_bulk/')
    || normalized.startsWith('src/line2_scrna/')
    || normalized.startsWith('src/line3_spatial/')
  ) {
    return 'mods';
  }
  if (
    normalized.startsWith('tests/')
    || normalized.startsWith('BioanalysDesktop/tests/')
    || normalized.startsWith('ops/')
    || normalized.startsWith('con_hf/ledger/')
    || normalized.startsWith('local_projects/PRJ_K40_SMOKE/')
  ) {
    return 'tests-ledger';
  }
  if (
    normalized === 'AGENTS.md'
    || normalized === '.gitignore'
    || normalized.startsWith('aims/')
    || normalized.startsWith('docs/')
    || normalized.startsWith('con_hf/')
    || normalized.startsWith('local_projects/')
    || normalized.startsWith('BioanalysDesktop/')
    || normalized.startsWith('reference/05.')
    || normalized === 'README.md'
    || normalized === '项目情况汇总2026-10-30.md'
    || normalized.endsWith('.bat')
  ) {
    return 'docs-release';
  }
  return 'unassigned';
}

export function buildPlan(files) {
  const grouped = new Map(BATCHES.map((batch) => [batch.id, []]));
  const unassigned = [];
  for (const file of files) {
    const batchId = classifyFile(file);
    if (batchId === 'unassigned') unassigned.push(file);
    else grouped.get(batchId).push(file);
  }
  const batches = BATCHES.map((batch) => {
    const batchFiles = grouped.get(batch.id).sort();
    const stageCommand = batchFiles.length
      ? `git add -- ${batchFiles.map((f) => `"${f}"`).join(' ')}`
      : 'git add -- ';
    return { id: batch.id, label: batch.label, count: batchFiles.length, files: batchFiles, stageCommand };
  });
  return {
    ok: unassigned.length === 0,
    summary: {
      total: files.length,
      assigned: files.length - unassigned.length,
      unassigned: unassigned.length,
    },
    batches,
    unassigned: unassigned.sort(),
  };
}

function listGitStatusFiles() {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || `git status failed: ${result.stderr}`);
  }
  const entries = [];
  const records = result.stdout.split('\0');
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;
    const statusCode = record.slice(0, 2);
    const filePath = record.slice(3);
    if (statusCode.includes('R')) {
      const next = records[i + 1] || '';
      if (next) {
        i += 1;
        entries.push(next);
      }
      continue;
    }
    if (filePath) entries.push(filePath);
  }
  return entries;
}

const isMainProcess = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainProcess) {
  const json = process.argv.includes('--json');
  try {
    const plan = buildPlan(listGitStatusFiles());
    if (json) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      for (const batch of plan.batches) {
        console.log(`${batch.id}: ${batch.count}`);
      }
      for (const file of plan.unassigned) {
        console.log(`[unassigned] ${file}`);
      }
    }
    process.exit(plan.ok ? 0 : 1);
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}
