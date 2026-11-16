import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PiJobOrchestrator } from '../server/pi_runner.js';
import { closePiStateDb } from '../server/services/pi_state_store.js';

function makeOrchestrator(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi_tool_loop_'));
  const dbPath = path.join(dir, 'pi_jobs.sqlite');
  t.after(() => {
    try { closePiStateDb(dbPath); } catch { /* 已关闭 */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return new PiJobOrchestrator({ dbPath, ...options });
}

function rpcSequence(texts) {
  const queue = [...texts];
  return async () => ({
    ok: true,
    exitCode: 0,
    events: [],
    finalText: queue.shift() || '{"action":"finish_stage","output":{}}',
  });
}

test('受控 Tool-Loop：先 tool_call 再 finish_stage', async (t) => {
  const calls = [];
  const orch = makeOrchestrator(t, {
    rpcExecutor: rpcSequence([
      JSON.stringify({ action: 'tool_call', tool: 'read_step_metrics', args: { project_id: 'PRJ_1', mod_id: 'l1_de_limma' } }),
      JSON.stringify({ action: 'finish_stage', output: { plan_text: 'ok', dag: [{ stage: 'ingest', mods: ['l1_ingest_prep'] }] } }),
    ]),
    toolExecutor: async ({ stage, toolName, args }) => {
      calls.push({ stage, toolName, args });
      return { ok: true, summary: 'requirement' };
    },
  });

  const job = await orch.startFromIntake({
    intake_id: 'loop_ok',
    requires_external_download: false,
    pipeline: 'line1_bulk',
  }, { jobId: 'job_loop_ok' });

  assert.equal(job.status, 'RUNNING');
  assert.equal(job.context.STAGE_3_COMPUTE_PULL_output.plan_text, 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, 'read_step_metrics');
  assert.equal(calls[0].stage, 'STAGE_3_COMPUTE_PULL');
});

test('Stage 1 立项：Pi 先 inspect_requirement 再 compile_work_order', async (t) => {
  const calls = [];
  const orch = makeOrchestrator(t, {
    rpcExecutor: rpcSequence([
      JSON.stringify({ action: 'tool_call', tool: 'inspect_requirement', args: { package_id: 'PKG_1' } }),
      JSON.stringify({
        action: 'tool_call',
        tool: 'compile_work_order',
        args: { project_id: 'PRJ_1', line_id: 'line1_bulk', selected_mods: ['l1_ingest_prep'] },
      }),
      JSON.stringify({
        action: 'finish_stage',
        output: {
          plan_text: '先做 QC 再做差异分析',
          dag: [{ stage: 'ingest', mods: ['l1_ingest_prep'] }],
          recommended_mods: ['l1_ingest_prep'],
          parameter_notes: [],
        },
      }),
    ]),
    toolExecutor: async ({ stage, toolName, args }) => {
      calls.push({ stage, toolName, args });
      return { ok: true };
    },
  });

  const job = await orch.runStage1Intake({
    intake_id: 'intake_1',
    pipeline: 'line1_bulk',
    facts: { project_id: 'PRJ_1' },
    files: [],
  }, { jobId: 'job_stage1' });

  assert.deepEqual(calls.map((call) => call.toolName), ['inspect_requirement', 'compile_work_order']);
  assert.equal(calls[0].stage, 'STAGE_1_INTAKE');
  assert.equal(job.status, 'COMPLETED');
  assert.ok(job.context.STAGE_1_INTAKE_output.plan_text);
  assert.equal(job.context.STAGE_1_INTAKE_output.dag.length, 1);
});

test('受控 Tool-Loop：没有 toolExecutor 时 fail-closed', async (t) => {
  const orch = makeOrchestrator(t, {
    rpcExecutor: rpcSequence([
      JSON.stringify({ action: 'tool_call', tool: 'read_step_metrics', args: { project_id: 'PRJ_1', mod_id: 'l1_de_limma' } }),
    ]),
  });

  const job = await orch.startFromIntake({
    intake_id: 'loop_missing',
    requires_external_download: false,
  }, { jobId: 'job_loop_missing' });

  assert.equal(job.status, 'FAILED');
  assert.match(job.last_error, /PI_TOOL_EXECUTOR_MISSING|toolExecutor/);
});

test('受控 Tool-Loop：超过 6 轮熔断', async (t) => {
  const orch = makeOrchestrator(t, {
    rpcExecutor: rpcSequence(Array.from({ length: 10 }, () => JSON.stringify({
      action: 'tool_call',
      tool: 'read_step_metrics',
      args: { project_id: 'PRJ_1', mod_id: 'l1_de_limma' },
    }))),
    toolExecutor: async () => ({ ok: true }),
  });

  const job = await orch.startFromIntake({
    intake_id: 'loop_exhausted',
    requires_external_download: false,
  }, { jobId: 'job_loop_exhausted' });

  assert.equal(job.status, 'FAILED');
  assert.match(job.last_error, /PI_TURN_EXHAUSTED/);
});

test('Stage 2 自愈入口：上下文只带失败步骤与租约，返回 RECOVERED', async (t) => {
  let seenPrompt = '';
  const orch = makeOrchestrator(t, {
    rpcExecutor: async ({ prompt }) => {
      seenPrompt = prompt;
      return {
        ok: true,
        exitCode: 0,
        events: [],
        finalText: JSON.stringify({
          action: 'finish_stage',
          output: { resolution: 'RECOVERED', mod_id: 'l1_de_limma', adaptation_trace: [] },
        }),
      };
    },
  });

  const job = await orch.runStage2Remediation({
    workOrderId: 'WO_S2_1',
    projectId: 'PRJ_S2_1',
    lineId: 'line1_bulk',
    failedStep: 'deg_limma',
    modId: 'l1_de_limma',
    leaseId: 'AUTH-1',
    context: { entry_point: 'deg_limma', failure_reason: 'exit 1' },
  }, { jobId: 'job_s2_1' });

  assert.equal(job.context.STAGE_3_COMPUTE_PULL_output.resolution, 'RECOVERED');
  assert.match(seenPrompt, /WO_S2_1/);
  assert.match(seenPrompt, /deg_limma/);
});
