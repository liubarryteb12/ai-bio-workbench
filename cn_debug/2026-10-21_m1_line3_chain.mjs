/**
 * M1 DoD 取证：line3_spatial 全 17 步真机跑批（P15 切片）。
 *
 * 契约与 line1 模板（cn_debug/2026-10-21_m1_line1_chain.mjs）同源：逐步 POST
 * /api/tasks/submit，完成判定靠 /api/tasks 列表消失，结果判定读远端台账。
 * 差异集中在三处取证可靠性上（逐条理由见 con_hf/dispatch/P15_line3_chain_runner.md 第 3 节）：
 *   1. 台账定位从"时间戳比较"改成"提交前快照 + 只认新增文件"。K40 是手机、工作台是 PC，
 *      两台机器时钟可能差几十秒到几分钟，按 start_time >= 提交时刻比较会把刚写完的台账
 *      判成旧账，产生假失败；快照差集与时钟无关。
 *   2. 台账文件名加严格正则二次过滤。ls 的 glob "*_enrichment_*.json" 会同时命中
 *      "2026-10-21_PRJ_E2E_SPATIAL_line3_spatial_enrichment_figures_ab12cd34.json"
 *      （"_enrichment_" 是 "_enrichment_figures_" 的前缀），不过滤会读错步骤的账。
 *   3. ssh 层失败与台账缺失分开报：ssh 不通（255 / 超时）要查链路，账没落盘要等或查
 *      run_throttled_task.sh，两者处置完全不同，不能都报"未找到台账"。
 *
 * 逐步 inputs 按 src/line3_spatial/scripts/<step> 里母版真实读取的文件名写（物种后缀
 * _mouse / _human 成对，脚本要求两物种都必须给），不是照抄 line1 的命名。
 *
 * 用法（先另起一个工作台进程，别占用 8787）：
 *   cd BioanalysDesktop; $env:BAD_PORT='8791'; node server/index.js
 *   BASE=http://127.0.0.1:8791 node cn_debug/2026-10-21_m1_line3_chain.mjs
 *
 * 断点续跑与单步复跑：
 *   START_INDEX=5 ...       从第 6 步（0 基）开始
 *   ONLY_STEP=spatial_domains ...  只跑这一步
 *   SKIP_PREFLIGHT=1 ...    跳过输入存在性预检（默认开，缺文件不下发）
 *   KO_GENE=... ...         空间虚拟敲除的靶基因（默认 Spp1，与母版硬编码兜底一致）
 */

import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const PROJECT = process.env.PROJECT_ID || 'PRJ_E2E_SPATIAL';
const LINE = 'line3_spatial';
const SEED = Number(process.env.SEED || 20261021);
const P = '/mnt/ssd/bio_data/projects/' + PROJECT + '/' + LINE;
const LOGS = '/mnt/ssd/bio_data/system_logs';
const START = Number(process.env.START_INDEX || 0);
const ONLY = process.env.ONLY_STEP || '';
const SKIP_PREFLIGHT = process.env.SKIP_PREFLIGHT === '1';
// 母版 spatial_knockout 的 KO_GENE 现在写死 "Spp1"（src/line3_spatial/scripts/spatial_knockout:113），
// 还不读引擎注入的 BIO_KO_GENE。这里提交同值只为满足提交层必填契约，行为与母版一致。
const KO_GENE = process.env.KO_GENE || 'Spp1';

const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;
const LEDGER_WAIT_MS = 120 * 1000;

