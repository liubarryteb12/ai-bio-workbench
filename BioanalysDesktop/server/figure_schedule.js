/**
 * figure_schedule.js —— 图件调度准入纯函数（Argon 第 75 轮 Q5 / MUT-FIG-B/C）。
 *
 * 零 I/O、零外部依赖：选中图件必须 ready，且 required_mod_ids 必须被 selectedMods
 * 完全覆盖，否则返回结构化违约（UNSCHEDULABLE_FIGURE / ERR_FIGURE_NOT_READY），
 * 编译期毫秒级 Fail-Closed 阻断下发。独立成模块以便变异门禁克隆反证。
 */

/**
 * @param {string[]} selectedMods 项目已选分析 Mod（含 producing mod）
 * @param {Array<{template_id:string}>} selections 图件选择
 * @param {Array<object>|{templates:Array<object>}} registry 图模板注册表
 * @returns {{ok:boolean, violations:Array<{code:string,figure_id:string,missing_mod_ids:string[],message:string}>}}
 */
export function validateFigureSchedule(selectedMods, selections, registry) {
  const selected = new Set(Array.isArray(selectedMods) ? selectedMods : []);
  const templates = Array.isArray(registry) ? registry : (registry?.templates || []);
  const violations = [];
  for (const selection of Array.isArray(selections) ? selections : []) {
    const figureId = String(selection?.template_id || selection?.id || '').trim();
    if (!figureId) continue;
    const template = templates.find((item) => item.id === figureId);
    if (!template) {
      violations.push({ code: 'UNKNOWN_TEMPLATE', figure_id: figureId, missing_mod_ids: [], message: `未知图模板 '${figureId}'` });
      continue;
    }
    const isReady = template.status === 'ready' || (template.deps_status === 'ready' && template.verified === true);
    if (!isReady) {
      violations.push({ code: 'ERR_FIGURE_NOT_READY', figure_id: figureId, missing_mod_ids: [], message: `${figureId}: status=${template.status || template.deps_status}，draft/未就绪图件禁止调度` });
      continue;
    }
    const required = Array.isArray(template.required_mod_ids) && template.required_mod_ids.length
      ? template.required_mod_ids
      : [template.producing_mod_id || template.analysis_step].filter(Boolean);
    const missing = required.filter((modId) => !selected.has(modId));
    if (missing.length > 0) {
      violations.push({
        code: 'UNSCHEDULABLE_FIGURE',
        figure_id: figureId,
        missing_mod_ids: missing,
        message: `${figureId}: 缺少前置分析 Mod ${missing.join(', ')}，请先勾选对应步骤或移除该图件`,
      });
    }
  }
  return { ok: violations.length === 0, violations };
}
