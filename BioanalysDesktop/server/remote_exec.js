/**
 * 远端执行层：本地零算力红线的唯一出口。
 *
 * 固定经 ADB 到主算力节点执行；SSH 通道已封存，见
 * `_archive/ssh_retired_20261111/RESTORE.md`。本模块只负责把命令送过去、
 * 按宽松/严格两种口径取回结果，并把通道自身可能混入的 noise 滤掉。
 */

import { projectLineDir } from './domain.js';
import { adbRaw, resolveComputeAdapter } from './proc.js';

export function runRemoteRaw(command) {
  resolveComputeAdapter();
  return adbRaw(command, { timeoutMs: 40000 });
}

/**
 * 列远端该线 processed/ 下的文件名（不含路径）。
 * 只取一层、不递归：M4 的产物核对只需要文件名集合，递归会在容器里触发 P-23。
 * 通道失败时返回空集合，预览端点不该因为链路抖动就 500，缺产物会显示成 missing。
 */
export function listRemoteProcessed(projectId, lineId) {
  const dir = `${projectLineDir(projectId, lineId)}/processed`;
  const out = runRemote(`ls -1 ${dir} 2>/dev/null || true`);
  return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
}

/** 宽松版：只要文本，忽略退出码（多数调用点靠命令里的 `|| true` / MISSING 自己兜底） */
export function runRemote(command) {
  return runRemoteRaw(command).text;
}

/**
 * 严格版：通道退出码非 0 或输出为空一律抛错，供五维自检使用。
 *
 * 存在的理由（踩坑台账 P-15）：宽松版丢弃退出码，链路断时通道返回非 0 且
 * stdout 为空，第 1 维会把空串判成"原生 ext4"、第 2 维会把空串算成 100% free，
 * 自检出现假绿灯 -  - 而自检是提交门禁，假绿灯比红灯危险得多。
 */
export function runRemoteStrict(command) {
  const { code, text } = runRemoteRaw(command);
  if (code !== 0) throw new Error(`远端命令退出码 ${code}`);
  if (!text) throw new Error('远端命令无输出');
  return text;
}

/**
 * 桥接输出的通道 noise 过滤：只留引擎原文。
 *
 * 真链实测（K40 高负载、known_hosts 首次写入时）stderr 会混进 ssh 客户端自身
 * 的提示行（`Warning: Permanently added ... to the list of known hosts`），
 * 这些不是引擎内容。若不滤掉，400 error 会把 ssh 提示和引擎 [BRIDGE FAIL]
 * 原文糊在一起，调用方难以点名是哪个断言没过。
 * 风险：按最保守口径只删已知 noise 前缀，其余一律保留；两通道重复内容只留一份
 * （2>&1 后 stdout/stderr 可能同文），避免 error 里重复刷屏。
 */
export function sanitizeBridgeOutput(stdout = '', stderr = '') {
  const noise = /^(Warning: Permanently added|Warning: .*known hosts)/i;
  const lines = [];
  const seen = new Set();
  for (const chunk of [stdout, stderr]) {
    for (const line of String(chunk ?? '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || noise.test(trimmed) || seen.has(trimmed)) continue;
      seen.add(trimmed);
      lines.push(line);
    }
  }
  return lines.join('\n').trim();
}
