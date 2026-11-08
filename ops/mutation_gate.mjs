#!/usr/bin/env node
/**
 * 变异门禁（T2-6，第 8 道门禁）。
 *
 * 存在的理由：T2-1..T2-7 的红测证明「修好能让门禁红」，但没人证明「改坏能让门禁红」。
 * 没有后者，一次回退（把 SACRED_PATTERNS 里的 BioanalysDesktop/ 删掉、把 ledger --check
 * 改回恒 0）可以静默存活到下一次发版，而且所有测试仍然全绿。
 *
 * 每条变异都跑两遍，缺一遍就不算自证：
 *   1. 基线：原实现上守护判据必须**绿**（否则「红」是廉价噪声，不是证据）；
 *   2. 变异：注入真实破坏后守护判据必须**红**（否则这条防线可以无声回退）。
 *
 * 铁律（gates.md 第七节）：变异只在**临时副本**上做，绝不原地改仓库文件。
 * Lead 与多个 teammate 共用同一工作树，一次 writeFileSync 覆盖就能让别人正在跑的测试假红。
 *
 * 用法：
 *   node ops/mutation_gate.mjs           跑全部变异
 *   node ops/mutation_gate.mjs --json    机器读
 * 退出码：0 全部抓住，1 有变异存活（或锚点漂移导致变异没法施加）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const SCOPE_ROOT = path.join(REPO, '.tmp', 'mutation_gate');

/**
 * 每轮临时作用域：先清空再建，跑完在 finally 里删干净。
 *
 * 目录名必须带上**本次进程**的唯一后缀。原来用固定的 .tmp/mutation_gate/<id>，
 * 而 run_all_gates.test.js 里会真跑门禁链（三次），与全量测试里同时在跑的
 * 「变异门禁」条目撞在同一批目录上：一方 forceRemove 正好删掉另一方正在写的夹具，
 * 表现为**随机红**（实测同一文件连跑三次结果不同，门禁本体单独跑永远绿）。
 * 用进程号 + 随机后缀，两边的写入范围就天然隔离。
 */
const SCOPE_RUN_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

