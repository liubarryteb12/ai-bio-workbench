/**
 * 本地环境文件加载器。
 *
 * 只读取仓库根下的 .env.local 与 .env，不覆盖已经存在的进程环境变量。
 * 这样本地算力配置可以留在未跟踪文件里，仓库本身不保存任何设备信息。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadEnvFile(filePath, env = process.env) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const loaded = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[match[1]] === undefined) {
      env[match[1]] = value;
      loaded.push(match[1]);
    }
  }
  return loaded;
}

export function loadLocalEnv(root = REPO_ROOT, env = process.env) {
  const loaded = [];
  for (const name of ['.env.local', '.env']) {
    loaded.push(...loadEnvFile(path.join(root, name), env));
  }
  return loaded;
}

loadLocalEnv();