const results = [];
const warns = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
};
const warn = (name, detail = '') => {
  warns.push({ name, detail });
  console.log('WARN | ' + name + (detail ? ' | ' + detail : ''));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 单引号包裹，路径里若有单引号按 POSIX 规矩转义 */
function shellQuote(text) {
  return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

/**
 * 远端执行：命令整体 base64 后再 ssh 传。
 * 必须 base64 的原因：命令里有位置变量与花括号变量展开，直接拼进 ssh 的 argv 会被本地
 * shell 先吃掉（Windows 侧命令行同样会被 PowerShell 预处理）；base64 之后 argv 恒为
 * 一个不含特殊字符的 token，远端用 base64 -d 还原再交给 bash。
 */
function sshBash(script, timeoutMs = 120000) {
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  return execFileSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'k40-ubuntu', 'echo ' + b64 + ' | base64 -d | bash'],
    { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
  );
}

/** 不抛的 ssh：把"链路不通"与"命令退出非零"都收成返回值，供上层分开报 */
function sshTry(script, timeoutMs = 120000) {
  try {
    return { ok: true, out: sshBash(script, timeoutMs), err: '' };
  } catch (cause) {
    const stderr = typeof cause.stderr === 'string' ? cause.stderr : String(cause.stderr || '');
    const status = cause.status === undefined || cause.status === null ? 'no-exit' : cause.status;
    return {
      ok: false,
      out: typeof cause.stdout === 'string' ? cause.stdout : String(cause.stdout || ''),
      err: 'ssh exit=' + status + ' ' + (stderr || cause.message || '').trim().slice(0, 400),
    };
  }
}

/**
 * 台账文件名形态（server/run.js:160）：
 *   YYYY-MM-DD_<project>_<line>_<step>_<taskId 前 8 位>.json
 * 严格正则锚定 "_<line>_<step>_<无下划线段>.json$"：taskId 段不含下划线，
 * 因此 enrichment 不会误命中 enrichment_figures。
 */
function ledgerPattern(step) {
  return new RegExp('_' + LINE + '_' + step + '_[^_/]*\\.json$');
}

function listLedgers(step) {
  const res = sshTry(
    'ls -t ' + LOGS + '/*' + PROJECT + '*_' + step + '_*.json 2>/dev/null || true',
  );
  if (!res.ok) return { ok: false, err: res.err, files: [] };
  const re = ledgerPattern(step);
  const files = res.out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => re.test(file));
  return { ok: true, err: '', files };
}

/** 读一条台账：先 test -f 确认存在，再 cat，再解析；三类失败分开返回 */
function readLedger(file) {
  const exists = sshTry('test -f ' + shellQuote(file) + ' && echo LEDGER_YES || echo LEDGER_NO');
  if (!exists.ok) return { ok: false, kind: 'ssh', err: exists.err };
  if (!/LEDGER_YES/.test(exists.out)) return { ok: false, kind: 'missing', err: '远端无此文件: ' + file };
  const cat = sshTry('cat ' + shellQuote(file));
  if (!cat.ok) return { ok: false, kind: 'ssh', err: cat.err };
  try {
    return { ok: true, ledger: JSON.parse(cat.out) };
  } catch (cause) {
    return { ok: false, kind: 'parse', err: '台账 JSON 解析失败: ' + cause.message, raw: cat.out.slice(0, 400) };
  }
}

/** 等"提交后新出现"的台账；before 是提交前快照 */
async function waitNewLedger(step, before, timeoutMs = LEDGER_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    const listed = listLedgers(step);
    if (!listed.ok) {
      lastErr = listed.err;
      await sleep(3000);
      continue;
    }
    const fresh = listed.files.find((file) => !before.has(file));
    if (fresh) {
      const read = readLedger(fresh);
      if (read.ok) return { ledger: read.ledger, file: fresh, err: '' };
      if (read.kind === 'missing') {
        // ls 刚列出来、cat 时已不在：极端竞态，继续等下一轮
        lastErr = read.err;
        await sleep(2000);
        continue;
      }
      return { ledger: null, file: fresh, err: read.kind + ': ' + read.err };
    }
    await sleep(3000);
  }
  return { ledger: null, file: null, err: lastErr || '超时未见新增台账（' + Math.round(timeoutMs / 1000) + 's）' };
}

