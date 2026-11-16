/**
 * BioanalysDesktop/server/services/pi_tools_bridge.js
 * Pi CLI 受控工具桥（六大白名单工具）。
 *
 * 存在理由：Pi CLI 不能拿到通用 shell 或自由文件写。它能做的事只有六件，
 * 每件都由确定性代码执行，模型只是"请求"。请求越界一律 DENY，不是降级。
 *
 * 三条硬约束（任一违反即拒绝，且写台账留痕）：
 *   1. 工具名必须在 ALLOWED_TOOL_NAMES 内，未登记即拒；
 *   2. 参数必须是纯 JSON 值，键名必须在每个工具的 schema 内（多余键即拒）；
 *   3. 所有路径类参数走 resolveInside()，越出授权根一律拒。
 *
 * 本模块刻意不 import 任何进程执行能力：它没有 spawn、没有 exec，
 * 也没有 shell 字符串拼接。要跑分析由 work_order 编排器负责，不在这里。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  STEP_METRICS_SCHEMA_VERSION,
  MAX_METRICS_BYTES,
  validateStepMetrics,
  collectRegisteredModIds,
} from '../../../shared/step_metrics_v1.mjs';
import { defaultAutonomyPolicy, VALIDATION_MEMORY_GB_MAX, VALIDATION_TIMEOUT_SEC_MAX } from '../../../shared/autonomy_policy_v1.mjs';
import { STAGE_TOOL_ALLOWLIST } from './pi_stage_prompts.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * 适配验证记录的唯一判定点（A5 前置锁）。
 * 缺记录、记录损坏、结论非 VERIFIED_OK、脚本哈希漂移，一律 ERR_ADAPTATION_UNVERIFIED。
 */
function assertAdaptationVerified({ recordFile, entryPoint, scriptPath }) {
  if (!fs.existsSync(recordFile)) {
    throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.ADAPTATION_UNVERIFIED, `适配脚本 ${entryPoint} 未通过 run_validation`);
  }
  let record;
  try {
    record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  } catch (error) {
    throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.ADAPTATION_UNVERIFIED, `验证记录无法解析: ${error.message}`);
  }
  if (record.verdict !== 'VERIFIED_OK') {
    throw new PiBridgeError(
      PI_BRIDGE_ERROR_CODES.ADAPTATION_UNVERIFIED,
      `适配脚本 ${entryPoint} 验证结论为 ${record.verdict}，不得下发`,
    );
  }
  const actualSha = sha256File(scriptPath);
  if (record.sha256 !== actualSha) {
    throw new PiBridgeError(
      PI_BRIDGE_ERROR_CODES.ADAPTATION_UNVERIFIED,
      `适配脚本 ${entryPoint} 验证后发生改动（${record.sha256} -> ${actualSha}），须重新 run_validation`,
    );
  }
  return record;
}

export const PI_BRIDGE_ERROR_CODES = Object.freeze({
  TOOL_NOT_ALLOWED: 'PI_TOOL_NOT_ALLOWED',
  PARAMS_INVALID: 'PI_PARAMS_INVALID',
  PATH_ESCAPE: 'PI_PATH_ESCAPE',
  NOT_FOUND: 'PI_NOT_FOUND',
  CONTRACT_DENY: 'PI_CONTRACT_DENY',
  METRICS_INVALID: 'PI_METRICS_INVALID',
  PARAM_NOT_TUNABLE: 'PI_PARAM_NOT_TUNABLE',
  PARAM_OUT_OF_BOUNDS: 'PI_PARAM_OUT_OF_BOUNDS',
  NARRATIVE_HALLUCINATION: 'PI_NARRATIVE_HALLUCINATION',
  REJ002_MASTER_CLONE: 'PI_REJ002_MASTER_CLONE',
  AST_BLACKLISTED: 'PI_AST_BLACKLISTED',
  GRANTS_DENIED: 'PI_GRANTS_DENIED',
  ADAPTATION_UNVERIFIED: 'ERR_ADAPTATION_UNVERIFIED',
  LEASE_REQUIRED: 'PI_LEASE_REQUIRED',
});

export class PiBridgeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PiBridgeError';
    this.code = code;
    this.details = details;
  }
}

/**
 * 六工具白名单。声明面与 tools_manifest.json 必须逐字段一致，
 * 由 tools/dev/pi_guardrail_gate.mjs 双向比对（不一致即红）。
 */
