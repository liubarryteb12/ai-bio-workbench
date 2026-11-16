/**
 * BioanalysDesktop/server/pi_runner.js
 * Pi Agent RPC 无状态调度器与双人工刹车片编排器。
 *
 * 核心契约：
 *   1. 底层调用 `pi --mode rpc --no-session`，绝不保留挂起常驻进程；
 *   2. 挂起态（外源数据下载审批、最终验收审批）写入 SQLite `.ops_state/pi_jobs.sqlite`；
 *   3. 恢复时由宿主读取本地状态与文件，拼装完整阶段上下文，重新发起 RPC 调用；
 *   4. 阶段四撰写解读报告严格执行 Token 与防幻觉边界：仅允许注入轻量结构化统计摘要
 *      （summary_stats.json / top_degs.tsv / enrichment_summary.tsv）与注册表图件模板 ID，
 *      严禁直接读取大体积原始矩阵或图像二进制。
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
// 默认导入 + 属性调用（proc.js 头部同款约定）：具名导入会在链接期固化绑定，
// 测试用 mock.method(childProcess, 'spawn') 就拦不住真实进程。Pi CLI 是本地
// 编排器，不是分析程序，因此不走 proc.js 的远端工具白名单，但必须保留这层可替换性。
import childProcess from 'node:child_process';
import { assetPath, DATA_ROOT } from './paths.js';
import { killProcessTree } from './proc.js';
import { resolvePiCli } from '../../tools/bin/pi-wrapper.js';
import {
  PI_JOB_STATUS,
  PI_STAGES,
  createPiJob,
  getPiJob,
  listPiJobs,
  updatePiJob,
  appendPiEvent,
  listPiEvents,
} from './services/pi_state_store.js';
import {
  loadStagePrompt,
  buildStageMessage,
  extractJsonObject,
  validateStageResponse,
} from './services/pi_stage_prompts.js';

const FORBIDDEN_RAW_EXT = new Set([
  '.h5ad', '.mtx', '.loom', '.rds', '.rdata', '.bam', '.fastq', '.fq',
  '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.svg', '.pdf', '.bmp',
]);

const MAX_SUMMARY_BYTES = 512 * 1024; // 512KB 上限，防止误喂全量矩阵

/**
 * Pi CLI 运行时解析：显式环境变量优先，其次包内/开发态随包 CLI。
 * 返回 bin 与 agent 配置目录，调用方负责把 agentDir 注入子进程环境。
 */
function resolvePiRuntime(explicitBin = null) {
  if (explicitBin) {
    return { bin: explicitBin, agentDir: process.env.PI_CODING_AGENT_DIR || null };
  }
  if (process.env.BIO_PI_CLI_BIN) {
    return { bin: process.env.BIO_PI_CLI_BIN, agentDir: process.env.PI_CODING_AGENT_DIR || null };
  }
  const resolved = resolvePiCli({ env: process.env });
  if (resolved) {
    return { bin: resolved.cli, agentDir: process.env.PI_CODING_AGENT_DIR || resolved.agentDir };
  }
  return { bin: 'pi', agentDir: process.env.PI_CODING_AGENT_DIR || null };
}

export function loadReadyFigureTemplateIds(allowlistPath = assetPath('tools', 'dev', 'figure_ready_allowlist.json')) {
  try {
    const raw = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.ready)) return raw.ready;
    if (Array.isArray(raw.templates)) return raw.templates;
    return [];
  } catch {
    return [];
  }
}

/**
 * 校验并加载阶段四允许注入的轻量统计摘要文件。
 * 拒绝任何大体积原始矩阵或图像二进制文件。
 */