/** 每步的输入（按母版真实读取文件名）与预期产物（用于事后核对，缺失只 WARN） */
const STEPS = [
  {
    step: 'ingest_spatial',
    timeoutMs: 90 * 60 * 1000,
    inputs: [
      P + '/raw_data/GSE192741_RAW.tar',
      P + '/raw_data/GPL24247_family.soft.gz',
      P + '/raw_data/GPL24676_family.soft.gz',
      P + '/raw_data/grouping.txt',
    ],
    outputs: ['spatial_counts_mouse.h5ad', 'spatial_counts_human.h5ad', 'samples_meta.tsv', 'ingest_report.txt'],
  },
  {
    step: 'qc_spots',
    inputs: [P + '/processed/spatial_counts_mouse.h5ad', P + '/processed/spatial_counts_human.h5ad'],
    outputs: ['spatial_qc_mouse.h5ad', 'spatial_qc_human.h5ad', 'spot_qc_metrics.tsv', 'qc_report.txt'],
  },
  {
    step: 'normalize_hvg',
    inputs: [P + '/processed/spatial_qc_mouse.h5ad', P + '/processed/spatial_qc_human.h5ad'],
    outputs: ['spatial_norm_mouse.h5ad', 'spatial_norm_human.h5ad', 'hvg_genes_mouse.tsv', 'hvg_genes_human.tsv'],
  },
  {
    step: 'dim_reduce',
    inputs: [P + '/processed/spatial_norm_mouse.h5ad', P + '/processed/spatial_norm_human.h5ad'],
    outputs: ['spatial_dimred_mouse.h5ad', 'spatial_dimred_human.h5ad', 'dimred_report.txt'],
  },
  {
    step: 'spatial_domains',
    inputs: [P + '/processed/spatial_dimred_mouse.h5ad', P + '/processed/spatial_dimred_human.h5ad'],
    outputs: ['spatial_domains_mouse.h5ad', 'spatial_domains_human.h5ad', 'domains_report.txt'],
  },
  {
    step: 'spatial_markers',
    inputs: [P + '/processed/spatial_domains_mouse.h5ad', P + '/processed/spatial_domains_human.h5ad'],
    outputs: ['spatial_marker_mouse.h5ad', 'spatial_marker_human.h5ad', 'domain_markers_mouse.tsv', 'domain_markers_human.tsv'],
  },
  {
    step: 'spatial_autocorr',
    inputs: [P + '/processed/spatial_marker_mouse.h5ad', P + '/processed/spatial_marker_human.h5ad'],
    outputs: ['spatial_autocorr_mouse.h5ad', 'spatial_autocorr_human.h5ad', 'gene_autocorr_mouse.tsv', 'gene_autocorr_human.tsv'],
  },
  {
    step: 'spatial_cooccurrence',
    inputs: [P + '/processed/spatial_autocorr_mouse.h5ad', P + '/processed/spatial_autocorr_human.h5ad'],
    outputs: ['spatial_cooccurrence_mouse.h5ad', 'spatial_cooccurrence_human.h5ad', 'domain_cooccurrence_mouse.tsv', 'domain_cooccurrence_human.tsv'],
  },
  {
    step: 'spatial_composition',
    inputs: [P + '/processed/spatial_cooccurrence_mouse.h5ad', P + '/processed/spatial_cooccurrence_human.h5ad'],
    outputs: ['spatial_composition_mouse.h5ad', 'spatial_composition_human.h5ad', 'sample_composition_mouse.tsv', 'sample_composition_human.tsv'],
  },
  {
    step: 'spatial_communication',
    timeoutMs: 60 * 60 * 1000,
    inputs: [P + '/processed/spatial_composition_mouse.h5ad', P + '/processed/spatial_composition_human.h5ad'],
    outputs: ['spatial_communication_mouse.h5ad', 'spatial_communication_human.h5ad', 'sample_communication_mouse.tsv', 'sample_communication_human.tsv'],
  },
  {
    step: 'celltype_annotation',
    // 母版读 h5ad + tsv 两套（h5ad 取 uns 里的全量 marker，tsv 取 top20），两者都要给
    inputs: [
      P + '/processed/spatial_marker_mouse.h5ad',
      P + '/processed/spatial_marker_human.h5ad',
      P + '/processed/domain_markers_mouse.tsv',
      P + '/processed/domain_markers_human.tsv',
    ],
    outputs: ['celltype_scores_mouse.tsv', 'celltype_scores_human.tsv', 'celltype_annotation_mouse.tsv', 'celltype_annotation_human.tsv', 'spatial_deconv_mouse.h5ad', 'spatial_deconv_human.h5ad'],
  },
  {
    step: 'spatial_localization',
    inputs: [P + '/processed/spatial_communication_mouse.h5ad', P + '/processed/spatial_communication_human.h5ad'],
    outputs: ['spatial_localization_mouse.h5ad', 'spatial_localization_human.h5ad', 'gene_localization_mouse.tsv', 'gene_localization_human.tsv'],
  },
  {
    step: 'spatial_knockout',
    timeoutMs: 90 * 60 * 1000,
    needsKoGene: true,
    inputs: [P + '/processed/spatial_localization_mouse.h5ad', P + '/processed/spatial_localization_human.h5ad'],
    outputs: ['spatial_knockout_mouse.h5ad', 'spatial_knockout_human.h5ad', 'ko_dr_genes_mouse.tsv', 'ko_dr_genes_human.tsv'],
  },
  {
    step: 'dr_post_analysis',
    inputs: [
      P + '/processed/spatial_knockout_mouse.h5ad',
      P + '/processed/spatial_knockout_human.h5ad',
      P + '/processed/ko_dr_genes_mouse.tsv',
      P + '/processed/ko_dr_genes_human.tsv',
      P + '/processed/domain_markers_mouse.tsv',
      P + '/processed/domain_markers_human.tsv',
    ],
    outputs: ['dr_enrichment_mouse.tsv', 'dr_enrichment_human.tsv', 'dr_overlap_mouse.tsv', 'dr_overlap_human.tsv'],
  },
  {
    step: 'enrichment',
    timeoutMs: 60 * 60 * 1000,
    // 母版读 h5ad 里的全量 marker（tsv 只有 top20，不够做 ORA/GSEA）
    inputs: [P + '/processed/spatial_marker_mouse.h5ad', P + '/processed/spatial_marker_human.h5ad'],
    outputs: ['enrichment_ora_mouse.tsv', 'enrichment_ora_human.tsv', 'enrichment_gsea_mouse.tsv', 'enrichment_gsea_human.tsv'],
  },
  {
    step: 'enrichment_figures',
    inputs: [
      P + '/processed/enrichment_ora_mouse.tsv',
      P + '/processed/enrichment_ora_human.tsv',
      P + '/processed/enrichment_gsea_mouse.tsv',
      P + '/processed/enrichment_gsea_human.tsv',
    ],
    outputs: ['l3_mouse_12_ora_top.png', 'l3_human_12_ora_top.png'],
    outputsDir: 'figures',
  },
  {
    step: 'spatial_figures',
    inputs: [P + '/processed/spatial_knockout_mouse.h5ad', P + '/processed/spatial_knockout_human.h5ad'],
    outputs: ['l3_mouse_01_domains.png', 'l3_mouse_03_ko_dr.png', 'l3_human_01_domains.png'],
    outputsDir: 'figures',
  },
];

