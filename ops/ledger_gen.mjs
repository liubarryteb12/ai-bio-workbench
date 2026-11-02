#!/usr/bin/env node
/**
 * ledger_gen.mjs —— 系统台账自省生成器（2026-11-01，技术债 5.7 收口）
 *
 * 存在理由（4 Argon 第三/四轮裁定的最小垂直切块）：
 *   workflows.json 的 54 个 Mod 与 figure_templates.json 的 82 个模板，
 *   当前「有没有对应母版脚本、有没有真实样例、有没有绑定步骤」全靠人手记在文档里，
 *   到下一轮就会腐烂。本脚本把这些**结构性事实**从代码与 JSON 真源直接导出，
 *   让台账从「手写记录」变成「代码自省」，交接文档只引用生成结果。
 *
 * 三条硬约束（Argon 明确要求，也是我 metrics_sync 踩过的坑）：
 *   1. **禁止时间戳、Git SHA、SLOC、行数**——任何会随无关改动漂移的量都不进台账，
 *      否则门禁测试会因为「改了个注释」而假红。
 *   2. **键名与数组排序必须确定**，跨平台字节级一致，测试才能用字符串严格比对。
 *   3. **纯 node:fs 只读扫描**，不起子进程、不 import 业务运行时，因此无需接缝豁免。
 *
 * 用法：
 *   node ops/ledger_gen.mjs --write   生成并写入 docs/generated/SYSTEM_LEDGER.json
 *   node ops/ledger_gen.mjs           打印到 stdout（用于比对）
 *
 * 产物 Schema（最小集）：
 *   workflows:        { totalSeries, totalMods, boundScriptsCount, missingScripts[] }
 *   figureTemplates:  { total, readyCount, pendingCount, pendingDetails[] }
 *   k40HostAssets:    { trackedFiles[] }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(REPO, 'docs', 'generated');
const OUT_FILE = path.join(OUT_DIR, 'SYSTEM_LEDGER.json');

/** 稳定的 JSON 序列化：对象键按字典序，数组保持源序 */
function stableStringify(value) {
  const sortValue = (v) => {
    if (Array.isArray(v)) return v.map(sortValue);
    if (v && typeof v === 'object') {
      const out = {};
      for (const key of Object.keys(v).sort()) out[key] = sortValue(v[key]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sortValue(value), null, 2) + '\n';
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO, relPath), 'utf8'));
}

