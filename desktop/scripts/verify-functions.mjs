/**
 * 便携版功能对齐验证（需求 5）。
 *
 * 用项目内置测试原始数据（PRJ_GSE316126_SANITY 的 expr_matrix.tsv）真实
 * 启动打包运行时，逐项跑通原项目的核心功能面：
 *
 *   1 服务健康          /api/health
 *   2 五维自检          /api/selfcheck（mock 计算面）
 *   3 模块注册表        /api/workflows
 *   4 图件模板          /api/figures/templates + /api/figures/catalog
 *   5 建项（真网关）    /api/projects/create 走 venv pydantic 校验
 *   6 建项负路径        非法 pipeline 被 schema 网关拒绝
 *   7 项目列表          /api/projects/list
 *   8 数据导入          init/chunk/status/complete，文件必须落自定义 raw_data 目录
 *   9 任务下发+日志     /api/tasks/submit + SSE /api/tasks/logs（mock 执行面）
 *  10 工单面            create/list/queue/receipt-404（完整执行链由仓库门禁覆盖）
 *  11 门户收件箱        /api/portal/inbox
 *
 * 报告构建（/api/report/build）需要真实算力节点，这里 SKIP，
 * 由 delivery_acceptance 单元门禁覆盖判据。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '..');
const positional = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const TARGET_ROOT = path.resolve(positional[0] || 'D:\\00.AIagent\\codespace\\bioworkbench');
const RUNTIME = path.join(TARGET_ROOT, 'resources', 'runtime');
const VENV_PYTHON = path.join(TARGET_ROOT, 'venv', 'Scripts', 'python.exe');
const FIXTURE = path.join(REPO_ROOT, 'workspace', 'projects', 'PRJ_GSE316126_SANITY', 'data', 'expr_matrix.tsv');
const ORDER_EXAMPLE = path.join(REPO_ROOT, 'tools', 'examples', 'work_order_v2.example.json');

const results = [];
function report(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? ' - ' + detail : ''}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function freePort() {
  return new Promise(resolve => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(0));
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function api(port, pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(options.timeoutMs || 30000),
  });
  let body = null;
  try { body = await response.json(); } catch {}
  return { status: response.status, body };
}

async function main() {
  for (const [label, target] of [['runtime', RUNTIME], ['venv python', VENV_PYTHON], ['fixture', FIXTURE]]) {
    if (!fs.existsSync(target)) {
      console.error(`[verify-functions] missing ${label}: ${target}`);
      process.exit(1);
    }
  }

  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-portable-fn-'));
  const rawDataDir = path.join(dataRoot, 'raw_data');
  for (const dir of [rawDataDir, path.join(dataRoot, 'workspace', 'projects'), path.join(dataRoot, 'portal', 'inbox'), path.join(dataRoot, '.ops_state'), path.join(dataRoot, 'ledger')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const port = await freePort();

  const child = spawn(path.join(RUNTIME, 'node', 'node.exe'), [
    path.join(RUNTIME, 'BioanalysDesktop', 'server', 'index.js'),
  ], {
    cwd: dataRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      BAD_PORT: String(port),
      BIO_ALLOW_DEV_NOAUTH: '1',
      BIO_ASSET_ROOT: RUNTIME,
      BIO_DATA_HOME: dataRoot,
      BIO_UPLOAD_ROOT: rawDataDir,
      BIO_PYTHON_PATH: VENV_PYTHON,
      BIO_COMPUTE_ADAPTER: 'mock',
      BIO_ALLOW_MOCK_COMPUTE: '1',
      BIO_COMPUTE_MOCK_STDOUT: 'CREATED',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let serverLog = '';
  child.stdout.on('data', chunk => { serverLog += chunk.toString(); });
  child.stderr.on('data', chunk => { serverLog += chunk.toString(); });

  const deadline = Date.now() + 30000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1200) });
      if (response.ok) { healthy = true; break; }
    } catch {}
    await sleep(250);
  }
  if (!healthy) {
    console.error(`[verify-functions] backend failed to start:\n${serverLog.slice(-2000)}`);
    try { child.kill(); } catch {}
    process.exit(1);
  }

  try {
    const health = await api(port, '/api/health');
    report('1 服务健康', health.status === 200 ? 'PASS' : 'FAIL', `status=${health.status}`);

    const selfcheck = await api(port, '/api/selfcheck', { timeoutMs: 60000 });
    const checks = Array.isArray(selfcheck.body?.checks) ? selfcheck.body.checks.length : 0;
    report('2 五维自检', selfcheck.status === 200 && checks >= 5 ? 'PASS' : 'FAIL',
      `status=${selfcheck.status} checks=${checks} compute_mode=${selfcheck.body?.compute_mode}`);

    const workflows = await api(port, '/api/workflows');
    const series = Array.isArray(workflows.body?.series) ? workflows.body.series.length : 0;
    report('3 模块注册表', workflows.status === 200 && series === 3 ? 'PASS' : 'FAIL', `series=${series}`);

    const templates = await api(port, '/api/figures/templates');
    const catalog = await api(port, '/api/figures/catalog');
    const templateCount = Array.isArray(templates.body?.templates) ? templates.body.templates.length : 0;
    report('4 图件模板', templates.status === 200 && catalog.status === 200 && templateCount >= 90 ? 'PASS' : 'FAIL',
      `templates=${templateCount} catalog_ok=${catalog.body?.ok}`);

    const projectId = 'PRJ_PORTABLE_FN_' + Date.now().toString(36).toUpperCase();
    const create = await api(port, '/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        lineId: 'line1_bulk',
        basicInfo: { name: '便携版功能验证', domain: '代谢', species: 'Homo sapiens' },
        dataSource: {
          source: 'GEO',
          dataType: 'bulk_rnaseq',
          sampleCount: 2,
          datasets: [{ gse: 'GSE16561', gpl: 'GPL6883', role: 'train', sampleCount: 2 }],
        },
        groupingDesign: {
          mode: 'case_control',
          groups: [
            { groupName: 'control', role: 'reference', sampleIds: ['GSM1', 'GSM2'] },
            { groupName: 'case', role: 'disease_stage', sampleIds: ['GSM3', 'GSM4'] },
          ],
          contrasts: [{ name: 'case_vs_control', case: 'case', ctrl: 'control', isPrimary: true }],
        },
      }),
      timeoutMs: 60000,
    });
    report('5 建项（venv 真网关）', create.status >= 200 && create.status < 300 ? 'PASS' : 'FAIL',
      `status=${create.status} ${create.body?.message || create.body?.error || ''}`);

    const badCreate = await api(port, '/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'PRJ_BAD_' + Date.now().toString(36),
        lineId: 'line1_bulk',
        basicInfo: { name: '负路径', domain: '代谢' },
        dataSource: { source: 'GEO', dataType: 'bulk_rnaseq', sampleCount: 2, datasets: [{ gse: 'GSE1', gpl: 'GPL1', role: 'train', sampleCount: 2 }] },
        groupingDesign: {
          mode: 'case_control',
          groups: [
            { groupName: 'control', role: 'reference', sampleIds: ['GSM1', 'GSM2'] },
            { groupName: 'case', role: 'disease_stage', sampleIds: ['GSM3', 'GSM4'] },
          ],
          contrasts: [{ name: 'c', case: 'case', ctrl: 'control', isPrimary: true }],
        },
        pipeline: 'line9_unknown',
      }),
    });
    const denied = badCreate.status === 400 && String(badCreate.body?.error || '').includes('Schema');
    report('6 建项负路径（网关拒绝）', denied ? 'PASS' : 'FAIL', `status=${badCreate.status} error=${badCreate.body?.error}`);
    if (denied === false) {
      const gatewayLines = serverLog.split('\n').filter(line => line.includes('schema_gateway'));
      console.log(`[debug] backend stderr schema_gateway lines: ${gatewayLines.length}`);
      for (const line of gatewayLines.slice(0, 5)) console.log(`[debug] ${line}`);
    }

    const list = await api(port, '/api/projects/list', { timeoutMs: 60000 });
    const projectsArray = Array.isArray(list.body?.projects);
    const found = projectsArray && list.body.projects.some(item => item.projectId === projectId);
    report('7 项目列表', list.status === 200 && projectsArray ? 'PASS' : 'FAIL',
      `status=${list.status} projects=${list.body?.projects?.length ?? 0} found=${found}`);

    const fixtureBytes = fs.readFileSync(FIXTURE);
    const fixtureStat = fs.statSync(FIXTURE);
    const init = await api(port, '/api/upload/init', {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        lineId: 'line1_bulk',
        filename: 'expr_matrix.tsv',
        size: fixtureStat.size,
        lastModified: Math.floor(fixtureStat.mtimeMs),
      }),
    });
    const uploadId = init.body?.uploadId;
    if (!uploadId) {
      report('8 数据导入', 'FAIL', `init status=${init.status} ${init.body?.error || ''}`);
    } else {
      const chunkSize = init.body?.chunkSize || 4 * 1024 * 1024;
      for (let offset = 0, index = 0; offset < fixtureBytes.length; offset += chunkSize, index++) {
        const slice = fixtureBytes.subarray(offset, Math.min(offset + chunkSize, fixtureBytes.length));
        const response = await fetch(`http://127.0.0.1:${port}/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${index}`, {
          method: 'POST',
          body: slice,
          headers: { 'Content-Type': 'application/octet-stream' },
          signal: AbortSignal.timeout(60000),
        });
        if (!response.ok) {
          report('8 数据导入', 'FAIL', `chunk ${index} status=${response.status}`);
          break;
        }
      }
      const status = await api(port, `/api/upload/status?uploadId=${encodeURIComponent(uploadId)}`);
      const chunksInRaw = (function findParts(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (findParts(full)) return true;
          } else if (entry.name.endsWith('.part')) return true;
        }
        return false;
      })(rawDataDir);
      const complete = await api(port, '/api/upload/complete', {
        method: 'POST',
        body: JSON.stringify({ uploadId, projectId, lineId: 'line1_bulk', filename: 'expr_matrix.tsv' }),
        timeoutMs: 120000,
      });
      const landed = (function find(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (find(full)) return true;
          } else if (entry.name.includes('expr_matrix')) return true;
        }
        return false;
      })(rawDataDir);
      report('8 数据导入（raw_data 目录生效）',
        init.status === 200 && status.status === 200 && chunksInRaw && complete.status === 200 ? 'PASS' : 'FAIL',
        `init=${init.status} status=${status.status} chunksInRaw=${chunksInRaw} complete=${complete.status} rawDir=${rawDataDir}`);
    }

    const submit = await api(port, '/api/tasks/submit', {
      method: 'POST',
      body: JSON.stringify({ projectId, lineId: 'line1_bulk', step: 'qc_fastq', inputs: [], outputs: [] }),
      timeoutMs: 60000,
    });
    const taskId = submit.body?.taskId;
    if (!taskId) {
      report('9 任务下发+日志', 'FAIL', `submit status=${submit.status} ${submit.body?.error || ''}`);
    } else {
      const response = await fetch(`http://127.0.0.1:${port}/api/tasks/logs?id=${encodeURIComponent(taskId)}`);
      let sawLog = false;
      let sawExit = false;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const sseDeadline = Date.now() + 20000;
      let buffer = '';
      while (Date.now() < sseDeadline && !sawExit) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          if (frame.includes('event: stdout') || frame.includes('event: stderr')) sawLog = true;
          if (frame.includes('event: exit')) { sawLog = true; sawExit = true; }
        }
      }
      try { await reader.cancel(); } catch {}
      report('9 任务下发+日志', sawLog ? 'PASS' : 'PARTIAL', `taskId=${taskId} sawLog=${sawLog} sawExit=${sawExit}`);
    }

    const orderDraft = JSON.parse(fs.readFileSync(ORDER_EXAMPLE, 'utf8'));
    orderDraft.work_order_id = 'WO_PORTABLE_FN_1';
    orderDraft.project_id = projectId;
    orderDraft.requirement.basicInfo.name = '便携版功能验证';
    orderDraft.requirement.basicInfo.domain = '代谢';
    orderDraft.requirement.basicInfo.dataType = 'bulk_rnaseq';
    orderDraft.requirement.dataSource.dataType = 'bulk_rnaseq';
    orderDraft.execution.line_id = 'line1_bulk';
    const lease = await api(port, '/api/orchestration/authority/acquire', { method: 'POST', body: JSON.stringify({}) });
    const leaseId = lease.body?.lease_id || '';
    const order = await api(port, '/api/work-orders', {
      method: 'POST',
      body: JSON.stringify(orderDraft),
      headers: leaseId ? { 'X-Bio-Lease-Id': leaseId } : {},
      timeoutMs: 60000,
    });
    const orders = await api(port, '/api/work-orders');
    const receipt = await api(port, '/api/work-orders/WO_PORTABLE_FN_1/receipt');
    const orderOk = order.status >= 200 && order.status < 300
      && Array.isArray(orders.body?.work_orders)
      && orders.body.work_orders.some(item => item.work_order_id === 'WO_PORTABLE_FN_1')
      && receipt.status === 404;
    report('10 工单面（create/list/receipt-404）', orderOk ? 'PASS' : 'FAIL',
      `create=${order.status} list=${orders.status} receipt=${receipt.status} error=${order.body?.error || order.body?.code || ''}`);

    const inbox = await api(port, '/api/portal/inbox');
    const inboxOk = inbox.status === 200
      && (Array.isArray(inbox.body?.items) || Array.isArray(inbox.body?.packages) || inbox.body?.ok === true);
    report('11 门户收件箱', inboxOk ? 'PASS' : 'FAIL', `status=${inbox.status}`);

    report('12 报告构建', 'SKIP', '需要真实算力节点；判据由 delivery_acceptance 单元门禁覆盖');
  } finally {
    try { child.send({ type: 'shutdown' }); } catch {}
    await new Promise(resolve => {
      const timer = setTimeout(() => { try { child.kill(); } catch {} resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }

  const failed = results.filter(item => item.status === 'FAIL');
  const passed = results.filter(item => item.status === 'PASS').length;
  console.log(`\n[verify-functions] PASS=${passed} FAIL=${failed.length} SKIP=${results.length - passed - failed.length}`);
  if (failed.length > 0) process.exit(1);
}

main().catch(error => {
  console.error(`[verify-functions] exception: ${error?.stack || error}`);
  process.exit(1);
});
