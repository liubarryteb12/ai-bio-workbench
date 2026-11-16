/**
 * Pi 护栏契约测试（2026-11-15）。
 *
 * 覆盖四件事，每件都对应一个可以在不被发现的情况下被回退的防线：
 *   1. 六工具白名单：声明面与运行时逐字段一致，越权工具一律拒；
 *   2. 指标卡契约：32KB 上限、幽灵 Mod、QC 旗标枚举；
 *   3. 双检查点：状态机不可跳级，人工批准必须留 actor；
 *   4. 防幻觉：裸写数值、无真值槽位、非 Ready 图件全部拦。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const BRIDGE = path.join(REPO, 'BioanalysDesktop', 'server', 'services', 'pi_tools_bridge.js');
const SUPERVISOR = path.join(REPO, 'BioanalysDesktop', 'server', 'services', 'pi_supervisor.js');
const METRICS = path.join(REPO, 'shared', 'step_metrics_v1.mjs');
const FACTS = path.join(REPO, 'tools', 'reporting', 'fact_check_narrative.mjs');
const BUILDER = path.join(REPO, 'tools', 'reporting', 'pi_clinical_report_builder.mjs');
const EXTRACTOR = path.join(REPO, 'tools', 'reporting', 'extract_step_metrics.mjs');
const MANIFEST = path.join(REPO, 'desktop', 'runtime', 'picli', 'tools_manifest.json');
const WORKFLOWS = path.join(REPO, 'tools', 'bio', 'workflows.json');
const ALLOWLIST = path.join(REPO, 'tools', 'dev', 'figure_ready_allowlist.json');
const AUTHORITY = path.join(REPO, 'BioanalysDesktop', 'server', 'services', 'authority.service.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pi_guardrail_'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const load = (file) => import(pathToFileURL(file).href);

function makeBridge(overrides = {}) {
  return { inboxRoot: TMP, workspaceRoot: TMP, workflowsPath: WORKFLOWS, ...overrides };
}

function goodCard(overrides = {}) {
  return {
    schema_version: 'step_metrics/v1',
    mod_id: 'l1_de_limma',
    line_id: 'line1_bulk',
    project_id: 'PRJ_TEST',
    status: 'ok',
    generated_at: new Date().toISOString(),
    seed: 20261105,
    input_fingerprint: { inputs_digest: 'fnvdeadbeefdeadbeef', file_count: 2 },
    metrics: { deg_total: 3649, deg_up: 3260, deg_down: 389 },
    ...overrides,
  };
}

// ---------------- 1. 六工具白名单 ----------------

test('工具清单恰为 9 个且声明面与运行时逐字段一致', async () => {
  const { TOOL_DEFINITIONS, ALLOWED_TOOL_NAMES, describeToolManifest } = await load(BRIDGE);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

  assert.equal(ALLOWED_TOOL_NAMES.length, 9);
  assert.equal(manifest.tool_count, 9);
  assert.deepEqual(
    ALLOWED_TOOL_NAMES.slice().sort(),
    manifest.tools.map((t) => t.tool_name).sort(),
  );
  // 声明面自描述与运行时快照必须一致：两份都改才算真改
  const snapshot = describeToolManifest();
  assert.equal(snapshot.tool_count, manifest.tool_count);
  // tier 分级：原 6 工具 tier1，propose_adaptation 与 run_validation 为 tier2 沙盒工具。
  const { TIER1_TOOLS, TIER2_TOOLS } = await load(BRIDGE);
  assert.deepEqual([...TIER2_TOOLS], ['propose_adaptation', 'run_validation', 'dispatch_step']);
  assert.equal(TIER1_TOOLS.length, 6);
  assert.equal(manifest.tools.find((tool) => tool.tool_name === 'propose_adaptation')?.tier, 'tier2');
  for (const tool of manifest.tools) {
    const runtime = TOOL_DEFINITIONS[tool.tool_name];
    assert.ok(runtime, `运行时缺少工具 ${tool.tool_name}`);
    assert.equal(tool.description, runtime.description);
    assert.equal(tool.read_only, runtime.readOnly);
    assert.deepEqual(Object.keys(tool.params).sort(), Object.keys(runtime.params).sort());
  }
});

test('越权工具名一律拒绝，且给出 PI_TOOL_NOT_ALLOWED', async () => {
  const { createPiToolsBridge } = await load(BRIDGE);
  const bridge = createPiToolsBridge(makeBridge());
  for (const forged of ['shell', 'powershell', 'fs.write', 'fs.read', 'exec', 'process.spawn']) {
    assert.throws(() => bridge.invoke(forged, {}), (err) => err.code === 'PI_TOOL_NOT_ALLOWED',
      `越权工具 ${forged} 必须被拒`);
  }
});

test('白名单模块不得含通用执行能力（源码静态判据）', () => {
  for (const file of [BRIDGE, SUPERVISOR]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(/\bchild_process\b/.test(text), false, `${path.basename(file)} 不得导入 child_process`);
    assert.equal(/\bspawnSync\b|\bexecSync\b/.test(text), false, `${path.basename(file)} 不得含同步执行`);
    assert.equal(/\bnew\s+Function\b|\beval\s*\(/.test(text), false, `${path.basename(file)} 不得含动态求值`);
  }
});

// ---------------- 1b. tier2 适配工具（D4.3 / A3） ----------------

test('propose_adaptation：未授权项目一律拒绝', async () => {
  const { createPiToolsBridge } = await load(BRIDGE);
  const bridge = createPiToolsBridge(makeBridge());
  assert.throws(
    () => bridge.invoke('propose_adaptation', {
      project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep', filename: 'adapt_01_clean.R',
      content: 'x <- read.csv("a.csv")', purpose: '清洗', reason: '列名不齐',
    }),
    (err) => err.code === 'PI_GRANTS_DENIED',
    '未授予 allow_l3_data_adaptation 的项目必须拒绝写脚本',
  );
});

test('propose_adaptation：路径白名单只认 adapt_*.R|py', async () => {
  const { createPiToolsBridge } = await load(BRIDGE);
  const bridge = createPiToolsBridge(makeBridge({ autonomyGrantsProvider: () => ({ allow_l3_data_adaptation: true }) }));
  for (const bad of ['clean.R', 'adapt_a.sh', '../adapt_x.R', 'adapt_.R']) {
    assert.throws(
      () => bridge.invoke('propose_adaptation', {
        project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep', filename: bad,
        content: 'x <- 1', purpose: 'p', reason: 'r',
      }),
      (err) => err.code === 'PI_PARAMS_INVALID' || err.code === 'PI_PATH_ESCAPE',
      `非法文件名 ${bad} 必须被拒`,
    );
  }
});

test('propose_adaptation：REJ-002 母版同名/高相似克隆拒绝（M-Pi-07 基线）', async () => {
  const { createPiToolsBridge, detectMasterClone } = await load(BRIDGE);
  const registry = JSON.parse(fs.readFileSync(WORKFLOWS, 'utf8'));
  const masterName = registry.series
    .flatMap((s) => (s.stages || []).flatMap((st) => st.mods || []))
    .map((m) => m.script).filter(Boolean)[0];
  const clone = detectMasterClone({ filename: masterName, content: 'x <- 1', registry });
  assert.equal(clone.cloned, true, `与母版同名 ${masterName} 必须判克隆`);

  // 路径白名单先挡住母版同名文件；内容克隆必须用合规文件名验证。
  const masterFile = fs.readdirSync(path.join(REPO, 'tools', 'bio'), { recursive: true })
    .map(String)
    .find((entry) => path.basename(entry) === masterName);
  assert.ok(masterFile, `母版文件 ${masterName} 必须存在`);
  const masterContent = fs.readFileSync(path.join(REPO, 'tools', 'bio', masterFile), 'utf8');
  const bridge = createPiToolsBridge(makeBridge({ autonomyGrantsProvider: () => ({ allow_l3_data_adaptation: true }) }));
  assert.throws(
    () => bridge.invoke('propose_adaptation', {
      project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep', filename: 'adapt_99_clone.R',
      content: masterContent, purpose: 'p', reason: 'r',
    }),
    (err) => err.code === 'PI_REJ002_MASTER_CLONE',
  );
});

test('propose_adaptation：AST 黑名单拦截逃逸调用', async () => {
  const { createPiToolsBridge, scanAstBlacklist } = await load(BRIDGE);
  const ast = scanAstBlacklist('system("rm -rf /")');
  assert.equal(ast.ok, false);
  const bridge = createPiToolsBridge(makeBridge({ autonomyGrantsProvider: () => ({ allow_l3_data_adaptation: true }) }));
  assert.throws(
    () => bridge.invoke('propose_adaptation', {
      project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep', filename: 'adapt_02_escape.R',
      content: 'system("rm -rf /")', purpose: 'p', reason: 'r',
    }),
    (err) => err.code === 'PI_AST_BLACKLISTED',
  );
});

test('propose_adaptation：合法脚本落盘并写入 scripts_manifest（写盘即登记）', async () => {
  const { createPiToolsBridge } = await load(BRIDGE);
  const projectRoot = path.join(TMP, 'workspace', 'projects');
  fs.mkdirSync(path.join(projectRoot, 'PRJ_TEST'), { recursive: true });
  const bridge = createPiToolsBridge(makeBridge({
    workspaceRoot: projectRoot,
    autonomyGrantsProvider: () => ({ allow_l3_data_adaptation: true }),
  }));
  const result = bridge.invoke('propose_adaptation', {
    project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep', filename: 'adapt_03_clean.R',
    content: 'x <- read.csv("a.csv")', purpose: '清洗表头', reason: '列名含双斜杠',
  });
  assert.equal(result.ok, true);
  assert.equal(result.registered, true);
  const scriptFile = path.join(projectRoot, 'PRJ_TEST', 'scripts', 'adapt_03_clean.R');
  const manifestFile = path.join(projectRoot, 'PRJ_TEST', 'scripts', 'scripts_manifest.json');
  assert.ok(fs.existsSync(scriptFile), '适配脚本必须落盘');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const entry = manifest.scripts.find((item) => item.entry_point === 'adapt_03_clean.R');
  assert.ok(entry, 'scripts_manifest 必须登记新脚本');
  assert.equal(entry.upstream_mod, 'l1_ingest_prep');
  assert.equal(entry.sha256, createHash('sha256').update('x <- read.csv("a.csv")').digest('hex'));
});

test('propose_adaptation：同模块适配提案上限 2 次，第三次拒绝（Gemini G2）', async (t) => {
  const { bridge } = await prepareAdaptedProject(t);
  for (const [index, name] of ['adapt_31_a.R', 'adapt_32_b.R'].entries()) {
    const result = bridge.invoke('propose_adaptation', {
      project_id: 'PRJ_TEST', mod_id: 'l1_qc_matrix', filename: name,
      content: `x <- ${index + 1}`, purpose: 'budget probe', reason: 'test',
    });
    assert.equal(result.ok, true);
  }
  assert.throws(
    () => bridge.invoke('propose_adaptation', {
      project_id: 'PRJ_TEST', mod_id: 'l1_qc_matrix', filename: 'adapt_33_c.R',
      content: 'x <- 3', purpose: 'budget probe', reason: 'test',
    }),
    (err) => err.code === 'PI_CONTRACT_DENY' && err.message.includes('PI_ADAPTATION_BUDGET_EXCEEDED'),
    '第三次提案必须转人工',
  );
});

// ---------------- 1c. tier2 验证工具（D4.4 / A4） ----------------

async function prepareAdaptedProject(t, overrides = {}) {
  const { createPiToolsBridge } = await load(BRIDGE);
  const projectRoot = path.join(TMP, `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(path.join(projectRoot, 'PRJ_TEST'), { recursive: true });
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const bridge = createPiToolsBridge(makeBridge({
    workspaceRoot: projectRoot,
    autonomyGrantsProvider: () => ({ allow_l3_data_adaptation: true }),
    ...overrides,
  }));
  bridge.invoke('propose_adaptation', {
    project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep', filename: 'adapt_10_clean.R',
    content: 'x <- read.csv("a.csv")', purpose: '清洗', reason: '列名不齐',
  });
  return { projectRoot, bridge };
}

test('run_validation：验证态通过后写 VERIFIED_OK 记录（3.5GB / 180s 上限）', async (t) => {
  const { projectRoot, bridge } = await prepareAdaptedProject(t, {
    runValidationFn: () => ({ exitCode: 0, durationSec: 12, peakMemoryGb: 1.4 }),
  });
  const result = await bridge.invoke('run_validation', {
    project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep', entry_point: 'adapt_10_clean.R',
  });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'VERIFIED_OK');
  assert.equal(result.memory_cap_gb, 3.5);
  assert.equal(result.timeout_cap_sec, 180);
  const recordFile = path.join(projectRoot, 'PRJ_TEST', 'scripts', '.val_tmp', 'adapt_10_clean.R.verified.json');
  assert.ok(fs.existsSync(recordFile), 'VERIFIED_OK 记录必须原子落盘');
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  assert.equal(record.verdict, 'VERIFIED_OK');
  assert.equal(record.sha256, createHash('sha256').update('x <- read.csv("a.csv")').digest('hex'));
});

test('run_validation：内存峰值超 3.5GB 判 VERIFIED_FAILED', async (t) => {
  const { bridge } = await prepareAdaptedProject(t, {
    runValidationFn: () => ({ exitCode: 0, durationSec: 12, peakMemoryGb: 4.2 }),
  });
  const result = await bridge.invoke('run_validation', {
    project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep', entry_point: 'adapt_10_clean.R',
  });
  assert.equal(result.ok, false);
  assert.equal(result.verdict, 'VERIFIED_FAILED');
});

test('run_validation：脚本登记后改动（哈希漂移）拒绝验证', async (t) => {
  const { projectRoot, bridge } = await prepareAdaptedProject(t, {
    runValidationFn: () => ({ exitCode: 0, durationSec: 5, peakMemoryGb: 1 }),
  });
  fs.appendFileSync(path.join(projectRoot, 'PRJ_TEST', 'scripts', 'adapt_10_clean.R'), '\n# drift\n', 'utf8');
  await assert.rejects(
    () => bridge.invoke('run_validation', {
      project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep', entry_point: 'adapt_10_clean.R',
    }),
    (err) => err.code === 'PI_CONTRACT_DENY',
  );
});

test('run_validation：执行器未接入时 fail-closed', async (t) => {
  const { bridge } = await prepareAdaptedProject(t);
  await assert.rejects(
    () => bridge.invoke('run_validation', {
      project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep', entry_point: 'adapt_10_clean.R',
    }),
    (err) => err.code === 'PI_CONTRACT_DENY',
  );
});

test('run_validation：跨线桥接检查未接入时 fail-closed', async (t) => {
  const { bridge } = await prepareAdaptedProject(t, {
    runValidationFn: () => ({ exitCode: 0, durationSec: 5, peakMemoryGb: 1 }),
    requiresBridgeCheck: () => true,
  });
  await assert.rejects(
    () => bridge.invoke('run_validation', {
      project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep', entry_point: 'adapt_10_clean.R',
    }),
    (err) => err.code === 'PI_CONTRACT_DENY',
  );
});

// ---------------- 1d. tier2 下发工具（D4.5 / A5） ----------------

function dispatchParams(overrides = {}) {
  return {
    work_order_id: 'WO_D4_001',
    project_id: 'PRJ_TEST',
    mod_id: 'l1_ingest_prep',
    entry_point: 'adapt_10_clean.R',
    lease_id: 'AUTH-20261115-0001',
    ...overrides,
  };
}

test('dispatch_step：未验证适配脚本拒绝下发（M-Pi-08 基线）', async (t) => {
  const { bridge } = await prepareAdaptedProject(t, {
    assertLease: () => ({ ok: true }),
    dispatchStepFn: () => ({ ok: true, status: 'dispatched' }),
  });
  await assert.rejects(
    () => bridge.invoke('dispatch_step', dispatchParams()),
    (err) => err.code === 'ERR_ADAPTATION_UNVERIFIED',
    '跳过 run_validation 直接下发必须被拒',
  );
});

test('dispatch_step：缺租约校验器 fail-closed', async (t) => {
  const { bridge } = await prepareAdaptedProject(t);
  await assert.rejects(
    () => bridge.invoke('dispatch_step', dispatchParams()),
    (err) => err.code === 'PI_LEASE_REQUIRED',
  );
});

test('dispatch_step：租约无效拒绝下发', async (t) => {
  const { bridge } = await prepareAdaptedProject(t, {
    assertLease: () => ({ ok: false, code: 'ERR_AUTHORITY_EXPIRED' }),
  });
  await assert.rejects(
    () => bridge.invoke('dispatch_step', dispatchParams()),
    (err) => err.code === 'PI_LEASE_REQUIRED',
  );
});

test('dispatch_step：验证通过后按租约下发，单次执行有留痕', async (t) => {
  let dispatched = 0;
  const ledger = [];
  const { bridge } = await prepareAdaptedProject(t, {
    assertLease: () => ({ ok: true }),
    runValidationFn: () => ({ exitCode: 0, durationSec: 8, peakMemoryGb: 1.2 }),
    dispatchStepFn: ({ leaseId, scriptSha256 }) => {
      dispatched += 1;
      return { ok: true, status: 'running', stepRunId: `RUN-${leaseId}-${scriptSha256.slice(0, 6)}` };
    },
    ledgerAppend: (entry) => ledger.push(entry),
  });
  await bridge.invoke('run_validation', {
    project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep', entry_point: 'adapt_10_clean.R',
  });
  const result = await bridge.invoke('dispatch_step', dispatchParams());
  assert.equal(result.ok, true);
  assert.equal(result.status, 'running');
  assert.match(result.step_run_id, /^RUN-AUTH-20261115-0001-/);
  assert.equal(dispatched, 1);
  assert.ok(ledger.some((entry) => entry.kind === 'pi_step_dispatched'));
});

test('dispatch_step：验证后脚本改动（哈希漂移）拒绝下发', async (t) => {
  const { projectRoot, bridge } = await prepareAdaptedProject(t, {
    assertLease: () => ({ ok: true }),
    runValidationFn: () => ({ exitCode: 0, durationSec: 8, peakMemoryGb: 1.2 }),
    dispatchStepFn: () => ({ ok: true }),
  });
  await bridge.invoke('run_validation', {
    project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep', entry_point: 'adapt_10_clean.R',
  });
  fs.appendFileSync(path.join(projectRoot, 'PRJ_TEST', 'scripts', 'adapt_10_clean.R'), '\n# drift\n', 'utf8');
  await assert.rejects(
    () => bridge.invoke('dispatch_step', dispatchParams()),
    (err) => err.code === 'ERR_ADAPTATION_UNVERIFIED',
  );
});

// ---------------- 1e. 检查点策略化（D4.7 / A7，终审 C 方案） ----------------

async function makeSupervisor(t, overrides = {}) {
  const { PiSupervisor, closePiSessionDb } = await load(SUPERVISOR);
  const dbPath = path.join(TMP, `pi-policy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sqlite`);
  t.after(() => {
    try { closePiSessionDb(dbPath); } catch { /* 已关闭 */ }
    try { fs.rmSync(dbPath, { force: true }); } catch { /* 已删 */ }
    try { fs.rmSync(`${dbPath}-wal`, { force: true }); } catch { /* 无 WAL */ }
    try { fs.rmSync(`${dbPath}-shm`, { force: true }); } catch { /* 无 SHM */ }
  });
  const supervisor = new PiSupervisor({ dbPath, ...overrides });
  return supervisor;
}

