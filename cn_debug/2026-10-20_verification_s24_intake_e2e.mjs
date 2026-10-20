/**
 * S24 E2E 真链验证：起真 server/index.js 打真 HTTP（临时端口），不碰真实远端。
 *
 * 原理：server 的全部远端执行都经 server/proc.js 的 spawnSync('ssh'|'scp'|'adb')。
 * 本脚本用 node --require 垫片在 ESM 图加载前补丁 child_process.spawnSync：
 * 拦截 ssh 调用，把命令里的 /mnt/ssd/bio_data 重写到本临时目录后交给本机 bash 执行
 * （mkdir/base64 均为 git-bash 自带），从而让"建项 → project.json 落盘"全链在本机闭环。
 * 不修改任何 server 源码；不触碰真实手机/容器。
 *
 * 幂等：每次运行先清空 FAKE_SSD_ROOT，项目 ID 固定，可反复复跑。
 * 用法：node cn_debug/2026-10-20_verification_s24_intake_e2e.mjs
 */

import { spawn, spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, '..', 'BioanalysDesktop');
const PORT = 18790;
const BASE = `http://127.0.0.1:${PORT}`;

// 伪 SSD 根：cn_debug 下本次验证自己的临时目录（脚本自产自销，幂等清空）
const FAKE_ROOT = path.resolve(HERE, 's24_e2e_tmp');
const FAKE_SSD = path.join(FAKE_ROOT, 'ssd');

rmSync(FAKE_ROOT, { recursive: true, force: true });
mkdirSync(FAKE_SSD, { recursive: true });

// ---------- ssh 垫片 ----------
const shimPath = path.join(FAKE_ROOT, 's24_fake_ssh.cjs');
writeFileSync(shimPath, `
const cp = require('node:child_process');
const origSync = cp.spawnSync.bind(cp);
const FAKE_SSD = ${JSON.stringify(FAKE_SSD)};
cp.spawnSync = function (cmd, args, opts) {
  if (cmd === 'ssh') {
    // ssh -o .. -o .. <host> '<command>'：最后一个参数是远端命令
    const command = args[args.length - 1];
    const rewritten = command.split('/mnt/ssd/bio_data').join(FAKE_SSD);
    const r = origSync('bash', ['-c', rewritten], { encoding: 'utf8', timeout: 30000 });
    return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
  }
  if (cmd === 'scp') {
    // 本验证不含数据文件部署路径；若意外走到 scp 直接报失败，不留静默
    return { status: 1, stdout: '', stderr: 's24-e2e-shim: scp not expected' };
  }
  return origSync(cmd, args, opts);
};
`);

