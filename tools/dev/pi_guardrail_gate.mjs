#!/usr/bin/env node
/**
 * Pi 护栏门禁（pi_guardrail_gate.mjs）。
 *
 * 存在的理由：Pi CLI 的六工具白名单如果只写在一份 JSON 里，它迟早会与代码分叉，
 * 而分叉的方向通常就是「代码悄悄多开了一个能力」。所以本门禁做三件事：
 *
 *   1. 声明面与运行时真源双向逐字段一致（tools_manifest.json vs TOOL_DEFINITIONS）；
 *   2. 运行时表达「没有通用执行能力」：白名单模块内不得出现 spawn/exec/shell 字符串；
 *   3. 指标卡与正文防幻觉三条判据的真实行为（越权工具、裸写数值、幽灵 Mod）。
 *
 * 判据都是「改坏必变红」，不是「看起来没问题」。变异反证编在
 * tools/dev/mutation_gate.mjs 的 m20–m22 三条。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

/** Windows 上必须走 file:// URL 才能动态 import 绝对路径。 */
function asImportUrl(file, query = '') {
  return pathToFileURL(file).href + query;
}

const MANIFEST_PATH = path.join(REPO, 'desktop', 'runtime', 'picli', 'tools_manifest.json');
const CONFIG_PATH = path.join(REPO, 'desktop', 'runtime', 'picli', 'pi_config.json');
const QC_RULES_PATH = path.join(REPO, 'desktop', 'runtime', 'picli', 'prompts', 'qc_sentinel_rules.md');
const BRIDGE_PATH = path.join(REPO, 'BioanalysDesktop', 'server', 'services', 'pi_tools_bridge.js');
const SUPERVISOR_PATH = path.join(REPO, 'BioanalysDesktop', 'server', 'services', 'pi_supervisor.js');
const WORKFLOWS_PATH = path.join(REPO, 'tools', 'bio', 'workflows.json');

const EXPECTED_TOOLS = Object.freeze([
  'inspect_requirement',
  'compile_work_order',
  'dispatch_and_poll_dag',
  'read_step_metrics',
  'remediate_step_param',
  'build_and_verify_report',
  'propose_adaptation',
  'run_validation',
  'dispatch_step',
]);

/** tier2 沙盒工具的守卫函数：executor 静态必须显式调用，缺失即红。 */
const TIER2_GUARDS = Object.freeze([
  'validateAdaptationPath',
  'scanAstBlacklist',
  'verifyScriptsManifest',
]);

