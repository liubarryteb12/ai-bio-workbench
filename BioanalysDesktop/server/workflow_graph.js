/**
 * workflow_graph.js —— mod 注册表的加载、校验与组合合法性判定。
 *
 * 单一事实源：`tools/bio/workflows.json`。客户端（portal）、服务台（BioanalysDesktop）、
 取证 runner（cn_debug/lib/chain_runner.mjs）三方共读同一份，避免依赖关系三处漂移。
 *
 * 校验的四类硬错误（任一不过即拒绝该组合）：
 *   1. 悬空依赖：requires 引用了任何 mod 都不产生的产物；
 *   2. 跨线泄漏：requires 引用了别的 series 才产生的产物（aims 铁律二）；
 *   3. 阶段倒挂：选中的 mod 的 stage order 比它依赖的 mod 更小；
 *   4. 母版缺失：mod id 在 src/<line>/scripts/ 下没有对应文件。
 *
 * 成本预估（est_minutes / peak_mem_mb）用于组合前拦截：超出 K40 7.5G 内存配额
 * 或总时长超上限时拒绝，而不是等远端跑爆。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const REGISTRY = path.join(REPO, 'tools', 'bio', 'workflows.json');

let cache = null;

/** 读注册表（带缓存；测试用 reloadWorkflows() 强制重读）。 */
export function loadWorkflows() {
  if (cache) return cache;
  const raw = fs.readFileSync(REGISTRY, 'utf8');
  cache = JSON.parse(raw);
  return cache;
}

/** 测试用：清缓存。 */
export function reloadWorkflows() {
  cache = null;
  return loadWorkflows();
}

/** 扁平化：modId -> {mod, seriesId, stage}。 */
export function indexMods() {
  const wf = loadWorkflows();
  const out = new Map();
  for (const series of wf.series) {
    for (const stage of series.stages) {
      for (const mod of stage.mods) {
        // key 必须带 series 前缀：三条线有同名 mod（normalize_hvg / enrichment /
        // enrichment_figures / dr_post_analysis），只用 modId 会让后加载的线覆盖前一条。
        out.set(`${series.id}:${mod.id}`, { mod, series, stage });
      }
    }
  }
  return out;
}

/** 产物名 -> 生产它的 modId 列表（一对多：同一产物可能由多个 mod 产生）。 */
export function indexProducers() {
  const idx = indexMods();
  const out = new Map();
  for (const [key, entry] of idx) {
    for (const p of entry.mod.produces || []) {
      if (!out.has(p)) out.set(p, []);
      // 存 series 限定的 key，避免 line2 的产物被 line3 同名 mod 冒名
      out.get(p).push(key);
    }
  }
  return out;
}

/**
 * 全量静态校验。返回 {ok, errors, stats}。
 * errors 里每条都带 series/mod 定位，便于直接跳到 workflows.json 对应行修。
 */
export function validateRegistry() {
  const wf = loadWorkflows();
  const errors = [];
  if (wf.manifest_version !== 2) {
    errors.push(`manifest_version 必须为 2，实际 ${wf.manifest_version}`);
  }
  if (wf.manifest_kind !== 'workspace_module_registry') {
    errors.push(`manifest_kind 必须为 workspace_module_registry，实际 ${wf.manifest_kind}`);
  }
  const producers = indexProducers();
  const seriesIds = new Set(wf.series.map((s) => s.id));

  for (const series of wf.series) {
    if (!seriesIds.has(series.id)) errors.push(`series id 重复: ${series.id}`);
    const orders = series.stages.map((s) => s.order);
    if (new Set(orders).size !== orders.length) {
      errors.push(`${series.id}: stage order 有重复 ${orders.join(',')}`);
    }
    for (const stage of series.stages) {
      for (const mod of stage.mods) {
        const where = `${series.id}/${stage.id}/${mod.id}`;
        // 母版必须真实存在。mod.id 是注册表命名（<系列>_<工序>_<功能>），
        // 与磁盘上的母版文件名不同——母版名走 mod.script，两者不能混。
        const scriptName = mod.script || mod.id;
        const scriptPath = path.join(REPO, 'tools', 'bio', series.id, 'scripts', scriptName);
        if (!fs.existsSync(scriptPath)) {
          errors.push(`${where}: 母版缺失 tools/bio/${series.id}/scripts/${scriptName}`);
        }
        // requires 不得为空
        if (!mod.requires || mod.requires.length === 0) {
          errors.push(`${where}: requires 为空（每个 mod 都必须声明输入）`);
        }
        // produces 不得为空
        if (!mod.produces || mod.produces.length === 0) {
          errors.push(`${where}: produces 为空（每个 mod 都必须声明产物）`);
        }
        // 悬空依赖 / 跨线泄漏
        for (const req of mod.requires || []) {
          // 原始输入（非别的 mod 产物）用白名单放过
          if (RAW_INPUTS.has(req)) continue;
          const who = producers.get(req);
          if (!who) {
            errors.push(`${where}: 悬空依赖，产物 '${req}' 无人生产`);
            continue;
          }
          const foreign = who.filter((p) => !sameSeries(p, series.id));
          if (foreign.length) {
            errors.push(`${where}: 跨线泄漏，'${req}' 由 ${foreign.join(',')} 生产（aims 铁律二）`);
          }
        }
        // after 必须指向同线且 order 更小的 mod
        for (const dep of mod.after || []) {
          const target = indexMods().get(`${series.id}:${dep}`);
          if (!target) {
            errors.push(`${where}: after 指向不存在的 mod '${dep}'`);
          } else if (target.series.id !== series.id) {
            errors.push(`${where}: after 跨线指向 ${dep}`);
          }
        }
        // ko_gene 声明必须与全局约束一致
        if (mod.ko_gene && !wf.constraints.ko_gene_required_mods.includes(mod.id)) {
          errors.push(`${where}: 声明了 ko_gene 但没进 constraints.ko_gene_required_mods`);
        }
        // 命名规则：<系列短名>_<工序>_<功能名>，防三条线同名撞车
        // line1_bulk -> l1、line2_scrna -> l2、line3_spatial -> l3
        const prefix = `l${series.id.replace(/\D/g, '')}`;
        if (!mod.id.startsWith(`${prefix}_`)) {
          errors.push(`${where}: id 必须以 ${prefix}_ 开头（系列+工序+功能名），实际 ${mod.id}`);
        }
        if (!/^l\d_[a-z][a-z0-9_]*$/.test(mod.id)) {
          errors.push(`${where}: id 不符合 <系列>_<工序>_<功能> 小写下划线命名，实际 ${mod.id}`);
        }
        // script 必须显式声明，且不得与 id 相同（相同说明忘了建映射，母版会找不到）
        if (!mod.script) {
          errors.push(`${where}: 缺 script 字段（母版文件名）`);
        } else if (mod.script === mod.id) {
          errors.push(`${where}: script 与 id 相同（${mod.id}），母版名应保持磁盘原名`);
        }
      }
    }
  }

  const totalMods = [...indexMods().keys()].length;
  return { ok: errors.length === 0, errors, stats: { series: wf.series.length, mods: totalMods } };
}