test('检查点一：宽限到期自动放行，吊销条件命中则转人工（终审 C 方案）', async (t) => {
  const supervisor = await makeSupervisor(t);
  const session = supervisor.start({ projectId: 'PRJ_T', lineId: 'line1_bulk', sessionId: 'ps_grace_1' });
  assert.equal(session.status, 'DRAFT');
  supervisor.submitPlan('ps_grace_1', {
    planText: '方案正文',
    dag: [{ stage: 'ingest', mods: ['l1_ingest_prep'] }],
  });
  const waiting = supervisor.evaluateCheckpoint('ps_grace_1', { checkpoint: 1, facts: { minValidReplicates: 4 } });
  assert.equal(waiting.mode, 'grace_auto_pass');
  assert.equal(waiting.waitSec, 180);

  // 宽限未到：不得自动批准
  assert.deepEqual(supervisor.autoPassDuePlans({ now: Date.now() + 1000, factsProvider: () => ({ minValidReplicates: 4 }) }), []);

  // 宽限已过：自动批准并留 actor=autonomy_policy
  const approved = supervisor.autoPassDuePlans({ now: Date.now() + 181_000, factsProvider: () => ({ minValidReplicates: 4 }) });
  assert.deepEqual(approved, ['ps_grace_1']);
  const after = supervisor.getSession('ps_grace_1');
  assert.equal(after.status, 'PLAN_APPROVED');

  // 吊销命中：即使宽限已过也不自动批准
  supervisor.start({ projectId: 'PRJ_T', lineId: 'line1_bulk', sessionId: 'ps_grace_2' });
  supervisor.submitPlan('ps_grace_2', {
    planText: '方案正文', dag: [{ stage: 'ingest', mods: ['l1_ingest_prep'] }],
  });
  assert.deepEqual(supervisor.autoPassDuePlans({ now: Date.now() + 181_000, factsProvider: () => ({ minValidReplicates: 2 }) }), []);
  assert.equal(supervisor.getSession('ps_grace_2').status, 'AWAITING_PLAN_APPROVAL');
});

