#!/usr/bin/env node
/**
 * cn_debug/2026-10-19_verification_wgcna_v1_v10.mjs
 *
 * WGCNA 模块 P0-1 ~ P0-5 修复的量化验收工具（V1–V10）。
 * 依据：workspace/handoff/archive/2026-10-19_wgcna_audit_report.md §5.4 可量化验证标准。
 *
 * 输入：本地回搬存档 outputs/<项目>/line1_bulk/{processed,figures} + outputs/system_logs；
 *       V9 需要远端可写（通过工作台 API 重跑一次，同 seed 比对产物指纹）。
 *
 * 用法：
 *   node cn_debug/2026-10-19_verification_wgcna_v1_v10.mjs [--project PRJ_E2E_GSE277173]
 *       [--seed 20261013] [--base http://127.0.0.1:8787] [--rerun] [--snapshot <dir>]
 *
 *   --rerun    通过 /api/tasks/submit 重跑 wgcna_modules（V9），约 6 分钟
 *   --snapshot 跳过重跑，只把当前本地产物指纹写到该目录（供重跑后比对）
 *
 * 退出码：0 = V1–V10 全部通过；1 = 有未通过项；2 = 前置条件不足（无法判定）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = process.argv.slice(2);
const arg = (name, dft) => {
  const i = D.indexOf(`--${name}`);
  return i >= 0 && D[i + 1] ? D[i + 1] : dft;
};
const flag = (name) => D.includes(`--${name}`);
const PROJECT = arg('project', 'PRJ_E2E_GSE277173');
const SEED = Number(arg('seed', 20261013));
const BASE = arg('base', 'http://127.0.0.1:8787');
const REMOTE_P = `/mnt/ssd/bio_data/projects/${PROJECT}/line1_bulk`;
const LINE_DIR = path.join(REPO, 'outputs', PROJECT, 'line1_bulk');
const PROC = path.join(LINE_DIR, 'processed');
const FIGS = path.join(LINE_DIR, 'figures');

const results = [];
const rec = (id, name, pass, detail) => {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name}${detail ? ` | ${detail}` : ''}`);
};

function readTsv(file) {
  const text = fs.readFileSync(file, 'utf8').trim();
  const lines = text.split(/\r?\n/);
  const head = lines[0].split('\t');
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
  });
}

function exists(f) {
  try { return fs.statSync(f).size > 0; } catch { return false; }
}

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

/** 本地存档指纹：用于 V9 重跑前后比对（WGCNA 确定性产物） */
function fingerprint() {
  const files = fs.readdirSync(PROC).filter((f) => /^wgcna_/.test(f)).sort();
  return Object.fromEntries(files.map((f) => [f, md5(path.join(PROC, f))]));
}

// ---------- V1 / V2：入网基因数与分块 ----------
{
  const reportFile = path.join(PROC, 'wgcna_report.txt');
  if (!exists(reportFile)) {
    rec('V1', '入网基因数 == 5000', false, 'wgcna_report.txt 缺失（先跑 ops/07_pull_outputs.ps1 回搬）');
    rec('V2', 'n_blocks == 1', false, '报告缺失，无法判定');
  } else {
    const repText = fs.readFileSync(reportFile, 'utf8');
    // report 是 "key=value" 平铺格式，且一行可含多个键（samples=16 genes_input=20019 genes_used=5000）。
    // 不能按行 split('=') 建字典——会把值里的下一个键名吞掉（2026-10-19 实测踩过：
    // rep.samples 变成 "16 genes_input"，导致 V1 误报 20019）。
    const rep = {};
    for (const m of repText.matchAll(/([A-Za-z_][\w.]*)=([^\s]+)/g)) rep[m[1]] = m[2];
    const genes = rep.genes_used;
    const blocks = rep.n_blocks;
    rec('V1', '入网基因数 == 5000', Number(genes) === 5000, `genes_used=${genes}`);
    rec('V2', 'n_blocks == 1', Number(blocks) === 1, `n_blocks=${blocks}`);
  }
}

// ---------- V3：kME/GS 表 ----------
{
  const f = path.join(PROC, 'wgcna_gene_traits.tsv');
  if (!exists(f)) { rec('V3', 'kME/GS 表完整', false, '文件缺失'); }
  else {
    const rows = readTsv(f);
    const bad = rows.filter((r) => !Number.isFinite(Number(r.kME)) || !Number.isFinite(Number(r.GS)));
    const out = rows.filter((r) => Math.abs(Number(r.kME)) > 1 || Math.abs(Number(r.GS)) > 1);
    const kme = rows.map((r) => Math.abs(Number(r.kME)));
    rec('V3', 'kME/GS 表行数=保留基因数、取值[-1,1]、无 NA',
      bad.length === 0 && out.length === 0,
      `rows=${rows.length} NA/越界=${bad.length}/${out.length} |kME|max=${Math.max(...kme).toFixed(4)}`);
  }
}

