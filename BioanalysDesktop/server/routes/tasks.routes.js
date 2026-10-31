// 任务路由：任务列表、下发、中止、日志流（SSE）。
//
// 从 server/index.js 逐字搬来，处理体未做改写。json、runRemoteRaw、runningTasks、
// sink 三件套、sanitizeBridgeOutput、validateTaskPaths 由入口注入：runningTasks 是
// 服务进程内的可变状态，注入引用而不是复制；sink 与 validateTaskPaths 的定义仍在
// index.js（tests/task_submit_validation.test.js 按 index.js 取 validateTaskPaths）。
//
// 返回约定：命中本模块管辖的 pathname 就返回 true（含"已注册异步回调、稍后才回响应"
// 的情形），未命中返回 false 让 index.js 继续往下派发。json() 返回 undefined，
// 所以绝不能拿它的返回值当命中信号，分支顶层必须显式 return true。
// 注意：req.on('end') 与 setImmediate 回调里的 return 是回调返回值，不是派发信号，
// 那些 return json(...) 与 return; 保持原样。
import {
  DEFAULT_PROJECT, LINES, SYSTEM_LOGS, sanitizeProjectId,
} from '../domain.js';
import { auditCommand } from '../audit.js';
import { pullLineOutputs } from '../pull.js';
import { modToScriptMap } from '../workflow_graph.js';
import {
  buildTaskScript, needsBridgeCheck, inspectBridgeNeed, buildBridgeCheckCommand,
  runBridgeCheckSync, BridgeCheckError, requiresKoGene, isValidKoGene, KNOCKOUT_STEPS,
} from '../task.js';
import { runTask } from '../run.js';

