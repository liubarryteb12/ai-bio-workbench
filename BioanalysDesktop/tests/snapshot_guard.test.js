/**
 * 工作区快照脚本的守卫（ops/09_snapshot.ps1）。
 *
 * 背景：本仓库 .git 只读，无法 commit，未提交改动没有回滚点。09_snapshot.ps1 用
 * zip 快照补上这个缺口。它踩过一个必须钉死的坑：Compress-Archive 只取 basename
 * 当条目名，777 个文件被拍平到根目录，src/workflows.json 变成 workflows.json，
 * 同名文件互相覆盖，解压只剩 695 个且目录结构全丢，等于不可还原。
 *
 * 本文件钉住三件事：打包方式必须保留相对路径、排除口径必须与 .gitignore 一致、
 * 落盘后必须自校验（条目数 + SHA256）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SNAPSHOT = path.join(REPO, 'ops', '09_snapshot.ps1');
const GITIGNORE = path.join(REPO, '.gitignore');

const snapshotText = fs.readFileSync(SNAPSHOT, 'utf8');

test('快照脚本必须用 ZipFile.CreateEntry，不能用 Compress-Archive', () => {
  assert.ok(
    snapshotText.includes('ZipFile]::Open'),
    '必须用 System.IO.Compression.ZipFile 逐条写入',
  );
  assert.ok(
    snapshotText.includes('CreateEntry'),
    '必须显式指定条目名，否则目录结构会丢',
  );
  // Compress-Archive 只取 basename，777 个文件被拍平，同名文件互相覆盖
  assert.ok(
    !snapshotText.includes('Compress-Archive -DestinationPath'),
    '不得用 Compress-Archive 打包（实测：拍平目录结构，快照不可还原）',
  );
});

test('条目名必须是相对 repoRoot 的路径，且用 / 分隔', () => {
  assert.ok(
    snapshotText.includes('$abs.Substring($repoRoot.Length + 1)'),
    '条目名要截掉仓库根，否则解压出来是绝对路径层级',
  );
  assert.ok(
    snapshotText.includes(".Replace('\\', '/')"),
    'zip 条目统一用 / 分隔，Windows 反斜杠在别的解压工具里会变成一层目录',
  );
});

test('落盘后必须自校验条目数与 SHA256', () => {
  assert.ok(snapshotText.includes('$written -ne $pending.Count'), '缺少条目数核对');
  assert.ok(snapshotText.includes('Get-FileHash'), '缺少 SHA256 记录');
  assert.ok(snapshotText.includes('SHA256 复算不符'), '缺少哈希复算比对');
  assert.ok(snapshotText.includes('.manifest.json'), '缺少 manifest 旁挂');
});

test('排除口径与 .gitignore 对齐（数据大块不进快照）', () => {
  const ignore = fs.readFileSync(GITIGNORE, 'utf8');
  // 这些目录在 .gitignore 里被排除，快照若收了就是把本就不进版本控制的东西打包
  for (const name of ['node_modules', 'outputs', 'test_use_data', 'project_data', 'reference']) {
    assert.ok(
      ignore.includes(name),
      `.gitignore 应排除 ${name}，否则快照与版本控制口径分叉`,
    );
    const excluded = snapshotText.includes(`'${name}'`)
      || (name === 'node_modules' && snapshotText.includes("'node_modules'"));
    assert.ok(excluded || name !== 'node_modules', `快照应排除 ${name}`);
  }
  assert.ok(snapshotText.includes("'node_modules'"), '快照必须排除 node_modules');
  assert.ok(snapshotText.includes("'__pycache__'"), '快照必须排除 __pycache__');
});

test('快照目录必须落在项目内，不写工作区外', () => {
  assert.ok(
    snapshotText.includes("Join-Path $repoRoot 'snapshots'"),
    '默认落点应是项目内 snapshots/',
  );
  assert.ok(
    snapshotText.includes('$Keep -lt 0'),
    '保留数量为负时应判参数错误',
  );
});

test('保留策略只删本脚本产的快照，按时间从最旧开始', () => {
  assert.ok(
    snapshotText.includes("'^workbench_\\d{8}_\\d{6}\\.zip$'"),
    '删除必须按命名白名单过滤，避免误删别人的文件',
  );
  assert.ok(
    snapshotText.includes('Sort-Object LastWriteTime'),
    '必须按时间排序，从最旧的开始删',
  );
});

test('scripts/ 母版契约仍然成立（上一轮闸门不回潮）', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(REPO, 'src', 'workflows.json'), 'utf8'));
  const registered = new Set();
  for (const series of registry.series) {
    for (const stage of series.stages) {
      for (const mod of stage.mods) registered.add(`${series.id}/${mod.script || mod.id}`);
    }
  }
  // 共享库不是步骤母版（没有命令行入口，被步骤 import），不计入未登记母版。
  const SHARED_LIBS = new Set(['h5_rows.py', 'spatial_stats.py']);
  const stray = [];
  for (const line of ['line1_bulk', 'line2_scrna', 'line3_spatial']) {
    const dir = path.join(REPO, 'src', line, 'scripts');
    for (const name of fs.readdirSync(dir)) {
      if (name === 'README.md' || name === 'probe_env') continue;
      if (SHARED_LIBS.has(name)) continue;
      // 只判文件：目录（如 __pycache__）不是母版，算进来会产生假红
      if (!fs.statSync(path.join(dir, name)).isFile()) continue;
      if (!registered.has(`${line}/${name}`)) stray.push(`${line}/${name}`);
    }
  }
  assert.deepEqual(stray, [], 'scripts/ 下出现未登记母版');
});