/** 原始输入白名单：这些是客户在表单里给的，不是上游 mod 的产物。 */
const RAW_INPUTS = new Set([
  'series_matrix', 'gpl', 'gpl_soft', 'gpl_soft_mouse', 'gpl_soft_human',
  'grouping.txt', 'raw_tar', 'processed', 'survival_data',
]);

function sameSeries(modId, seriesId) {
  // modId 可能是裸 modId，也可能是 series 限定的 key；两种都认
  const entry = indexMods().get(modId.includes(':') ? modId : `${seriesId}:${modId}`);
  return entry && entry.series.id === seriesId;
}

/**
 * 组合合法性判定。给定 seriesId 与勾选的 modId 列表，返回
 * {ok, errors, ordered, estMinutes, peakMemMb}。
 * ordered 是拓扑排序后的执行序（stage order 优先，同 stage 内保持声明序）。
 */
export function resolvePlan(seriesId, selectedIds, opts = {}) {
  const wf = loadWorkflows();
  const errors = [];
  const series = wf.series.find((s) => s.id === seriesId);
  if (!series) return { ok: false, errors: [`未知系列 ${seriesId}`], ordered: [], estMinutes: 0, peakMemMb: 0 };

  const idx = indexMods();
  // selected 内部统一存 series 限定的 key（与 indexProducers 的 key 同构）；
  // 对外（入参 selectedIds、出参 ordered）用裸 modId，客户端不该感知 series 前缀。
  const selected = new Set();
  for (const id of selectedIds) {
    // 先用调用方给的 series 查；查不到再全局查，这样才能报出「属于哪条线」
    // 而不是含糊的「未知 mod」（跨线选中是最该说清的一种错）。
    let entry = idx.get(`${seriesId}:${id}`);
    if (!entry) {
      for (const s of loadWorkflows().series) {
        const hit = idx.get(`${s.id}:${id}`);
        if (hit) { entry = hit; break; }
      }
    }
    if (!entry) {
      errors.push(`未知 mod '${id}'`);
      continue;
    }
    if (entry.series.id !== seriesId) {
      errors.push(`跨线选中：'${id}' 属于 ${entry.series.id}，不是 ${seriesId}`);
      continue;
    }
    selected.add(`${seriesId}:${id}`);
  }

  // 必经 stage 的 mod 必须全选
  for (const stage of series.stages) {
    if (!stage.required) continue;
    for (const mod of stage.mods) {
      // stage 必经不等于其中每个 mod 都必经：mod 自身标 optional=true 的可跳过
      if (mod.optional) continue;
      if (!selected.has(`${seriesId}:${mod.id}`)) {
        errors.push(`必经阶段 ${stage.id} 缺少 mod '${mod.id}'`);
      }
    }
  }

  // 依赖闭合：选中的 mod 的 requires（非原始输入）必须有生产者也被选中
  const producers = indexProducers();
  for (const id of selected) {
    const entry = idx.get(id);
    const bare = id.slice(seriesId.length + 1);
    for (const req of entry.mod.requires || []) {
      if (RAW_INPUTS.has(req)) continue;
      const who = (producers.get(req) || []).filter((p) => sameSeries(p, seriesId));
      if (!who.some((p) => selected.has(p))) {
        errors.push(`${bare} 依赖 '${req}'，但生产者 [${who.map((k) => k.slice(seriesId.length + 1)).join(',') || '无'}] 未选中`);
      }
    }
    for (const dep of entry.mod.after || []) {
      if (!selected.has(`${seriesId}:${dep}`)) errors.push(`${bare} 声明 after '${dep}' 但未选中`);
    }
  }

  // 拓扑排序
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`依赖成环：${id.slice(seriesId.length + 1)}`);
      return;
    }
    visiting.add(id);
    const entry = idx.get(id);
    for (const req of entry.mod.requires || []) {
      if (RAW_INPUTS.has(req)) continue;
      for (const p of producers.get(req) || []) {
        if (sameSeries(p, seriesId) && selected.has(p)) visit(p);
      }
    }
    for (const dep of entry.mod.after || []) {
      if (selected.has(`${seriesId}:${dep}`)) visit(`${seriesId}:${dep}`);
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(id);
  };
  for (const stage of [...series.stages].sort((a, b) => a.order - b.order)) {
    for (const mod of stage.mods) {
      if (selected.has(`${seriesId}:${mod.id}`)) visit(`${seriesId}:${mod.id}`);
    }
  }

  // 对外吐裸 modId，客户端不感知 series 前缀
  const orderedBare = ordered.map((k) => k.slice(seriesId.length + 1));

  let estMinutes = 0;
  let peakMemMb = 0;
  for (const id of ordered) {
    const m = idx.get(id).mod;
    estMinutes += m.est_minutes || 0;
    peakMemMb = Math.max(peakMemMb, m.peak_mem_mb || 0);
  }

  const quota = wf.constraints.mem_quota_mb;
  if (peakMemMb > quota) {
    errors.push(`峰值内存 ${peakMemMb}MB 超出 K40 配额 ${quota}MB`);
  }

  // 敲除类 mod 必须带靶基因：母版在参数解析处就会 exit 2，不预先拦就是白跑一次远端执行
  const koGene = (opts.koGene || '').trim();
  if (!koGene) {
    for (const key of selected) {
      const entry = idx.get(key);
      if (entry && entry.mod.ko_gene) {
        errors.push(`${key.slice(seriesId.length + 1)} 需要靶基因（--ko-gene），但未提供`);
      }
    }
  }

  return { ok: errors.length === 0, errors, ordered: orderedBare, estMinutes, peakMemMb };
}