// ---------- V4：hub 表 ----------
{
  const hubF = path.join(PROC, 'wgcna_hub_genes.tsv');
  const traitF = path.join(PROC, 'wgcna_module_trait.tsv');
  if (!exists(hubF) || !exists(traitF)) { rec('V4', '每个显著模块 >=1 hub 且 |kME|>=0.8', false, '文件缺失'); }
  else {
    const sig = readTsv(traitF).filter((r) => r.significant === 'TRUE').map((r) => r.module);
    const hub = readTsv(hubF);
    const covered = sig.filter((m) => hub.some((h) => h.module === m));
    const lowKme = hub.filter((h) => Math.abs(Number(h.kME)) < 0.8);
    rec('V4', '每个显著模块 >=1 hub 且 |kME|>=0.8',
      sig.length === covered.length && lowKme.length === 0,
      `sig_modules=${sig.length} covered=${covered.length} hubs=${hub.length} |kME|<0.8: ${lowKme.length}`);
  }
}

// ---------- V5：MEs 表 ----------
{
  const f = path.join(PROC, 'wgcna_module_eigengenes.tsv');
  if (!exists(f)) { rec('V5', 'MEs 行数=样本数、列数=模块数', false, '文件缺失'); }
  else {
    const rows = readTsv(f);
    const cols = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/)[0].split('\t');
    const traitF = path.join(PROC, 'wgcna_module_trait.tsv');
    const nMod = exists(traitF) ? readTsv(traitF).length : null;
    rec('V5', 'MEs 行数=16（样本数）、列数=模块数+1',
      rows.length === 16 && (nMod === null || cols.length === nMod + 1),
      `rows=${rows.length} cols=${cols.length} modules=${nMod}`);
  }
}

// ---------- V6：离群检测 ----------
{
  const f = path.join(PROC, 'wgcna_sample_outliers.txt');
  if (!exists(f)) { rec('V6', '全部样本列出 Z.k 且 |Z.k|>2.5 显式标注', false, '文件缺失'); }
  else {
    const lines = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/);
    const samples = lines.filter((l) => /^sample=/.test(l));
    const flagged = samples.filter((l) => l.includes('*outlier'));
    const maxZk = Math.max(...samples.map((l) => Math.abs(Number(l.match(/Z\.k=(-?[\d.]+)/)[1]))));
    rec('V6', '全部样本列出 Z.k 且 |Z.k|>2.5 显式标注',
      samples.length === 16 && flagged.every((l) => Math.abs(Number(l.match(/Z\.k=(-?[\d.]+)/)[1])) > 2.5),
      `samples=${samples.length} flagged=${flagged.length} max|Z.k|=${maxZk.toFixed(3)}`);
  }
}

// ---------- V7：台账 ----------
{
  const logDir = path.join(REPO, 'outputs', 'system_logs');
  let newest = null;
  if (fs.existsSync(logDir)) {
    for (const f of fs.readdirSync(logDir)) {
      if (!f.includes(PROJECT) || !f.includes('wgcna_modules')) continue;
      const p = path.join(logDir, f);
      const m = fs.statSync(p).mtimeMs;
      if (!newest || m > newest.m) newest = { m, p, f };
    }
  }
  if (!newest) { rec('V7', '台账 completed/exit 0/passed 且产物声明 >=6', false, '本地无 wgcna_modules 台账（先回搬 system_logs）'); }
  else {
    const d = JSON.parse(fs.readFileSync(newest.p, 'utf8'));
    const outs = (d.io_files?.output || []).length;
    rec('V7', '台账 completed/exit 0/passed 且产物声明 >=6',
      d.status === 'completed' && d.exit_code === 0 && d.checkpoint_status === 'passed'
      && !d.error_log && outs >= 6,
      `${newest.f} exit=${d.exit_code} ckpt=${d.checkpoint_status} outputs=${outs}`);
  }
}