function freshScope(id) {
  const dir = path.join(SCOPE_ROOT, SCOPE_RUN_ID, id);
  forceRemove(dir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 递归删除，Windows 上要跟只读属性打交道。
 *
 * M2 的探针仓是现造的 git 仓库，git 把 .git/objects 下的文件写成只读，
 * fs.rmSync({force:true}) 在 Windows 上仍会 EPERM（实测：门禁在 gate:all 里偶发红，
 * 单独跑却绿——这正是「偶发」的来源）。这里先清只读位再删，并带重试。
 */
function forceRemove(dir) {
  const stripReadonly = (target) => {
    let entries = [];
    try { entries = fs.readdirSync(target, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(target, entry.name);
      try { fs.chmodSync(full, 0o666); } catch { /* 只读位清不掉就交给下面的重试 */ }
      if (entry.isDirectory()) stripReadonly(full);
    }
  };
  try { fs.chmodSync(dir, 0o777); } catch { /* 目录可能已不存在 */ }
  stripReadonly(dir);
  // maxRetries/retryDelay 让杀软或索引服务短暂占用句柄的情况能自愈
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}

function dropScope(id) {
  forceRemove(path.join(SCOPE_ROOT, SCOPE_RUN_ID, id));
}

function cloneInto(scope, relPath, asName) {
  const to = path.join(scope, asName || relPath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(REPO, relPath), to);
  return to;
}

/**
 * 施加变异：逐条字面替换，任何一条锚点没命中就抛错。
 * 锚点漂移（源码被改写而这里没跟上）必须响亮失败：那说明门禁已经瞎了，不是通过。
 */
function applyEdits(file, edits) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;
  for (const edit of edits) {
    if (!after.includes(edit.find)) {
      throw new Error('变异锚点未命中（源码已漂移，本门禁需同步更新）：' + JSON.stringify(edit.find.slice(0, 70)));
    }
    after = after.replace(edit.find, edit.replace);
  }
  if (after === before) throw new Error('变异前后字节相同，这是在自证，不是反证');
  fs.writeFileSync(file, after, 'utf8');
  return after;
}

function runNode(args, { cwd = REPO } = {}) {
  const env = { ...process.env };
  // node --test 会把 NODE_TEST_CONTEXT 注入子进程；被驱动脚本内部再起 node --test 时
  // 会走 child 报告器、拿不到 TAP 汇总行（gates.md 第三节点名的陷阱）。
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, args, {
    cwd, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024, env,
  });
  return { code: result.status, text: (result.stdout || '') + (result.stderr || '') };
}

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

let importSeq = 0;
/** 每次 import 带独立查询串，避免同一进程里拿到上一次变异前的模块实例。 */
async function loadModule(file) {
  importSeq += 1;
  return import(pathToFileURL(file).href + '?mutation=' + importSeq);
}

/** 最小 metrics 探针仓：3 条真用例（或空测试目录）+ 可改的 README 基线。 */
function buildMetricsProbeRepo(scope, metricsFile, { emptyTests = false, baseline }) {
  const dir = path.join(scope, 'probe_repo');
  fs.rmSync(dir, { recursive: true, force: true });
  for (const sub of ['ops', 'shared', 'BioanalysDesktop/tests']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  // 探针仓里的 metrics_sync 用当前待测的那一份（基线跑原实现、变异跑改写副本）
  fs.copyFileSync(metricsFile, path.join(dir, 'ops', 'metrics_sync.mjs'));
  fs.copyFileSync(path.join(REPO, 'ops', 'skip_reason_gate.mjs'), path.join(dir, 'ops', 'skip_reason_gate.mjs'));
  fs.writeFileSync(path.join(dir, 'shared', 'x.js'), 'export const x = 1;\n', 'utf8');
  if (!emptyTests) {
    for (const name of ['a', 'b', 'c']) {
      fs.writeFileSync(path.join(dir, 'BioanalysDesktop', 'tests', name + '.test.js'),
        "import test from 'node:test';\ntest('" + name + "', () => {\n});\n", 'utf8');
    }
  }
  fs.writeFileSync(path.join(dir, 'BioanalysDesktop', 'README.md'), '# probe\n\n' + baseline + '\n', 'utf8');
  return dir;
}

/** 造一个带一条已跟踪日志 + 一条未跟踪日志的一次性 git 仓库。 */
function buildCleanProbeRepo(scope) {
  const dir = path.join(scope, 'repo');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const old = new Date('2000-01-01T00:00:00Z');
  for (const name of ['tracked.log', 'untracked.log']) {
    const full = path.join(dir, name);
    fs.writeFileSync(full, name, 'utf8');
    fs.utimesSync(full, old, old);
  }
  git(['init', '-q'], dir);
  git(['add', 'tracked.log'], dir);
  return dir;
}

/** 造一个被 scan 到的 portal 坏 shell：static_gate 必须点名它。 */
function buildStaticProbe(scope, gateFile) {
  const dir = path.join(scope, 'static');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'ops'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'portal'), { recursive: true });
  fs.copyFileSync(gateFile, path.join(dir, 'ops', 'static_gate.mjs'));
  fs.writeFileSync(path.join(dir, 'portal', 'broken.sample.sh'), 'if then fi\n', 'utf8');
  return dir;
}

/**
 * M7 的变异不是文本替换，是「把注册表里某一位十六进制数翻掉」。
 * 这里把 build_figure_templates 的 REPO / REGISTRY_PATH 两个锚点改写到副本上，
 * 再翻一位，让 --check 面对一份真实但被篡改的注册表。
 */
function buildPreviewShaMutation(scope) {
  let src = fs.readFileSync(path.join(REPO, 'ops', 'build_figure_templates.cjs'), 'utf8');
  const repoLine = "const REPO = path.resolve(__dirname, '..');";
  const registryLine = "const REGISTRY_PATH = path.join(REPO, 'tools', 'bio', 'figure_templates.json');";
  if (!src.includes(repoLine) || !src.includes(registryLine)) {
    throw new Error('变异锚点未命中（build_figure_templates 的 REPO/REGISTRY_PATH 已漂移）');
  }
  const copyJson = path.join(scope, 'tools', 'bio', 'figure_templates.json');
  fs.mkdirSync(path.dirname(copyJson), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'tools', 'bio', 'figure_templates.json'), copyJson);
  src = src.replace(repoLine, 'const REPO = ' + JSON.stringify(REPO) + ';');
  src = src.replace(registryLine, 'const REGISTRY_PATH = ' + JSON.stringify(copyJson) + ';');
  const patched = path.join(scope, 'build_check.cjs');
  fs.writeFileSync(patched, src, 'utf8');
  const text = fs.readFileSync(copyJson, 'utf8');
  const hit = text.match(/"preview_sha256": "([0-9a-f])/);
  if (!hit) throw new Error('变异锚点未命中（注册表里没有 preview_sha256）');
  const flipped = hit[1] === '0' ? '1' : '0';
  const mutated = text.replace(hit[0], '"preview_sha256": "' + flipped);
  if (mutated === text) throw new Error('变异前后字节相同，这是在自证，不是反证');
  fs.writeFileSync(copyJson, mutated, 'utf8');
  return patched;
}

