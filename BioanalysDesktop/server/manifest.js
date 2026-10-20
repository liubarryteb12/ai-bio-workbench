/**
 * 环境清单 manifest：台账 environment 字段的唯一来源
 *
 * 正本在本地 src/<line>/envs/manifest.txt，服务器侧副本由部署通道
 * （ops/06_deploy_scripts.ps1）落到 <line>/envs/，两边字节一致。
 * 存在意义：环境声明"分析中途不更换"，台账要记的是声明值而不是各处写死的默认值。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 台账 environment 需要的四个字段，缺任何一个都视为 manifest 不可用 */
const REQUIRED_FIELDS = ['language', 'version', 'env_name', 'container_image'];

/**
 * 解析 key=value 文本。
 *
 * 跳过空行、# 注释与没有等号的坏行（不抛：manifest 是数据文件，
 * 解析器抛异常会把调用方拖死，缺字段由 readEnvironmentManifest 判定）。
 * 值里的等号保留（按第一个 = 切分），首尾空白剔除。
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnvironmentManifest(text) {
  const result = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key !== '') result[key] = value;
  }
  return result;
}

/**
 * 读某条线的环境声明。
 *
 * @param {string} lineId
 * @returns {{language: string, version: string, env_name: string, container_image: string} | null}
 *   文件不存在、读不了或必填字段不全时返回 null，调用方退化到默认值并提示。
 *   不抛异常：调用点在 runTask 的 exit handler 里，抛错会杀进程。
 */
export function readEnvironmentManifest(lineId) {
  const manifestPath = fileURLToPath(new URL(`../../src/${lineId}/envs/manifest.txt`, import.meta.url));
  let text;
  try {
    text = readFileSync(manifestPath, 'utf8');
  } catch {
    return null;
  }
  const parsed = parseEnvironmentManifest(text);
  const missing = REQUIRED_FIELDS.filter((field) => !parsed[field]);
  if (missing.length > 0) return null;
  return {
    language: parsed.language,
    version: parsed.version,
    env_name: parsed.env_name,
    container_image: parsed.container_image,
  };
}