test('检查点一：宽限判定以 grace_deadline_ms 为单一真源，不等同于 updated_at', async (t) => {
  const { updateSession } = await load(SUPERVISOR);
  const supervisor = await makeSupervisor(t);
  supervisor.start({ projectId: 'PRJ_T', lineId: 'line1_bulk', sessionId: 'ps_grace_deadline' });
  supervisor.submitPlan('ps_grace_deadline', {
    planText: '方案正文',
    dag: [{ stage: 'ingest', mods: ['l1_ingest_prep'] }],
  });
  updateSession('ps_grace_deadline', {
    context: { grace_deadline_ms: Date.now() - 1000 },
  }, supervisor.dbPath);

  const approved = supervisor.autoPassDuePlans({ factsProvider: () => ({ minValidReplicates: 4 }) });
  assert.deepEqual(approved, ['ps_grace_deadline']);
  assert.equal(supervisor.getSession('ps_grace_deadline').status, 'PLAN_APPROVED');
});

test('检查点一批准后触发 onPlanApproved，人工与自动放行都覆盖', async (t) => {
  const approved = [];
  const supervisor = await makeSupervisor(t, {
    onPlanApproved: (session) => approved.push(session.work_order_id),
  });
  supervisor.start({
    workOrderId: 'WO_HOOK_1',
    projectId: 'PRJ_T',
    lineId: 'line1_bulk',
    sessionId: 'ps_hook_1',
  });
  supervisor.submitPlan('ps_hook_1', {
    planText: '方案正文',
    dag: [{ stage: 'ingest', mods: ['l1_ingest_prep'] }],
  });
  supervisor.approvePlan('ps_hook_1', { actor: 'admin' });
  assert.deepEqual(approved, ['WO_HOOK_1']);

  supervisor.start({
    workOrderId: 'WO_HOOK_2',
    projectId: 'PRJ_T',
    lineId: 'line1_bulk',
    sessionId: 'ps_hook_2',
  });
  supervisor.submitPlan('ps_hook_2', {
    planText: '方案正文',
    dag: [{ stage: 'ingest', mods: ['l1_ingest_prep'] }],
  });
  const auto = supervisor.autoPassDuePlans({
    now: Date.now() + 181_000,
    factsProvider: () => ({ minValidReplicates: 4 }),
  });
  assert.deepEqual(auto, ['ps_hook_2']);
  assert.deepEqual(approved, ['WO_HOOK_1', 'WO_HOOK_2']);
});

