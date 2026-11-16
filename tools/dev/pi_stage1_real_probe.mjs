#!/usr/bin/env node
/**
 * Stage 1 真模型探针：验证 Pi 会先读需求、再编工单。
 *
 * 判据：
 *   1. 工具调用顺序必须是 inspect_requirement → compile_work_order；
 *   2. finish_stage 必须给出非空 plan_text 与非空 dag；
 *   3. 全程只走宿主受控 Tool-Loop，Pi 不直接读写文件。
 *
 * 需要真实 Pi CLI 与模型密钥（.env.local 或环境变量），失败即退出 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import '../../BioanalysDesktop/server/env.js';
import { PiJobOrchestrator } from '../../BioanalysDesktop/server/pi_runner.js';
import { closePiStateDb } from '../../BioanalysDesktop/server/services/pi_state_store.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = path.join(REPO, '.tmp', 'pi_stage1_real.sqlite');
fs.mkdirSync(path.dirname(DB), { recursive: true });
try { fs.rmSync(DB, { force: true }); } catch { /* 首次运行没有旧库 */ }

const calls = [];
const orch = new PiJobOrchestrator({
  dbPath: DB,
  toolExecutor: async ({ stage, toolName, args }) => {
    calls.push({ stage, toolName, args });
    if (toolName === 'inspect_requirement') {
      return {
        ok: true,
        requirement: {
          package_id: args.package_id || 'PKG_S1_PROBE',
          project_id: 'PRJ_S1_PROBE',
          line_id: 'line1_bulk',
          species: 'Homo sapiens',
          data_type: 'bulk_rnaseq',
          sample_count: 12,
          groups: [
            { name: 'Control', role: 'reference', n: 6 },
            { name: 'Case', role: 'disease', n: 6 },
          ],
          contrasts: [{ name: 'Case_vs_Control', case: 'Case', ctrl: 'Control' }],
        },
      };
    }
    if (toolName === 'compile_work_order') {
      return {
        ok: true,
        work_order: {
          schema_version: 'work_order/v2',
          work_order_id: 'WO_S1_PROBE',
          project_id: args.project_id || 'PRJ_S1_PROBE',
          line_id: args.line_id || 'line1_bulk',
          mod_ids: Array.isArray(args.selected_mods) ? args.selected_mods : ['l1_ingest_prep'],
        },
      };
    }
    return { ok: false, error: `unexpected tool: ${toolName}` };
  },
});

let job;
try {
  job = await orch.runStage1Intake({
    intake_id: 'intake_s1_probe',
    pipeline: 'line1_bulk',
    facts: { project_id: 'PRJ_S1_PROBE' },
    files: [{ role: 'train_matrix', filename: 'counts.csv', format: 'csv' }],
  }, { jobId: 'job_s1_real_probe', timeoutMs: 180_000 });
} finally {
  closePiStateDb(DB);
}

const output = job?.context?.STAGE_1_INTAKE_output || {};
const order = calls.map((call) => call.toolName);
const failures = [];
if (order[0] !== 'inspect_requirement') failures.push(`首个工具应为 inspect_requirement，实际 ${order[0] || '<none>'}`);
if (!order.includes('compile_work_order')) failures.push('未调用 compile_work_order');
if (order.indexOf('compile_work_order') < order.indexOf('inspect_requirement')) {
  failures.push('compile_work_order 早于 inspect_requirement');
}
if (!output.plan_text || String(output.plan_text).trim() === '') failures.push('plan_text 为空');
if (!Array.isArray(output.dag) || output.dag.length === 0) failures.push('dag 为空');

console.log(JSON.stringify({
  tool_calls: order,
  plan_text: output.plan_text || null,
  dag_size: Array.isArray(output.dag) ? output.dag.length : 0,
  recommended_mods: output.recommended_mods || [],
  failures,
}, null, 2));

if (failures.length > 0) {
  console.error(`STAGE1_PROBE_FAIL ${failures.join('; ')}`);
  process.exit(1);
}
console.log('STAGE1_PROBE_PASS 真模型按顺序调用 inspect_requirement → compile_work_order 并完成立项');