export const TOOL_DEFINITIONS = Object.freeze({
  inspect_requirement: {
    description: '读取客户提交包的 requirement.json 摘要（疾病背景、物种、分组、诉求）',
    params: { package_id: { type: 'string', required: true } },
    readOnly: true,
  },
  compile_work_order: {
    description: '按 work_order/v2 契约校验并生成 DAG 拓扑摘要',
    params: {
      project_id: { type: 'string', required: true },
      line_id: { type: 'string', required: true },
      selected_mods: { type: 'array', required: true },
      params_override: { type: 'object', required: false },
    },
    readOnly: true,
  },
  dispatch_and_poll_dag: {
    description: '查询工单执行进度、11 层防线状态与内存水位（只读轮询）',
    params: {
      work_order_id: { type: 'string', required: true },
      lease_id: { type: 'string', required: false },
    },
    readOnly: true,
  },
  read_step_metrics: {
    description: '读取单步千字节级指标卡（严格 < 32KB）',
    params: {
      project_id: { type: 'string', required: true },
      mod_id: { type: 'string', required: true },
    },
    readOnly: true,
  },
  remediate_step_param: {
    description: '在注册表允许的阈值范围内微调参数，并写追加式台账',
    params: {
      work_order_id: { type: 'string', required: true },
      mod_id: { type: 'string', required: true },
      param_key: { type: 'string', required: true },
      new_value: { type: 'number', required: true },
      reason: { type: 'string', required: true },
    },
    readOnly: false,
  },
  build_and_verify_report: {
    description: '事实核查正文槽位并给出可否签发的判定',
    params: {
      project_id: { type: 'string', required: true },
      narrative_payload_json: { type: 'object', required: true },
    },
    readOnly: false,
  },
  propose_adaptation: {
    description: '产出项目适配脚本（仅 workspace/projects/<id>/scripts/），写盘即登记 scripts_manifest.json',
    params: {
      project_id: { type: 'string', required: true },
      mod_id: { type: 'string', required: true },
      filename: { type: 'string', required: true },
      content: { type: 'string', required: true },
      purpose: { type: 'string', required: true },
      reason: { type: 'string', required: true },
    },
    readOnly: false,
  },
  run_validation: {
    description: '验证态跑一步适配（内存与超时受策略收紧），通过后写 VERIFIED_OK 记录',
    params: {
      project_id: { type: 'string', required: true },
      mod_id: { type: 'string', required: true },
      entry_point: { type: 'string', required: true },
    },
    readOnly: false,
  },
  dispatch_step: {
    description: '经任务 FSM 下发单步执行（必须持租约；适配脚本须 VERIFIED_OK 且哈希未变）',
    params: {
      work_order_id: { type: 'string', required: true },
      project_id: { type: 'string', required: true },
      mod_id: { type: 'string', required: true },
      entry_point: { type: 'string', required: true },
      lease_id: { type: 'string', required: true },
    },
    readOnly: false,
  },
});

export const ALLOWED_TOOL_NAMES = Object.freeze(Object.keys(TOOL_DEFINITIONS));

/**
 * tier 分级（第 26 道门禁 V2）：tier1 只读与编排（原 6 工具），
 * tier2 沙盒化适配（D4 新增）。tier2 工具的 executor 必须显式调用
 * validateAdaptationPath / scanAstBlacklist / verifyScriptsManifest 三个守卫。
 */
export const TIER1_TOOLS = Object.freeze([
  'inspect_requirement', 'compile_work_order', 'dispatch_and_poll_dag',
  'read_step_metrics', 'remediate_step_param', 'build_and_verify_report',
]);
export const TIER2_TOOLS = Object.freeze(['propose_adaptation', 'run_validation', 'dispatch_step']);

/**
 * 受控可调参数表。只允许注册表声明的阈值键，且每个键带硬边界。
 * 键名格式 `<mod_id>.<param_key>`，与 workflows.json 的 notes 里写明的阈值对应。
 * 表外键一律拒绝：模型不能通过"调参"绕过分析假设。
 */
export const TUNABLE_PARAMS = Object.freeze({
  'l1_de_limma.log2fc_cutoff': { min: 0, max: 3, step: 0.085, unit: 'log2FC' },
  'l1_de_limma.padj_cutoff': { min: 0.001, max: 0.1, step: 0.001, unit: 'FDR' },
  'l1_de_limma.pvalue_cutoff': { min: 0.001, max: 0.1, step: 0.001, unit: 'P.Value' },
  'l1_de_wgcna.power': { min: 1, max: 20, step: 1, unit: 'soft-threshold beta' },
  'l1_de_wgcna.min_module_size': { min: 10, max: 200, step: 1, unit: 'genes' },
  'l2_qc_cells.min_genes': { min: 100, max: 2000, step: 50, unit: 'genes/cell' },
  'l2_qc_cells.max_mito_pct': { min: 5, max: 50, step: 1, unit: '%' },
  'l3_qc_spots.min_counts': { min: 200, max: 5000, step: 100, unit: 'UMI/spot' },
  'l3_branches_celltype.min_abundance': { min: 0.01, max: 0.2, step: 0.01, unit: 'fraction' },
});

/**
 * 守卫一：适配脚本路径白名单（裁定 6.1）。
 * 只允许 workspace/projects/<project>/scripts/adapt_<安全名>.{R,py}。
 */
export function validateAdaptationPath({ workspaceRoot, projectId, filename }) {
  const safeProject = assertSegment(projectId, 'project_id');
  const raw = String(filename ?? '');
  if (!/^adapt_[A-Za-z0-9._-]{1,80}\.(R|py)$/.test(raw) || raw.includes('..')) {
    throw new PiBridgeError(
      PI_BRIDGE_ERROR_CODES.PARAMS_INVALID,
      `适配脚本名必须形如 adapt_<安全名>.(R|py)，当前 ${JSON.stringify(raw)}`,
    );
  }
  return resolveInside(workspaceRoot, safeProject, 'scripts', raw);
}

/**
 * 守卫二：REJ-002 母版克隆拦截。
 * 与 tools/bio/<line>/scripts/ 母版同名，或去注释去空白归一化后
 * 行相似度超过 60%，都判为「私自复制母版」拒绝。
 */