export function handleTasksRoutes(req, res, url, {
  json, runRemoteRaw, runningTasks, createSink, dropSink, sendEvent, closeSink,
  sanitizeBridgeOutput, validateTaskPaths,
}) {
  if (url.pathname === '/api/tasks' && req.method === 'GET') {
    // 在跑任务列表：让界面知道有没有重复下发。
    // 字段名与 /api/tasks/submit 的返回值统一为 taskId  -  -  两处用不同名字
    // （这里曾叫 id）会让调用方按 submit 的字段去比对列表，永远匹配不上，
    // 长任务被误判成"已结束"（2026-10-19 端到端实测踩到）。
    json(res, 200, {
      tasks: [...runningTasks.entries()].map(([taskId, task]) => ({
        taskId,
        projectId: task.projectId,
        lineId: task.lineId,
        step: task.step,
        startedAt: task.startedAt,
      })),
    });
    return true;
  }

  if (url.pathname === '/api/tasks/submit' && req.method === 'POST') {
    // 任务下发：参数在服务端再校验一次，不信前端传来的东西
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let requested;
      try {
        requested = JSON.parse(body || '{}');
      } catch (cause) {
        return json(res, 400, { error: `请求体不是合法 JSON: ${cause.message}` });
      }

      const lineId = requested.lineId;
      if (!LINES.includes(lineId)) {
        return json(res, 400, { error: `lineId 非法: ${lineId}，只能是 ${LINES.join(' / ')}` });
      }
      const projectId = sanitizeProjectId(requested.projectId || DEFAULT_PROJECT);
      if (!projectId) {
        return json(res, 400, { error: `projectId 非法（只允许字母数字 . _ -）: ${requested.projectId}` });
      }
      if (!requested.step || typeof requested.step !== 'string') {
        return json(res, 400, { error: 'step 必填且必须是字符串' });
      }
      // step 是命令名（会被 shellQuote 成单个词执行），必须只含安全字符。
      // 含空格的输入（如 "echo data_plane_ok"）必然 command not found，
      // 还会把空格带进台账文件名，历史上把落盘命令的重定向拆断（2026-10-13 事故）。
      // 在这里提前拒，参数请走 inputs/outputs。
      if (!/^[A-Za-z0-9._-]+$/.test(requested.step)) {
        return json(res, 400, {
          error: `step 只能包含字母数字和 . _ -（命令名）: ${requested.step}。参数请用 inputs/outputs 传递`,
        });
      }
      const adapted = requested.adapted === true;
      const dependsOnStep = String(requested.dependsOnStep || '').trim();
      if (dependsOnStep && !/^[A-Za-z0-9._-]+$/.test(dependsOnStep)) {
        return json(res, 400, { error: `dependsOnStep 非法: ${dependsOnStep}` });
      }
      let adaptedScript = '';
      let adaptedLanguage = '';
      let canonicalOutput = '';
      if (adapted) {
        adaptedScript = String(requested.scriptPath || '');
        adaptedLanguage = String(requested.language || '');
        canonicalOutput = String(requested.canonicalOutput || '');
        const scriptPrefix = `/mnt/ssd/bio_data/projects/${projectId}/${lineId}/scripts/adapt_`;
        if (!adaptedScript.startsWith(scriptPrefix) || !/\.(R|py)$/.test(adaptedScript)) {
          return json(res, 400, { error: `adapted scriptPath 非法: ${adaptedScript}` });
        }
        if (!['r', 'python'].includes(adaptedLanguage)) {
          return json(res, 400, { error: `adapted language 非法: ${adaptedLanguage}` });
        }
        if (!canonicalOutput || canonicalOutput.includes('..') || canonicalOutput.startsWith('/')
          || !/^[A-Za-z0-9._/-]+$/.test(canonicalOutput)) {
          return json(res, 400, { error: `adapted canonicalOutput 非法: ${canonicalOutput}` });
        }
      }

      // P14 / aims:185：虚拟敲除必须由用户指定靶基因（target_ko_gene）。
      // 为什么在提交层就拦：母版里写死 KO_GENE 时，用户勾了"虚拟敲除"却敲的是别人的基因，
      // 产物看起来一切正常（DR 表、显著性、图都出），结论却是错的，事后无从发现。
      // 语义：敲除步骤缺失或非法一律 400；非敲除步骤传了也接受，但 task.js 不注入（忽略）。
      const needsKo = requiresKoGene(requested.step);
      let targetKoGene = '';
      if (requested.targetKoGene !== undefined && requested.targetKoGene !== null && requested.targetKoGene !== '') {
        if (typeof requested.targetKoGene !== 'string') {
          return json(res, 400, {
            error: `targetKoGene 必须是字符串（基因符号）: ${JSON.stringify(requested.targetKoGene).slice(0, 80)}`,
          });
        }
        targetKoGene = requested.targetKoGene.trim();
        if (targetKoGene !== '' && !isValidKoGene(targetKoGene)) {
          return json(res, 400, {
            error: `targetKoGene 非法（只允许字母数字与 . _ -，长度 1..32，首字符不能是 . 或 -）: ${targetKoGene}`,
          });
        }
      }
      if (needsKo && targetKoGene === '') {
        return json(res, 400, {
          error: `虚拟敲除必须指定 target_ko_gene：步骤 ${requested.step} 在 ${lineId} 上需要靶基因`
            + `（请求体字段 targetKoGene，例如 "TNF"）。可选项见 ${KNOCKOUT_STEPS.join(' / ')}`,
        });
      }

      // inputs / outputs 必须是字符串数组。调用方（含脚本化的 PowerShell / curl）
      // 很容易把单元素数组序列化成裸字符串，此时 task.js 的 inputs.map 会抛
      // TypeError 并**直接打死整个服务**（2026-10-19 实测：18787 进程退出）。
      // 参数类型错误是调用方问题，必须 400 返回，不能让服务端崩。
      for (const field of ['inputs', 'outputs']) {
        const value = requested[field];
        if (value !== undefined && value !== null) {
          if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
            return json(res, 400, {
              error: `${field} 必须是字符串数组，收到 ${typeof value}: ${JSON.stringify(value).slice(0, 120)}`,
            });
          }
        }
      }

      // P-29：禁止并发 SSH 到 k40-ubuntu。单任务串行是 proot 不进入 abort
      // 自我维持环的必要条件；跨项目并发同样禁止。
      if (runningTasks.size > 0) {
        return json(res, 409, {
          error: `P-29 禁止并发 SSH：当前已有 ${runningTasks.size} 个任务在运行，请等待完成后再提交`,
        });
      }

      // 同项目同线同步骤不允许并发第二次：生信任务重，跑重了难收拾
      const duplicate = [...runningTasks.values()].some(
        (task) => task.projectId === projectId && task.lineId === lineId && task.step === requested.step
      );
      if (duplicate) {
        return json(res, 409, { error: `该步骤正在运行: ${projectId} / ${lineId} / ${requested.step}。等它结束或先中止` });
      }

      if (adapted && dependsOnStep) {
        const dependencyScript = modToScriptMap().get(dependsOnStep) || dependsOnStep;
        const ledgerPattern = `${SYSTEM_LOGS}/*_${projectId}_${lineId}_${dependencyScript}_*.json`;
        const ledgerRead = runRemoteRaw(
          `latest=$(ls -t ${ledgerPattern} 2>/dev/null | head -n 1); `
          + 'if [ -n "$latest" ]; then cat "$latest"; fi',
        );
        if (ledgerRead.code !== 0) {
          return json(res, 503, { error: `前置步骤台账读取失败: ${ledgerRead.text}` });
        }
        let dependencyLedger = null;
        try {
          dependencyLedger = ledgerRead.text.trim() ? JSON.parse(ledgerRead.text) : null;
        } catch {
          dependencyLedger = null;
        }
        if (!dependencyLedger) {
          return json(res, 409, {
            error: `前置分析步骤 ${dependsOnStep} 尚无完成台账，禁止提前执行定制图 ${requested.step}`,
          });
        }
        if (dependencyLedger.status !== 'completed' || Number(dependencyLedger.exit_code) !== 0) {
          return json(res, 409, {
            error: `前置分析步骤 ${dependsOnStep} 未成功完成，禁止执行定制图 ${requested.step}`,
          });
        }
      }

      const taskId = `${projectId}-${lineId}-${Date.now()}`;
      const taskSpec = {
        projectId,
        lineId,
        step: requested.step,
        inputs: requested.inputs || [],
        outputs: requested.outputs || [],
        seed: requested.seed,
        // 非敲除步骤这里是空串，task.js 只在 requiresKoGene(step) 时注入，语义一致
        targetKoGene: targetKoGene || undefined,
        scriptPath: adapted ? adaptedScript : undefined,
        language: adapted ? adaptedLanguage : undefined,
        canonicalOutput: adapted ? canonicalOutput : undefined,
        adapted,
        dependsOnStep: adapted ? (dependsOnStep || undefined) : undefined,
      };

      // 审计提前到提交前：越界就不给 taskId，不启动、不占任务位。
      // 整段包 try/catch：参数形态异常（如 inputs 传了对象）不能把服务打死，
      // 必须是 400 返回  -  -  一次崩溃会让所有在跑任务与 SSE 连接一起断。
      let script;
      try {
        script = buildTaskScript(taskSpec);
      } catch (cause) {
        return json(res, 400, { error: `任务脚本构建失败（参数不合法）: ${cause.message}` });
      }
      const audit = auditCommand(script, lineId);
      if (!audit.allowed) {
        return json(res, 400, { error: audit.reason });
      }

      // S29 / R9：路径归属预校验，放在审计之后、桥接检查之前：
      // 先拦越界路径，避免为一条注定非法的路径去跑远端桥接校验（白耗 ssh 往返）。
      const pathCheck = validateTaskPaths(requested.inputs || [], requested.outputs || [], projectId);
      if (!pathCheck.ok) {
        return json(res, 400, { error: pathCheck.error });
      }

      // ── 桥接四项断言检查点（S28 / 架构评审 D1）──────────────────────────
      // aims §一.3：每次跨语言转换必须过 ops/verify_bridge_checkpoint.py。
      // 58 个分析脚本 0 调用（铁律空转），接线位置定为提交层 -  - 只有这里全知
      // "这一步是不是跨语言步骤"。母版缺失不阻断提交（保持既有行为），但必须
      // warn 可观测；K40 不可达时明确 503，绝不静默放过。
      const bridgeNeed = adapted ? { masterExists: false, bilingual: false, guardWired: false, reason: 'adapted task' } : inspectBridgeNeed(lineId, requested.step);
      if (!adapted && !bridgeNeed.masterExists) {
        console.warn(`[bridge] ${lineId}/${requested.step} 母版缺失，跳过桥接判定: ${bridgeNeed.reason}`);
      }
      // task-10 / m00939 边界②：母版自己也要调 src/bridge_guard.sh，否则直连 K40
      // 跑母版时断言仍空转。这里只 warn 不阻断：老母版不该因为新规突然提交失败，
      // 但不变量测试 tests/bridge_guard_invariant.test.js 会把缺口钉在 CI 上。
      if (!adapted && bridgeNeed.bilingual && !bridgeNeed.guardWired) {
        console.warn(`[bridge] ${lineId}/${requested.step} 是跨语言母版但未调用 src/bridge_guard.sh，`
          + `提交层仍会执行断言，直连 K40 跑母版则不会；请按 task-10 接线`);
      }
      if (!adapted && needsBridgeCheck(lineId, requested.step)) {
        let bridgePlan;
        try {
          bridgePlan = buildBridgeCheckCommand(lineId, requested.step, {
            inputs: requested.inputs || [],
            projectId,
          });
        } catch (cause) {
          const detail = cause instanceof BridgeCheckError ? cause.message : `桥接命令构建异常: ${cause.message}`;
          return json(res, 400, { error: `桥接检查命令构建失败: ${detail}` });
        }
        if (!bridgePlan.remoteScript) {
          // 引擎只认 .h5ad/.rds；双语步骤但输入全是 tsv 等时无法构造校验命令。
          // 不编造参数、不阻断提交（阻断是回归），warn 留痕并已在 S28 报告上报。
          console.warn(`[bridge] ${lineId}/${requested.step} 需要桥接校验但${bridgePlan.reason}，本次未过引擎`);
        } else {
          console.log(`[bridge] ${lineId}/${requested.step} 为跨语言步骤，执行四项断言: ${bridgePlan.remoteScript}`);
          const bridge = runBridgeCheckSync(bridgePlan);
          const bridgeOutput = sanitizeBridgeOutput(bridge.stdout, bridge.stderr);
          if (bridge.code === 0) {
            console.log(`[bridge] ${lineId}/${requested.step} 四项断言通过`);
          } else if (bridge.code === 255 || bridge.code === -1) {
            // ssh 自身连接失败是 255；spawnSync 超时/启动失败 status=null → runBridgeCheckSync 归 -1。
            // 这是"校验无法执行"，不是"校验通过"：明确 503，不许静默放过。
            return json(res, 503, {
              error: `桥接校验无法执行（K40 不可达）: exit=${bridge.code} ${bridgeOutput.slice(-500)}`,
            });
          } else {
            // 引擎明确判死：引擎原文（[BRIDGE FAIL] ...）点名是哪个断言没过
            return json(res, 400, {
              error: `桥接四项断言未通过（${lineId}/${requested.step}），引擎原文: ${bridgeOutput}`,
            });
          }
        }
      }

      try {
        const handle = runTask(
          {
            projectId,
            lineId,
            step: requested.step,
            inputs: requested.inputs || [],
            outputs: requested.outputs || [],
            seed: requested.seed,
            // 与上面 taskSpec 同源：审计用的脚本与实际跑的脚本必须带同一个靶基因
            targetKoGene: targetKoGene || undefined,
            scriptPath: adapted ? adaptedScript : undefined,
            language: adapted ? adaptedLanguage : undefined,
            canonicalOutput: adapted ? canonicalOutput : undefined,
            adapted,
          },
          {
            onStdout: (text) => sendEvent(taskId, 'stdout', text),
            onStderr: (text) => sendEvent(taskId, 'stderr', text),
            onExit: (code, entry) => {
              runningTasks.delete(taskId);
              sendEvent(taskId, 'exit', JSON.stringify({ code, entry }));
              if (code !== 0) {
                closeSink(taskId);
                return;
              }
              // 步骤成功即自动回搬（aims §7.3）：产物做完就同步到本地，
              // 不依赖用户手动点按钮。放 setImmediate 里是为了让 exit 事件先发出去，
              // 且 scp 是同步调用，不能卡住 SSE 的收尾。
              setImmediate(() => {
                try {
                  const pulled = pullLineOutputs(projectId, lineId);
                  sendEvent(taskId, 'stdout',
                    `[pull] 已回搬 ${pulled.pulled} 个文件（跳过 ${pulled.skipped}，失败 ${pulled.failed}）`
                    + ` → ${pulled.localDir}\n`);
                } catch (cause) {
                  sendEvent(taskId, 'stderr', `[pull] 自动回搬失败: ${cause.message}\n`);
                } finally {
                  closeSink(taskId);
                }
              });
            },
          }
        );
        runningTasks.set(taskId, {
          kill: handle.kill,
          projectId,
          lineId,
          step: requested.step,
          startedAt: new Date().toISOString(),
        });
        return json(res, 200, { taskId, projectId, lineId, step: requested.step });
      } catch (cause) {
        return json(res, 500, { error: cause instanceof Error ? cause.message : String(cause) });
      }
    });
    return true;
  }

  if (url.pathname === '/api/tasks/stop' && req.method === 'POST') {
    const taskId = url.searchParams.get('id') || '';
    const task = runningTasks.get(taskId);
    if (!task) {
      json(res, 404, { error: `任务不在运行: ${taskId}` });
      return true;
    }
    task.kill();
    runningTasks.delete(taskId);
    json(res, 200, { stopped: taskId });
    return true;
  }

  if (url.pathname === '/api/tasks/logs' && req.method === 'GET') {
    // SSE：日志流。任务已被中止或不存在时，先告知再关流
    const taskId = url.searchParams.get('id') || '';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');

    if (!runningTasks.has(taskId)) {
      res.write(`event: exit\ndata: ${JSON.stringify({ code: null, note: '任务不在运行（可能已结束或被中止）' })}\n\n`);
      res.end();
      return true;
    }

    const sink = createSink(taskId, (text) => res.write(text));
    req.on('close', () => {
      dropSink(taskId, sink);
    });
    return true;
  }

  return false;
}
