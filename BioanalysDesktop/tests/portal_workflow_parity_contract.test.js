/**
 * 门户「四点双射」一一对应契约（Argon 第 76 轮 Q4）。
 * 定律 1：门户目录 ≡ workflows.json（用户知道全部能做的事，每个 Mod 有可达母版）。
 * 定律 2：分析步骤依赖闭包，漏选上游 -> UNSCHEDULABLE_MOD_DAG（MUT-PORTAL-B）。
 * 定律 3：编译步骤集 ≡ 期望闭包，零漏跑零私加（MUT-PORTAL-C）。
 * 定律 4：编译步骤 -> K40 脚本字节同源由 Gate 18 k40_script_parity 兜底。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModDependencyMap, resolveModClosure, validateModSchedule, assertPlanModParity } from '../server/mod_schedule.js';
import { loadWorkflows, modToScriptMap } from '../server/workflow_graph.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflows = loadWorkflows();

test('定律 1：workflows.json 每个 Mod 都有可达母版（门户目录无幽灵步骤）', () => {
  const modToScript = modToScriptMap();
  const orphans = [];
  for (const series of workflows.series) {
    for (const stage of series.stages) {
      for (const mod of stage.mods) {
        const script = mod.script || modToScript.get(mod.id);
        const file = path.join(REPO, 'tools', 'bio', series.id, 'scripts', script || mod.id);
        if (!script || !fs.existsSync(file)) orphans.push(`${series.id}/${mod.id}`);
      }
    }
  }
  assert.deepEqual(orphans, [], '存在无母版的幽灵 Mod：' + orphans.join(', '));
});

test('定律 1：门户步骤渲染源自 workflows（renderSteps 遍历 stage.mods）', () => {
  const html = fs.readFileSync(path.join(REPO, 'portal', 'index.html'), 'utf8');
  assert.match(html, /function renderSteps/, '门户必须有 renderSteps');
  assert.match(html, /stage\.mods/, 'renderSteps 必须遍历 workflows 的 stage.mods');
  assert.match(html, /figureTemplateRegistry/, '图件卡片必须源自 figure_templates 注册表');
});

test('定律 2：仅勾选下游 Mod 漏选上游 -> UNSCHEDULABLE_MOD_DAG（MUT-PORTAL-B 基线）', () => {
  const depMap = buildModDependencyMap(workflows);
  // 找一个有上游依赖的下游 Mod
  const downstream = [...depMap.entries()].find(([, deps]) => deps.length > 0);
  assert.ok(downstream, '应存在有上游依赖的 Mod');
  const [downId, upstreams] = downstream;
  const res = validateModSchedule([downId], [], workflows);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'UNSCHEDULABLE_MOD_DAG');
  assert.ok(res.missing_upstream_mods.length > 0);
  assert.ok(upstreams.some((u) => res.missing_upstream_mods.includes(u)));
});

test('定律 2：提交完整闭包则放行', () => {
  const depMap = buildModDependencyMap(workflows);
  const downstream = [...depMap.entries()].find(([, deps]) => deps.length > 0);
  const [downId] = downstream;
  const closure = [...resolveModClosure([downId], depMap)];
  const res = validateModSchedule(closure, [], workflows);
  assert.equal(res.ok, true, JSON.stringify(res.missing_upstream_mods));
});

test('定律 3：计划恒等检测漏跑与私加（MUT-PORTAL-C 基线）', () => {
  const expected = ['l1_ingest_prep', 'l1_qc_matrix', 'l1_de_limma'];
  assert.equal(assertPlanModParity(expected, expected).ok, true);
  const dropped = assertPlanModParity(['l1_ingest_prep', 'l1_de_limma'], expected);
  assert.equal(dropped.ok, false);
  assert.deepEqual(dropped.dropped_steps, ['l1_qc_matrix']);
  const added = assertPlanModParity([...expected, 'l1_ml_model'], expected);
  assert.equal(added.ok, false);
  assert.deepEqual(added.unrequested_steps, ['l1_ml_model']);
});

test('定律 2/3 联动：图件 required_mods 纳入闭包', () => {
  const depMap = buildModDependencyMap(workflows);
  const figureRequired = ['l1_de_limma'];
  const closure = resolveModClosure(figureRequired, depMap);
  const submitted = [...closure];
  const res = validateModSchedule(submitted, figureRequired, workflows);
  assert.equal(res.ok, true);
  assert.equal(assertPlanModParity(submitted, res.expected_closure).ok, true);
});
