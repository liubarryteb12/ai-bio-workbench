#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const LEDGER = path.join(REPO, 'docs', 'WORK_ORDER_ORCHESTRATOR_REPORT.md');

function writeLedger(text) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      fs.writeFileSync(LEDGER, text, 'utf8');
      return null;
    } catch (cause) {
      lastError = cause;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (attempt + 1));
    }
  }
  return lastError;
}

async function main() {
  const module = await import('./work_order_orchestrator.mjs');
  const source = fs.readFileSync(path.join(HERE, 'work_order_orchestrator.mjs'), 'utf8');
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });

  add('单入口存在', fs.existsSync(path.join(HERE, 'work_order_orchestrator.mjs')));
  add('ADB 默认', /computeAdapter \|\| 'adb'/.test(source));
  add('SSH 特殊开关', /allowSsh !== true/.test(source));
  add('无 SSH 直接调用', !/runSsh|sshArgv|scpArgv/.test(source));
  add('Ready 单图准入', /ERR_FIGURE_NOT_READY/.test(source) && /RETIRED_FIGURE_IDS/.test(source));
  add('DAG 串行派发', /for \(const \[index, task\] of planTasks\.entries\(\)\)/.test(source));
  add('完成回执校验', /validateTaskReceipt/.test(source) && /ERR_TASK_RECEIPT/.test(source));
  add('报告验收', /DELIVERY_ACCEPTANCE_OK/.test(source) && /delivery_verified/.test(source));
  add('汇总与回执落盘', /Project_Summary\.md/.test(source) && /work_order\.receipt\.json/.test(source));

  const facts = {
    series: [{
      id: 'line1_bulk', seed: 20261013,
      stages: [
        { id: 'ingest', order: 1, required: true, mods: [{ id: 'l1_ingest_prep', script: 'prep_matrix', requires: ['series_matrix'], produces: ['expr_genes.tsv'] }] },
        { id: 'qc', order: 2, required: false, mods: [{ id: 'l1_qc_matrix', script: 'qc_matrix', requires: ['expr_genes.tsv'], produces: ['qc_report.tsv'] }] },
      ],
    }],
  };
  const figureFacts = {
    readyFigures: new Map([['fig_probe', { id: 'fig_probe', status: 'ready', canonical_output: 'probe.png', required_mod_ids: ['l1_qc_matrix'] }]]),
    allowedIds: new Set(['fig_probe']),
  };
  const registryFacts = {
    series: new Map(), mods: new Map(), workflows: facts,
    readyFigures: figureFacts.readyFigures, allowedIds: figureFacts.allowedIds,
  };
  for (const series of facts.series) {
    const orderedMods = [];
    for (const stage of series.stages) {
      for (const mod of stage.mods) {
        const entry = { id: mod.id, mod, seriesId: series.id, stageId: stage.id, order: stage.order, required: stage.required, optional: false };
        registryFacts.mods.set(mod.id, entry);
        orderedMods.push(entry);
      }
    }
    registryFacts.series.set(series.id, { series, stages: series.stages, orderedMods, seed: series.seed });
  }
  const order = {
    schema_version: module.WORK_ORDER_SCHEMA_VERSION,
    workOrderId: 'WO-GATE-PROBE',
    projectId: 'PRJ_GATE_PROBE',
    lineId: 'line1_bulk',
    modIds: ['l1_qc_matrix'],
    figureSelections: [{ template_id: 'fig_probe' }],
    uploads: [{ filename: 'matrix.tsv', content_base64: Buffer.from('gene\tvalue\nA\t1\n').toString('base64') }],
  };
  try {
    const plan = module.compileWorkOrderPlan(order, { facts: registryFacts });
    add('编译闭包', plan.closure.includes('l1_ingest_prep') && plan.dag.length === 2);
    add('默认通道', plan.computeAdapter === 'adb');
  } catch (cause) {
    add('编译闭包', false, cause.message);
    add('默认通道', false, cause.message);
  }
  try {
    module.compileWorkOrderPlan({ ...order, computeAdapter: 'ssh' }, { facts: registryFacts });
    add('SSH fail closed', false, '未带 allowSsh 仍放行');
  } catch (cause) {
    add('SSH fail closed', cause.code === 'ERR_SSH_DISABLED', cause.message);
  }
  try {
    module.compileWorkOrderPlan({ ...order, figureSelections: [{ template_id: 'fig_l3_multipanel' }] }, { facts: registryFacts });
    add('组图 fail closed', false, '退役组图仍放行');
  } catch (cause) {
    add('组图 fail closed', cause.code === 'ERR_RETIRED_FIGURE', cause.message);
  }

  const contract = spawnSync(process.execPath, [
    '--test', path.join(REPO, 'BioanalysDesktop', 'tests', 'work_order_orchestrator_contract.test.js'),
  ], { cwd: REPO, encoding: 'utf8' });
  const contractOutput = `${contract.stdout || ''}${contract.stderr || ''}`.trim();
  add('契约测试', contract.status === 0, contractOutput.split(/\r?\n/).slice(-8).join(' | '));

  const failed = checks.filter((item) => !item.ok);
  const lines = [
    '# 结构化工单编排器门禁报告',
    '',
    `日期 ${new Date().toISOString()}`,
    '',
    '本门禁只使用确定性合成工单与本地 mock 客户端，不连接远端设备，不启动分析任务。',
    '',
    '| 判据 | 结果 | 详情 |',
    '| :--- | :--- | :--- |',
    ...checks.map((item) => `| ${item.name} | ${item.ok ? '通过' : '失败'} | ${String(item.detail).replace(/\|/g, '\\|')} |`),
    '',
    `合计 ${checks.length} 项，通过 ${checks.length - failed.length} 项，失败 ${failed.length} 项。`,
    '',
    failed.length ? 'WORK_ORDER_ORCHESTRATOR_GATE_FAILED' : 'WORK_ORDER_ORCHESTRATOR_GATE_OK',
  ];
  const writeError = writeLedger(lines.join('\n') + '\n');
  if (writeError) {
    console.error(`[RED] 报告落盘: ${writeError.message || writeError}`);
    return 1;
  }
  for (const item of failed) console.error(`[RED] ${item.name}: ${item.detail}`);
  if (failed.length) return 1;
  console.log('WORK_ORDER_ORCHESTRATOR_GATE_OK');
  return 0;
}

main().then((code) => { process.exitCode = code; });