/** 输入存在性预检：缺文件不下发（下发必 failed，白烧一次远端执行） */
function preflight(spec) {
  const lines = spec.inputs.map((file) => '[ -e ' + shellQuote(file) + ' ] || echo MISSING:' + file);
  const res = sshTry(lines.join('\n') + '\necho PREFLIGHT_DONE', 60000);
  if (!res.ok) return { ok: false, err: res.err, missing: [] };
  if (!/PREFLIGHT_DONE/.test(res.out)) {
    return { ok: false, err: '预检脚本未跑完（远端可能提前退出）: ' + res.out.slice(-200), missing: [] };
  }
  const missing = res.out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('MISSING:'))
    .map((line) => line.slice('MISSING:'.length));
  return { ok: missing.length === 0, err: '', missing };
}

/** 产物核对：只看主产物在不在（脚本自校验过了，这里防"exit 0 但产物落别处"） */
function verifyOutputs(spec) {
  const dir = spec.outputsDir === 'figures' ? P + '/figures' : P + '/processed';
  const lines = spec.outputs.map((name) => '[ -e ' + shellQuote(dir + '/' + name) + ' ] || echo ABSENT:' + name);
  const res = sshTry(lines.join('\n') + '\necho VERIFY_DONE', 60000);
  if (!res.ok) return { ok: false, err: res.err, absent: [] };
  const absent = res.out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('ABSENT:'))
    .map((line) => line.slice('ABSENT:'.length));
  return { ok: absent.length === 0, err: '', absent };
}

async function fetchJson(path, options) {
  const res = await fetch(BASE + path, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: res.status, ok: res.ok, body };
}

async function runningIds() {
  const res = await fetchJson('/api/tasks');
  if (!res.ok || !res.body) throw new Error('/api/tasks 不可用: HTTP ' + res.status);
  return new Set((res.body.tasks || []).map((task) => task.taskId));
}

