/**
 * 任务执行引擎：流式跑远端命令 + 结束自动写台账
 *
 * 执行前必须过审计（audit.js 兜底），跑完的台账必须能过 ledger.js 自己的判定，
 * 否则不落盘：写一条自己违规的账比不写更糟。
 */

import { randomUUID } from 'node:crypto';

import { auditCommand } from './audit.js';
import { auditLedgerEntry } from './ledger.js';
import { buildLedgerEntry, buildTaskScript, isLongRunningStep, routeTask } from './task.js';
import { readEnvironmentManifest } from './manifest.js';
import { SYSTEM_LOGS } from './domain.js';
// 5.1（2026-11-01）：本模块不再直连 node:child_process。ssh/scp 一律走 proc.js 接缝
// （白名单 + BIO_COMPUTE_ADAPTER=mock 罩护 + 可测垫片），"唯一出口"从此没有例外。
import { runExecFile, runExecStream, sshArgv } from './proc.js';
import { probeRemoteState, reconcileTask } from './reconcile.js';
// Q3：失败分类学唯一真源。finishTask 不再自己发明「非零即失败」的裸判定，
// 而是把退出码交给 FSM 得到带原因码的结果（LOCK_CONFLICT / OOM_GUARD / STEP_CONTRACT_FAIL ...）。
import { classifyTaskOutcome, TASK_STATES } from './task_fsm.js';
import { validateWithSchemaGateway } from './schema_gateway_client.js';

const DETACHED_POLL_INTERVAL_MS = Math.max(
  60000,
  Number(process.env.BIO_TASK_POLL_INTERVAL_MS || 60000),
);
const DETACHED_TIMEOUT_MS = Number(process.env.BIO_TASK_TIMEOUT_MS || 40 * 60 * 1000);

/**
 * 把 task 描述编译成**最终**远端脚本并做唯一一次安全审计（第三十二轮 Q3 裁定）。
 *
 * 为什么要有它：提交层与引擎层历史上各审一次，而两次的输入不同（引擎层多带 throttled /
 * detached / wrapperTaskId），脚本内容实测已分叉（.tmp/probe_audit_divergence.mjs）。
 * 两条审计迟早会给出不同结论，那时用户看到的是「提交成功但引擎拒绝」的哑谜。
 *
 * 现在脚本拼装与审计收口到这里：提交层先调它拿 400 判定，引擎层再调它拿同一份脚本，
 * 「审的就是跑的」由结构保证，不再靠两边手工对齐。
 *
 * wrapperTaskId 必须由调用方传进来：提交层要在响应里回 taskId，引擎层要用同一个 id 拼日志
 * 路径，两边各自随机生成就会再次分叉。
 *
 * @param {object} task 任务描述（projectId / lineId / step / inputs / outputs / seed 等）
 * @param {{wrapperTaskId: string}} ids 由调用方生成的稳定标识
 * @returns {{script: string, audit: {allowed: boolean, reason: string|null, hits: Array}} 冻结对象
 */
export function prepareAndAuditTask(task, ids = {}) {
  if (!ids.wrapperTaskId) throw new Error('prepareAndAuditTask 需要 wrapperTaskId：两端必须用同一个标识');
  const script = buildTaskScript({
    ...task,
    throttled: true,
    detached: isLongRunningStep(task.step),
    wrapperTaskId: ids.wrapperTaskId,
  });
  return Object.freeze({ script, audit: Object.freeze(auditCommand(script, task.lineId)) });
}

/**
 * 启动一个任务。
 *
 * @param {object} task
 * @param {string} task.lineId
 * @param {string} task.step
 * @param {string[]} task.inputs
 * @param {string[]} task.outputs
 * @param {number} [task.seed]
 * @param {string} [task.preparedScript] 提交层已编译并审过的脚本；给了就直接用，不再重编译
 * @param {string} [task.preparedWrapperTaskId] 提交层使用的 wrapperTaskId，引擎沿用同一个
 * @param {{onStdout?: Function, onStderr?: Function, onExit?: Function, cwd?: string}} handlers
 * @returns {{id: string, kill: Function}} 用于中止任务
 */