export function loadLightweightReportSummaries(summaryPaths = {}) {
  const summaries = {};
  for (const [key, filePath] of Object.entries(summaryPaths || {})) {
    if (!filePath || typeof filePath !== 'string') continue;
    const ext = path.extname(filePath).toLowerCase();
    if (FORBIDDEN_RAW_EXT.has(ext) || /raw_counts|expression_matrix|series_matrix/i.test(path.basename(filePath))) {
      throw new Error(`TOKEN_BOUNDARY_VIOLATION: 阶段四禁止直接读取原始矩阵或图像二进制文件: ${path.basename(filePath)}`);
    }
    if (!fs.existsSync(filePath)) continue;
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_SUMMARY_BYTES) {
      throw new Error(`TOKEN_BOUNDARY_VIOLATION: 摘要文件超过 512KB 上限 (${stat.size} bytes): ${path.basename(filePath)}`);
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (ext === '.json') {
      summaries[key] = JSON.parse(content);
    } else {
      // TSV/CSV 仅保留前 100 行作为安全摘要
      summaries[key] = content.split(/\r?\n/).slice(0, 100).join('\n');
    }
  }
  return summaries;
}

/**
 * 底层执行一次无状态 `pi --mode rpc --no-session` 调用。
 */
export function runPiRpc({
  jobId,
  stage,
  prompt,
  cwd = DATA_ROOT,
  piBin = null,
  extraArgs = [],
  onEvent = null,
  timeoutMs = 120_000,
} = {}) {
  return new Promise((resolve) => {
    const runtime = resolvePiRuntime(piBin);
    const resolvedBin = runtime.bin;
    const isNodeScript = /\.(mjs|cjs|js)$/i.test(resolvedBin);
    const execCmd = isNodeScript ? process.execPath : resolvedBin;
    const baseArgs = isNodeScript ? [resolvedBin] : [];
    // 边界：Pi 只能用宿主注入的 9 个受控工具，不得直接读写文件或执行 shell。
    // 9 工具桥尚未以 Pi 扩展形式暴露，因此先关闭全部内置工具与扩展发现。
    const args = [
      ...baseArgs,
      '--mode', 'rpc',
      '--no-session',
      '--no-builtin-tools',
      '--no-extensions',
      '--no-mcp',
      '--no-skills',
      ...extraArgs,
    ];

    const child = childProcess.spawn(execCmd, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        ...(runtime.agentDir && !process.env.PI_CODING_AGENT_DIR
          ? { PI_CODING_AGENT_DIR: runtime.agentDir }
          : {}),
      },
    });

    const events = [];
    let stdoutBuf = '';
    let stderrBuf = '';
    let finalText = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // 进程树连根强杀：只 kill 顶层会留下派生的 Pi 子进程继续吃内存。
      killProcessTree(child);
      resolve({
        ok: false,
        exitCode: -1,
        events,
        finalText,
        error: `Pi RPC timed out after ${timeoutMs}ms (job=${jobId}, stage=${stage})`,
      });
    }, timeoutMs);

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed = null;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = { type: 'raw_stdout', text: trimmed };
      }
      events.push(parsed);
      if (parsed.type === 'message_end'
        && parsed.message
        && parsed.message.role === 'assistant'
        && Array.isArray(parsed.message.content)) {
        // 真 Pi RPC 的助手正文在 message.content 的 text 片段里，不在顶层 text。
        const text = parsed.message.content
          .filter((part) => part && part.type === 'text')
          .map((part) => String(part.text || ''))
          .join('');
        if (text) finalText = text;
      } else if (parsed.type === 'message_end' || parsed.type === 'assistant_message' || parsed.type === 'response') {
        if (typeof parsed.text === 'string') finalText = parsed.text;
        else if (typeof parsed.content === 'string') finalText = parsed.content;
      }
      if (parsed.type === 'agent_settled') {
        // 真 Pi 只有在 stdin 关闭后才走有序退出；收到 settled 再关，避免半截回答。
        try { child.stdin.end(); } catch { /* 已关闭 */ }
      }
      if (typeof onEvent === 'function') {
        onEvent(parsed);
      }
    };

    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString('utf8');
      let idx;
      while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        handleLine(line);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: -1,
        events,
        finalText,
        error: `Failed to spawn Pi CLI (${resolvedBin}): ${err.message}`,
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdoutBuf.trim()) handleLine(stdoutBuf);
      resolve({
        ok: code === 0,
        exitCode: code ?? -1,
        events,
        finalText,
        stderr: stderrBuf.trim(),
        error: code === 0 ? null : (stderrBuf.trim() || `Pi RPC exited with code ${code}`),
      });
    });

    // 发送 RPC Prompt。stdin 保持打开，等 agent_settled 后再关闭：
    // 立即 end 会让 Pi 在模型回答前有序退出，真机实测只能拿到空 finalText。
    const rpcPayload = JSON.stringify({
      type: 'prompt',
      job_id: jobId,
      stage,
      message: prompt,
    });
    child.stdin.write(rpcPayload + '\n', 'utf8');
  });
}