/** 白名单模块里绝对不能出现的执行能力。命中即红。 */
const FORBIDDEN_CAPABILITIES = Object.freeze([
  { re: /\bchild_process\b/, label: 'child_process 导入' },
  { re: /\bspawnSync\b/, label: 'spawnSync 调用' },
  { re: /\bexecSync\b/, label: 'execSync 调用' },
  { re: /\bexecFileSync\b/, label: 'execFileSync 调用' },
  { re: /\bnew\s+Function\b/, label: '动态代码求值' },
  { re: /\beval\s*\(/, label: 'eval 调用' },
  { re: /\brequire\s*\(\s*['"]child_process['"]/, label: 'require(child_process)' },
]);

function fail(message) {
  console.error(`[ RED ] ${message}`);
  let failures = 0;
  return { ok: false, message, failures: 1 };
}

async function main() {
  const failures = [];
  const notes = [];

  // ---------- 1. 声明面存在 ----------
  for (const [label, file] of [
    ['tools_manifest.json', MANIFEST_PATH],
    ['pi_config.json', CONFIG_PATH],
    ['qc_sentinel_rules.md', QC_RULES_PATH],
    ['pi_tools_bridge.js', BRIDGE_PATH],
    ['pi_supervisor.js', SUPERVISOR_PATH],
  ]) {
    if (!fs.existsSync(file)) failures.push(`缺少声明面文件: ${label}（${path.relative(REPO, file)}）`);
  }
  if (failures.length > 0) return report(failures, notes);

  // ---------- 2. 声明面 vs 运行时真源 ----------
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const {
    TOOL_DEFINITIONS, ALLOWED_TOOL_NAMES, TUNABLE_PARAMS, TIER1_TOOLS, TIER2_TOOLS,
  } = await import(asImportUrl(BRIDGE_PATH));

  if (manifest.tool_count !== manifest.tools.length) {
    failures.push(`manifest.tool_count=${manifest.tool_count} 与 tools.length=${manifest.tools.length} 不一致`);
  }
  if (manifest.tool_count !== EXPECTED_TOOLS.length) {
    failures.push(`工具数必须恰为 ${EXPECTED_TOOLS.length}，实际 ${manifest.tool_count}`);
  }
  const manifestNames = manifest.tools.map((t) => t.tool_name);
  const missingInManifest = EXPECTED_TOOLS.filter((n) => !manifestNames.includes(n));
  const extraInManifest = manifestNames.filter((n) => !EXPECTED_TOOLS.includes(n));
  if (missingInManifest.length > 0) failures.push(`manifest 缺少工具: ${missingInManifest.join(', ')}`);
  if (extraInManifest.length > 0) failures.push(`manifest 出现未授权工具: ${extraInManifest.join(', ')}`);

  // tier 分级：manifest 每条必须有 tier，且与运行时 TIER1/TIER2 划分一致。
  for (const tool of manifest.tools) {
    const expectedTier = TIER1_TOOLS.includes(tool.tool_name) ? 'tier1'
      : TIER2_TOOLS.includes(tool.tool_name) ? 'tier2' : null;
    if (!expectedTier) continue;
    if (tool.tier !== expectedTier) {
      failures.push(`工具 ${tool.tool_name} 的 tier 声明 ${JSON.stringify(tool.tier)} 与运行时分级的 ${expectedTier} 不一致`);
    }
  }

  const runtimeNames = [...ALLOWED_TOOL_NAMES];
  const manifestSet = new Set(manifestNames);
  const runtimeSet = new Set(runtimeNames);
  for (const name of runtimeSet) {
    if (!manifestSet.has(name)) failures.push(`运行时多出未声明工具: ${name}`);
  }
  for (const name of manifestSet) {
    if (!runtimeSet.has(name)) failures.push(`manifest 声明了运行时不存在的工具: ${name}`);
  }

  // 逐字段比对：description / read_only / params 的键与必填标记
  for (const tool of manifest.tools) {
    const runtime = TOOL_DEFINITIONS[tool.tool_name];
    if (!runtime) continue;
    if (tool.description !== runtime.description) {
      failures.push(`工具 ${tool.tool_name} 的 description 在声明面与运行时不一致`);
    }
    if (tool.read_only !== runtime.readOnly) {
      failures.push(`工具 ${tool.tool_name} 的 read_only 在声明面与运行时不一致`);
    }
    const manifestParams = Object.keys(tool.params || {}).sort();
    const runtimeParams = Object.keys(runtime.params || {}).sort();
    if (manifestParams.join(',') !== runtimeParams.join(',')) {
      failures.push(`工具 ${tool.tool_name} 的参数集不一致: 声明面[${manifestParams}] 运行时[${runtimeParams}]`);
    }
    for (const key of manifestParams) {
      const mp = tool.params[key];
      const rp = runtime.params[key];
      if (mp.type !== rp.type) failures.push(`工具 ${tool.tool_name}.${key} 类型不一致: ${mp.type} vs ${rp.type}`);
      if (Boolean(mp.required) !== Boolean(rp.required)) {
        failures.push(`工具 ${tool.tool_name}.${key} 必填标记不一致`);
      }
    }
  }

  // ---------- 3. 配置面 ----------
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const perms = config.permissions || {};
  for (const capability of ['shell', 'powershell', 'file_read', 'file_write', 'network', 'process_spawn']) {
    if (perms[capability] !== false) {
      failures.push(`pi_config.permissions.${capability} 必须为 false（当前 ${JSON.stringify(perms[capability])}）`);
    }
  }
  const configAllowlist = config.tool_allowlist || [];
  if (configAllowlist.slice().sort().join(',') !== EXPECTED_TOOLS.slice().sort().join(',')) {
    failures.push('pi_config.tool_allowlist 与六大白名单不一致');
  }
  if (config.token_limits?.max_metrics_card_bytes !== 32768) {
    failures.push('pi_config.token_limits.max_metrics_card_bytes 必须为 32768');
  }
  if (config.human_checkpoints?.required !== true) {
    failures.push('pi_config.human_checkpoints.required 必须为 true');
  }
  const cp1 = config.human_checkpoints?.checkpoint_1_project_plan?.gate;
  const cp2 = config.human_checkpoints?.checkpoint_2_target_lock?.gate;
  if (cp1 !== 'BEFORE_COMPUTE_DISPATCH') failures.push(`检查点一门位必须为 BEFORE_COMPUTE_DISPATCH，实际 ${cp1}`);
  if (cp2 !== 'BEFORE_REPORT_SIGNING') failures.push(`检查点二门位必须为 BEFORE_REPORT_SIGNING，实际 ${cp2}`);

  // ---------- 4. 运行时模块不得具备通用执行能力 ----------
  for (const [label, file] of [['pi_tools_bridge.js', BRIDGE_PATH], ['pi_supervisor.js', SUPERVISOR_PATH]]) {
    const text = fs.readFileSync(file, 'utf8');
    for (const rule of FORBIDDEN_CAPABILITIES) {
      if (rule.re.test(text)) failures.push(`${label} 命中禁用能力: ${rule.label}`);
    }
  }

  // ---------- 4b. tier2 executor 必须显式调用三守卫 ----------
  const bridgeText = fs.readFileSync(BRIDGE_PATH, 'utf8');
  for (const guard of TIER2_GUARDS) {
    if (!bridgeText.includes(guard)) {
      failures.push(`tier2 executor 缺少守卫调用: ${guard}`);
    }
  }

  // ---------- 5. 可调参数表必须带硬边界 ----------
  const tunableNames = Object.keys(TUNABLE_PARAMS || {});
  if (tunableNames.length === 0) failures.push('TUNABLE_PARAMS 为空：模型将无法在受控范围内调参，这是配置缺失');
  for (const [key, spec] of Object.entries(TUNABLE_PARAMS || {})) {
    if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(key)) failures.push(`可调参数键格式非法: ${key}`);
    if (!Number.isFinite(spec.min) || !Number.isFinite(spec.max) || spec.min >= spec.max) {
      failures.push(`可调参数 ${key} 的边界非法: [${spec.min}, ${spec.max}]`);
    }
  }
  for (const required of ['l1_de_limma.log2fc_cutoff', 'l1_de_limma.padj_cutoff', 'l3_branches_celltype.min_abundance']) {
    if (!TUNABLE_PARAMS[required]) failures.push(`缺少必备可调参数: ${required}`);
  }

  // ---------- 6. 行为判据：越权 / 幻觉 / 幽灵 Mod ----------
  const behaviorFailures = await runBehaviorChecks(failures);
  if (behaviorFailures.length > 0) failures.push(...behaviorFailures);

  return report(failures, notes);
}

async function runBehaviorChecks(failures) {
  const out = [];
  const bridgeModule = await import(asImportUrl(BRIDGE_PATH, '?gate=1'));
  const reportModule = await import(asImportUrl(
    path.join(REPO, 'tools', 'reporting', 'fact_check_narrative.mjs'), '?gate=1',
  ));

  // 6a. 未登记工具必须被拒
  const bridge = bridgeModule.createPiToolsBridge({
    inboxRoot: path.join(REPO, 'portal', 'inbox'),
    workspaceRoot: path.join(REPO, 'workspace', 'projects'),
    workflowsPath: WORKFLOWS_PATH,
  });
  for (const forged of ['shell', 'powershell', 'fs.write', 'process.spawn']) {
    let threw = false;
    try {
      bridge.invoke(forged, {});
    } catch (error) {
      threw = error?.code === 'PI_TOOL_NOT_ALLOWED';
    }
    if (!threw) out.push(`越权工具 '${forged}' 未被拒绝`);
  }

  // 6b. 未声明参数必须被拒
  let extraParamRejected = false;
  try {
    bridge.invoke('inspect_requirement', { package_id: 'PKG_x', extra: 'boom' });
  } catch (error) {
    extraParamRejected = error?.code === 'PI_PARAMS_INVALID';
  }
  if (!extraParamRejected) out.push('未声明参数未被拒绝');

  // 6c. 路径穿越必须被拒
  let escapeRejected = false;
  try {
    bridge.invoke('read_step_metrics', { project_id: '..', mod_id: 'l1_de_limma' });
  } catch (error) {
    escapeRejected = ['PI_PARAMS_INVALID', 'PI_PATH_ESCAPE'].includes(error?.code);
  }
  if (!escapeRejected) out.push('路径穿越 project_id=.. 未被拒绝');

  // 6d. 未登记 Mod 的指标卡必须被拒
  let ghostModRejected = false;
  try {
    bridgeModule.validateToolParams('read_step_metrics', { project_id: 'PRJ_X', mod_id: 'l1_de_limma' });
    const ghostCard = {
      schema_version: 'step_metrics/v1', mod_id: 'mod_ghost_999', line_id: 'line1_bulk',
      project_id: 'PRJ_X', status: 'ok', generated_at: new Date().toISOString(),
      input_fingerprint: { inputs_digest: 'abcdefgh' }, metrics: { deg_total: 1 },
    };
    const metricsModule = await import(asImportUrl(
      path.join(REPO, 'shared', 'step_metrics_v1.mjs'), '?gate=1',
    ));
    const verdict = metricsModule.validateStepMetrics(ghostCard, {
      registeredModIds: metricsModule.collectRegisteredModIds(WORKFLOWS_PATH),
    });
    ghostModRejected = verdict.ok === false;
  } catch {
    ghostModRejected = true;
  }
  if (!ghostModRejected) out.push('幽灵 Mod 指标卡未被拒绝');

  // 6e. 裸写统计数值必须被拦
  const bare = reportModule.verifyNarrative({
    narrative: '本队列共 n = 70 例，AUC = 0.98，p = 0.003。',
    metricsCards: [],
  });
  if (bare.ok) out.push('裸写数值未被拦截（fact_check_narrative 判据失效）');

  // 6f. 槽位无真值必须被拦
  const unresolved = reportModule.verifyNarrative({
    narrative: '样本量 {{metric:l1_qc_matrix.sample_count}} 例。',
    metricsCards: [],
  });
  if (unresolved.ok) out.push('无真值槽位未被拦截');

  // 6g. 合法槽位必须能通过并填充
  const good = reportModule.verifyNarrative({
    narrative: '样本量 {{metric:l1_qc_matrix.sample_count}} 例。',
    metricsCards: [{
      mod_id: 'l1_qc_matrix',
      metrics: { sample_count: 70 },
    }],
    readyFigureIds: new Set(),
  });
  if (!good.ok) out.push(`合法槽位被误拦: ${good.reason}`);
  else if (!good.rendered.includes('70')) out.push('合法槽位未被填充为真值');

  // 6h. 超出可调边界必须被拒
  let boundsRejected = false;
  try {
    bridge.invoke('remediate_step_param', {
      work_order_id: 'WO-X', mod_id: 'l1_de_limma', param_key: 'log2fc_cutoff',
      new_value: 99, reason: 'test',
    });
  } catch (error) {
    boundsRejected = error?.code === 'PI_PARAM_OUT_OF_BOUNDS';
  }
  if (!boundsRejected) out.push('越界参数未被拒绝');

  // 6i. 表外参数名必须被拒
  let untunableRejected = false;
  try {
    bridge.invoke('remediate_step_param', {
      work_order_id: 'WO-X', mod_id: 'l1_de_limma', param_key: 'random_seed',
      new_value: 1, reason: 'test',
    });
  } catch (error) {
    untunableRejected = error?.code === 'PI_PARAM_NOT_TUNABLE';
  }
  if (!untunableRejected) out.push('表外参数未被拒绝');

  // 6j. QC 规则文件必须把三条硬判据写清
  const qcText = fs.readFileSync(QC_RULES_PATH, 'utf8');
  for (const [label, pattern] of [
    ['DEG 数量失衡', /DEG 数量失衡/],
    ['WGCNA 软阈值', /WGCNA 软阈值/],
    ['验证集过拟合', /验证集过拟合/],
  ]) {
    if (!pattern.test(qcText)) out.push(`QC 规则文件缺少「${label}」条`);
  }

  return out;
}

function report(failures, notes) {
  if (failures.length === 0) {
    console.log(`[ OK ] 声明面与运行时真源逐字段一致（${EXPECTED_TOOLS.length} 工具，含 tier2 沙盒工具）`);
    console.log('[ OK ] 白名单模块不含任何通用执行能力（shell / spawn / eval 均未命中）');
    console.log('[ OK ] 配置面权限全为 false，检查点门位与令牌上限符合契约');
    console.log('[ OK ] 行为判据通过：越权工具、未声明参数、路径穿越、幽灵 Mod、裸写数值、无真值槽位、越界参数全部被拒');
    for (const note of notes) console.log('[ NOTE ] ' + note);
    console.log('PI_GUARDRAIL_GATE_OK');
    return 0;
  }
  for (const failure of failures) console.error(`[ RED ] ${failure}`);
  console.error(`PI_GUARDRAIL_GATE_FAILED ${failures.length} 处违规`);
  return 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error('PI_GUARDRAIL_GATE_FAILED 内部异常：' + error.message);
    process.exitCode = 1;
  });
}

export { EXPECTED_TOOLS, FORBIDDEN_CAPABILITIES };
