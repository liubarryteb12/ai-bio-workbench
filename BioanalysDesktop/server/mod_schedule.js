/**
 * mod_schedule.js —— 分析步骤（Mod）依赖闭包与调度准入（Argon 第 76 轮 Q4 四点双射定律 2/3）。
 *
 * 零 I/O 纯函数。依赖真源由 workflows.json 阶段拓扑派生：每个 Mod 依赖其所在阶段之前
 * 所有「必需阶段（stage.required）」的 Mod（与门户 renderSteps 自动勾选必需阶段同口径）。
 * 定律 2：用户勾选下游但漏选上游 -> 422 UNSCHEDULABLE_MOD_DAG + missing_upstream_mods[]。
 * 定律 3：编译执行步骤集恒等于 Closure(selected_mods ∪ figure_required_mods)，零漏跑零私加。
 */

/** 从 workflows 派生 mod_id -> depends_on[]（前置必需阶段的全部 Mod）。 */
export function buildModDependencyMap(workflows) {
  const depMap = new Map();
  for (const series of workflows.series || []) {
    const stages = [...(series.stages || [])].sort((a, b) => Number(a.order) - Number(b.order));
    const requiredPrior = [];
    for (const stage of stages) {
      const mods = (stage.mods || []).map((m) => m.id);
      for (const modId of mods) {
        depMap.set(modId, [...requiredPrior]);
      }
      if (stage.required) {
        for (const modId of mods) if (!requiredPrior.includes(modId)) requiredPrior.push(modId);
      }
    }
  }
  return depMap;
}

/** 传递闭包：selected 集合加上其全部上游依赖。 */
export function resolveModClosure(selectedIds, depMap) {
  const closure = new Set();
  const stack = [...selectedIds];
  while (stack.length) {
    const id = stack.pop();
    if (closure.has(id)) continue;
    closure.add(id);
    for (const upstream of depMap.get(id) || []) {
      if (!closure.has(upstream)) stack.push(upstream);
    }
  }
  return closure;
}

/**
 * 定律 2/3 准入校验。
 * @param {string[]} submittedMods 用户提交的分析步骤（前端应已自动闭包）
 * @param {string[]} figureRequiredMods 选中图件的 required_mod_ids 并集
 * @param {object} workflows workflows.json 解析对象
 * @returns {{ok:boolean, code?:string, missing_upstream_mods:string[], expected_closure:string[]}}
 */
export function validateModSchedule(submittedMods, figureRequiredMods, workflows) {
  const depMap = buildModDependencyMap(workflows);
  const submitted = new Set(Array.isArray(submittedMods) ? submittedMods : []);
  const seed = [...submitted, ...(Array.isArray(figureRequiredMods) ? figureRequiredMods : [])];
  const closure = resolveModClosure(seed, depMap);
  const missing = [...closure].filter((id) => !submitted.has(id));
  const expected = [...closure];
  if (missing.length > 0) {
    return { ok: false, code: 'UNSCHEDULABLE_MOD_DAG', missing_upstream_mods: missing, expected_closure: expected };
  }
  return { ok: true, missing_upstream_mods: [], expected_closure: expected };
}

/**
 * 定律 3 计划恒等：编译步骤集必须恒等于期望闭包（零漏跑零私加）。
 * @param {string[]} compiledSteps 编译产物 pipeline_dag 的 mod_id 集
 * @param {string[]} expectedClosure 期望闭包
 * @returns {{ok:boolean, dropped_steps:string[], unrequested_steps:string[]}}
 */
export function assertPlanModParity(compiledSteps, expectedClosure) {
  const compiled = new Set(Array.isArray(compiledSteps) ? compiledSteps : []);
  const expected = new Set(Array.isArray(expectedClosure) ? expectedClosure : []);
  const dropped = [...expected].filter((id) => !compiled.has(id));
  const unrequested = [...compiled].filter((id) => !expected.has(id));
  return { ok: dropped.length === 0 && unrequested.length === 0, dropped_steps: dropped, unrequested_steps: unrequested };
}

/**
 * 定律 1 目录双射：workflows.json 每个 Mod 必须有可达母版（无幽灵步骤）。
 * @param {object} workflows
 * @param {(seriesId:string, mod:object)=>boolean} scriptExists 注入的母版可达性判定
 * @returns {{ok:boolean, orphan_mods:string[]}}
 */
export function assertCatalogParity(workflows, scriptExists) {
  const orphans = [];
  for (const series of workflows.series || []) {
    for (const stage of series.stages || []) {
      for (const mod of stage.mods || []) {
        if (!scriptExists(series.id, mod)) orphans.push(`${series.id}/${mod.id}`);
      }
    }
  }
  return { ok: orphans.length === 0, orphan_mods: orphans };
}