export function runTask(task, handlers = {}) {
  const startedAt = new Date().toISOString();
  const taskId = randomUUID();
  const detached = isLongRunningStep(task.step);
  const wrapperTaskId = task.preparedWrapperTaskId || `task_${Date.now()}_${taskId.slice(0, 8)}`;
  // 远端执行与审计用同一份脚本，避免"审的是一套、跑的是另一套"
  // throttled: true —— 工作台任务必须经 ops/run_throttled_task.sh（nice/ionice 降权 + 存储水位与
  // 跨线门禁 + 线程封顶，aims §六.3）。2026-10-21 之前这里是默认 false，等于整条契约对引擎任务
  // 全部失效（D-21）；包装器缺 BIO_EXEC_CMD 支持时传命令串会 ENOENT，现已由命令串模式解决。
  // 提交层已经编译并审过的脚本优先：重编译会换一个 wrapperTaskId，等于审的和跑的不是同一份
  const script = task.preparedScript || buildTaskScript({
    ...task,
    throttled: true,
    detached,
    wrapperTaskId,
  });
  const audit = task.preparedScript ? { allowed: true, reason: null } : auditCommand(script, task.lineId);
  if (!audit.allowed) {
    // 审计不过就不启动，直接把拒绝原因当 stderr 抛给调用方
    handlers.onStderr?.(`[audit] ${audit.reason}\n`);
    handlers.onExit?.(-1);
    return { id: null, kill: () => {} };
  }

  // Phase 0/1/2 契约：前置 Schema 网关校验
  const gatewayCheck = validateWithSchemaGateway('run_task', {
    lineId: task.lineId,
    step: task.step,
    projectId: task.projectId,
    inputs: Array.isArray(task.inputs) ? task.inputs : [],
    outputs: Array.isArray(task.outputs) ? task.outputs : [],
    seed: task.seed,
  });

  const isShadowMode = process.env.BIO_GATEWAY_SHADOW_MODE !== '0';
  if (!gatewayCheck.allowed) {
    if (!isShadowMode) {
      handlers.onStderr?.(`[schema_gateway:DENY] ${gatewayCheck.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}\n`);
      handlers.onExit?.(-1);
      return { id: null, kill: () => {} };
    }
  }

  // 只保留 stderr 尾部用于 error_log；全量日志由调用方自己收集，不在这里存两份
  let stderrTail = '';
  let settled = false;
  let stopped = false;
  let child = null;
  let selectedNode = null;
  let pollTimer = null;
  let probeFailures = 0;
  const wrapperLedgerPath = `/tmp/${wrapperTaskId}_ledger.json`;
  const wrapperMarkerPath = `${SYSTEM_LOGS}/_running/${wrapperTaskId}.json`;
  const wrapperLogPath = `${SYSTEM_LOGS}/${wrapperTaskId}.wrapper.log`;

  const finishTask = (code, options = {}) => {
    if (settled) return;
    settled = true;
    if (pollTimer) clearTimeout(pollTimer);
    const endedAt = new Date().toISOString();
    const success = code === 0;
    const env = readEnvironmentManifest(task.lineId);
    if (!env) {
      handlers.onStderr?.(`[ledger] 未找到 ${task.lineId} 的 envs/manifest.txt，environment 用默认值\n`);
    }
    // Q3：把退出码交给 FSM 得到标准失败原因码。注意这里传 hasReceipt=null ——
    // finishTask 时 persistEntry 还没跑，回执信号未知，FSM 会诚实给 UNKNOWN 而不是臆断。
    // 因此 status 仍沿用既有 code===0 判定（避免行为漂移），FSM 只负责给失败日志
    // 加上可机读的原因码前缀，让 LOCK_CONFLICT / OOM_GUARD 等在台账里可检索。
    const fsmOutcome = classifyTaskOutcome({ exitCode: code, hasReceipt: null });
    const reasonTag = !success && fsmOutcome.reason
      ? `[FSM:${fsmOutcome.reason}] `
      : '';
    const entry = buildLedgerEntry({
      projectId: task.projectId,
      lineId: task.lineId,
      step: task.step,
      seed: task.seed,
      inputs: task.inputs,
      outputs: task.outputs,
      status: success ? 'completed' : 'failed',
      checkpointStatus: options.checkpointStatus || (success ? 'passed' : 'failed'),
      exitCode: code,
      errorLog: success ? null : (reasonTag + (options.errorLog || stripSshNoise(stderrTail).trim() || 'stderr 为空，退出码非零')),
      startedAt,
      endedAt,
      language: env?.language,
      version: env?.version,
      envName: env?.env_name,
      containerImage: env?.container_image,
    });
    entry.task_id = taskId;
    entry.compute_node_id = selectedNode?.id || null;

    // reconcile.js 的既有探针接口固定读 K40。备用节点任务跳过该探针，避免把 K40 的状态误套到备用节点。
    if (!options.skipReconcile && selectedNode?.id === 'k40-ubuntu') {
      const reconciliation = reconcileTask(
        entry,
        probeRemoteState(taskId, Array.isArray(task.outputs) ? task.outputs : [])
      );
      if (reconciliation) {
        entry.status = reconciliation.status;
        entry.checkpoint_status = reconciliation.checkpoint_status;
        entry.reconcile_note = reconciliation.reconcile_note;
      }
    }

    const selfAudit = auditLedgerEntry(entry);
    if (!selfAudit.legal) {
      handlers.onStderr?.(`[ledger] 拒绝落盘：台账自身不合规: ${selfAudit.problems.join('; ')}\n`);
    } else {
      // Q3 收口：persistEntry 是异步 fire-and-forget，onExit 必须保持同步（既有契约），
      // 所以这里不能 await。但「台账没落盘」不能再只打一行日志就算完：
      // 远端无 WROTE 回执时，任务本该是 FAILED/RECEIPT_MISSING 而非 completed。
      // 因此在 rejection 里用 FSM 把结果如实修正，并发一条可机读事件让上层知晓。
      // entry 对象本身也同步打上标记（onExit 拿到的就是这个引用），避免上层读到假绿。
      entry.ledger_receipt = 'pending';
      persistEntry(entry, task.lineId, { sshTarget: selectedNode?.host || 'k40-ubuntu' })
        .then(() => { entry.ledger_receipt = 'confirmed'; })
        .catch((cause) => {
          const outcome = classifyTaskOutcome({ exitCode: code, hasReceipt: false });
          entry.ledger_receipt = 'missing';
          entry.status = outcome.state === TASK_STATES.FAILED ? 'failed' : entry.status;
          entry.checkpoint_status = 'failed';
          entry.receipt_failure_reason = outcome.reason;
          handlers.onStderr?.(`[ledger] 台账落盘失败: ${cause.message}\n`);
          handlers.onReceiptMissing?.({
            taskId,
            code,
            reason: outcome.reason,
            state: outcome.state,
            retryable: outcome.retryable,
            message: cause.message,
          });
        });
    }

    handlers.onExit?.(code, entry);
  };

  const scheduleDetachedProbe = () => {
    if (settled) return;
    pollTimer = setTimeout(probeDetachedTask, DETACHED_POLL_INTERVAL_MS);
    pollTimer.unref?.();
  };

  const probeDetachedTask = () => {
    if (settled) return;
    if (Date.now() - Date.parse(startedAt) >= DETACHED_TIMEOUT_MS) {
      finishTask(-1, {
        skipReconcile: true,
        errorLog: `detached 长任务超过 ${Math.round(DETACHED_TIMEOUT_MS / 60000)} 分钟仍未落台账`,
      });
      return;
    }
    const probe = [
      `if [ -f '${wrapperLedgerPath}' ]; then`,
      '  echo __LEDGER__',
      `  cat '${wrapperLedgerPath}'`,
      `elif [ -f '${wrapperMarkerPath}' ]; then`,
      '  echo __PENDING__',
      'else',
      '  echo __WAITING__',
      `  tail -c 400 '${wrapperLogPath}' 2>/dev/null || true`,
      'fi',
    ].join('\n');
    runExecFile(
      sshArgv(selectedNode?.host || 'k40-ubuntu', probe),
      { timeoutMs: 30000, maxBuffer: 2 * 1024 * 1024, callback: (error, stdout, stderr) => {
        if (settled) return;
        if (error) {
          probeFailures += 1;
          handlers.onStderr?.(`[detached] 状态探针失败 ${probeFailures}/2: ${String(stderr || error.message).slice(-300)}\n`);
          if (probeFailures >= 2) {
            finishTask(-1, { skipReconcile: true, errorLog: stderr || error.message });
            return;
          }
          scheduleDetachedProbe();
          return;
        }
        probeFailures = 0;
        const text = String(stdout || '').trim();
        if (text.startsWith('__LEDGER__')) {
          try {
            const wrapperLedger = JSON.parse(text.slice('__LEDGER__'.length).trim());
            const code = wrapperLedger.status === 'completed' ? 0 : 1;
            const wrappedError = wrapperLedger.error_log && wrapperLedger.error_log !== 'null'
              ? wrapperLedger.error_log
              : null;
            finishTask(code, {
              skipReconcile: true,
              checkpointStatus: code === 0 ? 'passed' : 'failed',
              errorLog: wrappedError,
            });
            runExecFile(
              sshArgv(selectedNode?.host || 'k40-ubuntu', `rm -f '${wrapperLedgerPath}'`),
              { timeoutMs: 10000 },
            );
          } catch (cause) {
            finishTask(-1, {
              skipReconcile: true,
              errorLog: `detached 台账 JSON 无法解析: ${cause.message}`,
            });
          }
          return;
        }
        handlers.onStdout?.(`[detached] ${text.replace('__PENDING__', '任务运行中').replace('__WAITING__', '等待包装器就绪')}\n`);
        scheduleDetachedProbe();
      } },
    );
  };

  const launchOnNode = (_routedTask, node) => {
    selectedNode = node;
    if (stopped) return { id: taskId, launched: false };
    child = runExecStream(
      sshArgv(node.host, script),
      {
        cwd: handlers.cwd,
        onStdout: (text) => handlers.onStdout?.(text),
        onStderr: (text) => {
          stderrTail = (stderrTail + text).slice(-2000);
          handlers.onStderr?.(text);
        },
        onExit: (code) => {
          if (detached && code === 0) {
            handlers.onStdout?.(`[detached] 已脱离本机进程树，wrapper=${wrapperTaskId}，node=${node.id}\n`);
            scheduleDetachedProbe();
            return;
          }
          finishTask(code, { skipReconcile: detached || node.id !== 'k40-ubuntu' });
        },
        onError: (cause) => finishTask(-1, {
          skipReconcile: detached || node.id !== 'k40-ubuntu',
          errorLog: cause.message,
        }),
      },
    );

    return { id: taskId, launched: true };
  };

  routeTask({ ...task, taskId }, { executor: launchOnNode }).catch((cause) => {
    handlers.onStderr?.(`[failover] 新任务无法路由: ${cause.message}\n`);
    handlers.onExit?.(-1);
  });

  const stopTask = () => {
    if (settled || stopped) return;
    stopped = true;
    if (!child) return;
    if (!detached) {
      child.kill();
      return;
    }
    const stop = [
      `marker='${wrapperMarkerPath}'`,
      'pid=$(sed -n \'s/.*"wrapper_pid": \\([0-9][0-9]*\\).*/\\1/p\' "$marker" 2>/dev/null)',
      'if [ -n "$pid" ]; then kill -TERM -- "-$pid" 2>/dev/null || true; fi',
      'rm -f "$marker"',
      'echo STOPPED',
    ].join('\n');
    runExecFile(
      sshArgv(selectedNode?.host || 'k40-ubuntu', stop),
      { timeoutMs: 20000, callback: () => finishTask(143, { skipReconcile: true, errorLog: '用户中止 detached 长任务' }) },
    );
  };

  return { id: taskId, kill: stopTask };
}