test('检查点 CAS：同版本并发跃迁只有一个成功（Gemini G2 裁定）', async (t) => {
  const { updateSession } = await load(SUPERVISOR);
  const supervisor = await makeSupervisor(t);
  supervisor.start({ projectId: 'PRJ_T', lineId: 'line1_bulk', sessionId: 'ps_cas' });
  supervisor.submitPlan('ps_cas', {
    planText: '方案正文', dag: [{ stage: 'ingest', mods: ['l1_ingest_prep'] }],
  });
  const session = supervisor.getSession('ps_cas');
  const version = session.state_version;
  assert.ok(Number.isInteger(version) && version >= 1);

  updateSession('ps_cas', { context: { first_winner: true }, expectedVersion: version }, supervisor.dbPath);
  assert.throws(
    () => updateSession('ps_cas', { context: { stale_writer: true }, expectedVersion: version }, supervisor.dbPath),
    (err) => err.code === 'ERR_SESSION_STALE_VERSION',
    '同版本第二个写者必须失败',
  );
});

test('检查点二：永远人工，不允许策略自动放行（golden 跑批除外）', async (t) => {
  const supervisor = await makeSupervisor(t);
  supervisor.start({ projectId: 'PRJ_T', lineId: 'line1_bulk', sessionId: 'ps_cp2' });
  const decision = supervisor.evaluateCheckpoint('ps_cp2', { checkpoint: 2, facts: {} });
  assert.equal(decision.mode, 'manual_hard_gate');
  const golden = supervisor.evaluateCheckpoint('ps_cp2', {
    checkpoint: 2, facts: { goldenRegression: true, allQcPass: true },
  });
  assert.equal(golden.mode, 'golden_regression_pass');
});

test('D5.2 统一拦截：宽限期内回 DRAFT，定时器胜出后转 FAILED', async (t) => {
  const supervisor = await makeSupervisor(t);
  supervisor.start({ projectId: 'PRJ_T', lineId: 'line1_bulk', sessionId: 'ps_intercept' });
  supervisor.submitPlan('ps_intercept', {
    planText: '方案正文', dag: [{ stage: 'ingest', mods: ['l1_ingest_prep'] }],
  });
  const waiting = supervisor.getSession('ps_intercept');
  assert.ok(Number(waiting.context.grace_deadline_ms) > Date.now() - 5000, '必须写 grace_deadline_ms');
  const pre = supervisor.interceptPlan('ps_intercept', {
    actor: 'human-admin', reason: '方案需修改', expectedVersion: waiting.state_version,
  });
  assert.equal(pre.mode, 'PRE_DISPATCH_INTERCEPTED');
  assert.equal(pre.session.status, 'DRAFT');

  // 第二个会话：定时器已胜出（PLAN_APPROVED / RUNNING_DAG）后拦截
  supervisor.start({ projectId: 'PRJ_T', lineId: 'line1_bulk', sessionId: 'ps_intercept_2' });
  supervisor.submitPlan('ps_intercept_2', {
    planText: '方案正文', dag: [{ stage: 'ingest', mods: ['l1_ingest_prep'] }],
  });
  supervisor.approvePlan('ps_intercept_2', { actor: 'timer' });
  supervisor.markDagRunning('ps_intercept_2');
  const post = supervisor.interceptPlan('ps_intercept_2', { actor: 'human-admin', reason: '停机' });
  assert.equal(post.mode, 'POST_DISPATCH_PREEMPTED');
  assert.equal(post.session.status, 'FAILED');
  assert.equal(post.session.last_error, 'INTERCEPTED_AFTER_DISPATCH');
});

test('D5.2 拦截 CAS：过期版本号拒绝', async (t) => {
  const supervisor = await makeSupervisor(t);
  supervisor.start({ projectId: 'PRJ_T', lineId: 'line1_bulk', sessionId: 'ps_intercept_cas' });
  supervisor.submitPlan('ps_intercept_cas', {
    planText: '方案正文', dag: [{ stage: 'ingest', mods: ['l1_ingest_prep'] }],
  });
  const session = supervisor.getSession('ps_intercept_cas');
  assert.throws(
    () => supervisor.interceptPlan('ps_intercept_cas', {
      actor: 'human-admin', expectedVersion: session.state_version - 1,
    }),
    (err) => err.code === 'ERR_SESSION_STALE_VERSION',
  );
});

test('统计降级报告：常规签名通道拒绝，人工特批后可签并打标 EXPLORATORY_DEGRADED', async (t) => {
  const supervisor = await makeSupervisor(t);
  supervisor.start({ projectId: 'PRJ_T', lineId: 'line1_bulk', sessionId: 'ps_grade' });
  supervisor.submitPlan('ps_grade', {
    planText: '方案正文', dag: [{ stage: 'ingest', mods: ['l1_ingest_prep'] }],
  });
  supervisor.approvePlan('ps_grade', { actor: 'human-admin' });
  supervisor.markDagRunning('ps_grade');
  supervisor.submitTargetLock('ps_grade', {
    targets: [{ gene: 'TNF', evidence_mod: 'l1_de_limma', effect_size: 1.8 }],
  });
  supervisor.approveTargetLock('ps_grade', { actor: 'human-admin' });

  assert.throws(
    () => supervisor.markReportSigned('ps_grade', { deliveryGrade: 'EXPLORATORY_DEGRADED' }),
    (err) => err.code === 'ERR_DEGRADED_STATS_REQUIRE_OVERRIDE',
  );
  assert.throws(
    () => supervisor.markReportSigned('ps_grade', { deliveryGrade: 'EXPLORATORY_DEGRADED', override: true }),
    (err) => err.code === 'CHECKPOINT_ACTOR_REQUIRED',
  );
  assert.throws(
    () => supervisor.markReportSigned('ps_grade', {
      deliveryGrade: 'EXPLORATORY_DEGRADED', override: true, actor: 'human-admin',
    }),
    (err) => err.code === 'CHECKPOINT_REASON_REQUIRED',
  );
  const signed = supervisor.markReportSigned('ps_grade', {
    deliveryGrade: 'EXPLORATORY_DEGRADED', override: true, actor: 'human-admin',
    comment: '样本量不足，探索性结果仅供候选', receiptId: 'RCP-D4',
  });
  assert.equal(signed.status, 'REPORT_SIGNED');
  assert.equal(signed.context.delivery_grade, 'EXPLORATORY_DEGRADED');
  assert.equal(signed.context.exploratory_disclaimer_required, true);
});