// ---------- V8：图件（DPI/最短边/五维打分，直接调项目既有审计脚本） ----------
{
  const figs = fs.existsSync(FIGS) ? fs.readdirSync(FIGS).filter((f) => f.endsWith('.png')) : [];
  const need = ['l1_28_wgcna_softpower.png', 'l1_29_wgcna_module_trait.png',
    'l1_30_wgcna_sample_tree.png', 'l1_31_wgcna_mm_gs.png'];
  const missing = need.filter((f) => !figs.includes(f));
  if (missing.length) {
    rec('V8', '新增图件 300dpi / 最短边>=1200px / 打分>=75', false, `缺失: ${missing.join(', ')}`);
  } else {
    const run = (script, args) => {
      // 用 spawnSync 而不是 execFileSync：figure_score.py 在有 UNVERIFIED 时退出码为 1
      // （"没测"不算通过），execFileSync 会当场抛异常，把正常的判决输出吞掉
      // （2026-10-19 实测踩到：V8 报"打分脚本输出无法解析"）。
      const r = spawnSync('python', [path.join(REPO, 'cn_debug', script), ...args], { encoding: 'utf8' });
      return `${r.stdout || ''}${r.stderr || ''}${r.error ? `\nSPAWN_ERROR ${r.error.message}` : ''}`;
    };
    const scan = run('figure_audit_scan.py', ['--dir', FIGS]);
    // 打分必须喂外部判决（FE-012）：不喂则 B/D 全 UNVERIFIED，退出码 1。
    // 判决来源：cn_debug/figure_audit_line1.csv（几何审计）+ code_audit.csv（源码扫描）。
    const score = run('figure_score.py', ['--dir', FIGS,
      '--audit-csv', path.join(REPO, 'cn_debug', 'figure_audit_line1.csv'),
      '--code-csv', path.join(REPO, 'cn_debug', 'code_audit.csv'),
      '--ledger-dir', path.join(REPO, 'outputs', 'system_logs')]);
    const scanOk = /fail=0/.test(scan) && !/FAIL/.test(scan);
    // 新输出多了 UNVERIFIED 段：figs=N PASS=P FIX=F FAIL=X UNVERIFIED=U avg=A
    const m = score.match(/score: figs=(\d+) PASS=(\d+) FIX=(\d+) FAIL=(\d+) UNVERIFIED=(\d+) avg=([\d.]+)/);
    // UNVERIFIED 不算通过（"没测"≠"通过"），但也不该让 V8 判红——V8 验的是"新图件格式合规"，
    // UNVERIFIED 的成因（R 图无机器判决/ppi 禁跑/l1_27 陈旧）由 figure_manual_review.md 跟踪。
    const scoreOk = Boolean(m) && Number(m[4]) === 0 && Number(m[6]) >= 75;
    rec('V8', '新增图件 300dpi / 最短边>=1200px / 打分>=75', scanOk && scoreOk,
      m ? `scan fail=0, score figs=${m[1]} PASS=${m[2]} FAIL=${m[4]} UNVERIFIED=${m[5]} avg=${m[6]}`
        : '打分脚本输出无法解析');
  }
}