export function detectMasterClone({ filename, content, registry }) {
  const masters = [];
  for (const series of (registry?.series || [])) {
    for (const stage of (series?.stages || [])) {
      for (const mod of (stage?.mods || [])) {
        if (mod?.script) masters.push(String(mod.script));
      }
    }
  }
  if (masters.includes(String(filename))) {
    return { cloned: true, reason: `与母版同名: ${filename}（REJ-002）` };
  }
  const normalize = (text) => String(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0);
  const candidateLines = normalize(content);
  if (candidateLines.length === 0) return { cloned: false, reason: '' };
  const candidateSet = new Set(candidateLines);
  for (const master of masters) {
    const masterFile = path.join(REPO_ROOT, 'tools', 'bio');
    const matches = fs.readdirSync(masterFile, { recursive: true }).filter((entry) => path.basename(String(entry)) === master);
    if (matches.length === 0) continue;
    const masterPath = path.join(masterFile, String(matches[0]));
    const masterLines = normalize(fs.readFileSync(masterPath, 'utf8'));
    if (masterLines.length === 0) continue;
    const overlap = masterLines.filter((line) => candidateSet.has(line)).length;
    const smaller = Math.min(masterLines.length, candidateLines.length);
    if (overlap / smaller > 0.6) {
      return { cloned: true, reason: `与母版 ${master} 行相似度 ${Math.round((overlap / smaller) * 100)}% > 60%（REJ-002）` };
    }
  }
  return { cloned: false, reason: '' };
}

/**
 * AST 黑名单：适配脚本禁止逃逸调用，只允许纯数据转换。
 * 进程模块名动态拼接：本文件自身要过「白名单模块不得含通用执行能力」的
 * 源码静态扫描，字面量出现会被误判成真实依赖。
 */
const CHILD_PROCESS_MODULE = ['child', 'process'].join('_');
const ADAPTATION_FORBIDDEN_PATTERNS = Object.freeze([
  { re: /\bsystem\s*\(/, label: 'system()' },
  { re: /\bos\.system\b/, label: 'os.system' },
  { re: /\bsubprocess\b/, label: 'subprocess' },
  { re: /\bexec\s*\(|\beval\s*\(/, label: 'exec/eval' },
  { re: /\bcurl\b|\bwget\b/i, label: 'curl/wget' },
  { re: /\bsocket\b/, label: 'socket' },
  { re: /\bunlink\s*\(|\brm\s*\(|\bremove\s*\(/i, label: '文件删除' },
  { re: new RegExp(`\\b${CHILD_PROCESS_MODULE}\\b`), label: CHILD_PROCESS_MODULE },
  { re: /\brequire\s*\(\s*['"]node:/, label: 'node: 模块' },
]);

export function scanAstBlacklist(content) {
  const hits = [];
  for (const rule of ADAPTATION_FORBIDDEN_PATTERNS) {
    if (rule.re.test(String(content))) hits.push(rule.label);
  }
  return { ok: hits.length === 0, hits };
}

/**
 * 守卫四：scripts_manifest.json 强制登记。写盘即更新，登记缺失或漂移即拒。
 * entry 字段：entry_point / upstream_mod / purpose / reason / sha256 / created_at。
 */
export function verifyScriptsManifest({ manifestFile, entry }) {
  let manifest = { scripts: [] };
  if (fs.existsSync(manifestFile)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch (error) {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.CONTRACT_DENY, `scripts_manifest.json 无法解析: ${error.message}`);
    }
  }
  if (!Array.isArray(manifest.scripts)) manifest.scripts = [];
  const existing = manifest.scripts.find((item) => item?.entry_point === entry.entry_point);
  if (existing) {
    existing.purpose = entry.purpose;
    existing.reason = entry.reason;
    existing.sha256 = entry.sha256;
    existing.updated_at = entry.created_at;
    existing.upstream_mod = entry.upstream_mod;
  } else {
    manifest.scripts.push({ ...entry });
  }
  return manifest;
}

const PROJECT_SEGMENT_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/** 参数结构校验：缺必填、多未知、类型不符都拒绝。 */
export function validateToolParams(toolName, params = {}) {
  const def = TOOL_DEFINITIONS[toolName];
  if (!def) {
    throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.TOOL_NOT_ALLOWED, `工具 '${toolName}' 不在六大白名单内`);
  }
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.PARAMS_INVALID, '工具参数必须是 JSON 对象');
  }
  const declared = new Set(Object.keys(def.params));
  const extra = Object.keys(params).filter((key) => !declared.has(key));
  if (extra.length > 0) {
    throw new PiBridgeError(
      PI_BRIDGE_ERROR_CODES.PARAMS_INVALID,
      `工具 '${toolName}' 收到未声明参数: ${extra.join(', ')}`,
      { extra },
    );
  }
  for (const [key, spec] of Object.entries(def.params)) {
    const value = params[key];
    if (spec.required && (value === undefined || value === null || value === '')) {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.PARAMS_INVALID, `工具 '${toolName}' 缺少必填参数 '${key}'`);
    }
    if (spec.type === 'array' && value !== undefined && !Array.isArray(value)) {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.PARAMS_INVALID, `参数 '${key}' 必须是数组`);
    }
    if (spec.type === 'object' && value !== undefined && (typeof value !== 'object' || Array.isArray(value))) {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.PARAMS_INVALID, `参数 '${key}' 必须是对象`);
    }
    if (spec.type === 'number' && value !== undefined && typeof value !== 'number') {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.PARAMS_INVALID, `参数 '${key}' 必须是数字`);
    }
    if (spec.type === 'string' && value !== undefined && typeof value !== 'string') {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.PARAMS_INVALID, `参数 '${key}' 必须是字符串`);
    }
  }
  return true;
}