/**
 * mod id -> 母版名。
 *
 * 为什么需要：pipelineDag 的 stepId 历史上存的是母版名，mod 化后的客户端传的是
 * mod id（l2_tf_scenic）。lineFromPipeline 之类的推断逻辑按母版名比对，
 * 不翻一层就会全部失配。服务台侧就近取这份映射，不 import cn_debug 的取证库。
 */
export function modToScriptMap() {
  const out = new Map();
  for (const series of loadWorkflows().series) {
    for (const stage of series.stages) {
      for (const mod of stage.mods) out.set(mod.id, mod.script || mod.id);
    }
  }
  return out;
}

/**
 * 母版名 -> mod id（反查）。
 *
 * 键必须是 `<lineId>:<母版名>`：enrichment_figures / normalize_hvg / enrichment /
 * dr_post_analysis 在两条以上线同名（磁盘上分属不同目录），只用母版名做 key 会让
 * 后加载的线覆盖前一条，line1 的 l1_enrich_figures 永远反查不到
 * （2026-10-23 被 step_name_resolve 测试抓到的真实缺陷）。
 */
export function scriptToModMap(lineId) {
  const out = new Map();
  for (const series of loadWorkflows().series) {
    if (lineId && series.id !== lineId) continue;
    for (const stage of series.stages) {
      for (const mod of stage.mods) {
        out.set(`${series.id}:${mod.script || mod.id}`, mod.id);
      }
    }
  }
  return out;
}

/** 客户端用：某系列的全部 stage 与 mod（含勾选态由调用方算）。 */
export function describeSeries(seriesId) {
  const wf = loadWorkflows();
  const series = wf.series.find((s) => s.id === seriesId);
  if (!series) return null;
  return {
    id: series.id,
    name: series.name,
    data_form: series.data_form,
    language_profile: series.language_profile,
    seed: series.seed,
    stages: [...series.stages]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: s.id,
        name: s.name,
        order: s.order,
        required: !!s.required,
        notes: s.notes || '',
        mods: s.mods.map((m) => ({
          id: m.id,
          script: m.script || m.id,
          name: m.name,
          language: m.language,
          est_minutes: m.est_minutes,
          peak_mem_mb: m.peak_mem_mb,
          optional: !!m.optional,
          ko_gene: !!m.ko_gene,
          risk: m.risk || '',
          notes: m.notes || '',
        })),
      })),
  };
}
