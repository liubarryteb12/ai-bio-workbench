/**
 * 建项时数据文件落盘验证（真实 ssh/scp 到 k40-ubuntu）。
 *
 * 验的是"客户上传的矩阵在建项后真的出现在远端项目的本线 raw_data/"，
 * 而不是只写进 project.json。这一步不通，客户填的相对路径在服务器上就是空的。
 *
 * 会创建真实远端项目目录，结束时删除本次创建的那一个（按固定前缀 + 时间戳定位）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8787';
const INBOX = fileURLToPath(new URL('../portal/inbox/', import.meta.url));
const STAMP = Date.now().toString(36);
const PKG = `PKG_2099-01-01_000000_数据落盘验证_${STAMP}`;
const PROJECT = `PRJ_DFTEST_${STAMP}`;
const LINE = 'line1_bulk';
const REMOTE_PROJECT = `/mnt/ssd/bio_data/projects/${PROJECT}`;

let failed = 0;
function check(label, cond, detail = '') {
  if (!cond) failed += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${label}${detail ? ' | ' + detail : ''}`);
}

function ssh(cmd) {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', cmd],
    { encoding: 'utf8' });
}

const content = 'gene\tS1\tS2\nIL17A\t10\t12\nS100A8\t3\t5\n';
const archiveName = 'train_matrix__GSE277173__mouse_cortex.tsv';
const pkgDir = path.join(INBOX, PKG);
fs.mkdirSync(path.join(pkgDir, 'raw_data'), { recursive: true });
fs.writeFileSync(path.join(pkgDir, 'raw_data', archiveName), content, 'utf8');
fs.writeFileSync(path.join(pkgDir, 'requirement.json'), JSON.stringify({ project_id: PROJECT }), 'utf8');

let created = false;
try {
  const payload = {
    projectId: PROJECT,
    basicInfo: { name: '数据落盘验证', disease: 'Psoriasis', species: 'Homo sapiens' },
    dataSource: {
      dataType: 'microarray',
      data_source_mode: 'IN_HOUSE_UPLOAD',
      id_type: 'Gene_Symbol',
      value_scale: 'Raw_Counts',
      uploaded_files: { train_matrix: 'raw_data/mouse_cortex.tsv', val_matrix: null },
    },
    groupingDesign: {
      mode: 'two_group',
      groups: [
        { groupName: 'Control', role: 'reference', stageOrder: 0, sampleIds: ['Ctrl_1'] },
        { groupName: 'Disease', role: 'disease_stage', stageOrder: 1, sampleIds: ['Case_1'] },
      ],
    },
    pipelineDag: [{ order: 1, stepId: 'prep_matrix' }, { order: 2, stepId: 'deg_limma' }],
    dataFiles: [{
      role: 'train_matrix', bind: '', name: 'mouse_cortex.tsv',
      path: `${PKG}/raw_data/${archiveName}`, size: Buffer.byteLength(content),
    }],
  };

  const res = await fetch(`${BASE}/api/projects/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  created = res.status === 200 || res.status === 207;
  check('建项返回成功', created, `${res.status} ${body.error || body.message || ''}`);
  check('识别出分析线', body.line === LINE, String(body.line));
  check('数据文件部署标记 ok', body.dataFiles?.[0]?.ok === true, JSON.stringify(body.dataFiles?.[0] || null));

  const remotePath = `${REMOTE_PROJECT}/${LINE}/raw_data/mouse_cortex.tsv`;
  const stat = ssh(`stat -c %s '${remotePath}' 2>/dev/null || echo MISSING`).trim();
  check('远端 raw_data 存在该文件', stat !== 'MISSING', stat);
  check('远端字节数与本地一致', Number(stat) === Buffer.byteLength(content),
    `${stat} vs ${Buffer.byteLength(content)}`);

  const remoteContent = ssh(`cat '${remotePath}'`);
  check('远端内容一致', remoteContent === content);

  // project.json 里必须留下 data_files 记录，且路径仍是包内相对路径
  const metaRaw = ssh(`cat '${REMOTE_PROJECT}/project.json'`);
  const meta = JSON.parse(metaRaw);
  check('project.json 记录 data_files', Array.isArray(meta.data_files) && meta.data_files.length === 1);
  check('project.json 保留包内相对路径',
    meta.data_files?.[0]?.path === `${PKG}/raw_data/${archiveName}`,
    meta.data_files?.[0]?.path || '');

  // 路径穿越必须在建项阶段被拒（不写盘）
  const evil = await fetch(`${BASE}/api/projects/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      projectId: `${PROJECT}_evil`,
      dataFiles: [{ role: 'other', name: 'x.tsv', path: '../../etc/passwd' }],
    }),
  });
  const evilBody = await evil.json().catch(() => ({}));
  check('路径穿越被拒', evil.status === 400, `${evil.status} ${evilBody.error || ''}`);
  check('穿越请求未创建项目',
    ssh(`test -d '${REMOTE_PROJECT}_evil' && echo YES || echo NO`).trim() === 'NO');
} finally {
  if (created) {
    try { ssh(`rm -rf '${REMOTE_PROJECT}'`); } catch { /* 清理失败不掩盖结论 */ }
  }
  fs.rmSync(pkgDir, { recursive: true, force: true });
  const left = fs.existsSync(INBOX) ? fs.readdirSync(INBOX).filter((n) => n.includes(STAMP)) : [];
  check('本地测试包已清理', left.length === 0, JSON.stringify(left));
  check('远端测试项目已清理',
    ssh(`test -d '${REMOTE_PROJECT}' && echo YES || echo NO`).trim() === 'NO');
}

console.log(failed === 0 ? '\n全部符合预期' : `\n${failed} 条不符合预期`);
process.exitCode = failed === 0 ? 0 : 1;