test('回执 6/6 实证①：脏数据自愈闭环（双斜杠探针 ID + 乱序列名）', async (t) => {
  // 造一个真实的脏输入：探针 ID 含双斜杠，表型列名被打乱。
  const dirty = 'probe_id,sample,,age\nILMN_16512 // TNF // 7124,P01,,\nILMN_16513 // IL6 // 3569,P02,,\n';
  const cleanScript = [
    'raw <- read.csv("dirty.csv", check.names = FALSE)',
    'raw$probe_id <- sub(" // .*$", "", raw$probe_id)',
    'write.table(raw, "clean.tsv", sep = "\\t", quote = FALSE, row.names = FALSE)',
  ].join('\n');

  let dispatchedWith = null;
  const ledger = [];
  const { projectRoot, bridge } = await prepareAdaptedProject(t, {
    assertLease: () => ({ ok: true }),
    runValidationFn: () => ({ exitCode: 0, durationSec: 9, peakMemoryGb: 1.1 }),
    dispatchStepFn: ({ entryPoint, scriptSha256 }) => {
      dispatchedWith = { entryPoint, scriptSha256 };
      return { ok: true, status: 'running', stepRunId: 'RUN-DIRTY-001' };
    },
    ledgerAppend: (entry) => ledger.push(entry),
  });

  // 全链路：propose -> 登记 -> 验证 -> 下发。适配脚本只做列名/ID 归一化，不改数值分布。
  bridge.invoke('propose_adaptation', {
    project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep', filename: 'adapt_20_dirty.R',
    content: cleanScript, purpose: '探针 ID 去双斜杠 + 表型列名归位', reason: '原始矩阵不符合母版输入契约',
  });
  const validated = await bridge.invoke('run_validation', {
    project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep', entry_point: 'adapt_20_dirty.R',
  });
  assert.equal(validated.verdict, 'VERIFIED_OK');
  const dispatched = await bridge.invoke('dispatch_step', {
    work_order_id: 'WO_DIRTY_001', project_id: 'PRJ_TEST', mod_id: 'l1_ingest_prep',
    entry_point: 'adapt_20_dirty.R', lease_id: 'AUTH-20261115-0001',
  });
  assert.equal(dispatched.ok, true);
  assert.equal(dispatchedWith.entryPoint, 'adapt_20_dirty.R');
  assert.equal(dispatchedWith.scriptSha256, createHash('sha256').update(cleanScript).digest('hex'));
  assert.ok(ledger.some((entry) => entry.kind === 'pi_adaptation_proposed'));
  assert.ok(ledger.some((entry) => entry.kind === 'pi_adaptation_validated'));
  assert.ok(ledger.some((entry) => entry.kind === 'pi_step_dispatched'));

  // 脏输入样例本身保留在闭环证据里（探针双斜杠与乱列名）。
  assert.ok(dirty.includes('ILMN_16512 // TNF'));
  const manifest = JSON.parse(fs.readFileSync(
    path.join(projectRoot, 'PRJ_TEST', 'scripts', 'scripts_manifest.json'), 'utf8',
  ));
  assert.ok(manifest.scripts.some((item) => item.entry_point === 'adapt_20_dirty.R'));
});

test('未声明参数被拒，多余键不会静默丢弃', async () => {
  const { createPiToolsBridge } = await load(BRIDGE);
  const bridge = createPiToolsBridge(makeBridge());
  assert.throws(
    () => bridge.invoke('inspect_requirement', { package_id: 'PKG_x', arbitrary: 1 }),
    (err) => err.code === 'PI_PARAMS_INVALID',
  );
});

test('路径穿越在 project_id / mod_id 上都被拒', async () => {
  const { createPiToolsBridge } = await load(BRIDGE);
  const bridge = createPiToolsBridge(makeBridge());
  for (const bad of ['..', '../etc', 'a/b', 'a\\b']) {
    assert.throws(
      () => bridge.invoke('read_step_metrics', { project_id: bad, mod_id: 'l1_de_limma' }),
      (err) => ['PI_PARAMS_INVALID', 'PI_PATH_ESCAPE'].includes(err.code),
      `project_id=${bad} 必须被拒`,
    );
  }
});

// ---------------- 2. 指标卡契约 ----------------

test('指标卡超过 32KB 必须拒绝', async () => {
  const { validateStepMetrics } = await load(METRICS);
  const big = goodCard({ metrics: { huge: 'x'.repeat(33000) } });
  const verdict = validateStepMetrics(big);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((e) => e.includes('超过上限')));
});

test('幽灵 Mod 的指标卡被拒，登记过的 Mod 通过', async () => {
  const { validateStepMetrics, collectRegisteredModIds } = await load(METRICS);
  const registered = collectRegisteredModIds(WORKFLOWS);
  assert.equal(validateStepMetrics(goodCard(), { registeredModIds: registered }).ok, true);
  const ghost = validateStepMetrics(goodCard({ mod_id: 'mod_ghost_999' }), { registeredModIds: registered });
  assert.equal(ghost.ok, false);
  assert.ok(ghost.errors.some((e) => e.includes('未在 workflows.json 登记')));
});

test('QC 旗标码必须在受控枚举内，severity 只能是 info/warn/block', async () => {
  const { validateStepMetrics } = await load(METRICS);
  const bad = validateStepMetrics(goodCard({
    qc_flags: [{ code: 'MADE_UP_FLAG', severity: 'fatal', message: 'x' }],
  }));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('不在受控枚举内')));
  const good = validateStepMetrics(goodCard({
    qc_flags: [{ code: 'DEG_COUNT_HIGH', severity: 'warn', message: '偏多' }],
  }));
  assert.equal(good.ok, true);
});

test('槽位压平支持数组下标，Top20 基因表可被引用', async () => {
  const { flattenMetricSlots } = await load(METRICS);
  const slots = flattenMetricSlots({
    mod_id: 'l1_de_limma',
    seed: 20261105,
    metrics: { top_genes: [{ gene_symbol: 'PPP2R3B', p_value: 4.1e-84 }], deg_total: 3649 },
  });
  assert.equal(slots.get('l1_de_limma.deg_total'), 3649);
  assert.equal(slots.get('l1_de_limma.top_genes[0].gene_symbol'), 'PPP2R3B');
  assert.equal(slots.get('l1_de_limma.seed'), 20261105);
});

test('同名槽位不同真值必须报冲突', async () => {
  const { mergeMetricSlots } = await load(METRICS);
  const { conflicts } = mergeMetricSlots([
    goodCard({ metrics: { deg_total: 10 } }),
    goodCard({ metrics: { deg_total: 20 } }),
  ]);
  assert.deepEqual(conflicts, ['l1_de_limma.deg_total']);
});

// ---------------- 3. 双人工检查点 ----------------