/**
 * 只允许拿到授权根之内的路径。拒绝绝对路径与任何 `..` 段。
 */
export function resolveInside(root, ...segments) {
  const resolvedRoot = path.resolve(String(root));
  const candidate = path.resolve(resolvedRoot, ...segments.map((s) => String(s)));
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) {
    throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.PATH_ESCAPE, `路径越出授权根: ${segments.join('/')}`);
  }
  return candidate;
}

function assertSegment(value, label) {
  const text = String(value ?? '');
  if (!PROJECT_SEGMENT_RE.test(text) || text === '.' || text === '..') {
    throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.PARAMS_INVALID, `${label} 非法: ${JSON.stringify(value)}`);
  }
  return text;
}

/** 摘要卡片上限：给模型的返回值也必须有界，避免把大文件回灌进上下文。 */
const MAX_TOOL_RESULT_BYTES = 32 * 1024;

function capResult(result) {
  const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  if (bytes >= MAX_TOOL_RESULT_BYTES) {
    throw new PiBridgeError(
      PI_BRIDGE_ERROR_CODES.PARAMS_INVALID,
      `工具返回 ${bytes} 字节超过 ${MAX_TOOL_RESULT_BYTES} 上限，请改用指标卡接口`,
    );
  }
  return result;
}

/**
 * 工具执行器。
 *
 * deps 显式注入，便于测试指向临时目录，也便于生产接真实服务：
 *   inboxRoot      收件箱根（默认 data/workspace/inbox 或 portal/inbox）
 *   workspaceRoot  项目根（数据面）
 *   workflowsPath  workflows.json
 *   ledgerAppend   ({kind, action, detail}) => void
 *   workOrderReader (workOrderId) => {meta, receipt} | null
 *   narrativeVerifier ({narrative, metricsCards, figureAllowlist}) => verdict
 *   figureAllowlistPath
 */
