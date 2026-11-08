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
 *   node ops/ledger_gen.mjs --check   只比对：磁盘台账与现算结果字节级一致才 exit 0，差异 exit 1
 *   node ops/ledger_gen.mjs           打印到 stdout（人看，不参与门禁）
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

/** 收集全部分析母版脚本的相对路径（tools/bio/<line>/scripts/ 下的无扩展名文件与脚本） */
function collectMasterScripts() {
  const out = new Set();
  const srcDir = path.join(REPO, 'tools', 'bio');
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
      out.add(path.posix.join('tools/bio', line.name, 'scripts', entry.name));
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
  const workflows = readJson('tools/bio/workflows.json');
  const templates = readJson('tools/bio/figure_templates.json');
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
  // 待办瘦身定性（2026-11-02，4 Argon 第十二轮第 4 节 / docs/figure_pending_triage.md）：
  // 55 个 pending 里有相当一部分永远不该准入（地理地图、商业信息图、跨组学 GWAS/突变图），
  // 继续挂在 pending 里会把技术债的数字虚高。这里按图型语义做一次显式定性，
  // 骨架判据写在 docs/figure_pending_triage.md，名单只在这里维护（一个含义一个真源）。
  //
  // excluded_out_of_scope：图型语义与转录组三线交付无关，永久冻结，不再是待办
  // blocked_upstream    ：语义相关但上游 Step 尚未声明对应产物表，等算法开发
  // actionable          ：有上游表支撑、可按单逐模板准入的真待办
  // 解冻（2026-11-02，4 Argon 第十三轮第 3 节）：桑基/冲积图与三元图曾被归入
  // 「商业信息图」，但 R 4.5.3 已装 ggalluvial（纯静态 ggplot2 扩展，非 htmlwidget），
  // 且 cellcomm_interactions.tsv 与 dr_regulatory_network.tsv 都能支撑三级调控流向；
  // 三元图在三个亚群/三个 Domain 的相对归属对比上是经典静态统计图。
  // 故这两类回到 actionablePending，只保留真正依赖网页交互组件的条目在冻结池。
  const EXCLUDED_IDS = new Set([
    // 商业信息图 / 交互组件：无法表达误差与统计显著性，或依赖 htmlwidgets
    'fig_l1_circularpacking', 'fig_l1_donut', 'fig_l1_partpiechart', 'fig_l1_piechart',
    'fig_l1_treemap', 'fig_l1_waffle', 'fig_l1_streamgraph', 'fig_l1_radialstackedbar',
    'fig_l1_radialcolumnchart', 'fig_l1_circularbarplot', 'fig_l3_sankeybubbleplot',
    'fig_l2_mosaicplot',
    // 跨组学专有图型：转录组上游不产出 SNP 坐标 / VCF 突变 / CNV 区段
    'fig_l2_manhattanplot', 'fig_l2_mutationoncoplot', 'fig_l2_chromosomeplot',
    'fig_l2_genestructureplot',
    // 时间序列 / 地理类：GEO bulk 样本没有等间隔时间轴，也没有地理坐标
    'fig_l1_areachart', 'fig_l1_linechart', 'fig_l1_stackedarea', 'fig_l1_timeseries',
    'fig_l1_breakplot',
    // 网页交互式
    'fig_l2_ivolcanoplot',
  ]);
  const BLOCKED_UPSTREAM_IDS = new Set([
    // 上游确实声明了产物，但当前示例项目里没有这些表的行数证据，先挂账等真机复核
  ]);
  const actionablePending = [];
  const blockedUpstream = [];
  const frozenOutOfScope = [];
  // blocked_r453（只有 fig_kegg_pathway 一条，交接已裁定）既不是真待办也不是冻结：
  // 它等的是一个尚不存在的母版，语义上属于 blocked_upstream 家族。
  const BLOCKED_R453_IDS = new Set(['fig_kegg_pathway']);
  for (const item of pendingDetails) {
    if (BLOCKED_R453_IDS.has(item.id)) blockedUpstream.push(item.id);
    else if (EXCLUDED_IDS.has(item.id)) frozenOutOfScope.push(item.id);
    else if (BLOCKED_UPSTREAM_IDS.has(item.id)) blockedUpstream.push(item.id);
    else actionablePending.push(item.id);
  }
  const figureLedger = {
    total: list.length,
    readyCount,
    pendingCount: pendingDetails.length,
    // 瘦身后的三分类：pendingCount 仍是物理总数，另两个才是「还剩多少真活」
    actionablePendingCount: actionablePending.length,
    blockedUpstreamCount: blockedUpstream.length,
    frozenOutOfScopeCount: frozenOutOfScope.length,
    actionablePending,
    blockedUpstream,
    frozenOutOfScope,
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

  // `CHECK_BRANCH`（锚点：mutation_gate 的 M3 会删掉本分支，要求 T2-4 红测变红）
  // 门禁语义：--check 必须与磁盘逐字节比对，不许退化成「把台账打到 stdout 就算通过」。
  // 之前这里没有分支，--check 走的是下面的 fallthrough，于是第 4 道门禁恒绿。
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(OUT_FILE)) {
      console.error('[ RED ] 磁盘台账不存在：' + path.relative(REPO, OUT_FILE) + '，先跑 node ops/ledger_gen.mjs --write');
      return 1;
    }
    const onDisk = fs.readFileSync(OUT_FILE, 'utf8');
    if (onDisk === text) {
      console.log('[ OK ] 台账与真源一致（ledger checksum 相同）');
      return 0;
    }
    const diskLines = onDisk.split('\n');
    const nowLines = text.split('\n');
    const max = Math.max(diskLines.length, nowLines.length);
    let firstDiff = max;
    for (let i = 0; i < max; i += 1) {
      if (diskLines[i] !== nowLines[i]) { firstDiff = i + 1; break; }
    }
    console.error('[ RED ] 台账与真源不一致（ledger drift）：磁盘 ' + diskLines.length + ' 行 / 现算 '
      + nowLines.length + ' 行，首个差异在第 ' + firstDiff + ' 行');
    console.error('  磁盘: ' + JSON.stringify(diskLines[firstDiff - 1] ?? '(缺行)'));
    console.error('  现算: ' + JSON.stringify(nowLines[firstDiff - 1] ?? '(多行)'));
    console.error('  修复: node ops/ledger_gen.mjs --write');
    return 1;
  }

  process.stdout.write(text);
  return 0;
}

// 只有被直接执行时才跑 main；被 import 时只暴露 computeSystemLedger 给测试
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main());
