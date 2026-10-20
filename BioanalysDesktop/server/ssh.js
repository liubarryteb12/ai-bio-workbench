/**
 * ssh 通道接缝：本地到手机服务器的唯一出口
 *
 * 所有远端执行都经过这里，不散落在各功能模块里 child_process。
 * 别名复用 ~/.ssh/config 已有的 k40（底座）/ k40-ubuntu（容器计算面）。
 */

import { HOSTS } from './domain.js';

/**
 * 把命令包成 ssh 的一条参数。
 *
 * 远端登录 shell 会完整执行收到的字符串，所以必须保证单引号成对：
 * 内层每个 `'` 转成 `'\''`（结束当前引号、写入一个字面单引号、重开引号）。
 *
 * @param {string} command 远端要执行的命令
 * @param {'base'|'compute'} face 底座面还是容器计算面
 * @returns {string} 完整的 ssh 命令行
 */
export function buildRemoteCommand(command, face = 'compute') {
  const host = HOSTS[face];
  if (!host) {
    throw new Error(`未知执行面: ${face}，只能是 base 或 compute`);
  }
  const escaped = String(command).replace(/'/g, String.raw`'\''`);
  return `ssh -o BatchMode=yes -o ConnectTimeout=10 ${host} '${escaped}'`;
}

/** scp 取文件回本地的命令模板 */
export function buildFetchCommand(remotePath, localPath, face = 'compute') {
  const host = HOSTS[face];
  if (!host) {
    throw new Error(`未知执行面: ${face}，只能是 base 或 compute`);
  }
  const escapeOne = (text) => `"${String(text).replace(/"/g, String.raw`\"`)}"`;
  return `scp -o BatchMode=yes -o ConnectTimeout=10 ${escapeOne(`${host}:${remotePath}`)} ${escapeOne(localPath)}`;
}