async function attempt(spec, index, tryNo) {
  const label = (index + 1) + '. ' + spec.step + (tryNo > 1 ? ' (retry ' + (tryNo - 1) + ')' : '');
  const timeoutMs = spec.timeoutMs || DEFAULT_TIMEOUT_MS;

  if (!SKIP_PREFLIGHT) {
    const pre = preflight(spec);
    if (!pre.ok) {
      check(label + ' 输入预检', false, pre.missing.length ? '缺文件: ' + pre.missing.join(', ') : pre.err);
      return false;
    }
  }

  const before = listLedgers(spec.step);
  if (!before.ok) {
    check(label + ' 台账快照', false, before.err);
    return false;
  }
  const beforeSet = new Set(before.files);

  const payload = {
    projectId: PROJECT,
    lineId: LINE,
    step: spec.step,
    inputs: spec.inputs,
    outputs: [],
    seed: SEED,
  };
  if (spec.needsKoGene) payload.targetKoGene = KO_GENE;

  const submit = await fetchJson('/api/tasks/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!submit.ok) {
    check(label + ' 下发', false, (submit.body && submit.body.error) || 'HTTP ' + submit.status);
    return false;
  }
  const taskId = submit.body && submit.body.taskId;
  check(label + ' 下发', Boolean(taskId), String(taskId || JSON.stringify(submit.body).slice(0, 200)));

  // 完成判定：任务从 /api/tasks 列表消失。轮询失败连续 5 次才判死，避免工作台瞬时抖动误杀
  const deadline = Date.now() + timeoutMs;
  let stillRunning = true;
  let pollFailures = 0;
  while (Date.now() < deadline) {
    await sleep(3000);
    let ids;
    try {
      ids = await runningIds();
      pollFailures = 0;
    } catch (cause) {
      pollFailures += 1;
      if (pollFailures >= 5) {
        check(label + ' 完成', false, '轮询 /api/tasks 连续失败: ' + cause.message);
        return false;
      }
      continue;
    }
    if (!ids.has(taskId)) {
      stillRunning = false;
      break;
    }
  }
  if (stillRunning) {
    check(label + ' 完成', false, '超时 ' + Math.round(timeoutMs / 60000) + ' 分钟仍在运行（taskId=' + taskId + '）');
    return false;
  }

  await sleep(1500);
  const found = await waitNewLedger(spec.step, beforeSet);
  if (!found.ledger) {
    check(label + ' 台账', false, found.err);
    return false;
  }
  const ledger = found.ledger;
  const exitCode = ledger.exit_code === undefined || ledger.exit_code === null ? 'n/a' : ledger.exit_code;
  const ok = ledger.status === 'completed';
  const detail = 'status=' + ledger.status + ' exit=' + exitCode
    + ' ' + (ledger.start_time || '?') + '→' + (ledger.end_time || '?')
    + ' 账=' + found.file.split('/').pop();
  check(label + ' 结果', ok, detail);

  if (!ok) {
    // 服务端台账的 error_log 是 stderr 尾部文本（server/run.js:83），直接打出来就是真实报错
    const errorText = String(ledger.error_log === null || ledger.error_log === undefined ? '（无 error_log）' : ledger.error_log);
    console.log('    error_log=' + errorText.replace(/\n/g, '\n    ').slice(0, 1200));
    return false;
  }

  if (ledger.exit_code === undefined || ledger.exit_code === null) {
    warn(label + ' 台账无 exit_code', 'status=completed 已判成功，但台账缺 exit_code 字段');
  }
  const verify = verifyOutputs(spec);
  if (!verify.ok) {
    warn(label + ' 产物核对', verify.absent.length ? '缺主产物: ' + verify.absent.join(', ') : verify.err);
  }
  return true;
}

async function runStep(spec, index) {
  for (let tryNo = 1; tryNo <= 2; tryNo += 1) {
    if (tryNo > 1) {
      console.log('  容器可能重启过（K40 7.5GB 内存跑重步骤有 OOM 前科），20s 后重试一次');
      await sleep(20000);
    }
    if (await attempt(spec, index, tryNo)) return true;
  }
  return false;
}

async function main() {
  console.log('line3_spatial 全链取证 | 项目=' + PROJECT + ' 线=' + LINE + ' 种子=' + SEED + ' 工作台=' + BASE);
  console.log('步骤数=' + STEPS.length + ' 起始索引=' + START + (ONLY ? ' 仅跑=' + ONLY : '')
    + (SKIP_PREFLIGHT ? ' 预检=跳过' : ' 预检=开'));
  if (STEPS.some((spec) => spec.needsKoGene)) {
    console.log('空间虚拟敲除靶基因（提交层字段）=' + KO_GENE
      + '（注意：母版 spatial_knockout:113 仍写死 Spp1，尚未读 BIO_KO_GENE）');
  }

  const health = await fetchJson('/api/health');
  check('工作台在线', health.ok === true, 'HTTP ' + health.status);

  const dirCheck = sshTry('[ -d ' + shellQuote(P) + ' ] && echo DIR_YES || echo DIR_NO');
  if (!dirCheck.ok) {
    check('远端链路', false, dirCheck.err);
  } else {
    check('远端项目目录', /DIR_YES/.test(dirCheck.out), P);
  }

  for (let i = START; i < STEPS.length; i += 1) {
    if (ONLY && STEPS[i].step !== ONLY) continue;
    const ok = await runStep(STEPS[i], i);
    if (!ok) {
      console.log('\n中断：该步骤失败，后续步骤依赖其产物，停止下发。');
      break;
    }
  }

  const pass = results.filter((row) => row.ok).length;
  console.log('\n结果：' + pass + '/' + results.length + ' 通过，WARN ' + warns.length + ' 条');
  if (warns.length) {
    for (const row of warns) console.log('  WARN ' + row.name + (row.detail ? ' | ' + row.detail : ''));
  }
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch((cause) => {
  console.error('脚本异常:', cause && cause.message ? cause.message : cause);
  process.exitCode = 1;
});