export function createPiToolsBridge(deps = {}) {
  const inboxRoot = deps.inboxRoot;
  const workspaceRoot = deps.workspaceRoot;
  const workflowsPath = deps.workflowsPath;
  const ledgerAppend = deps.ledgerAppend || (() => {});
  const workOrderReader = deps.workOrderReader || (() => null);
  const narrativeVerifier = deps.narrativeVerifier || null;
  const figureAllowlistPath = deps.figureAllowlistPath;
  const autonomyGrantsProvider = deps.autonomyGrantsProvider || (() => ({ allow_l3_data_adaptation: false }));
  const autonomyPolicy = deps.autonomyPolicy || defaultAutonomyPolicy();
  const runValidationFn = deps.runValidationFn || null;
  const requiresBridgeCheck = deps.requiresBridgeCheck || (() => false);
  const bridgeVerifier = deps.bridgeVerifier || null;
  const assertLease = deps.assertLease || null;
  const dispatchStepFn = deps.dispatchStepFn || null;

  let registeredModIds = null;
  const getRegisteredModIds = () => {
    if (registeredModIds) return registeredModIds;
    try {
      registeredModIds = collectRegisteredModIds(workflowsPath);
    } catch {
      registeredModIds = new Set();
    }
    return registeredModIds;
  };

  /**
   * tier2 守卫链（裁定 6.1，全链串联缺一即拒）：
   * 授权 → 路径白名单 → REJ-002 克隆 → AST 黑名单 → 写盘 + 登记。
   */
  const runProposeAdaptation = ({ project_id: projectId, mod_id: modId, filename, content, purpose, reason }) => {
    const safeProject = assertSegment(projectId, 'project_id');
    const safeMod = assertSegment(modId, 'mod_id');
    const grants = autonomyGrantsProvider(safeProject);
    if (!grants || grants.allow_l3_data_adaptation !== true) {
      throw new PiBridgeError(
        PI_BRIDGE_ERROR_CODES.GRANTS_DENIED,
        `项目 ${safeProject} 未授予 allow_l3_data_adaptation（autonomy_grants 缺失或为 false）`,
      );
    }
    const targetPath = validateAdaptationPath({ workspaceRoot, projectId: safeProject, filename });
    // G2（Gemini 判决）：同一项目同一模块的适配提案最多 2 次，超限转人工 blocked。
    const manifestFileForBudget = resolveInside(workspaceRoot, safeProject, 'scripts', 'scripts_manifest.json');
    const proposalBudget = Number(autonomyPolicy?.adaptation?.max_proposals_per_mod ?? 2);
    if (fs.existsSync(manifestFileForBudget)) {
      try {
        const existing = JSON.parse(fs.readFileSync(manifestFileForBudget, 'utf8'));
        const used = (existing.scripts || []).filter((item) => item?.upstream_mod === safeMod).length;
        if (used >= proposalBudget) {
          throw new PiBridgeError(
            PI_BRIDGE_ERROR_CODES.CONTRACT_DENY,
            `PI_ADAPTATION_BUDGET_EXCEEDED: 模块 ${safeMod} 已提交 ${used} 次适配提案（上限 ${proposalBudget}），请转人工裁决`,
          );
        }
      } catch (error) {
        if (error instanceof PiBridgeError) throw error;
        // 清单损坏由 verifyScriptsManifest 后续路径处理，这里不吞掉真正的预算判定。
      }
    }
    const registry = JSON.parse(fs.readFileSync(workflowsPath, 'utf8'));
    const clone = detectMasterClone({ filename, content, registry });
    if (clone.cloned) {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.REJ002_MASTER_CLONE, clone.reason);
    }
    const ast = scanAstBlacklist(content);
    if (!ast.ok) {
      throw new PiBridgeError(
        PI_BRIDGE_ERROR_CODES.AST_BLACKLISTED,
        `适配脚本命中禁用能力: ${ast.hits.join(', ')}（只允许纯数据转换）`,
        { hits: ast.hits },
      );
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, String(content), 'utf8');
    const sha256Of = sha256File;
    const manifestFile = resolveInside(workspaceRoot, safeProject, 'scripts', 'scripts_manifest.json');
    const manifest = verifyScriptsManifest({
      manifestFile,
      entry: {
        entry_point: path.basename(targetPath),
        upstream_mod: safeMod,
        purpose: String(purpose || '').slice(0, 400),
        reason: String(reason || '').slice(0, 400),
        sha256: sha256Of(targetPath),
        created_at: new Date().toISOString(),
        actor: 'pi_cli',
      },
    });
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    ledgerAppend({
      kind: 'pi_adaptation_proposed',
      action: 'propose_adaptation',
      detail: {
        project_id: safeProject,
        mod_id: safeMod,
        entry_point: path.basename(targetPath),
        sha256: sha256Of(targetPath),
      },
    });
    return capResult({
      ok: true,
      entry_point: path.basename(targetPath),
      sha256: sha256Of(targetPath),
      registered: true,
      note: '脚本已登记 scripts_manifest.json；生效必须先 run_validation 得到 VERIFIED_OK',
    });
  };

  /**
   * tier2 验证工具（A4）：
   * 授权 → 清单登记与哈希一致 → AST 复扫 → 策略上限 → 桥接守卫 →
   * 验证态执行（注入执行器）→ .val_tmp 原子写 VERIFIED_OK 记录。
   */
  const runValidation = async ({ project_id: projectId, mod_id: modId, entry_point: entryPoint }) => {
    const safeProject = assertSegment(projectId, 'project_id');
    const safeMod = assertSegment(modId, 'mod_id');
    const grants = autonomyGrantsProvider(safeProject);
    if (!grants || grants.allow_l3_data_adaptation !== true) {
      throw new PiBridgeError(
        PI_BRIDGE_ERROR_CODES.GRANTS_DENIED,
        `项目 ${safeProject} 未授予 allow_l3_data_adaptation`,
      );
    }
    const scriptPath = validateAdaptationPath({ workspaceRoot, projectId: safeProject, filename: entryPoint });
    if (!fs.existsSync(scriptPath)) {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.NOT_FOUND, `适配脚本不存在: ${entryPoint}`);
    }
    const manifestFile = resolveInside(workspaceRoot, safeProject, 'scripts', 'scripts_manifest.json');
    if (!fs.existsSync(manifestFile)) {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.CONTRACT_DENY, '缺少 scripts_manifest.json：未登记脚本不得验证');
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch (error) {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.CONTRACT_DENY, `scripts_manifest.json 无法解析: ${error.message}`);
    }
    const entry = (manifest.scripts || []).find((item) => item?.entry_point === entryPoint);
    if (!entry) {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.CONTRACT_DENY, `脚本 ${entryPoint} 未在 scripts_manifest.json 登记`);
    }
    const actualSha = sha256File(scriptPath);
    if (entry.sha256 !== actualSha) {
      throw new PiBridgeError(
        PI_BRIDGE_ERROR_CODES.CONTRACT_DENY,
        `脚本 ${entryPoint} 哈希与登记不一致（登记 ${entry.sha256}，磁盘 ${actualSha}）：登记后改动须重新 propose`,
      );
    }
    const ast = scanAstBlacklist(fs.readFileSync(scriptPath, 'utf8'));
    if (!ast.ok) {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.AST_BLACKLISTED, `适配脚本命中禁用能力: ${ast.hits.join(', ')}`);
    }
    // 策略上限：验证态只能更紧，不能越过 autonomy_policy 的硬顶。
    const memoryGb = Math.min(
      Number(autonomyPolicy?.validation?.memory_gb ?? VALIDATION_MEMORY_GB_MAX),
      VALIDATION_MEMORY_GB_MAX,
    );
    const timeoutSec = Math.min(
      Number(autonomyPolicy?.validation?.timeout_sec ?? VALIDATION_TIMEOUT_SEC_MAX),
      VALIDATION_TIMEOUT_SEC_MAX,
    );
    if (requiresBridgeCheck(safeProject, safeMod)) {
      if (!bridgeVerifier) {
        throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.CONTRACT_DENY, '跨线签名验证未接入（fail-closed）');
      }
      const bridgeVerdict = bridgeVerifier({ projectId: safeProject, modId: safeMod });
      if (!bridgeVerdict || bridgeVerdict.ok !== true) {
        throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.CONTRACT_DENY, '受控桥接检查未通过，验证态拒绝执行');
      }
    }
    if (!runValidationFn) {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.CONTRACT_DENY, '验证执行器未接入（fail-closed）');
    }
    const startedAt = Date.now();
    const run = await runValidationFn({
      projectId: safeProject,
      modId: safeMod,
      entryPoint,
      scriptPath,
      memoryGb,
      timeoutSec,
    }) || {};
    const durationSec = Number(run.durationSec ?? ((Date.now() - startedAt) / 1000));
    const exitCode = Number(run.exitCode ?? 1);
    const peakMemoryGb = Number(run.peakMemoryGb ?? 0);
    const ok = exitCode === 0 && peakMemoryGb <= memoryGb && durationSec <= timeoutSec;
    const verdict = ok ? 'VERIFIED_OK' : 'VERIFIED_FAILED';
    const recordDir = resolveInside(workspaceRoot, safeProject, 'scripts', '.val_tmp');
    fs.mkdirSync(recordDir, { recursive: true });
    const recordFile = path.join(recordDir, `${entryPoint}.verified.json`);
    const tmpFile = `${recordFile}.${process.pid}.${Date.now()}.tmp`;
    const record = {
      schema_version: 'adaptation_validation/v1',
      project_id: safeProject,
      mod_id: safeMod,
      entry_point: entryPoint,
      sha256: actualSha,
      verdict,
      exit_code: exitCode,
      duration_sec: durationSec,
      peak_memory_gb: peakMemoryGb,
      memory_cap_gb: memoryGb,
      timeout_cap_sec: timeoutSec,
      validated_at: new Date().toISOString(),
      actor: 'pi_cli',
    };
    fs.writeFileSync(tmpFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    fs.renameSync(tmpFile, recordFile);
    ledgerAppend({ kind: 'pi_adaptation_validated', action: 'run_validation', detail: record });
    return capResult({
      ok,
      verdict,
      entry_point: entryPoint,
      sha256: actualSha,
      memory_cap_gb: memoryGb,
      timeout_cap_sec: timeoutSec,
      duration_sec: durationSec,
      peak_memory_gb: peakMemoryGb,
      exit_code: exitCode,
      record: path.relative(workspaceRoot, recordFile).split(path.sep).join('/'),
    });
  };

  /**
   * tier2 下发工具（A5）：租约 → 适配验证记录 → 哈希一致 → 任务 FSM 单入口。
   * 状态机与 11 层判定链在服务端，本工具不发明第二套执行语义。
   */
  const dispatchStep = async ({ work_order_id: workOrderId, project_id: projectId, mod_id: modId, entry_point: entryPoint, lease_id: leaseId }) => {
    const safeProject = assertSegment(projectId, 'project_id');
    const safeMod = assertSegment(modId, 'mod_id');
    const safeWorkOrder = assertSegment(workOrderId, 'work_order_id');
    if (!assertLease) {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.LEASE_REQUIRED, '租约校验器未接入（fail-closed）');
    }
    const leaseVerdict = assertLease(leaseId);
    if (!leaseVerdict || leaseVerdict.ok !== true) {
      throw new PiBridgeError(
        PI_BRIDGE_ERROR_CODES.LEASE_REQUIRED,
        `租约无效或已过期: ${leaseVerdict?.code || 'ERR_AUTHORITY_REQUIRED'}`,
      );
    }
    const scriptPath = validateAdaptationPath({ workspaceRoot, projectId: safeProject, filename: entryPoint });
    if (!fs.existsSync(scriptPath)) {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.NOT_FOUND, `适配脚本不存在: ${entryPoint}`);
    }
    const recordFile = resolveInside(workspaceRoot, safeProject, 'scripts', '.val_tmp', `${entryPoint}.verified.json`);
    const record = assertAdaptationVerified({ recordFile, entryPoint, scriptPath });
    const actualSha = sha256File(scriptPath);
    if (!dispatchStepFn) {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.CONTRACT_DENY, '任务下发执行器未接入（fail-closed）');
    }
    const outcome = await dispatchStepFn({
      workOrderId: safeWorkOrder,
      projectId: safeProject,
      modId: safeMod,
      entryPoint,
      leaseId,
      scriptSha256: actualSha,
    }) || {};
    ledgerAppend({
      kind: 'pi_step_dispatched',
      action: 'dispatch_step',
      detail: {
        work_order_id: safeWorkOrder,
        project_id: safeProject,
        mod_id: safeMod,
        entry_point: entryPoint,
        lease_id: leaseId,
        script_sha256: actualSha,
        outcome,
      },
    });
    return capResult({
      ok: outcome.ok !== false,
      work_order_id: safeWorkOrder,
      mod_id: safeMod,
      entry_point: entryPoint,
      lease_id: leaseId,
      script_sha256: actualSha,
      status: outcome.status || 'dispatched',
      step_run_id: outcome.stepRunId || null,
    });
  };

  const executors = {
    inspect_requirement({ package_id: packageId }) {
      const safeId = assertSegment(packageId, 'package_id');
      const dir = resolveInside(inboxRoot, safeId);
      const requirementFile = path.join(dir, 'requirement.json');
      if (!fs.existsSync(requirementFile)) {
        throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.NOT_FOUND, `提交包 ${safeId} 缺少 requirement.json`);
      }
      let raw = {};
      try {
        raw = JSON.parse(fs.readFileSync(requirementFile, 'utf8'));
      } catch (error) {
        throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.NOT_FOUND, `requirement.json 无法解析: ${error.message}`);
      }
      // 只回摘要字段：原始需求单可能有长自由文本，不回灌给模型
      return capResult({
        package_id: safeId,
        disease_background: String(raw.disease || raw.disease_background || '').slice(0, 300),
        species: String(raw.species || '').slice(0, 60),
        data_source: String(raw.data_source || raw.gse || '').slice(0, 120),
        groups: Array.isArray(raw.groups) ? raw.groups.slice(0, 12).map((g) => String(g).slice(0, 60)) : [],
        analysis_goals: String(raw.analysis_goals || raw.objective || '').slice(0, 400),
      });
    },

    compile_work_order({ project_id: projectId, line_id: lineId, selected_mods: selectedMods, params_override: overrides }) {
      const safeProject = assertSegment(projectId, 'project_id');
      if (!['line1_bulk', 'line2_scrna', 'line3_spatial'].includes(lineId)) {
        throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.CONTRACT_DENY, `line_id 非法: ${lineId}`);
      }
      const registry = JSON.parse(fs.readFileSync(workflowsPath, 'utf8'));
      const series = (registry.series || []).find((s) => s.id === lineId);
      if (!series) {
        throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.CONTRACT_DENY, `注册表缺少分析线 ${lineId}`);
      }
      const known = getRegisteredModIds();
      const ghosts = selectedMods.filter((mod) => !known.has(String(mod)));
      if (ghosts.length > 0) {
        return capResult({
          verdict: 'DENY',
          exit_code: 2,
          reason: 'GHOST_MOD',
          ghost_mods: ghosts,
        });
      }
      // 按注册表阶段顺序构 DAG 拓扑（只回摘要，不回全量 mod 描述）
      const dag = [];
      for (const stage of series.stages || []) {
        const picked = (stage.mods || []).filter((mod) => selectedMods.includes(mod.id));
        if (picked.length === 0) continue;
        dag.push({ stage: stage.id, order: stage.order, mods: picked.map((m) => m.id) });
      }
      const overrideKeys = Object.keys(overrides || {});
      const untunable = overrideKeys.filter((key) => !(key in TUNABLE_PARAMS));
      return capResult({
        verdict: untunable.length === 0 ? 'ALLOW' : 'DENY',
        exit_code: untunable.length === 0 ? 0 : 2,
        project_id: safeProject,
        line_id: lineId,
        stage_count: dag.length,
        mod_count: dag.reduce((n, s) => n + s.mods.length, 0),
        dag,
        params_override_keys: overrideKeys,
        untunable_override_keys: untunable,
      });
    },

    dispatch_and_poll_dag({ work_order_id: workOrderId, lease_id: leaseId }) {
      const record = workOrderReader(workOrderId);
      if (!record) {
        throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.NOT_FOUND, `工单不存在: ${workOrderId}`);
      }
      const meta = record.meta || {};
      const receipt = record.receipt || null;
      return capResult({
        work_order_id: workOrderId,
        lease_bound: Boolean(leaseId),
        status: meta.status || 'unknown',
        approved: Boolean(meta.approved),
        stage_events: Array.isArray(receipt?.stages)
          ? receipt.stages.slice(0, 12).map((s) => ({ stage: s.stage, status: s.status }))
          : [],
        acceptance_passed: Boolean(receipt?.acceptance?.passed),
        memory_limit_gb: Number(receipt?.summary?.memory_limit_gb ?? 6.5),
        failure_stage: receipt?.failure_stage ?? null,
      });
    },

    read_step_metrics({ project_id: projectId, mod_id: modId }) {
      const safeProject = assertSegment(projectId, 'project_id');
      const safeMod = assertSegment(modId, 'mod_id');
      const file = resolveInside(workspaceRoot, safeProject, 'metrics', `${safeMod}.metrics.json`);
      if (!fs.existsSync(file)) {
        throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.NOT_FOUND, `指标卡不存在: ${safeProject}/${safeMod}`);
      }
      const stat = fs.statSync(file);
      if (stat.size >= MAX_METRICS_BYTES) {
        throw new PiBridgeError(
          PI_BRIDGE_ERROR_CODES.METRICS_INVALID,
          `指标卡 ${stat.size} 字节超过 ${MAX_METRICS_BYTES} 上限，拒绝回灌上下文`,
        );
      }
      let card = null;
      try {
        card = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (error) {
        throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.METRICS_INVALID, `指标卡无法解析: ${error.message}`);
      }
      const verdict = validateStepMetrics(card, { registeredModIds: getRegisteredModIds() });
      if (!verdict.ok) {
        throw new PiBridgeError(
          PI_BRIDGE_ERROR_CODES.METRICS_INVALID,
          `指标卡不符合 ${STEP_METRICS_SCHEMA_VERSION}: ${verdict.errors.join('；')}`,
          { errors: verdict.errors },
        );
      }
      return capResult(card);
    },

    remediate_step_param({ work_order_id: workOrderId, mod_id: modId, param_key: paramKey, new_value: newValue, reason }) {
      const compoundKey = `${modId}.${paramKey}`;
      const spec = TUNABLE_PARAMS[compoundKey];
      if (!spec) {
        throw new PiBridgeError(
          PI_BRIDGE_ERROR_CODES.PARAM_NOT_TUNABLE,
          `参数 '${compoundKey}' 不在受控可调表内（模型不得自行放宽分析假设）`,
        );
      }
      if (typeof newValue !== 'number' || !Number.isFinite(newValue)) {
        throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.PARAMS_INVALID, 'new_value 必须是有限数字');
      }
      if (newValue < spec.min || newValue > spec.max) {
        throw new PiBridgeError(
          PI_BRIDGE_ERROR_CODES.PARAM_OUT_OF_BOUNDS,
          `参数 '${compoundKey}' 取值 ${newValue} 越界，允许区间 [${spec.min}, ${spec.max}] ${spec.unit || ''}`,
          { min: spec.min, max: spec.max },
        );
      }
      const entry = {
        kind: 'pi_param_remediation',
        action: 'remediate_step_param',
        detail: {
          work_order_id: workOrderId,
          mod_id: modId,
          param_key: paramKey,
          new_value: newValue,
          bounds: [spec.min, spec.max],
          reason: String(reason || '').slice(0, 400),
          actor: 'pi_cli',
        },
      };
      ledgerAppend(entry);
      return capResult({
        ok: true,
        applied: false,
        reason: 'RECORDED_PENDING_RERUN',
        message: '参数调整已记入台账；实际生效需重新排队该步骤，模型不得直接改母版',
        compound_key: compoundKey,
        new_value: newValue,
      });
    },

    build_and_verify_report({ project_id: projectId, narrative_payload_json: payload }) {
      const safeProject = assertSegment(projectId, 'project_id');
      if (!narrativeVerifier) {
        throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.CONTRACT_DENY, '报告核验器未接入（fail-closed）');
      }
      const cards = Array.isArray(payload?.metrics_cards) ? payload.metrics_cards : [];
      for (const card of cards) {
        const verdict = validateStepMetrics(card, { registeredModIds: getRegisteredModIds() });
        if (!verdict.ok) {
          throw new PiBridgeError(
            PI_BRIDGE_ERROR_CODES.METRICS_INVALID,
            `报告引用的指标卡不合规 (${card?.mod_id || 'unknown'}): ${verdict.errors.join('；')}`,
          );
        }
      }
      const verdict = narrativeVerifier({
        projectId: safeProject,
        narrative: String(payload?.narrative || ''),
        metricsCards: cards,
        figureAllowlistPath,
      });
      if (!verdict.ok) {
        return capResult({
          ok: false,
          signable: false,
          code: PI_BRIDGE_ERROR_CODES.NARRATIVE_HALLUCINATION,
          reason: verdict.reason,
          unbounded_metrics: verdict.unboundedMetrics || [],
          unresolved_slots: verdict.unresolvedSlots || [],
          unready_figures: verdict.unreadyFigures || [],
        });
      }
      return capResult({
        ok: true,
        signable: true,
        slot_count: verdict.slotCount,
        figure_count: verdict.figureCount,
        audit: verdict.audit,
      });
    },

    propose_adaptation: runProposeAdaptation,
    run_validation: runValidation,
    dispatch_step: dispatchStep,
  };

  /**
   * 统一入口：校验 → 执行 → 返回。任何越权都抛 PiBridgeError，调用方按 fail-closed 处理。
   */
  function invoke(toolName, params = {}) {
    validateToolParams(toolName, params);
    const executor = executors[toolName];
    if (!executor) {
      throw new PiBridgeError(PI_BRIDGE_ERROR_CODES.TOOL_NOT_ALLOWED, `工具 '${toolName}' 没有实现`);
    }
    const recordDenied = (error) => {
      if (error instanceof PiBridgeError) {
        ledgerAppend({
          kind: 'pi_tool_denied',
          action: 'invoke_tool',
          detail: { tool: toolName, code: error.code, message: error.message },
        });
      }
      return error;
    };
    try {
      const result = executor(params);
      // run_validation / dispatch_step 是 async：拒绝会走 rejection 分支，留痕必须同样落账。
      if (result && typeof result.then === 'function') {
        return result.catch((error) => {
          throw recordDenied(error);
        });
      }
      return result;
    } catch (error) {
      throw recordDenied(error);
    }
  }

  /**
   * 阶段级受控调用：先查阶段白名单，再走统一参数校验与执行器。
   * 宿主 Tool-Loop 只允许走这个入口，避免模型直接 invoke 越权。
   */
  function executeToolCall(stage, toolName, args = {}) {
    const allowed = STAGE_TOOL_ALLOWLIST[stage] || [];
    if (!allowed.includes(toolName)) {
      throw new PiBridgeError(
        PI_BRIDGE_ERROR_CODES.TOOL_NOT_ALLOWED,
        `阶段 ${stage} 不允许调用工具 ${toolName}`,
      );
    }
    return invoke(toolName, args);
  }

  return { invoke, executeToolCall, executors, toolNames: ALLOWED_TOOL_NAMES };
}

/** 供 tools_manifest.json 与声明面双向比对使用的机器可读快照。 */
export function describeToolManifest() {
  return {
    schema_version: 'pi_tools_manifest/v1',
    tool_count: ALLOWED_TOOL_NAMES.length,
    tools: ALLOWED_TOOL_NAMES.map((name) => ({
      tool_name: name,
      description: TOOL_DEFINITIONS[name].description,
      read_only: TOOL_DEFINITIONS[name].readOnly,
      params: TOOL_DEFINITIONS[name].params,
    })),
    denied_capabilities: ['shell', 'powershell', 'fs.read', 'fs.write', 'network', 'process.spawn'],
  };
}