/**
 * 剥掉 ssh 客户端自己的噪声行。
 *
 * error_log 是给人排查问题看的，混着 "Warning: Permanently added ..." 只会淹没真实错误。
 * 只按行前缀过滤，不动内容本身。
 */
export function stripSshNoise(text) {
  const noisePrefixes = [
    'Warning: Permanently added',
    'Warning: Remote host identification has changed',
    'Warning: the RSA host key',
    'Warning: the ECDSA host key',
    'Warning: Pseudo-terminal will not be allocated',
    'TERM variable not set',
  ];
  return String(text)
    .split(/\r?\n/)
    .filter((line) => !noisePrefixes.some((prefix) => line.startsWith(prefix)))
    .join('\n');
}

/**
 * 文件名段安全化：只保留 `[A-Za-z0-9._-]`，其余一律换下划线。
 *
 * step 名是用户/界面填的自由文本（如 `echo data_plane_ok`），会直接进台账文件名。
 * 空格会把落盘命令的 shell 重定向拆断（2026-10-13 事故：base64 把后半段当输入文件，
 * 台账丢失），引号/分号更危险。在这里一次收敛，文件名只含安全字符。
 */
function sanitizeFileNameSegment(text) {
  return String(text).replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * 台账文件名：`YYYY-MM-DD_<project>_<line>_<step>_<taskId 前8位>.json`
 *
 * 日期按用户工作地（Asia/Shanghai）取，不按 UTC：凌晨跑的任务用 UTC 会记到前一天，
 * 巡检按天找账时对不上。entry 里的时间戳仍是 UTC ISO，两者分工不同。
 * project 段便于人工按项目归档；台账内容里的 project_id 才是权威。
 */
export function buildLedgerFileName(entry) {
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(entry.start_time));
  const project = sanitizeFileNameSegment(entry.project_id || 'default');
  const line = sanitizeFileNameSegment(entry.line_id);
  const step = sanitizeFileNameSegment(entry.step_name);
  const taskId = sanitizeFileNameSegment(entry.task_id.slice(0, 8));
  return `${localDate}_${project}_${line}_${step}_${taskId}.json`;
}