export class PiJobOrchestrator extends EventEmitter {
  constructor(options = {}) {
    super();
    this.dbPath = options.dbPath;
    this.piBin = options.piBin || process.env.BIO_PI_CLI_BIN || null;
    this.allowlistPath = options.allowlistPath;
    this.rpcExecutor = options.rpcExecutor || runPiRpc;
    this.toolExecutor = options.toolExecutor || null;
  }

  _emitAndRecord(jobId, stage, eventType, payload = {}) {
    const evt = appendPiEvent({ jobId, stage, eventType, payload }, this.dbPath);
    this.emit('event', evt);
    this.emit(`job:${jobId}`, evt);
    return evt;
  }

  /**
   * 阶段一：需求解读与工单编译（Pi 主动调 inspect_requirement / compile_work_order）。
   * 与 startFromIntake 分开：后者是既有的"直接进计算"兼容入口，本方法才是
   * 「Pi 先读需求再编工单」的生产入口。
   */
  async runStage1Intake(intakeManifest = {}, options = {}) {
    const jobId = options.jobId || `job_s1_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const context = {
      intake_id: intakeManifest.intake_id || null,
      submission_mode: intakeManifest.submission_mode || 'own_matrix',
      pipeline: intakeManifest.pipeline || 'line1_bulk',
      facts: intakeManifest.facts || {},
      files: intakeManifest.files || [],
    };
    const job = createPiJob({
      jobId,
      intakeId: context.intake_id,
      stage: PI_STAGES.STAGE_1_INTAKE,
      status: PI_JOB_STATUS.RUNNING,
      requiresExternalDownload: false,
      context,
      dbPath: this.dbPath,
    });
    const result = await this._dispatchRpcStage(job, PI_STAGES.STAGE_1_INTAKE, options);
    if (result?.context?.STAGE_1_INTAKE_output) {
      return updatePiJob(jobId, { status: PI_JOB_STATUS.COMPLETED }, this.dbPath);
    }
    return result;
  }

  /**
   * 从阶段一入库清单启动任务：
   *   - 若 requires_external_download=true，立刻挂起在人工刹车片一（不常驻 Pi 进程）；
   *   - 若为自有矩阵，直接进入阶段三（计算调度）并触发无状态 Pi RPC。
   */
  async startFromIntake(intakeManifest, options = {}) {
    const jobId = options.jobId || `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const requiresExternal = Boolean(intakeManifest.requires_external_download);
    const context = {
      intake_id: intakeManifest.intake_id || null,
      submission_mode: intakeManifest.submission_mode || (requiresExternal ? 'geo_accession' : 'own_matrix'),
      pipeline: intakeManifest.pipeline || 'line1_bulk',
      facts: intakeManifest.facts || {},
      files: intakeManifest.files || [],
    };

    if (requiresExternal) {
      const job = createPiJob({
        jobId,
        intakeId: context.intake_id,
        stage: PI_STAGES.STAGE_1_INTAKE,
        status: PI_JOB_STATUS.SUSPENDED_EXTERNAL,
        requiresExternalDownload: true,
        context,
        checkpointReason: '人工刹车片一：全自动模式下下载外源 GEO 数据前必须经人工确认批准',
        dbPath: this.dbPath,
      });
      this._emitAndRecord(jobId, PI_STAGES.STAGE_1_INTAKE, 'checkpoint_suspend', {
        status: PI_JOB_STATUS.SUSPENDED_EXTERNAL,
        reason: job.checkpoint_reason,
      });
      return job;
    }

    const job = createPiJob({
      jobId,
      intakeId: context.intake_id,
      stage: PI_STAGES.STAGE_3_COMPUTE_PULL,
      status: PI_JOB_STATUS.RUNNING,
      requiresExternalDownload: false,
      context,
      dbPath: this.dbPath,
    });
    return this._dispatchRpcStage(job, PI_STAGES.STAGE_3_COMPUTE_PULL, options);
  }