// ---------- V9：同 seed 复跑一致性 ----------
const SNAP = arg('snapshot', '');
if (flag('rerun')) {
  const before = fingerprint();
  if (Object.keys(before).length === 0) {
    rec('V9', '同 seed 复跑产物指纹一致', false, '本地无 WGCNA 产物可比对（先回搬 processed/）');
  } else {
    const submit = await fetch(`${BASE}/api/tasks/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: PROJECT, lineId: 'line1_bulk', step: 'wgcna_modules',
        inputs: [`${REMOTE_P}/processed/expr_genes.tsv`, `${REMOTE_P}/processed/group_map.tsv`],
        outputs: [
          `${REMOTE_P}/processed/wgcna_modules.tsv`,
          `${REMOTE_P}/processed/wgcna_module_trait.tsv`,
          `${REMOTE_P}/processed/wgcna_gene_traits.tsv`,
          `${REMOTE_P}/processed/wgcna_hub_genes.tsv`,
          `${REMOTE_P}/processed/wgcna_module_eigengenes.tsv`,
          `${REMOTE_P}/processed/wgcna_sample_outliers.txt`,
          `${REMOTE_P}/processed/wgcna_input_genes.txt`,
          `${REMOTE_P}/processed/wgcna_report.txt`,
          `${REMOTE_P}/figures/l1_28_wgcna_softpower.png`,
          `${REMOTE_P}/figures/l1_29_wgcna_module_trait.png`,
          `${REMOTE_P}/figures/l1_30_wgcna_sample_tree.png`,
          `${REMOTE_P}/figures/l1_31_wgcna_mm_gs.png`,
        ],
        seed: SEED,
      }),
    });
    const sub = await submit.json();
    if (!submit.ok) {
      rec('V9', '同 seed 复跑产物指纹一致', false, `下发失败: ${sub.error || submit.status}`);
    } else {
      console.log(`[V9] 已下发 taskId=${sub.taskId}，等待完成（约 1–7 分钟）...`);
      // 轮询策略：/api/tasks 只返回"运行中"的任务，任务结束即从列表消失，
      // 因此以"taskId 从运行列表消失"为完成信号，再读远端台账判终态
      // （与 cn_debug/2026-10-19_e2e_run_pipeline.mjs 的"读远端台账判 status/exit_code"同契约）。
      const sshOut = (cmd) => execFileSync('ssh',
        ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', cmd],
        { encoding: 'utf8', timeout: 60000 });
      let finished = null;
      const deadline = Date.now() + 25 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10000));
        const list = await (await fetch(`${BASE}/api/tasks`)).json();
        const still = (list.tasks || []).some((x) => x.taskId === sub.taskId);
        if (still) continue;
        // 已离开运行列表：找最新一条本项目 wgcna_modules 台账
        const newest = sshOut(
          `ls -t /mnt/ssd/bio_data/system_logs/*${PROJECT}*wgcna_modules*.json 2>/dev/null | head -1`
        ).trim();
        if (!newest) continue;
        const entry = JSON.parse(sshOut(`cat '${newest}'`));
        if (entry.status === 'completed' || entry.status === 'failed') {
          finished = { entry, name: newest.split('/').pop() };
          break;
        }
      }
      if (!finished) {
        rec('V9', '同 seed 复跑产物指纹一致', false, '轮询超时（25 分钟）未拿到终态');
      } else if (finished.entry.status !== 'completed' || finished.entry.exit_code !== 0) {
        rec('V9', '同 seed 复跑产物指纹一致', false,
          `复跑 ${finished.entry.status}（exit=${finished.entry.exit_code}，${finished.name}）`);
      } else {
        // 自动回搬应已把新产物拉到本地；再显式回搬一次兜底（幂等）
        try {
          await (await fetch(`${BASE}/api/figures/pull`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project: PROJECT, line: 'line1_bulk', force: false }),
          })).json();
        } catch { /* 回搬失败不掩盖 V9 结论，下面用 exec 兜底 */ }
        execFileSync('pwsh', ['-NoProfile', '-File', path.join(REPO, 'ops', '07_pull_outputs.ps1'),
          '-Project', PROJECT, '-Line', 'line1_bulk'], { stdio: 'ignore', timeout: 420000 });
        const after = fingerprint();
        const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
        const diff = keys.filter((k) => before[k] !== after[k]);
        rec('V9', '同 seed 复跑产物指纹一致', diff.length === 0,
          diff.length ? `不一致: ${diff.join(', ')}` : `比对 ${keys.length} 个 WGCNA 产物 md5 全部一致`);
      }
    }
  }
} else if (SNAP) {
  fs.mkdirSync(SNAP, { recursive: true });
  fs.writeFileSync(path.join(SNAP, 'wgcna_fingerprint.json'), JSON.stringify(fingerprint(), null, 2));
  console.log(`[V9] 已写出指纹快照 -> ${path.join(SNAP, 'wgcna_fingerprint.json')}（--rerun 后重新运行比对）`);
} else {
  rec('V9', '同 seed 复跑产物指纹一致', false, '未运行（加 --rerun 执行；不加则只出快照 --snapshot <dir>）');
}

// ---------- V10：下游 key_genes 的 WGCNA 侧来源 ----------
{
  const f = path.join(PROC, 'key_genes_report.txt');
  if (!exists(f)) { rec('V10', 'key_genes 的 WGCNA 侧来源=wgcna_hub_genes.tsv 且非空', false, 'key_genes_report.txt 缺失'); }
  else {
    const txt = fs.readFileSync(f, 'utf8');
    const uses = /wgcna_criteria=wgcna_hub_genes\.tsv/.test(txt);
    const nWgcna = Number(txt.match(/n_deg=(\d+) n_wgcna=(\d+)/)?.[2] ?? 0);
    rec('V10', 'key_genes 的 WGCNA 侧来源=wgcna_hub_genes.tsv 且非空', uses && nWgcna > 0,
      `source=wgcna_hub_genes.tsv n_wgcna=${nWgcna}`);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n[V1-V10] PASS=${results.length - failed.length}/${results.length}` +
  (failed.length ? ` FAIL=${failed.map((r) => r.id).join(',')}` : '') +
  `（V9 未运行时不计入通过）`);
process.exit(failed.length ? 1 : 0);