/**
 * 台账落盘的远端命令（payload 走 ssh stdin，命令行只留解码与回执）。
 *
 * 旧版把 base64 payload 整段拼进 `ssh k40-ubuntu '<command>'` 单行 argv：71 outputs
 * 条目命令 9,114+ 字符，实测（S18R §8-2 + S26 复现）超 ~8,231 字符远端 shell 静默截断，
 * 半截 base64 照样 exit 0，「WROTE」被截掉也无从察觉 → 台账静默丢失。
 * stdin 没有 argv 长度限制，payload 体积不再约束命令行；命令行长度恒定（不随 outputs 增长）。
 *
 * 硬校验靠远端回执 `WROTE '<path>' <bytes>`（bytes 用 wc -c 取），persistEntry 负责比对。
 * 抽成纯函数是为了可单测：远端路径必须整体加单引号，裸露重定向会被文件名里的空格
 * 拆断（2026-10-13 事故）。
 */
export function buildLedgerWriteCommand(entry) {
  const remotePath = `${SYSTEM_LOGS}/${buildLedgerFileName(entry)}`;
  const command = `mkdir -p '${SYSTEM_LOGS}' && base64 -d > '${remotePath}'`
    + ` && echo WROTE "'${remotePath}'" $(wc -c < '${remotePath}')`;
  return { command, remotePath };
}