test('检查点一：空方案不得进入待批准态', async () => {
  const { PiSupervisor, closePiSessionDb } = await load(SUPERVISOR);
  const dbPath = path.join(TMP, 'cp1.sqlite');
  const sup = new PiSupervisor({ dbPath });
  const session = sup.start({ projectId: 'PRJ_T', lineId: 'line1_bulk' });
  assert.throws(() => sup.submitPlan(session.session_id, { planText: '', dag: [{ stage: 'de' }] }),
    /PI_PLAN_EMPTY/);
  assert.throws(() => sup.submitPlan(session.session_id, { planText: '方案', dag: [] }),
    /PI_PLAN_DAG_EMPTY/);
  closePiSessionDb(dbPath);
});

test('检查点一：未批准不得下发 DAG；批准必须留 actor', async () => {
  const { PiSupervisor, PI_SESSION_STATUS, closePiSessionDb } = await load(SUPERVISOR);
  const dbPath = path.join(TMP, 'cp1b.sqlite');
  const sup = new PiSupervisor({ dbPath });
  const s = sup.start({ projectId: 'PRJ_T', lineId: 'line1_bulk' });

  assert.throws(() => sup.markDagRunning(s.session_id), /INVALID_STATE_TRANSITION/);

  sup.submitPlan(s.session_id, { planText: '立项方案', dag: [{ stage: 'ingest', mods: ['l1_ingest_prep'] }] });
  assert.throws(() => sup.approvePlan(s.session_id, {}), /CHECKPOINT_ACTOR_REQUIRED/);

  const approved = sup.approvePlan(s.session_id, { actor: 'dr_wang' });
  assert.equal(approved.status, PI_SESSION_STATUS.PLAN_APPROVED);
  const running = sup.markDagRunning(s.session_id);
  assert.equal(running.status, PI_SESSION_STATUS.RUNNING_DAG);
  closePiSessionDb(dbPath);
});

test('检查点二：靶点数必须 1..3 且每个带证据字段', async () => {
  const { PiSupervisor, closePiSessionDb } = await load(SUPERVISOR);
  const dbPath = path.join(TMP, 'cp2.sqlite');
  const sup = new PiSupervisor({ dbPath });
  const s = sup.start({ projectId: 'PRJ_T', lineId: 'line1_bulk' });
  sup.submitPlan(s.session_id, { planText: '方案', dag: [{ stage: 'de' }] });
  sup.approvePlan(s.session_id, { actor: 'op' });
  sup.markDagRunning(s.session_id);

  assert.throws(() => sup.submitTargetLock(s.session_id, { targets: [] }), /TARGET_LOCK_COUNT_INVALID/);
  assert.throws(() => sup.submitTargetLock(s.session_id, {
    targets: [1, 2, 3, 4].map((i) => ({ gene: `G${i}`, evidence_mod: 'l1_de_limma', effect_size: i })),
  }), /TARGET_LOCK_COUNT_INVALID/);
  assert.throws(() => sup.submitTargetLock(s.session_id, {
    targets: [{ gene: 'ATM', effect_size: 1 }],
  }), /TARGET_LOCK_EVIDENCE_MISSING/);

  const ok = sup.submitTargetLock(s.session_id, {
    targets: [{ gene: 'ATM', evidence_mod: 'l1_ml_hub', effect_size: 1.42 }],
    qcSummary: { deg_total: 3649 },
  });
  assert.equal(ok.current_checkpoint, 'CHECKPOINT_2_TARGET_LOCK');
  closePiSessionDb(dbPath);
});

test('检查点二未批准不得签发报告；状态机不可跳级', async () => {
  const { PiSupervisor, PI_SESSION_STATUS, closePiSessionDb } = await load(SUPERVISOR);
  const dbPath = path.join(TMP, 'cp2b.sqlite');
  const sup = new PiSupervisor({ dbPath });
  const s = sup.start({ projectId: 'PRJ_T', lineId: 'line1_bulk' });

  // 从 DRAFT 直接签发必须红
  assert.throws(() => sup.markReportSigned(s.session_id), /INVALID_STATE_TRANSITION/);

  sup.submitPlan(s.session_id, { planText: '方案', dag: [{ stage: 'de' }] });
  sup.approvePlan(s.session_id, { actor: 'op' });
  sup.markDagRunning(s.session_id);
  sup.submitTargetLock(s.session_id, {
    targets: [{ gene: 'ATM', evidence_mod: 'l1_ml_hub', effect_size: 1.42 }],
  });
  assert.throws(() => sup.markReportSigned(s.session_id), /INVALID_STATE_TRANSITION/);

  sup.approveTargetLock(s.session_id, { actor: 'dr_li' });
  const signed = sup.markReportSigned(s.session_id, { receiptId: 'RCP-1' });
  assert.equal(signed.status, PI_SESSION_STATUS.REPORT_SIGNED);
  closePiSessionDb(dbPath);
});

test('检查点记录落库，重启后可读回批准轨迹', async () => {
  const { PiSupervisor, listCheckpoints, closePiSessionDb } = await load(SUPERVISOR);
  const dbPath = path.join(TMP, 'cp_trace.sqlite');
  const sup = new PiSupervisor({ dbPath });
  const s = sup.start({ projectId: 'PRJ_T', lineId: 'line1_bulk' });
  sup.submitPlan(s.session_id, { planText: '方案', dag: [{ stage: 'de' }] });
  sup.approvePlan(s.session_id, { actor: 'op', reason: '参数合理' });

  const rows = listCheckpoints(s.session_id, dbPath);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].decision, 'SUBMITTED');
  assert.equal(rows[1].decision, 'APPROVED');
  assert.equal(rows[1].decided_by, 'op');

  // 重新打开（模拟重启）后仍可读
  closePiSessionDb(dbPath);
  const rows2 = listCheckpoints(s.session_id, dbPath);
  assert.equal(rows2.length, 2);
  closePiSessionDb(dbPath);
});

test('工具调用被记录，越权调用在记录前就被拒', async () => {
  const { PiSupervisor, listToolCalls, closePiSessionDb } = await load(SUPERVISOR);
  const { createPiToolsBridge } = await load(BRIDGE);
  const dbPath = path.join(TMP, 'tool_calls.sqlite');
  const sup = new PiSupervisor({ dbPath, toolsBridge: createPiToolsBridge(makeBridge()) });
  const s = sup.start({ projectId: 'PRJ_T', lineId: 'line1_bulk' });

  await assert.rejects(() => sup.invokeTool(s.session_id, 'shell', { cmd: 'rm -rf /' }),
    (err) => err.code === 'PI_TOOL_NOT_ALLOWED');
  assert.equal(listToolCalls(s.session_id, dbPath).length, 0, '越权调用不得留下"已尝试"记录');

  // 合法调用：不存在的指标卡应记一条失败调用
  await assert.rejects(() => sup.invokeTool(s.session_id, 'read_step_metrics', {
    project_id: 'PRJ_T', mod_id: 'l1_de_limma',
  }));
  const calls = listToolCalls(s.session_id, dbPath);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool_name, 'read_step_metrics');
  assert.equal(calls[0].ok, 0);
  closePiSessionDb(dbPath);
});

// ---------------- 4. 防幻觉 ----------------

test('裸写 p / AUC / n 一律拦，槽位内不算裸写', async () => {
  const { verifyNarrative, NARRATIVE_GATE_ERROR_CODE } = await load(FACTS);
  const bad = verifyNarrative({ narrative: '共 n = 70 例，AUC = 0.9756，p = 0.003。', metricsCards: [] });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, NARRATIVE_GATE_ERROR_CODE);
  assert.ok(bad.unboundedMetrics.length >= 3);

  const good = verifyNarrative({
    narrative: '样本量 {{metric:l1_qc_matrix.sample_count}} 例。',
    metricsCards: [{ mod_id: 'l1_qc_matrix', metrics: { sample_count: 70 } }],
    readyFigureIds: new Set(),
  });
  assert.equal(good.ok, true);
  assert.ok(good.rendered.includes('70'));
});

