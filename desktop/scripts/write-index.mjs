/**
 * 便携目录引用关系索引生成器（需求 4）。
 *
 * 用法：node scripts/write-index.mjs <targetRoot> [--relations <json>]
 *
 * 覆盖范围：targetRoot 下的全部稳定文件（exe、resources、venv、tools...）。
 * 排除范围：data\（用户运行数据，随使用变化，不属于稳定索引面）。
 * 输出：<targetRoot>\index.json，包含 entries（path/bytes/sha256）与
 * relations（构建来源关系，来自 --relations 或既有 index 合并）。
 *
 * 新增/删除文件后重新运行本脚本即完成索引更新；verify 与 gate 会校验
 * 索引与磁盘一致，漂移即红。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walkFiles(root, excludedRoots) {
  const files = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full);
      const excluded = excludedRoots.some(excluded => {
        const resolved = path.resolve(root, excluded);
        return full === resolved || full.startsWith(resolved + path.sep);
      });
      if (excluded) continue;
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      files.push({
        path: relative.split(path.sep).join('/'),
        bytes: entry.size ?? fs.statSync(full).size,
        sha256: sha256(full),
      });
    }
  };
  visit(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function main() {
  const positional = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const targetRoot = path.resolve(positional[0] || '');
  if (!fs.existsSync(targetRoot)) {
    console.error(`target root missing: ${targetRoot}`);
    process.exit(1);
  }

  const existingIndexPath = path.join(targetRoot, 'index.json');
  let relations = [];
  if (fs.existsSync(existingIndexPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(existingIndexPath, 'utf8'));
      relations = Array.isArray(existing.relations) ? existing.relations : [];
    } catch {}
  }
  if (relations.length === 0) {
    const runtimeIndex = path.join(targetRoot, 'resources', 'runtime', 'app-index.json');
    if (fs.existsSync(runtimeIndex)) {
      try {
        const runtime = JSON.parse(fs.readFileSync(runtimeIndex, 'utf8'));
        if (Array.isArray(runtime.relations)) relations = runtime.relations;
      } catch {}
    }
  }
  const relationsArg = readArg('--relations');
  if (relationsArg && fs.existsSync(relationsArg)) {
    const parsed = JSON.parse(fs.readFileSync(relationsArg, 'utf8'));
    if (Array.isArray(parsed.relations)) relations = parsed.relations;
  }

  const entries = walkFiles(targetRoot, ['data']);
  const index = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    root: path.basename(targetRoot),
    entry_count: entries.length,
    total_bytes: entries.reduce((sum, item) => sum + item.bytes, 0),
    excluded: ['data/'],
    relations,
    entries,
  };
  const outPath = path.join(targetRoot, 'index.json');
  fs.writeFileSync(outPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`[index] wrote ${outPath}`);
  console.log(`[index] entries: ${index.entry_count}, bytes: ${index.total_bytes}, relations: ${relations.length}`);
}

main();