// ---------- 起服务 ----------
const child = spawn(process.execPath, ['--require', shimPath, 'server/index.js'], {
  cwd: DESKTOP,
  env: { ...process.env, BAD_PORT: String(PORT), FAKE_SSD_ROOT: FAKE_SSD },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverErr = '';
child.stderr.on('data', (c) => { serverErr += c.toString(); });
let childExit = null;
child.on('exit', (code) => { childExit = code; });

const results = [];
let failed = 0;
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  if (!cond) failed += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? `  -- ${detail}` : ''}`);
}

async function waitHealth() {
  const deadline = Date.now() + 10000;
  for (;;) {
    if (childExit !== null) throw new Error(`服务进程提前退出 (code ${childExit}):\n${serverErr.slice(-2000)}`);
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch { /* 未就绪继续等 */ }
    if (Date.now() > deadline) throw new Error(`服务 10s 未就绪:\n${serverErr.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function post(body) {
  const res = await fetch(`${BASE}/api/projects/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* 留 null */ }
  return { status: res.status, payload };
}

function readMetaOnDisk(projectId) {
  const p = path.join(FAKE_SSD, 'projects', projectId, 'project.json');
  return JSON.parse(readFileSync(p, 'utf8'));
}

// ---------- payload 构造 ----------

/** 公共库 happy path（全量 intake + 16:9 模板 + 主对比） */
function pubPayload() {
  return {
    projectId: 'PRJ_S24_E2E_PUB',
    lineId: 'line1_bulk',
    name: 'S24 E2E 公共库',
    basicInfo: { name: 'S24 E2E 公共库', domain: '心脑血管', disease: 'Ischemic Stroke', species: 'Homo sapiens' },
    dataSource: {
      source: 'GEO', data_source_mode: 'PUBLIC_DB', dataType: 'microarray',
      sampleCount: 4, tissue: 'Peripheral Blood',
      datasets: [{ gse: 'GSE16561', gpl: 'GPL6883', role: 'train' }],
    },
    groupingDesign: {
      mode: 'two_group',
      groups: [
        { groupId: 'g1', groupName: '对照', role: 'reference', stageOrder: 0, colorHex: '#3B4992', sampleIds: ['GSM1', 'GSM2'] },
        { groupId: 'g2', groupName: '处理', role: 'disease_stage', stageOrder: 1, colorHex: '#EE0000', sampleIds: ['GSM3', 'GSM4'] },
      ],
      contrasts: [{ name: '处理 vs 对照', case: '处理', ctrl: '对照', isPrimary: true }],
    },
    pipelineDag: [{ order: 1, stepId: 'prep_matrix' }, { order: 2, stepId: 'qc_matrix' }],
    biologicalPriors: { focusGenes: ['IL17A', 'S100A8'], koFallbackPolicy: 'auto_recommend' },
    analysisCutoffs: { profile: 'sensitive', log2fc_threshold: 2.0 },
    plotLayoutConfig: { templateId: 'template_16x9' },
    experimentalDesign: { isPaired: true, pairMap: { GSM1: 'D1', GSM2: 'D1' }, covariates: { batchCol: 'GSE_batch', adjustedVariables: ['age', 'sex'] } },
    validationGroupMapping: { valControlSamples: ['GSM1'], valTreatSamples: ['GSM3'] },
    wgcnaConfig: { top_n_genes: 6000 },
    aclAndOutput: { owner: 'e2e', collaborators: [], expectedFormats: ['png_300dpi', 'tsv_tables'] },
  };
}

/** IN_HOUSE 全链（line2 + 虚拟敲除带靶基因 + 自有三件套） */
function inHousePayload() {
  return {
    projectId: 'PRJ_S24_E2E_KO',
    lineId: 'line2_scrna',
    name: 'S24 E2E 自有数据',
    basicInfo: { name: 'S24 E2E 自有数据', domain: '神经退行', disease: 'Alzheimer Model', species: 'Mus musculus' },
    dataSource: {
      source: '自有数据', data_source_mode: 'IN_HOUSE_UPLOAD', dataType: 'scrna',
      sampleCount: 6, tissue: 'Brain Cortex',
      id_type: 'Ensembl_ID', value_scale: 'Raw_Counts',
      uploaded_files: { train_matrix: 'raw_data/counts_train.tsv' },
    },
    groupingDesign: {
      mode: 'two_group',
      groups: [
        { groupId: 'g1', groupName: 'Control', role: 'reference', stageOrder: 0, colorHex: '#3B4992', sampleIds: ['Ctrl_1', 'Ctrl_2'] },
        { groupId: 'g2', groupName: 'Treat', role: 'disease_stage', stageOrder: 1, colorHex: '#EE0000', sampleIds: ['Treat_1', 'Treat_2'] },
      ],
      contrasts: [],
    },
    pipelineDag: [{ order: 1, stepId: 'ingest_counts' }, { order: 2, stepId: 'virtual_knockout', params: { target_gene: 'App' } }],
    biologicalPriors: { targetKoGene: 'App' },
    plotLayoutConfig: { templateId: 'template_4x3' },
  };
}

try {
  await waitHealth();
  check('服务健康（/api/health 200）', true);

  // 1) 公共库 happy path：全量 intake + 16:9 + line_id 落盘
  const pub = await post(pubPayload());
  check('公共库全量 intake 建项 → 200', pub.status === 200, `status=${pub.status} body=${JSON.stringify(pub.payload).slice(0, 300)}`);
  if (pub.status === 200) {
    const disk = readMetaOnDisk('PRJ_S24_E2E_PUB');
    check('project.json: line_id=line1_bulk', disk.line_id === 'line1_bulk', `实际=${disk.line_id}`);
    check('project.json: plot_layout_config.template_id=template_16x9', disk.plot_layout_config?.template_id === 'template_16x9');
    check('project.json: analysis_cutoffs= sensitive + 显式 log2fc 2.0',
      disk.analysis_cutoffs?.profile === 'sensitive' && disk.analysis_cutoffs?.log2fc_threshold === 2.0,
      JSON.stringify(disk.analysis_cutoffs));
    check('project.json: biological_priors 四块齐全（focus_genes/ko_fallback_policy）',
      JSON.stringify(disk.biological_priors?.focus_genes) === '["IL17A","S100A8"]' && disk.biological_priors?.ko_fallback_policy === 'auto_recommend');
    check('project.json: experimental_design 配对 + 协变量',
      disk.experimental_design?.is_paired === true && disk.experimental_design?.cov?.batch_col === 'GSE_batch'
      && JSON.stringify(disk.experimental_design?.cov?.adjusted_variables) === '["age","sex"]');
    check('project.json: validation_group_mapping 落盘且 invalid=false',
      JSON.stringify(disk.validation_group_mapping?.val_control_samples) === '["GSM1"]' && disk.validation_group_mapping?.invalid === false);
    check('project.json: wgcna_config 显式键落盘（top_n_genes=6000）', disk.wgcna_config?.top_n_genes === 6000);
    check('project.json: data_source_mode=PUBLIC_DB', disk.data_source?.data_source_mode === 'PUBLIC_DB');
  }

  // 2) R11 六条负路径 → 400 且 error 点名
  const negatives = [
    ['species 非枚举', (b) => { b.basicInfo.species = 'Homo Sapiens'; }, /species/],
    ['domain 非枚举', (b) => { b.basicInfo.domain = 'Neurovascular'; }, /domain/],
    ['dataType 非法', (b) => { b.dataSource.dataType = 'bulk'; }, /dataType/],
    ['sampleCount 小数', (b) => { b.dataSource.sampleCount = 1.5; }, /sampleCount/],
    ['contrasts 引用不存在组名', (b) => { b.groupingDesign.contrasts[0].case = '不存在的组'; }, /contrasts/],
    ['contrasts 主对比缺失', (b) => { b.groupingDesign.contrasts[0].isPrimary = false; }, /主对比/],
    ['R12 敲除无靶基因', (b) => {
      b.lineId = 'line2_scrna';
      b.pipelineDag = [{ order: 1, stepId: 'virtual_knockout' }];
      delete b.biologicalPriors;
    }, /含虚拟敲除步骤必须提供靶基因/],
    ['line_id 缺失', (b) => { delete b.lineId; }, /line_id/],
  ];
  for (const [name, mutate, expect] of negatives) {
    const body = pubPayload();
    mutate(body);
    const r = await post(body);
    check(`R11/R12/line_id 负路径：${name} → 400 且 error 点名`,
      r.status === 400 && expect.test(r.payload?.error || ''),
      `status=${r.status} error=${JSON.stringify(r.payload?.error)}`);
  }

  // 3) IN_HOUSE 全链：200 → project.json 双模态 + LOC 编号
  const ko = await post(inHousePayload());
  check('IN_HOUSE 全链建项 → 200', ko.status === 200, `status=${ko.status} body=${JSON.stringify(ko.payload).slice(0, 300)}`);
  if (ko.status === 200) {
    const disk = readMetaOnDisk('PRJ_S24_E2E_KO');
    check("IN_HOUSE: data_source_mode='IN_HOUSE_UPLOAD'", disk.data_source?.data_source_mode === 'IN_HOUSE_UPLOAD');
    const acc = disk.data_source?.accession_and_platform || {};
    check('IN_HOUSE: LOC 编号按项目 ID 派生（train_id=LOC_PRJ_S24_E2E_KO_TRAIN）',
      acc.train_id === 'LOC_PRJ_S24_E2E_KO_TRAIN', `实际=${acc.train_id}`);
    check('IN_HOUSE: 未提供 val_matrix → val_id=null', acc.val_id === null);
    check('IN_HOUSE: 三件套落盘（id_type/value_scale/train_matrix）',
      acc.id_type === 'Ensembl_ID' && acc.value_scale === 'Raw_Counts' && acc.uploaded_files?.train_matrix === 'raw_data/counts_train.tsv');
    check('IN_HOUSE: line_id=line2_scrna + 敲除靶基因落盘',
      disk.line_id === 'line2_scrna' && disk.biological_priors?.target_ko_gene === 'App');
    check('IN_HOUSE: 自有样本编号（Ctrl_1 等）通过公共库 GSM 限制',
      disk.grouping_design?.groups?.[0]?.sampleIds?.includes('Ctrl_1') === true);
  }

  console.log(`\n==== S24 E2E 汇总：${results.length - failed}/${results.length} 通过 ====`);
} catch (cause) {
  console.error('E2E 执行异常:', cause);
  failed += 1;
} finally {
  child.kill();
}

process.exit(failed === 0 ? 0 : 1);