/** 收集全部分析母版脚本的相对路径（src/<line>/scripts/ 下的无扩展名文件与脚本） */
function collectMasterScripts() {
  const out = new Set();
  const srcDir = path.join(REPO, 'src');
  let lines = [];
  try { lines = fs.readdirSync(srcDir, { withFileTypes: true }); } catch { return out; }
  for (const line of lines) {
    if (!line.isDirectory()) continue;
    const scriptsDir = path.join(srcDir, line.name, 'scripts');
    if (!fs.existsSync(scriptsDir)) continue;
    for (const entry of fs.readdirSync(scriptsDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      // 母版可能是无扩展名（1 步 1 母版），也可能带 .sh/.R/.py
      if (/^(README|\..*)/i.test(entry.name)) continue;
      if (/^\.(md|json|txt|log)$/i.test(path.extname(entry.name))) continue;
      out.add(path.posix.join('src', line.name, 'scripts', entry.name));
    }
  }
  return out;
}

/** 从 workflows.json 抽取全部 mod 与其声明的脚本字段 */
function collectMods(workflows) {
  const mods = [];
  for (const series of workflows.series || []) {
    for (const stage of series.stages || []) {
      for (const mod of stage.mods || []) {
        mods.push({
          series: series.id,
          stage: stage.id,
          id: mod.id,
          // mod 里声明母版的字段名可能不同，这里收集所有可能的脚本引用
          script: mod.script || mod.script_path || mod.master || mod.master_script || null,
        });
      }
    }
  }
  return mods;
}

/**
 * 计算系统台账（纯函数，导出给测试做内存比对）。
 * @returns {object} 结构化台账
 */
export function computeSystemLedger() {
  const workflows = readJson('src/workflows.json');
  const templates = readJson('src/figure_templates.json');
  const masters = collectMasterScripts();
  const mods = collectMods(workflows);

  // ── workflows 面 ──
  const modsWithScript = mods.filter((m) => m.script);
  const missingScripts = modsWithScript
    .filter((m) => {
      // script 可能是仓库相对路径，也可能只写母版名
      const candidate = String(m.script).replace(/\\/g, '/');
      if (candidate.startsWith('src/')) return !masters.has(candidate);
      const byName = [...masters].some((p) => p.endsWith('/' + path.posix.basename(candidate)));
      return !byName;
    })
    .map((m) => ({ series: m.series, stage: m.stage, id: m.id, script: m.script }));

  const workflowsLedger = {
    totalSeries: (workflows.series || []).length,
    totalMods: mods.length,
    boundScriptsCount: modsWithScript.length,
    missingScripts,
  };

  // ── figureTemplates 面（5.7 的机器可读化）──
  const list = (templates.templates || []);
  const pendingDetails = [];
  let readyCount = 0;
  /**
   * 判定口径按 figure_templates.json 的**真实字段名**（先前用猜的 sample/adapter/step
   * 导致 82 个模板全部误判 pending，实测纠正）：
   *   missingSample   ：没有 source / preview / sample_project_output 任一真实样例证据
   *   missingAdapter  ：adapt_vars 为空（没有适配器变量映射）
   *   unboundStep     ：linked_mods 与 analysis_step 都为空（没绑定到任何步骤）
   *   depsPending     ：deps_status 非 ready（依赖链未就绪，这是 5.7 台账里最关键的挂账项）
   */
  for (const tpl of list) {
    const missingSample = !(tpl.source || tpl.preview || tpl.sample_project_output);
    const adaptVars = tpl.adapt_vars && typeof tpl.adapt_vars === 'object' ? Object.keys(tpl.adapt_vars).length : 0;
    const missingAdapter = adaptVars === 0;
    const linked = Array.isArray(tpl.linked_mods) ? tpl.linked_mods.length : 0;
    const unboundStep = linked === 0 && !tpl.analysis_step;
    const depsPending = tpl.deps_status !== 'ready';
    if (missingSample || missingAdapter || unboundStep || depsPending) {
      pendingDetails.push({ id: tpl.id, missingSample, missingAdapter, unboundStep, depsPending });
    } else {
      readyCount += 1;
    }
  }
  const figureLedger = {
    total: list.length,
    readyCount,
    pendingCount: pendingDetails.length,
    pendingDetails,
  };

  // ── K40 宿主面受控资产 ──
  const k40Dir = path.join(REPO, 'ops', 'k40');
  const trackedFiles = [];
  const walk = (dir, prefix) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      // 构建产物/缓存不是受控资产：不收录，否则跑一次探针脚本就会让台账门禁假红
      if (entry.name === '__pycache__' || entry.name === 'node_modules') continue;
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else trackedFiles.push('ops/k40/' + rel);
    }
  };
  walk(k40Dir, '');
  trackedFiles.sort();

  return {
    workflows: workflowsLedger,
    figureTemplates: figureLedger,
    k40HostAssets: { trackedFiles },
  };
}

function main() {
  const ledger = computeSystemLedger();
  const text = stableStringify(ledger);

  if (process.argv.includes('--write')) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const previous = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : null;
    if (previous === text) {
      console.log('台账已是最新，无需写入');
      return 0;
    }
    fs.writeFileSync(OUT_FILE, text, 'utf8');
    console.log('已写入 ' + path.relative(REPO, OUT_FILE));
    console.log('  workflows: ' + ledger.workflows.totalSeries + ' 系列 / '
      + ledger.workflows.totalMods + ' Mod / ' + ledger.workflows.boundScriptsCount
      + ' 有母版 / 断链 ' + ledger.workflows.missingScripts.length);
    console.log('  figureTemplates: ' + ledger.figureTemplates.total + ' 模板 / '
      + ledger.figureTemplates.readyCount + ' 就绪 / '
      + ledger.figureTemplates.pendingCount + ' pending');
    return 0;
  }

  process.stdout.write(text);
  return 0;
}

// 只有被直接执行时才跑 main；被 import 时只暴露 computeSystemLedger 给测试
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main());
