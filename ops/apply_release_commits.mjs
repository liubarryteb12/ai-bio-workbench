#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COMMIT_MESSAGES = {
  'core-engines': 'feat(core-engines): land microkernel 7-piece core and 8 shared engines with path/thread guards',
  'mods': 'feat(mods): add 10 pluggable mods, K40 figure sources v1.0, and A2A runtime routes',
  'tests-ledger': 'test(tests-ledger): add 100 workbench test files, A2A contract tests, and execution ledgers',
  'docs-release': 'docs(release): unify aims SSOT navigation, add root README, and finalize v3.2 release plan',
};

async function main() {
  const { buildPlan, classifyFile } = await import('./release-plan.mjs');

  const statusRes = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (statusRes.error || statusRes.status !== 0) {
    throw new Error(`git status failed: ${statusRes.stderr}`);
  }

  const entries = [];
  const records = statusRes.stdout.split('\0');
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

  const plan = buildPlan(entries);
  if (!plan.ok) {
    console.error(`Unassigned files (${plan.unassigned.length}):`, plan.unassigned);
    process.exit(1);
  }

  console.log(`Starting 4-batch atomic release commits across ${plan.summary.total} files...`);

  for (const batch of plan.batches) {
    if (batch.count === 0) {
      console.log(`Skipping empty batch: ${batch.id}`);
      continue;
    }

    console.log(`\n========================================`);
    console.log(`Processing Batch [${batch.id}]: ${batch.count} files`);
    console.log(`========================================`);

    // Stage files in chunks of 50 to avoid command line limits
    const CHUNK_SIZE = 50;
    for (let i = 0; i < batch.files.length; i += CHUNK_SIZE) {
      const chunk = batch.files.slice(i, i + CHUNK_SIZE);
      const addRes = spawnSync('git', ['add', '--', ...chunk], {
        cwd: ROOT,
        stdio: 'inherit',
      });
      if (addRes.status !== 0) {
        throw new Error(`git add failed for batch ${batch.id}`);
      }
    }

    const message = COMMIT_MESSAGES[batch.id];
    console.log(`Committing: ${message}`);
    const commitRes = spawnSync('git', ['commit', '-m', message], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    if (commitRes.status !== 0) {
      throw new Error(`git commit failed for batch ${batch.id}`);
    }
  }

  console.log('\nAll 4 batches committed successfully!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