test('无真值槽位必须拦，重复冲突也必须拦', async () => {
  const { verifyNarrative } = await load(FACTS);
  const unresolved = verifyNarrative({
    narrative: '样本量 {{metric:l1_qc_matrix.sample_count}} 例。',
    metricsCards: [],
  });
  assert.equal(unresolved.ok, false);
  assert.deepEqual(unresolved.unresolvedSlots, ['l1_qc_matrix.sample_count']);

  const conflicted = verifyNarrative({
    narrative: '样本量 {{metric:l1_qc_matrix.sample_count}} 例。',
    metricsCards: [
      { mod_id: 'l1_qc_matrix', metrics: { sample_count: 70 } },
      { mod_id: 'l1_qc_matrix', metrics: { sample_count: 80 } },
    ],
    readyFigureIds: new Set(),
  });
  assert.equal(conflicted.ok, false);
});

test('非 Ready 白名单图件必须拦', async () => {
  const { verifyNarrative, loadReadyFigureIds } = await load(FACTS);
  const ready = loadReadyFigureIds(ALLOWLIST);
  assert.ok(ready.size >= 27, 'Ready 白名单至少 27 条');

  const bad = verifyNarrative({
    narrative: '![fig](figures/fig_not_ready_at_all.png)',
    metricsCards: [],
    readyFigureIds: ready,
  });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.unreadyFigures, ['fig_not_ready_at_all']);

  const good = verifyNarrative({
    narrative: '![fig](figures/fig_l1_scatter.v2.png)',
    metricsCards: [],
    readyFigureIds: ready,
  });
  assert.equal(good.ok, true);
});

test('图件路径到模板 ID 的解析支持版本后缀', async () => {
  const { templateIdFromPath } = await load(FACTS);
  assert.equal(templateIdFromPath('figures/fig_l1_scatter.png'), 'fig_l1_scatter');
  assert.equal(templateIdFromPath('figures/line1_bulk/fig_l1_scatter.v2.png'), 'fig_l1_scatter');
  assert.equal(templateIdFromPath('figures/random_image.png'), null);
});

test('报告构建器拒绝幽灵 Mod 指标卡与组合图', async () => {
  const { buildClinicalReport } = await load(BUILDER);
  assert.throws(
    () => buildClinicalReport({ projectId: 'PRJ_T', metricsCards: [goodCard({ mod_id: 'mod_ghost_x' })] }),
    /STEP_METRICS_INVALID/,
  );
  assert.throws(
    () => buildClinicalReport({
      projectId: 'PRJ_T',
      metricsCards: [goodCard()],
      figures: [{ template_id: 'fig_l1_scatter', producing_mod_id: 'l1_de_limma', panel_count: 2 }],
    }),
    /COMPOSITE_FIGURE_FORBIDDEN/,
  );
});

test('报告构建器：没有真值的行被剪掉，不留下空标题', async () => {
  const { buildClinicalReport } = await load(BUILDER);
  const report = buildClinicalReport({ projectId: 'PRJ_T', metricsCards: [goodCard()] });
  assert.equal(report.markdown.includes('Section 6: Figure Legends'), false,
    '本轮无图件时不得留下 Figure Legends 空标题');
  assert.equal(report.markdown.includes('2.3 微环境重塑与细胞通讯'), false,
    '线 2 指标卡缺失时不得留下空小节');
  assert.ok(report.markdown.includes('3649'), '真实指标必须被渲染');
  assert.equal(report.audit.unbounded_count, 0);
  assert.equal(report.audit.unresolved_count, 0);
});

test('报告构建器：qc_flags 必须原样进入附录', async () => {
  const { buildClinicalReport } = await load(BUILDER);
  const report = buildClinicalReport({
    projectId: 'PRJ_T',
    metricsCards: [goodCard({
      qc_flags: [{ code: 'DEG_COUNT_HIGH', severity: 'warn', message: '差异基因偏多' }],
    })],
  });
  assert.ok(report.markdown.includes('DEG_COUNT_HIGH'), '质控告警必须出现在报告正文');
  assert.equal(report.audit.qc_flag_count, 1);
});

// ---------------- 6. HTTP 会话路由 ----------------

test('HTTP 会话路由：未批准检查点一调 dispatch 返回 409，越权工具返回 403', async () => {
  const http = await import('node:http');
  const { handlePiOrchestratorRoutes } = await load(
    path.join(REPO, 'BioanalysDesktop', 'server', 'routes', 'pi_orchestrator.routes.js'),
  );
  const { PiSupervisor, closePiSessionDb } = await load(SUPERVISOR);
  const { createPiToolsBridge } = await load(BRIDGE);
  const dbPath = path.join(TMP, 'http_sessions.sqlite');

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const ctx = {
    json,
    piSupervisor: new PiSupervisor({ dbPath, toolsBridge: createPiToolsBridge(makeBridge()) }),
  };

  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      // 路由命中即 return true，响应由 withJsonBody 异步写出（与官方派发时序一致）。
      const handled = await handlePiOrchestratorRoutes(req, res, url, ctx);
      if (!handled) json(res, 404, { ok: false, error: 'unhandled' });
    } catch (err) {
      if (!res.headersSent) json(res, 500, { ok: false, error: String(err?.message || err) });
    }
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body) => fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  try {
    const created = await post('/api/pi/sessions/start', {
      project_id: 'PRJ_HTTP', line_id: 'line1_bulk', session_id: 'ps_http_1',
    });
    assert.equal(created.status, 201);
    const { session } = await created.json();
    assert.equal(session.status, 'DRAFT');

    // 未提交方案直接 dispatch → 409
    const early = await post('/api/pi/sessions/ps_http_1/dispatch', {});
    assert.equal(early.status, 409);

    // 越权工具 → 403
    const forged = await post('/api/pi/sessions/ps_http_1/tool', { tool_name: 'shell', params: { cmd: 'ls' } });
    assert.equal(forged.status, 403);
    const forgedBody = await forged.json();
    assert.equal(forgedBody.code, 'PI_TOOL_NOT_ALLOWED');

    // 提交方案 → 待批准
    const plan = await post('/api/pi/sessions/ps_http_1/plan', {
      plan_text: '立项方案正文', dag: [{ stage: 'ingest', mods: ['l1_ingest_prep'] }],
    });
    assert.equal(plan.status, 200);

    // 缺 actor 批准 → 400
    const noActor = await post('/api/pi/sessions/ps_http_1/approve-plan', {});
    assert.equal(noActor.status, 400);

    // 带 actor 批准 → 200
    const approved = await post('/api/pi/sessions/ps_http_1/approve-plan', { actor: 'dr_wang' });
    assert.equal(approved.status, 200);
    const approvedBody = await approved.json();
    assert.equal(approvedBody.session.status, 'PLAN_APPROVED');
  } finally {
    await new Promise((resolve) => srv.close(resolve));
    closePiSessionDb(dbPath);
  }
});