/**
 * 七条变异。每条给四样东西：改哪一行、怎么改、守护判据是什么、以及
 * guard(file) 返回 true 表示「守护判据绿」（即这条防线还活着）。
 * guard 跑两遍：原实现必须 true，变异副本必须 false。
 */
export const MUTATIONS = Object.freeze([
  {
    id: 'm1_clean_sacred',
    layer: 'infra',
    label: 'M1 clean_workspace 神圣名单去掉 BioanalysDesktop/',
    target: 'ops/clean_workspace.mjs',
    guardLabel: 'T2-1 断言 1/2：BioanalysDesktop/.tmp 必须被神圣名单熔断',
    edits: [{ find: "  'BioanalysDesktop/',\n", replace: '' }],
    async guard(file) {
      const mod = await loadModule(file);
      try {
        mod.assertNotSacred(path.join(REPO, 'BioanalysDesktop', '.tmp'));
        return { green: false, detail: 'BioanalysDesktop/.tmp 被放行（神圣名单失效）' };
      } catch (error) {
        if (String(error.code) === 'ERR_SACRED_PATH_PROTECTED') {
          return { green: true, detail: '护栏熔断 ERR_SACRED_PATH_PROTECTED' };
        }
        return { green: false, detail: '抛了非预期错误：' + error.message };
      }
    },
  },
  {
    id: 'm2_clean_continue',
    layer: 'infra',
    label: 'M2 clean_workspace 把「已跟踪则跳过」写成 return（清理退化成空转）',
    target: 'ops/clean_workspace.mjs',
    guardLabel: 'T2-1 断言 3：未跟踪的过期日志仍必须进入清理集',
    edits: [{
      find: 'if (tracked.size > 0 && tracked.has(toRepoRelative(root, full))) continue;',
      replace: 'if (tracked.size > 0 && tracked.has(toRepoRelative(root, full))) return;',
    }],
    async guard(file, scope) {
      // 探针仓必须建在本次临时作用域（.tmp/mutation_gate/<id>）里。
      // 首版误用 path.dirname(file)（也就是 ops/）当作用域根，结果在 ops/ 下造出
      // ops/static/、ops/probe_repo/ 两棵含 spawnSync 的副本树，把 proc_seam_guard 打红。
      const repoDir = buildCleanProbeRepo(scope || path.dirname(file));
      const mod = await loadModule(file);
      const targets = mod.scanTargets({ root: repoDir, keepDays: 0, onWarn: () => {} });
      const names = targets.map((t) => path.relative(repoDir, t.path).split(path.sep).join('/'));
      if (names.includes('tracked.log')) {
        return { green: false, detail: '已跟踪日志进入了删除集：' + JSON.stringify(names) };
      }
      if (!names.includes('untracked.log')) {
        return { green: false, detail: '未跟踪的过期日志也被放过，清理退化成空转：' + JSON.stringify(names) };
      }
      return { green: true, detail: '删除集恰为未跟踪的过期日志：' + JSON.stringify(names) };
    },
  },
  {
    id: 'm3_metrics_substring',
    layer: 'infra',
    label: 'M3 metrics_sync 精确相等回退成 includes 子串判定',
    target: 'ops/metrics_sync.mjs',
    guardLabel: 'T2-3 断言 1/2：基线 7 / 13 与实测 3 必须判红',
    edits: [{
      find: "const measure = (value, unit) => new RegExp('\\\\b' + value + '\\\\s+' + unit + '\\\\b').test(actual);",
      replace: 'const measure = (value, unit) => actual.includes(String(value));',
    }],
    async guard(file, scope) {
      const baseline = '当前基线 **7 tests / 1 pass / 0 fail / 0 skipped**（3 个测试文件；口径由 ops/metrics_sync.mjs 实测 node --test 汇总行）';
      const probeRepo = buildMetricsProbeRepo(scope || path.dirname(file), file, { baseline });
      const r = runNode(['ops/metrics_sync.mjs', '--check'], { cwd: probeRepo });
      // 守护判据绿 = 「基线 7 与实测 3 不等被拒绝」，即 exit 非 0
      return { green: r.code !== 0, detail: '基线 7 vs 实测 3 -> exit ' + r.code };
    },
  },
  {
    id: 'm4_metrics_zero',
    layer: 'infra',
    label: 'M4 metrics_sync 去掉「用例数为 0 判未实测」',
    target: 'ops/metrics_sync.mjs',
    guardLabel: 'T2-3 断言 3：测试目录清空后必须判红，不许全绿',
    edits: [{ find: 'if (cases === null || pass === null || cases === 0) {', replace: 'if (cases === null || pass === null) {' }],
    async guard(file, scope) {
      const baseline = '当前基线 **0 tests / 0 pass / 0 fail / 0 skipped**（3 个测试文件）';
      const probeRepo = buildMetricsProbeRepo(scope || path.dirname(file), file, { baseline, emptyTests: true });
      const r = runNode(['ops/metrics_sync.mjs', '--check'], { cwd: probeRepo });
      // 绿 = 用例清零被拒绝（exit 非 0）
      return { green: r.code !== 0, detail: '用例清零 -> exit ' + r.code };
    },
  },
  {
    id: 'm5_ledger_check',
    layer: 'infra',
    label: 'M5 ledger_gen 废掉 --check 分支（退回打印整份台账并 exit 0）',
    target: 'ops/ledger_gen.mjs',
    guardLabel: 'T2-4 断言 1/2：--check 必须真比对，不得打印整份台账',
    // 副本落在 .tmp 下，ledger_gen 按自身位置推导 REPO，会把仓库根算错（实测直接 ENOENT）。
    // 先把 REPO 锚点钉回真仓库，变异才只落在「--check 分支」这一个变量上。
    repin: [{ find: "const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');", replace: 'const REPO = ' + JSON.stringify(REPO) + ';' }],
    edits: [{ find: "if (process.argv.includes('--check')) {", replace: "if (process.argv.includes('--check-disabled')) {" }],
    async guard(file) {
      const r = runNode([file, '--check']);
      // 绿 = 不打印整份台账（无论结论绿红，--check 的输出都不该是台账本体）
      const dumped = r.text.includes('"figureTemplates"');
      return { green: !dumped, detail: 'exit ' + r.code + '，输出' + (dumped ? '含整份台账' : '只有结论') };
    },
  },
  {
    id: 'm6_static_scan',
    layer: 'behavior',
    label: 'M6 static_gate 扫描面回退成旧五目录（portal/tests/src/docs 失守）',
    target: 'ops/static_gate.mjs',
    guardLabel: 'T2-5 断言 1/3：portal/ 语法错文件必须被扫到并报红',
    edits: [{
      find: "const SCAN_DIRS = ['ops', 'src', 'shared', 'bin', 'BioanalysDesktop/server', 'BioanalysDesktop/tests', 'BioanalysDesktop/src', 'portal', 'docs'];",
      replace: "const SCAN_DIRS = ['ops', 'src', 'shared', 'bin', 'BioanalysDesktop/server'];",
    }],
    async guard(file, scope) {
      const probe = buildStaticProbe(scope || path.dirname(file), file);
      const r = runNode([path.join(probe, 'ops', 'static_gate.mjs')], { cwd: probe });
      // 绿 = 输出点名 portal/broken.sample.sh（该文件被扫到并有语法问题）
      const named = r.text.includes('portal/broken.sample.sh');
      return { green: named, detail: 'portal 坏文件被' + (named ? '点名' : '漏扫') + '，exit ' + r.code };
    },
  },
  {
    id: 'm7_preview_sha',
    layer: 'behavior',
    label: 'M7 build_figure_templates 的 preview_sha256 改一位（证据漂移）',
    target: 'ops/build_figure_templates.cjs',
    guardLabel: 'figure_registry 门禁：注册表必须与 CSV/r453 证据同步',
    shaEdit: true,
    async guard(file) {
      // 基线用仓库原脚本（一致时应绿）；变异用改写副本（篡改一位后应红）
      const r = runNode([file, '--check'], { cwd: REPO });
      // 绿 = exit 0（注册表与证据一致）
      return { green: r.code === 0, detail: 'figure_registry --check exit ' + r.code };
    },
  },
  {
    id: 'm8_router_tiebreak',
    layer: 'behavior',
    label: 'M8 router_lib 去掉「最长命中词」决胜（改回声明顺序撞大运）',
    target: 'ops/router_lib.mjs',
    guardLabel: 'router_eval：做空间解卷积必须命中 route-l3-deconv',
    edits: [{
      find: 'cand.hits === best.hits && cand.longest > best.longest',
      replace: 'false',
    }],
    async guard(file) {
      const mod = await loadModule(file);
      const doc = mod.loadRouter(path.join(REPO, 'ROUTER.yaml'));
      const r = mod.matchRoute(doc.routes, '做空间解卷积');
      const got = r ? r.id : null;
      if (got !== 'route-l3-deconv') {
        return { green: false, detail: '匹配落到 ' + got + '（应为 route-l3-deconv）' };
      }
      return { green: true, detail: '命中 route-l3-deconv' };
    },
  },
  {
    id: 'm9_router_ghost_script',
    layer: 'behavior',
    label: 'M9 router_lib 不再校验 allowed_scripts 是否存在（幽灵脚本放行）',
    target: 'ops/router_lib.mjs',
    guardLabel: 'router_gate：引用不存在的 Mod ID 必须报红',
    edits: [{
      find: 'errs.push(tag + " allowed_scripts 引用了不存在的脚本: " + s);',
      replace: 'void s;',
    }],
    async guard(file) {
      const mod = await loadModule(file);
      const doc = mod.loadRouter(path.join(REPO, 'ROUTER.yaml'));
      const { modIds, seriesIds } = mod.loadModIds(path.join(REPO, 'tools/bio/workflows.json'));
      const opsScripts = mod.listOpsScripts(path.join(REPO, 'ops'));
      const probe = JSON.parse(JSON.stringify(doc));
      probe.routes[0].allowed_scripts.push('l3_ghost_mod');
      const errs = mod.validateRouter(probe, { modIds, opsScripts, seriesIds });
      const hit = errs.some((e) => String(e).includes('l3_ghost_mod'));
      if (!hit) return { green: false, detail: '幽灵脚本被放行，errs=' + JSON.stringify(errs) };
      return { green: true, detail: '幽灵脚本被点名' };
    },
  },
  {
    id: 'm10_fig_ghost_mod',
    layer: 'behavior',
    label: 'MUT-FIG-A partition 不再校验 producing_mod_id 外键（幽灵 Mod 放行）',
    target: 'ops/lib/figure_status_partition.mjs',
    guardLabel: 'figure_status_partition：ready 模板 producing_mod_id 不在 workflows.json 必判 invalid',
    edits: [{ find: '!modIds.has(t.producing_mod_id)', replace: 'false' }],
    async guard(file) {
      const mod = await loadModule(file);
      const probe = [{ id: 'fig_probe', status: 'ready', producing_mod_id: 'mod_ghost_999', preview_sha256: 'a'.repeat(64), data_contract: { input_artifact: 'x.tsv' } }];
      const { invalid } = mod.partitionByStatus(probe);
      const hit = invalid.some((i) => i.reason === 'invalid_ready_contract');
      if (!hit) return { green: false, detail: '幽灵 producing_mod_id 被放行，invalid=' + JSON.stringify(invalid) };
      return { green: true, detail: '幽灵外键被判 invalid_ready_contract' };
    },
  },
  {
    id: 'm11_fig_unschedulable',
    layer: 'behavior',
    label: 'MUT-FIG-B figure_schedule 缺前置 Mod 不再阻断（UNSCHEDULABLE 放行）',
    target: 'BioanalysDesktop/server/figure_schedule.js',
    guardLabel: 'validateFigureSchedule：required_mod_ids 未被覆盖必返回 UNSCHEDULABLE_FIGURE',
    edits: [{ find: 'if (missing.length > 0) {', replace: 'if (false) {' }],
    async guard(file) {
      const mod = await loadModule(file);
      const registry = [{ id: 'fig_probe', status: 'ready', required_mod_ids: ['l3_dimred_domains', 'l3_figures_spatial'] }];
      const res = mod.validateFigureSchedule(['l3_figures_spatial'], [{ template_id: 'fig_probe' }], registry);
      const hit = res.violations.some((v) => v.code === 'UNSCHEDULABLE_FIGURE' && v.missing_mod_ids.includes('l3_dimred_domains'));
      if (!hit) return { green: false, detail: '缺前置 Mod 被放行，res=' + JSON.stringify(res) };
      return { green: true, detail: '缺前置 Mod 被判 UNSCHEDULABLE_FIGURE' };
    },
  },
  {
    id: 'm12_fig_draft_taint',
    layer: 'infra',
    label: 'MUT-FIG-C partition 不再拦截 draft 伪造实证（伪证放行）',
    target: 'ops/lib/figure_status_partition.mjs',
    guardLabel: 'figure_status_partition：draft 携带 preview_sha256/render_evidence 必判 invalid',
    edits: [{ find: 'if (t.preview_sha256 || t.render_evidence) {', replace: 'if (false) {' }],
    async guard(file) {
      const mod = await loadModule(file);
      const probe = [{ id: 'fig_draft', status: 'draft', preview_sha256: 'b'.repeat(64), render_evidence: null }];
      const { invalid } = mod.partitionByStatus(probe);
      const hit = invalid.some((i) => i.reason === 'draft_with_fake_evidence');
      if (!hit) return { green: false, detail: 'draft 伪证被放行，invalid=' + JSON.stringify(invalid) };
      return { green: true, detail: 'draft 伪证被判 draft_with_fake_evidence' };
    },
  },
  {
    id: 'm13_fig_draft_schedule',
    layer: 'behavior',
    label: 'MUT-FIG-C figure_schedule 不再拒绝 draft 调度（越权放行）',
    target: 'BioanalysDesktop/server/figure_schedule.js',
    guardLabel: 'validateFigureSchedule：draft 图件必返回 ERR_FIGURE_NOT_READY',
    edits: [{ find: 'if (!isReady) {', replace: 'if (false) {' }],
    async guard(file) {
      const mod = await loadModule(file);
      const registry = [{ id: 'fig_draft', status: 'draft' }];
      const res = mod.validateFigureSchedule(['l1_figures_bulk'], [{ template_id: 'fig_draft' }], registry);
      const hit = res.violations.some((v) => v.code === 'ERR_FIGURE_NOT_READY');
      if (!hit) return { green: false, detail: 'draft 调度被放行，res=' + JSON.stringify(res) };
      return { green: true, detail: 'draft 调度被判 ERR_FIGURE_NOT_READY' };
    },
  },
  {
    id: 'm14_figcode_font',
    layer: 'behavior',
    label: 'MUT-FIGCODE-A 母版字号回归 fontsize=7 必须被第 20 道门禁检出',
    target: 'tools/bio/line1_bulk/scripts/bulk_figures',
    guardLabel: 'figure_code_gate：母版出现 fontsize=7 时 blocking>0',
    edits: [{ find: 'fontsize=8', replace: 'fontsize=7' }],
    async guard(file, scope) {
      const probe = path.join(scope, 'probe_a');
      fs.mkdirSync(path.join(probe, 'cn_debug'), { recursive: true });
      fs.mkdirSync(path.join(probe, 'tools', 'bio', 'line1_bulk', 'scripts'), { recursive: true });
      fs.copyFileSync(path.join(REPO, 'cn_debug', 'figure_code_audit.py'), path.join(probe, 'cn_debug', 'figure_code_audit.py'));
      fs.copyFileSync(file, path.join(probe, 'tools', 'bio', 'line1_bulk', 'scripts', 'bulk_figures'));
      const gate = await loadModule(path.join(REPO, 'ops', 'figure_code_gate.mjs'));
      const res = gate.checkFigureCode(probe);
      return { green: res.blocking === 0, detail: 'blocking=' + res.blocking };
    },
  },
  {
    id: 'm15_figcode_exit',
    layer: 'infra',
    label: 'MUT-FIGCODE-B 门禁退出码诚实度（有违规仍判 ok 必红）',
    target: 'ops/figure_code_gate.mjs',
    guardLabel: 'figure_code_gate：含 fontsize=6 夹具时 ok 必须为 false',
    edits: [{ find: 'const ok = errors.length === 0 && blocking === 0;', replace: 'const ok = true;' }],
    async guard(file, scope) {
      const probe = path.join(scope, 'probe_b');
      fs.mkdirSync(path.join(probe, 'cn_debug'), { recursive: true });
      fs.mkdirSync(path.join(probe, 'tools', 'bio', 'line1_bulk', 'scripts'), { recursive: true });
      fs.copyFileSync(path.join(REPO, 'cn_debug', 'figure_code_audit.py'), path.join(probe, 'cn_debug', 'figure_code_audit.py'));
      const master = '#!/usr/bin/env bash\nset -euo pipefail\npython3 - <<\'PYSCRIPT\'\nimport matplotlib\nmatplotlib.use("Agg")\nimport matplotlib.pyplot as plt\nplt.rcParams.update({"savefig.dpi": 300})\nfig = plt.figure()\nfig.text(0.01, -0.02, "x", fontsize=6)\nfig.savefig("figures/x.png", dpi=300)\nplt.close("all")\nPYSCRIPT\n';
      fs.writeFileSync(path.join(probe, 'tools', 'bio', 'line1_bulk', 'scripts', 'probe_fig'), master);
      const gate = await loadModule(file);
      const res = gate.checkFigureCode(probe);
      return { green: res.ok === false, detail: 'ok=' + res.ok + ' blocking=' + res.blocking };
    },
  },
  {
    id: 'm16_figcode_c13',
    layer: 'behavior',
    label: 'MUT-FIGCODE-C 审计器 C13（plt.close）规则失效必红',
    target: 'cn_debug/figure_code_audit.py',
    guardLabel: 'figure_code_gate：缺 plt.close 的探针必须被 C13 检出 blocking>0',
    edits: [{ find: 'if has_pyplot and has_savefig and not re.search(r"plt\\.close\\(|pyplot\\.close\\(", text):', replace: 'if False:' }],
    async guard(file, scope) {
      const probe = path.join(scope, 'probe_c');
      fs.mkdirSync(path.join(probe, 'cn_debug'), { recursive: true });
      fs.mkdirSync(path.join(probe, 'tools', 'bio', 'line1_bulk', 'scripts'), { recursive: true });
      fs.copyFileSync(file, path.join(probe, 'cn_debug', 'figure_code_audit.py'));
      const master = '#!/usr/bin/env bash\nset -euo pipefail\npython3 - <<\'PYSCRIPT\'\nimport matplotlib\nmatplotlib.use("Agg")\nimport matplotlib.pyplot as plt\nplt.rcParams.update({"savefig.dpi": 300})\nfig = plt.figure()\nfig.savefig("figures/x.png", dpi=300)\nPYSCRIPT\n';
      fs.writeFileSync(path.join(probe, 'tools', 'bio', 'line1_bulk', 'scripts', 'probe_fig'), master);
      const gate = await loadModule(path.join(REPO, 'ops', 'figure_code_gate.mjs'));
      const res = gate.checkFigureCode(probe);
      return { green: res.blocking > 0, detail: 'blocking=' + res.blocking + ' kinds=' + JSON.stringify(res.byKind) };
    },
  },
  {
    id: 'm17_portal_catalog',
    layer: 'behavior',
    label: 'MUT-PORTAL-A 目录双射失效（幽灵 Mod 放行）',
    target: 'BioanalysDesktop/server/mod_schedule.js',
    guardLabel: 'assertCatalogParity：无母版的幽灵 Mod 必须判 orphan',
    edits: [{ find: 'return { ok: orphans.length === 0, orphan_mods: orphans };', replace: 'return { ok: true, orphan_mods: orphans };' }],
    async guard(file) {
      const mod = await loadModule(file);
      const stub = { series: [{ id: 'line1_bulk', stages: [{ order: 1, required: true, mods: [{ id: 'mod_fake_99', script: 'no_such_script' }] }] }] };
      const res = mod.assertCatalogParity(stub, () => false);
      return { green: res.ok === false && res.orphan_mods.includes('line1_bulk/mod_fake_99'), detail: 'ok=' + res.ok + ' orphans=' + JSON.stringify(res.orphan_mods) };
    },
  },
  {
    id: 'm18_portal_dag',
    layer: 'behavior',
    label: 'MUT-PORTAL-B 依赖闭包阻断失效（漏选上游放行）',
    target: 'BioanalysDesktop/server/mod_schedule.js',
    guardLabel: 'validateModSchedule：仅选下游漏上游必须 UNSCHEDULABLE_MOD_DAG',
    edits: [{ find: 'if (missing.length > 0) {', replace: 'if (false) {' }],
    async guard(file) {
      const mod = await loadModule(file);
      const stub = { series: [{ id: 'line1_bulk', stages: [{ order: 1, required: true, mods: [{ id: 'up' }] }, { order: 2, required: false, mods: [{ id: 'down' }] }] }] };
      const res = mod.validateModSchedule(['down'], [], stub);
      return { green: res.ok === false && res.code === 'UNSCHEDULABLE_MOD_DAG', detail: 'ok=' + res.ok + ' missing=' + JSON.stringify(res.missing_upstream_mods) };
    },
  },
  {
    id: 'm19_portal_parity',
    layer: 'behavior',
    label: 'MUT-PORTAL-C 计划恒等失效（漏跑/私加放行）',
    target: 'BioanalysDesktop/server/mod_schedule.js',
    guardLabel: 'assertPlanModParity：编译步骤漏跑必须判 dropped',
    edits: [{ find: 'return { ok: dropped.length === 0 && unrequested.length === 0, dropped_steps: dropped, unrequested_steps: unrequested };', replace: 'return { ok: true, dropped_steps: dropped, unrequested_steps: unrequested };' }],
    async guard(file) {
      const mod = await loadModule(file);
      const res = mod.assertPlanModParity(['a'], ['a', 'b']);
      return { green: res.ok === false && res.dropped_steps.includes('b'), detail: 'ok=' + res.ok + ' dropped=' + JSON.stringify(res.dropped_steps) };
    },
  },
]);

