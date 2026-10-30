#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(ROOT, 'local_projects', 'PRJ_K40_SMOKE');
const DATA = path.join(SAMPLE, 'data');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function compile(script) {
  const result = execFileSync(process.execPath, [path.join(ROOT, script)], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (!/OK/.test(result)) throw new Error(`compile failed: ${script}`);
}

function modulePath(build, relative) {
  return pathToFileURL(path.join(ROOT, 'tests', build, relative)).href;
}

async function buildAlpha() {
  compile('tests/biz_alpha_compile.cjs');
  const { BizAlphaAdapter } = await import(
    modulePath('.biz_alpha_build', 'src/mods/mod-biz-alpha/implementation.mjs')
  );
  const adapter = new BizAlphaAdapter(DATA);
  const result = await adapter.reconcileAndAllocate(
    'baseline',
    '2026-10-29',
    [
      { entryId: 'd', logicalDate: '2026-10-29', categoryCode: 'food', memoText: 'sample', debitCents: 1200, creditCents: 0 },
      { entryId: 'c', logicalDate: '2026-10-29', categoryCode: 'food', memoText: 'sample', debitCents: 0, creditCents: 1200 },
    ],
    [{ bucketId: 'food', weightBps: 10000 }]
  );
  if (result.exitCode !== 0) throw new Error(`alpha failed: ${result.error}`);
}

async function buildBeta() {
  compile('tests/biz_beta_compile.cjs');
  const { BizBetaAdapter } = await import(
    modulePath('.biz_beta_build', 'src/mods/mod-biz-beta/implementation.mjs')
  );
  const inputDir = path.join(DATA, 'input');
  fs.mkdirSync(inputDir, { recursive: true });
  const lines = [['gene', ...Array.from({ length: 12 }, (_, i) => `S${i + 1}`)].join('\t')];
  for (let gene = 0; gene < 40; gene += 1) {
    const values = [];
    for (let sample = 0; sample < 12; sample += 1) {
      if (gene < 5) {
        values.push(sample < 6 ? 1 + gene * 0.1 + sample * 0.01 : 10 + gene * 0.2 + sample * 0.01);
      } else {
        values.push(1 + ((gene * 7 + sample * 3) % 5) * 0.1);
      }
    }
    lines.push([`G${gene + 1}`, ...values].join('\t'));
  }
  fs.writeFileSync(path.join(inputDir, 'baseline-matrix.tsv'), `${lines.join('\n')}\n`, 'utf8');
  const adapter = new BizBetaAdapter(SAMPLE, DATA);
  const result = await adapter.executeTranscriptomicsPipeline({
    jobId: 'baseline',
    scope: 'GEO_STANDARD',
    inputMatrixRelPath: 'data/input/baseline-matrix.tsv',
    expectedSamples: 12,
    expectedGenes: 40,
    seeds: [20261013, 20261014, 20261015],
  });
  if (result.exitCode !== 0) throw new Error(`beta failed: ${result.error}`);
}

async function buildTemplate() {
  compile('tests/template_studio_compile.cjs');
  const { TemplateStudioAdapter } = await import(
    modulePath('.template_studio_build', 'src/mods/mod-template-studio/implementation.mjs')
  );
  const { ComputeEngineImpl } = await import(
    modulePath('.template_studio_build', 'src/engines/compute-engine/implementation.mjs')
  );
  const { ChildProcessComputeAdapter } = await import(
    modulePath('.template_studio_build', 'src/engines/compute-engine/adapters.mjs')
  );
  const adapter = new TemplateStudioAdapter(
    path.join(ROOT, 'src', 'mods', 'mod-template-studio', 'templates'),
    path.join(SAMPLE, 'adapt'),
    new ComputeEngineImpl(new ChildProcessComputeAdapter())
  );
  const result = await adapter.renderTemplate({
    templateId: 'bar_template',
    title: 'K40 template sample',
    values: [1, 2, 3, 4, 5],
    outputPath: path.join(DATA, 'template-outputs', 'bar-baseline.png'),
    seed: 20261013,
  });
  if (!result.artifact.sha256) throw new Error('template failed');
}

async function buildPortal() {
  compile('tests/portal_sync_compile.cjs');
  const { PortalSyncAdapter } = await import(
    modulePath('.portal_sync_build', 'src/mods/mod-portal-sync/implementation.mjs')
  );
  const { DeliverableCollector } = await import(
    modulePath('.portal_sync_build', 'src/core/DeliverableCollector.mjs')
  );
  const { SyncEngineImpl } = await import(
    modulePath('.portal_sync_build', 'src/engines/sync-engine/implementation.mjs')
  );
  const alpha = path.join(DATA, 'alpha-reports', 'reconciled-baseline.json');
  const preview = sha256(alpha);
  const artifact = {
    lines: ['src/mods/mod-biz-alpha/implementation.ts:1-200'],
    analysis_step: 'biz_alpha.reconcile_consumption_structure',
    produces: 'RECONCILED_CENTS_REPORT',
    output_glob: 'data/alpha-reports/reconciled-*.json',
    source_sha256: sha256(path.join(ROOT, 'src', 'mods', 'mod-biz-alpha', 'implementation.ts')),
    preview_sha256: preview,
    sample_project_output: 'data/alpha-reports/reconciled-baseline.json',
  };
  const keys = crypto.generateKeyPairSync('ed25519');
  const adapter = new PortalSyncAdapter(
    new DeliverableCollector(SAMPLE),
    new SyncEngineImpl()
  );
  const exported = await adapter.exportSignedDeliverable({
    id: 'baseline',
    mods: [{ modId: 'mod-biz-alpha', state: 'ready', artifacts: [artifact] }],
    privateKeyPem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  const target = path.join(DATA, 'portal-sync', 'signed-baseline.packlet.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(exported.packlet, null, 2)}\n`, 'utf8');
}

fs.mkdirSync(DATA, { recursive: true });
await buildAlpha();
await buildBeta();
await buildTemplate();
await buildPortal();

const samples = {
  alpha: path.join(DATA, 'alpha-reports', 'reconciled-baseline.json'),
  beta: path.join(DATA, 'beta-outputs', 'robust-biomarkers-baseline.tsv'),
  template: path.join(DATA, 'template-outputs', 'bar-baseline.png'),
  portal: path.join(DATA, 'portal-sync', 'signed-baseline.packlet.json'),
};
for (const [name, file] of Object.entries(samples)) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    throw new Error(`ERR_SMOKE_SAMPLE_MISSING: ${name}`);
  }
}
console.log(JSON.stringify({
  ok: true,
  sample_root: path.relative(ROOT, SAMPLE).split(path.sep).join('/'),
  hashes: Object.fromEntries(Object.entries(samples).map(([name, file]) => [name, sha256(file)])),
}, null, 2));
