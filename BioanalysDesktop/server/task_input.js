import fs from 'node:fs';
import path from 'node:path';
import { PROJECTS_ROOT, projectLineDir } from './domain.js';
import { runAsync, runSshAsync, scpArgv, shellQuote } from './proc.js';
import { remoteRawPath, deployedRawName } from './upload.js';
import { PORTAL_INBOX } from './portal_inbox.js';
export function remoteTaskInput(rawPath, projectId, lineId) {
  const normalized = String(rawPath || '').split('\\').join('/').replace(/^\.\/+/, '');
  if (!normalized) return `${projectLineDir(projectId, lineId)}/processed/input.tsv`;
  if (normalized.startsWith(`data/${lineId}/`)) {
    return `${PROJECTS_ROOT}/${projectId}/${normalized.slice('data/'.length)}`;
  }
  if (normalized.startsWith(`figures/${lineId}/`)) {
    return `${PROJECTS_ROOT}/${projectId}/${normalized}`;
  }
  if (normalized.startsWith('processed/') || normalized.startsWith('results/')) {
    return `${projectLineDir(projectId, lineId)}/${normalized}`;
  }
  if (!normalized.includes('/')) {
    return `${projectLineDir(projectId, lineId)}/processed/${normalized}`;
  }
  return `${PROJECTS_ROOT}/${projectId}/${normalized}`;
}

/**
 * 图模板脚本上传。异步版：调用链上再有同步 scp，建项请求就会把事件循环按住。
 * 返回形态未变（{ ok, error, uploads }），调用点只多一个 await。
 */
export async function uploadPreparedFigureScripts(preparedFigures) {
  const uploads = [];
  for (const entry of preparedFigures.manifest_entries || []) {
    const remoteDir = path.posix.dirname(entry.remote_path);
    const mkdir = await runSshAsync('k40-ubuntu', `mkdir -p ${shellQuote(remoteDir)}`, { timeoutMs: 40000 });
    if (mkdir.code !== 0) {
      return { ok: false, error: `图模板目录创建失败: ${mkdir.text}`, uploads };
    }
    const scp = await runAsync([
      'scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
      entry.local_path, `k40-ubuntu:${entry.remote_path}`,
    ]);
    if (scp.code !== 0) {
      return {
        ok: false,
        error: `图模板脚本上传失败: ${scp.stderr || scp.stdout || 'stderr 为空'}`,
        uploads,
      };
    }
    uploads.push({
      template_id: entry.template_id,
      local_path: entry.local_path,
      remote_path: entry.remote_path,
    });
  }
  return { ok: true, error: '', uploads };
}

/**
 * 提交包数据文件部署：scp 落远端 raw_data/ 后做字节校验。
 *
 * 异步版（T1.5）：两个 timeoutMs 都是 900000（15 分钟）。真链路打不回握手时，
 * 同步出口会让整个后端停摆同样长的时间，所以 scp 与随后的 stat 探针一起换异步。
 * 返回形态未变（{ ok, results }），调用点必须 await，漏了会把 Promise 当成成功。
 */
export async function deployDataFiles(projectId, lineId, dataFiles) {
  const results = [];
  if (!Array.isArray(dataFiles) || !dataFiles.length) return { ok: true, results };
  if (!lineId) {
    return {
      ok: false,
      results: dataFiles.map((f) => ({
        name: f.name, ok: false,
        error: '无法从 pipelineDag 推断分析线，未部署',
      })),
    };
  }
  for (const file of dataFiles) {
    const src = path.resolve(PORTAL_INBOX, file.path);
    if (!src.startsWith(path.resolve(PORTAL_INBOX) + path.sep) || !fs.existsSync(src)) {
      results.push({ name: file.name, ok: false, error: `提交包内找不到源文件: ${file.path}` });
      continue;
    }
    let remote;
    try {
      remote = remoteRawPath(projectId, lineId, deployedRawName(file));
    } catch (cause) {
      results.push({ name: file.name, ok: false, error: cause.message });
      continue;
    }
    const localSize = fs.statSync(src).size;
    const remoteDir = remote.slice(0, remote.lastIndexOf('/')) || '/';
    const mkdir = await runSshAsync('k40-ubuntu', `mkdir -p ${shellQuote(remoteDir)}`, { timeoutMs: 40000 });
    if (mkdir.code !== 0) {
      results.push({ name: file.name, ok: false, error: `远端目录创建失败: ${mkdir.text || '无输出'}` });
      continue;
    }
    const scp = await runAsync(scpArgv(src, remote), { timeoutMs: 900000 });
    if (scp.code !== 0) {
      results.push({ name: file.name, ok: false, error: `scp 失败: ${scp.stderr || scp.stdout}` });
      continue;
    }
    const stat = await runSshAsync('k40-ubuntu', `stat -c %s ${shellQuote(remote)} 2>/dev/null || echo MISSING`, { timeoutMs: 40000 });
    const remoteSize = Number(stat.text.trim());
    if (!Number.isFinite(remoteSize) || remoteSize !== localSize) {
      results.push({
        name: file.name, ok: false,
        error: `字节校验不符（本地 ${localSize} / 远端 ${Number.isFinite(remoteSize) ? remoteSize : 'MISSING'}）`,
      });
      continue;
    }
    results.push({ name: file.name, ok: true, remotePath: remote, size: localSize });
  }
  return { ok: results.every((r) => r.ok), results };
}