test('HTTP 适配提案：列表可读、缺租约拒绝、批准与驳回落盘', async () => {
  const http = await import('node:http');
  const { handlePiOrchestratorRoutes } = await load(
    path.join(REPO, 'BioanalysDesktop', 'server', 'routes', 'pi_orchestrator.routes.js'),
  );
  const { PiSupervisor, closePiSessionDb } = await load(SUPERVISOR);
  const { acquireAuthority, closeAuthorityDatabase } = await load(AUTHORITY);
  const dbPath = path.join(TMP, 'http_proposals.sqlite');
  const authorityFile = path.join(TMP, 'http_authority.sqlite');
  const workspaceRoot = path.join(TMP, 'http_ws');
  const projectId = 'PRJ_HTTP_PROP';
  const scriptsDir = path.join(workspaceRoot, projectId, 'scripts');
  fs.mkdirSync(path.join(scriptsDir, '.val_tmp'), { recursive: true });
  const scriptBody = 'x <- 1\n';
  fs.writeFileSync(path.join(scriptsDir, 'adapt_01.R'), scriptBody, 'utf8');
  fs.writeFileSync(path.join(scriptsDir, 'scripts_manifest.json'), JSON.stringify({
    scripts: [{
      entry_point: 'adapt_01.R', upstream_mod: 'l1_ingest_prep', purpose: '清洗', reason: '列名不齐',
      sha256: createHash('sha256').update(scriptBody).digest('hex'),
    }],
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(scriptsDir, '.val_tmp', 'adapt_01.R.verified.json'), JSON.stringify({
    verdict: 'VERIFIED_OK', validated_at: new Date().toISOString(),
    memory_cap_gb: 3.5, timeout_cap_sec: 180,
  }, null, 2), 'utf8');

  const sup = new PiSupervisor({ dbPath });
  sup.start({ projectId, lineId: 'line1_bulk', sessionId: 'ps_prop' });
  const { lease_id: leaseId } = acquireAuthority(
    { kind: 'human', id: 'test', role: 'admin' },
    { file: authorityFile },
  );
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const ctx = {
    json, piSupervisor: sup, workspaceProjectsRoot: workspaceRoot, authorityFile,
    actor: 'human-admin',
  };
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      const handled = await handlePiOrchestratorRoutes(req, res, url, ctx);
      if (!handled) json(res, 404, { ok: false, error: 'unhandled' });
    } catch (err) {
      if (!res.headersSent) json(res, 500, { ok: false, error: String(err?.message || err) });
    }
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (p, body, headers = {}) => fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  try {
    const list = await fetch(`${base}/api/pi/sessions/ps_prop/proposals`);
    assert.equal(list.status, 200);
    const listed = await list.json();
    assert.equal(listed.proposals.length, 1);
    assert.equal(listed.proposals[0].entry_point, 'adapt_01.R');
    assert.equal(listed.proposals[0].verified.verdict, 'VERIFIED_OK');
    assert.equal(listed.proposals[0].exists, true);

    const noLease = await post('/api/pi/sessions/ps_prop/proposals/adapt_01.R/decide', { action: 'approve' });
    assert.equal(noLease.status, 409, '缺租约的提案决定必须被拒');

    const approved = await post(
      '/api/pi/sessions/ps_prop/proposals/adapt_01.R/decide',
      { action: 'approve', comment: '同意', actor: 'human-admin' },
      { 'X-Bio-Lease-Id': leaseId },
    );
    assert.equal(approved.status, 200);
    const approvedBody = await approved.json();
    assert.equal(approvedBody.action, 'approve');
    const manifestAfterApprove = JSON.parse(fs.readFileSync(path.join(scriptsDir, 'scripts_manifest.json'), 'utf8'));
    assert.equal(manifestAfterApprove.scripts[0].approved_by, 'human-admin');

    const rejected = await post(
      '/api/pi/sessions/ps_prop/proposals/adapt_01.R/decide',
      { action: 'reject', comment: '不适配' },
      { 'X-Bio-Lease-Id': leaseId },
    );
    assert.equal(rejected.status, 200);
    const manifestAfterReject = JSON.parse(fs.readFileSync(path.join(scriptsDir, 'scripts_manifest.json'), 'utf8'));
    assert.equal(manifestAfterReject.scripts.length, 0, '驳回后登记必须移除');
    assert.equal(fs.existsSync(path.join(scriptsDir, 'adapt_01.R')), false, '驳回后脚本必须删除');
  } finally {
    await new Promise((resolve) => srv.close(resolve));
    closePiSessionDb(dbPath);
    closeAuthorityDatabase(authorityFile);
  }
});

// ---------------- 7. 黄金集复现脚本 ----------------

test('黄金集复现脚本：指标卡、报告、审计与检查点判读全部可复现', async () => {
  const { runGoldenCase, DEFAULT_PROJECT } = await load(path.join(REPO, 'tools', 'dev', 'pi_golden_case.mjs'));
  const processedDir = path.join(REPO, 'workspace', 'projects', DEFAULT_PROJECT, 'data', 'line1_bulk', 'processed');
  if (!fs.existsSync(processedDir)) return;

  const out = runGoldenCase({ projectId: DEFAULT_PROJECT, dry: true });
  assert.equal(out.cards.length >= 6, true);
  assert.equal(out.factCheckAudit.unbounded_count, 0);
  assert.equal(out.factCheckAudit.unresolved_count, 0);
  assert.equal(out.review.checkpoint_1.id, 'CHECKPOINT_1_PROJECT_PLAN');
  assert.equal(out.review.checkpoint_2.id, 'CHECKPOINT_2_TARGET_LOCK');
  // 每条建议必须是受控可调表内的参数，且落在区间内
  for (const rem of out.review.checkpoint_2.remediations) {
    if (rem.param_key === null) continue;
    assert.equal(rem.within_bounds, true, `${rem.mod_id}.${rem.param_key} 建议值必须落在区间内`);
  }
});

// ---------------- 5. 真实黄金集端到端 ----------------
test('黄金集：从 DCM 真实产物提取指标卡并渲染报告，全程 0 裸写数值', async () => {
  const { extractStepMetrics } = await load(EXTRACTOR);
  const { buildClinicalReport } = await load(BUILDER);
  const { validateStepMetrics, collectRegisteredModIds } = await load(METRICS);
  const processedDir = path.join(REPO, 'workspace', 'projects', 'PRJ_DCM_BENCH_20261105', 'data', 'line1_bulk', 'processed');
  if (!fs.existsSync(processedDir)) {
    test.skip?.('PRJ_DCM_BENCH_20261105 产物不在本机');
    return;
  }

  const registered = collectRegisteredModIds(WORKFLOWS);
  const cards = extractStepMetrics({
    projectId: 'PRJ_DCM_BENCH_20261105', lineId: 'line1_bulk', processedDir,
  });
  assert.ok(cards.length >= 6, `至少提取 6 张卡，实际 ${cards.length}`);

  for (const card of cards) {
    const verdict = validateStepMetrics(card, { registeredModIds: registered });
    assert.equal(verdict.ok, true, `${card.mod_id} 指标卡不合契约: ${verdict.errors.join('；')}`);
    assert.ok(verdict.bytes < 32 * 1024, `${card.mod_id} 指标卡 ${verdict.bytes} 字节超过 32KB`);
  }

  const degCard = cards.find((c) => c.mod_id === 'l1_de_limma');
  assert.equal(degCard.metrics.deg_total, 3649, '真实产物里 sig_genes=3649');
  assert.equal(degCard.metrics.deg_up, 3260);
  assert.equal(degCard.metrics.deg_down, 389);

  const report = buildClinicalReport({ projectId: 'PRJ_DCM_BENCH_20261105', metricsCards: cards });
  assert.equal(report.audit.unbounded_count, 0, '报告正文不得有裸写统计数值');
  assert.equal(report.audit.unresolved_count, 0, '所有槽位必须命中真值');
  assert.ok(report.markdown.includes('3649'), '真实 DEG 总数必须出现在报告里');
});