async function runOne(mutation) {
  const scope = freshScope(mutation.id);
  try {
    let greenRun;
    let redRun;
    if (mutation.shaEdit) {
      greenRun = await mutation.guard(path.join(REPO, 'ops', 'build_figure_templates.cjs'), scope);
      if (greenRun.green !== true) {
        return { greenBaseline: false, redAfterMutation: false, detail: '基线不绿，无法反证：' + greenRun.detail };
      }
      const patched = buildPreviewShaMutation(scope);
      redRun = await mutation.guard(patched, scope);
    } else {
      greenRun = await mutation.guard(path.join(REPO, mutation.target), scope);
      if (greenRun.green !== true) {
        return { greenBaseline: false, redAfterMutation: false, detail: '基线不绿，无法反证：' + greenRun.detail };
      }
      const copy = cloneInto(scope, mutation.target);
      // 副本搬到 .tmp 后 __dirname/.. 不再等于仓库根。凡用 REPO 推导素材路径的脚本，
      // 必须先把 REPO 锚点钉回真仓库，否则变异会退化成「文件找不到」，测的不是那条防线。
      if (mutation.repin) applyEdits(copy, mutation.repin);
      applyEdits(copy, mutation.edits);
      redRun = await mutation.guard(copy, scope);
    }
    return {
      greenBaseline: true,
      redAfterMutation: redRun.green === false,
      detail: '基线绿（' + greenRun.detail + '）→ 变异后' + (redRun.green === false ? '红（' : '仍绿（') + redRun.detail + '）',
    };
  } catch (error) {
    // 锚点漂移 / 变异没法施加，一律算「没抓住」：门禁已经瞎了，不能算通过。
    return { greenBaseline: false, redAfterMutation: false, detail: '变异无法施加：' + error.message };
  } finally {
    // 清理失败不能掩盖判定结论：删不掉只记一行提示，判定已经算完了。
    try { dropScope(mutation.id); } catch (error) {
      console.error('[ WARN ] 临时作用域未能清理：' + mutation.id + '（' + error.message + '），可手工删 .tmp/mutation_gate');
    }
  }
}

