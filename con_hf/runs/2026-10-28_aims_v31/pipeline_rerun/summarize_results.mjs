import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const LEDGER_DIR = path.join(HERE, 'ledgers');
const WORKFLOWS = JSON.parse(fs.readFileSync(path.join(REPO, 'src', 'workflows.json'), 'utf8'));
const EXPECTED_SEED = 20261013;

const expected = [];
for (const series of WORKFLOWS.series) {
  expected.push({
    lineId: series.id,
    steps: series.stages.flatMap((stage) => stage.mods.map((mod) => mod.script)),
  });
}
expected.find((item) => item.lineId === 'line1_bulk').steps.unshift('probe_env');

const ledgers = fs.readdirSync(LEDGER_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => {
    const file = path.join(LEDGER_DIR, name);
    return { file, name, entry: JSON.parse(fs.readFileSync(file, 'utf8')) };
  });

const rows = [];
const failures = [];
for (const series of expected) {
  for (const step of series.steps) {
    const matches = ledgers.filter((item) => (
      item.entry.project_id === 'PRJ_AIMS_V3_20261027'
      && item.entry.line_id === series.lineId
      && item.entry.step_name === step
    )).sort((left, right) => (
      Date.parse(right.entry.start_time) - Date.parse(left.entry.start_time)
    ));
    if (matches.length === 0) {
      failures.push(`${series.lineId}/${step}: ledger missing`);
      continue;
    }
    const latest = matches[0].entry;
    const seedRequired = step !== 'probe_env';
    if (latest.status !== 'completed') failures.push(`${series.lineId}/${step}: status=${latest.status}`);
    if (latest.exit_code !== 0) failures.push(`${series.lineId}/${step}: exit=${latest.exit_code}`);
    if (latest.checkpoint_status !== 'passed') {
      failures.push(`${series.lineId}/${step}: checkpoint=${latest.checkpoint_status}`);
    }
    if (seedRequired && latest.environment?.random_seed !== EXPECTED_SEED) {
      failures.push(`${series.lineId}/${step}: seed=${latest.environment?.random_seed}`);
    }
    rows.push({
      line_id: series.lineId,
      step_name: step,
      status: latest.status,
      exit_code: latest.exit_code,
      checkpoint_status: latest.checkpoint_status,
      random_seed: latest.environment?.random_seed ?? null,
      seed_contract: seedRequired ? 'required_20261013' : 'not_applicable',
      start_time: latest.start_time,
      end_time: latest.end_time,
      task_id: latest.task_id,
      ledger_file: matches[0].name,
    });
  }
}

const header = [
  'line_id', 'step_name', 'status', 'exit_code', 'checkpoint_status',
  'random_seed', 'seed_contract', 'start_time', 'end_time', 'task_id', 'ledger_file',
];
const tsv = [
  header.join('\t'),
  ...rows.map((row) => header.map((key) => String(row[key] ?? '')).join('\t')),
].join('\n') + '\n';
fs.writeFileSync(path.join(HERE, 'k40_55_ledgers.tsv'), tsv, 'utf8');

const summary = {
  expected: expected.reduce((total, item) => total + item.steps.length, 0),
  found: rows.length,
  pass: rows.filter((row) => (
    row.status === 'completed'
    && row.exit_code === 0
    && row.checkpoint_status === 'passed'
    && (row.seed_contract === 'not_applicable' || row.random_seed === EXPECTED_SEED)
  )).length,
  failures,
  by_line: Object.fromEntries(expected.map((item) => [
    item.lineId,
    rows.filter((row) => row.line_id === item.lineId).length,
  ])),
};
fs.writeFileSync(path.join(HERE, 'SUMMARY.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0) process.exitCode = 1;