  /**
   * Stage 2 自愈入口：DAG 单步失败时由队列回调。
   * 会话上下文只带失败步骤、项目、工单与租约，原始数据不进入 Pi。
   */
  async runStage2Remediation({
    workOrderId, projectId, lineId, failedStep, modId, leaseId, context = {},
  } = {}, options = {}) {
    if (!workOrderId || !projectId) {
      throw new Error('STAGE2_CONTEXT_REQUIRED: workOrderId 与 projectId 必填');
    }
    const jobId = options.jobId || `job_s2_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job = createPiJob({
      jobId,
      intakeId: null,
      stage: PI_STAGES.STAGE_3_COMPUTE_PULL,
      status: PI_JOB_STATUS.RUNNING,
      requiresExternalDownload: false,
      context: {
        work_order_id: String(workOrderId),
        project_id: String(projectId),
        line_id: String(lineId || ''),
        failed_step: String(failedStep || ''),
        mod_id: String(modId || ''),
        lease_id: String(leaseId || ''),
        ...context,
      },
      dbPath: this.dbPath,
    });
    return this._dispatchRpcStage(job, PI_STAGES.STAGE_3_COMPUTE_PULL, options);
  }

  /**
   * 人工批准外源数据下载（恢复人工刹车片一）：
   * 从 SQLite 读取上下文，重新发起 `pi --mode rpc --no-session`。
   */
  async approveExternalDownload(jobId, actor = 'operator', options = {}) {
    const job = getPiJob(jobId, this.dbPath);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (job.status !== PI_JOB_STATUS.SUSPENDED_EXTERNAL) {
      throw new Error(`INVALID_STATE_TRANSITION: 任务 ${jobId} 当前状态为 ${job.status}，非 ${PI_JOB_STATUS.SUSPENDED_EXTERNAL}`);
    }

    const updated = updatePiJob(jobId, {
      stage: PI_STAGES.STAGE_2_EXTERNAL_FETCH,
      status: PI_JOB_STATUS.RUNNING,
      checkpointReason: null,
      approvedBy: actor,
      approvedAt: new Date().toISOString(),
    }, this.dbPath);

    this._emitAndRecord(jobId, PI_STAGES.STAGE_2_EXTERNAL_FETCH, 'checkpoint_resume', {
      approved_by: actor,
      resumed_stage: PI_STAGES.STAGE_2_EXTERNAL_FETCH,
    });

    return this._dispatchRpcStage(updated, PI_STAGES.STAGE_2_EXTERNAL_FETCH, options);
  }

  /**
   * 阶段三末尾强闭环：
   *   1. 验证本地 `.verify_passed` 回执（必须含 VERIFIED_AT_）；
   *   2. 在进入刹车片二之前，立即执行远端清零（wipe_remote.sh），确保手机闪存立刻释放给下一工单；
   *   3. 标记 `remote_wiped: true` 并挂起在人工刹车片二（后续阶段四 100% 读取本地 02_output/）。
   */
  async completeStage3PullAndWipe(jobId, {
    verifyPassedTokenPath,
    remoteJobDir,
    wipeExecutor,
    computeFacts = {},
  } = {}) {
    const job = getPiJob(jobId, this.dbPath);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    if (!verifyPassedTokenPath || !fs.existsSync(verifyPassedTokenPath)) {
      throw new Error('STAGE3_WIPE_BLOCKED: 缺少 .verify_passed 校验回执，禁止清零远端或进入刹车片二');
    }
    const tokenText = fs.readFileSync(verifyPassedTokenPath, 'utf8').trim();
    if (!tokenText.startsWith('VERIFIED_AT_')) {
      throw new Error(`STAGE3_WIPE_BLOCKED: .verify_passed 回执格式非法: ${tokenText}`);
    }
    if (typeof wipeExecutor !== 'function') {
      throw new Error('STAGE3_WIPE_BLOCKED: 未提供远端清零执行器 (wipeExecutor)');
    }

    const wipeRes = await wipeExecutor({ jobId, remoteJobDir, tokenText });
    if (!wipeRes || !wipeRes.ok) {
      throw new Error(`STAGE3_WIPE_FAILED: 远端沙箱清零失败，阻断进入刹车片二: ${wipeRes?.error || 'unknown error'}`);
    }

    this._emitAndRecord(jobId, PI_STAGES.STAGE_3_COMPUTE_PULL, 'remote_wiped', {
      remote_job_dir: remoteJobDir,
      wiped_at: new Date().toISOString(),
    });

    return this.suspendForFinalAcceptance(jobId, {
      ...computeFacts,
      verified_sha256: true,
      remote_wiped: true,
      verify_token: tokenText,
    });
  }

  /**
   * K40 计算、SHA-256 校验与远端清零完成后，挂起在人工刹车片二（等待最终验收）。
   */
  suspendForFinalAcceptance(jobId, computeFacts = {}) {
    const job = getPiJob(jobId, this.dbPath);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (computeFacts.remote_wiped === false) {
      throw new Error('INVALID_STATE_TRANSITION: 远端沙箱尚未清零 (remote_wiped=false)，严禁进入刹车片二');
    }

    const updated = updatePiJob(jobId, {
      stage: PI_STAGES.STAGE_3_COMPUTE_PULL,
      status: PI_JOB_STATUS.SUSPENDED_ACCEPTANCE,
      context: { compute_facts: computeFacts },
      checkpointReason: '人工刹车片二：产物已拉回校验且远端沙箱已清零，等待人工终审以触发基于本地产物的阶段四报告生成',
    }, this.dbPath);

    this._emitAndRecord(jobId, PI_STAGES.STAGE_3_COMPUTE_PULL, 'checkpoint_suspend', {
      status: PI_JOB_STATUS.SUSPENDED_ACCEPTANCE,
      reason: updated.checkpoint_reason,
      compute_facts: computeFacts,
    });
    return updated;
  }

  /**
   * 人工验收通过（恢复人工刹车片二）：
   * 严格读取轻量结构化统计摘要与模板注册表 ID，发起阶段四 Pi RPC 解读报告生成。
   */
  async approveFinalAcceptance(jobId, actor = 'operator', options = {}) {
    const job = getPiJob(jobId, this.dbPath);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (job.status !== PI_JOB_STATUS.SUSPENDED_ACCEPTANCE) {
      throw new Error(`INVALID_STATE_TRANSITION: 任务 ${jobId} 当前状态为 ${job.status}，非 ${PI_JOB_STATUS.SUSPENDED_ACCEPTANCE}`);
    }

    const summaryPaths = options.summaryPaths || job.context?.compute_facts?.summary_paths || {};
    const lightweightSummaries = loadLightweightReportSummaries(summaryPaths);
    const readyTemplateIds = loadReadyFigureTemplateIds(this.allowlistPath);

    const updated = updatePiJob(jobId, {
      stage: PI_STAGES.STAGE_4_REPORT_DELIVERY,
      status: PI_JOB_STATUS.RUNNING,
      checkpointReason: null,
      approvedBy: actor,
      approvedAt: new Date().toISOString(),
      context: {
        report_summaries: lightweightSummaries,
        figure_template_ids: readyTemplateIds,
      },
    }, this.dbPath);

    this._emitAndRecord(jobId, PI_STAGES.STAGE_4_REPORT_DELIVERY, 'checkpoint_resume', {
      approved_by: actor,
      resumed_stage: PI_STAGES.STAGE_4_REPORT_DELIVERY,
      summary_keys: Object.keys(lightweightSummaries),
      template_count: readyTemplateIds.length,
    });

    const resultJob = await this._dispatchRpcStage(updated, PI_STAGES.STAGE_4_REPORT_DELIVERY, options);
    if (resultJob.status !== PI_JOB_STATUS.FAILED) {
      return updatePiJob(jobId, { status: PI_JOB_STATUS.COMPLETED }, this.dbPath);
    }
    return resultJob;
  }

  async _dispatchRpcStage(job, stage, options = {}) {
    const promptInfo = loadStagePrompt(stage);
    const maxTurns = Number(options.maxTurns || 6);
    const history = [];

    const failStage = (message, code) => {
      const failed = updatePiJob(job.job_id, {
        status: PI_JOB_STATUS.FAILED,
        lastError: message,
      }, this.dbPath);
      this._emitAndRecord(job.job_id, stage, 'error', { code: code || 'PI_STAGE_FAILED', error: message });
      return failed;
    };

    for (let turn = 1; turn <= maxTurns; turn += 1) {
      const prompt = buildStageMessage({ stage, context: job.context, history });
      this._emitAndRecord(job.job_id, stage, 'rpc_prompt', {
        turn,
        prompt_bytes: Buffer.byteLength(prompt, 'utf8'),
        mode: 'rpc',
        no_session: true,
        prompt_file: promptInfo.file,
        prompt_sha256: promptInfo.sha256,
      });

      const rpcResult = await this.rpcExecutor({
        jobId: job.job_id,
        stage,
        prompt,
        piBin: options.piBin || this.piBin,
        extraArgs: ['--system-prompt', promptInfo.text, ...(options.extraArgs || [])],
        timeoutMs: options.timeoutMs,
        onEvent: (ev) => {
          this._emitAndRecord(job.job_id, stage, 'rpc_event', ev);
        },
      });

      if (!rpcResult.ok) {
        return failStage(rpcResult.error || 'Pi RPC execution failed', 'PI_RPC_FAILED');
      }

      let response;
      try {
        response = validateStageResponse(stage, extractJsonObject(rpcResult.finalText));
      } catch (error) {
        return failStage(`Pi 响应不合约: ${error.message}`, 'PI_RESPONSE_INVALID');
      }

      if (response.action === 'finish_stage') {
        const updated = updatePiJob(job.job_id, {
          context: { [`${stage}_output`]: response.output },
        }, this.dbPath);
        this._emitAndRecord(job.job_id, stage, 'complete', {
          turn,
          exitCode: rpcResult.exitCode,
          eventCount: rpcResult.events.length,
        });
        return updated;
      }

      if (!this.toolExecutor) {
        return failStage('宿主未注入 toolExecutor，工具调用 fail-closed', 'PI_TOOL_EXECUTOR_MISSING');
      }

      let toolResult;
      try {
        toolResult = await this.toolExecutor({
          stage,
          toolName: response.tool,
          args: response.args,
          context: job.context,
        });
      } catch (error) {
        return failStage(
          `工具 ${response.tool} 执行失败: ${error.message}`,
          error.code || 'PI_TOOL_CALL_FAILED',
        );
      }

      history.push({ role: 'assistant', content: JSON.stringify(response) });
      history.push({
        role: 'user',
        content: JSON.stringify({ tool_result: { tool: response.tool, ok: true, result: toolResult } }),
      });
      this._emitAndRecord(job.job_id, stage, 'tool_call', {
        turn,
        tool: response.tool,
        ok: true,
      });
    }

    return failStage(`PI_TURN_EXHAUSTED: Pi 阶段 ${stage} 超过 ${maxTurns} 轮仍未 finish_stage`, 'PI_TURN_EXHAUSTED');
  }

  getJob(jobId) {
    return getPiJob(jobId, this.dbPath);
  }

  listJobs(limit = 100) {
    return listPiJobs(this.dbPath, limit);
  }

  listEvents(jobId, afterId = 0, limit = 200) {
    return listPiEvents(jobId, this.dbPath, afterId, limit);
  }
}