/**
 * 台账写到服务器 system_logs/：base64 经 ssh stdin 中转（防 JSON 变形 + 防 argv 截断）。
 *
 * 双硬校验，缺一即 reject，绝不许静默当成功：
 *   1. 远端必须回 `WROTE '<remotePath>' <bytes>` 标记；
 *   2. bytes 必须与 payload 字节数一致（防半截写入）。
 * 导出是为了测试可用假 ssh 垫片验证 stdin 传输与校验行为。
 * @throws 落盘失败 / 无 WROTE 标记 / 字节数不符
 */
/**
 * 从远端输出里解析台账回执 WROTE '<path>' <bytes>，返回声称的字节数；无回执返回 null。
 *
 * 兼容两种形态（第三十六轮 DCM 基准实测教训）：带引号 WROTE '/p' 1167 是现行 echo
 * 输出与既有 mock 的形态；不带引号 WROTE /p 1167 是旧版 echo 被 shell 剥掉引号后的
 * 真实形态。旧版校验只认带引号，而旧命令的 echo 实际输出不带引号：每条台账落盘成功
 * 仍被判定「未回 WROTE 标记」。前缀逐字相等（非子串匹配），防其它日志行混算成回执。
 */
export function persistReceiptMarker(output, remotePath) {
  const quoted = "WROTE '" + remotePath + "' ";
  const plain = 'WROTE ' + remotePath + ' ';
  for (const line of String(output).split(/\r?\n/)) {
    const text = line.trim();
    let rest = null;
    if (text.startsWith(quoted)) rest = text.slice(quoted.length);
    else if (text.startsWith(plain)) rest = text.slice(plain.length);
    if (rest === null) continue;
    const bytes = Number(rest.trim());
    if (Number.isFinite(bytes)) return bytes;
  }
  return null;
}

export async function persistEntry(entry, lineId, options = {}) {
  const { command, remotePath } = buildLedgerWriteCommand(entry);
  const payload = Buffer.from(JSON.stringify(entry, null, 2), 'utf8');
  const result = await runSsh(command, payload.toString('base64'), options.sshTarget || 'k40-ubuntu');
  const reportedBytes = persistReceiptMarker(result, remotePath);
  if (reportedBytes === null) {
    throw new Error(`写台账失败：远端未回 WROTE 标记（命令疑似被截断或落盘未执行） path=${remotePath} tail=${result.slice(-300)}`);
  }
  if (reportedBytes !== payload.length) {
    throw new Error(`写台账失败：远端落盘 ${reportedBytes} 字节 != payload ${payload.length} 字节（疑似半截写入） path=${remotePath}`);
  }
  return { path: remotePath, output: result };
}

/**
 * ssh 执行远端命令；stdinPayload 非 null 时经 stdin 传给远端命令（base64 台账 payload）。
 */
function runSsh(command, stdinPayload = null, sshTarget = 'k40-ubuntu') {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const child = runExecStream(sshArgv(sshTarget, command), {
      onStdout: (text) => { out += text; },
      onStderr: (text) => { err += text; },
      onExit: (code) => {
        const text = (out + '\n' + err)
          .split(/\r?\n/)
          .filter((line) => !line.startsWith('Warning: Permanently added'))
          .join('\n')
          .trim();
        if (code === 0) resolve(text);
        else reject(new Error(`写台账失败 (exit ${code}): ${text}`));
      },
    });
    if (stdinPayload !== null) {
      child.stdin?.end?.(stdinPayload, 'utf8');
    }
  });
}