export async function runAllMutations() {
  const results = [];
  for (const mutation of MUTATIONS) {
    const outcome = await runOne(mutation);
    const caught = outcome.greenBaseline === true && outcome.redAfterMutation === true;
    results.push({
      id: mutation.id, label: mutation.label, guardLabel: mutation.guardLabel,
      // layer 必须从用例透传到结果：首版漏了这一步，汇总把 7 条全算成 unknown。
      layer: mutation.layer,
      greenBaseline: outcome.greenBaseline, redAfterMutation: outcome.redAfterMutation,
      caught, detail: outcome.detail,
    });
  }
  const survived = results.filter((r) => r.caught === false);
  return { ok: survived.length === 0, results, survived };
}

export async function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  const asJson = argv.includes('--json');
  const outcome = await runAllMutations();
  if (asJson) {
    io.log(JSON.stringify({
      ok: outcome.ok,
      total: outcome.results.length,
      caught: outcome.results.filter((r) => r.caught).length,
      survived: outcome.survived.map((r) => r.id),
      mutations: outcome.results,
      layers: layerStats,
    }, null, 2));
    return outcome.ok ? 0 : 1;
  }
  io.log('变异门禁（' + outcome.results.length + ' 条防线，'
    + (outcome.survived.length === 0 ? '全部抓住' : outcome.survived.length + ' 条存活') + '）');
  for (const r of outcome.results) {
    io.log((r.caught ? '[ OK ] ' : '[ RED] ') + r.label);
    io.log('       守护判据: ' + r.guardLabel);
    io.log('       结果: ' + r.detail);
  }
  // 分层统计（Argon 第 67 轮 Q4a）：infra 与 behavior 两层的硬判据都是 escaped === 0，
  // 分层只用于故障定界，不给任何一层放水。
  const layerStats = {};
  for (const r of outcome.results) {
    const L = r.layer || 'unknown';
    layerStats[L] = layerStats[L] || { total: 0, escaped: 0 };
    layerStats[L].total += 1;
    if (!r.caught) layerStats[L].escaped += 1;
  }
  const layerText = Object.entries(layerStats)
    .map(([k, v]) => k + '=' + (v.total - v.escaped) + '/' + v.total)
    .join(' ');
  const layerOk = Object.values(layerStats).every((v) => v.escaped === 0);
  if (outcome.ok && layerOk) {
    io.log('MUTATION_GATE_OK ' + outcome.results.length + ' 条变异全部被对应判据抓住（每条都先验基线绿、再验变异红）｜分层 ' + layerText + '｜escaped 两层均为 0');
    return 0;
  }
  io.error('');
  io.error('MUTATION_GATE_FAILED ' + outcome.survived.length + ' 条变异存活（对应门禁没变红）：'
    + outcome.survived.map((r) => r.id).join(', '));
  io.error('这表示那条防线已经可以在不被发现的情况下回退。');
  return 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error('MUTATION_GATE_FAILED 内部异常：' + error.message);
    process.exitCode = 1;
  });
}
