import fs from 'node:fs';
import path from 'node:path';
import { PROJECTS_ROOT, projectLineDir } from './domain.js';
import { runSync } from './proc.js';
import { remoteRawPath, deployedRawName } from './upload.js';
import { PORTAL_INBOX } from './portal_inbox.js';
export function createTaskInput({ runRemoteRaw, runRemote }) {
  function remoteTaskInput(rawPath, projectId, lineId) {
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

  function uploadPreparedFigureScripts(preparedFigures) {
    const uploads = [];
    for (const entry of preparedFigures.manifest_entries || []) {
      const remoteDir = path.posix.dirname(entry.remote_path);
      const mkdir = runRemoteRaw(`mkdir -p '${remoteDir}'`);
      if (mkdir.code !== 0) {
        return { ok: false, error: `图模板目录创建失败: ${mkdir.text}`, uploads };
      }
      const scp = runSync([
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

  function deployDataFiles(projectId, lineId, dataFiles) {
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
      const scp = runSync(
        ['scp', '-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes',
          '-P', '10022', src, `root@127.0.0.1:${remote}`],
        { timeoutMs: 900000 }
      );
      if (scp.code !== 0) {
        results.push({ name: file.name, ok: false, error: `scp 失败: ${scp.stderr || scp.stdout}` });
        continue;
      }
      const stat = runRemote(`stat -c %s '${remote}' 2>/dev/null || echo MISSING`);
      const remoteSize = Number(stat.trim());
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
  return {
    remoteTaskInput,
    uploadPreparedFigureScripts,
    deployDataFiles,
  };
}
