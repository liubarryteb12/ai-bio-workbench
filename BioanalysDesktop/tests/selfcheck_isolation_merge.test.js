/**
 * 第 4 维合并灯 + 自检严格 ssh 的防回归测试
 *
 * 覆盖三件事：
 *   1. worstStatus / mergeIsolationChecks 的四档优先级（fail > warn > unknown > pass）
 *   2. proc.runSshStrict 在 ssh 断链（退出码 255 / 空输出）时必须抛错 ——
 *      这是 P-15 假绿灯的根因：宽松版把空输出判成"原生 ext4""100% free"
 *   3. server/index.js 的接线是静态可核的：第 1~4 维必须走严格版，
 *      第 4 维必须把隔离灯与 SHA256 灯合并成一条
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import childProcess from 'node:child_process';

import {
  worstStatus, mergeIsolationChecks,
} from '../server/selfcheck.js';
import { runSshRaw, runSshStrict } from '../server/proc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const INDEX_SRC = fs.readFileSync(path.join(REPO_ROOT, 'BioanalysDesktop', 'server', 'index.js'), 'utf8');
// 诊断路由搬进 routes/ 后，自检处理体随端点走。守卫扫"入口加归属模块"的并集，
// 断言本身不动：出现次数下限与四条正则的语义保持原口径。
const DIAGNOSTICS_SRC = fs.readFileSync(
  path.join(REPO_ROOT, 'BioanalysDesktop', 'server', 'routes', 'diagnostics.routes.js'),
  'utf8',
);
// runRemoteStrict 的定义搬进 remote_exec.js 后，定义那一处也跟着走。
// 并集再加一个文件，出现次数下限与四条正则仍是原口径。
const REMOTE_EXEC_SRC = fs.readFileSync(
  path.join(REPO_ROOT, 'BioanalysDesktop', 'server', 'remote_exec.js'),
  'utf8',
);
const STRICT_GUARD_SRC = INDEX_SRC + DIAGNOSTICS_SRC + REMOTE_EXEC_SRC;

// ---------- 1. 四档优先级 ----------

test('worstStatus：空数组视为 pass（没有坏消息不等于好消息，但语义上无灯可报）', () => {
  assert.equal(worstStatus([]), 'pass');
});

test('worstStatus：fail > warn > unknown > pass 严格有序', () => {
  assert.equal(worstStatus(['pass', 'unknown']), 'unknown');
  assert.equal(worstStatus(['unknown', 'warn']), 'warn');
  assert.equal(worstStatus(['warn', 'fail']), 'fail');
  assert.equal(worstStatus(['pass', 'pass']), 'pass');
});

test('worstStatus：未知状态名按 unknown 处理，不许静默降级成 pass', () => {
  assert.equal(worstStatus(['pass', 'bogus']), 'unknown');
});

// ---------- 2. 合并灯 ----------

test('mergeIsolationChecks：两盏子灯全 pass → 单条 pass 且 detail 是固定通过文案', () => {
  const merged = mergeIsolationChecks(
    { status: 'pass', value: '3/3 线通过', detail: '' },
    { status: 'pass', value: '4/4 一致', detail: '' },
  );
  assert.equal(merged.id, 'isolation');
  assert.equal(merged.label, '跨线隔离/桥接/版本');
  assert.equal(merged.status, 'pass');
  assert.equal(merged.value, '3/3 线通过 | 4/4 一致');
  assert.match(merged.detail, /均通过/);
});

test('mergeIsolationChecks：隔离 fail + 哈希 pass → fail，detail 只点名坏的那条', () => {
  const merged = mergeIsolationChecks(
    { status: 'fail', value: '2/3 线通过', detail: 'line2_scrna 退出码 7' },
    { status: 'pass', value: '4/4 一致', detail: '本地与远端核心文件哈希一致' },
  );
  assert.equal(merged.status, 'fail');
  assert.match(merged.detail, /line2_scrna 退出码 7/);
  assert.doesNotMatch(merged.detail, /哈希一致/);
});

test('mergeIsolationChecks：隔离 pass + 哈希 warn（远端缺文件）→ warn 且点名 MISSING', () => {
  const merged = mergeIsolationChecks(
    { status: 'pass', value: '3/3 线通过', detail: '' },
    { status: 'warn', value: '3/4 一致', detail: '/mnt/ssd/bio_data/ops/bridge_guard.sh 远端文件不存在（MISSING）' },
  );
  assert.equal(merged.status, 'warn');
  assert.match(merged.detail, /MISSING/);
});

test('mergeIsolationChecks：哈希 unknown（不可达）不被隔离 pass 冲掉，也不升级成 fail', () => {
  const merged = mergeIsolationChecks(
    { status: 'pass', value: '3/3 线通过', detail: '' },
    { status: 'unknown', value: '', detail: 'UNREACHABLE: ssh 退出码 255（远端不可达，不能当作失败）' },
  );
  assert.equal(merged.status, 'unknown');
  assert.match(merged.detail, /UNREACHABLE/);
});

test('mergeIsolationChecks：两盏都坏时 detail 用分号并列，两条原因都不丢', () => {
  const merged = mergeIsolationChecks(
    { status: 'fail', value: 'a', detail: '隔离门禁坏' },
    { status: 'fail', value: 'b', detail: '哈希漂移' },
  );
  assert.equal(merged.status, 'fail');
  assert.equal(merged.value, 'a | b');
  assert.match(merged.detail, /隔离门禁坏；哈希漂移/);
});

// ---------- 3. 严格 ssh 防假绿灯 ----------

/** 用默认导入 + mock.method 拦 spawnSync（D-08 铁律） */
function withSpawnSync(t, impl) {
  return t.mock.method(childProcess, 'spawnSync', impl);
}

test('runSshRaw：滤掉 known_hosts 噪声并保留退出码', (t) => {
  withSpawnSync(t, () => ({
    status: 0,
    stdout: 'ext4\n',
    stderr: "Warning: Permanently added '[127.0.0.1]:10022' (ED25519) to the list of known hosts.\n",
  }));
  const { code, text } = runSshRaw('k40-ubuntu', 'df -T /mnt/ssd/bio_data');
  assert.equal(code, 0);
  assert.equal(text, 'ext4');
  assert.doesNotMatch(text, /Warning: Permanently added/);
});

test('runSshStrict：断链（退出码 255、空输出）必须抛错，不许把空串当结果', (t) => {
  withSpawnSync(t, () => ({ status: 255, stdout: '', stderr: 'ssh: connect to host k40-ubuntu port 22: Connection refused' }));
  assert.throws(() => runSshStrict('k40-ubuntu', 'df -T /mnt/ssd/bio_data'), /退出码 255/);
});

test('runSshStrict：退出码 0 但无输出也抛错（命令被截断同样不能当通过）', (t) => {
  withSpawnSync(t, () => ({ status: 0, stdout: '', stderr: '' }));
  assert.throws(() => runSshStrict('k40-ubuntu', 'df -P /mnt/ssd/bio_data | tail -1'), /无输出/);
});

test('runSshStrict：只有噪声行时视同无输出（滤完是空串）', (t) => {
  withSpawnSync(t, () => ({
    status: 0,
    stdout: '',
    stderr: "Warning: Permanently added '[127.0.0.1]:10022' (ED25519) to the list of known hosts.\n",
  }));
  assert.throws(() => runSshStrict('k40-ubuntu', 'true'), /无输出/);
});

test('runSshStrict：正常输出原样返回（含换行的多行结果不裁掉内容）', (t) => {
  withSpawnSync(t, () => ({ status: 0, stdout: 'LINE|line1_bulk|0\nLINE|line2_scrna|0\nEND|\n', stderr: '' }));
  const text = runSshStrict('k40-ubuntu', 'check_storage_and_isolation.sh');
  assert.equal(text, 'LINE|line1_bulk|0\nLINE|line2_scrna|0\nEND|');
});

// ---------- 4. index.js 接线（静态断言） ----------

test('index.js：第 1~4 维都走 runRemoteStrict，不许再退回宽松版', () => {
  const strictCalls = STRICT_GUARD_SRC.match(/runRemoteStrict\(/g) ?? [];
  // 4 处调用 + 1 处函数定义
  assert.ok(strictCalls.length >= 5, `runRemoteStrict 出现次数过少：${strictCalls.length}`);
  assert.match(STRICT_GUARD_SRC, /runRemoteStrict\('df -T \/mnt\/ssd\/bio_data/);
  assert.match(STRICT_GUARD_SRC, /runRemoteStrict\('df -P \/mnt\/ssd\/bio_data/);
  assert.match(STRICT_GUARD_SRC, /runRemoteStrict\(buildHardwareCommand\(\)\)/);
  assert.match(STRICT_GUARD_SRC, /runRemoteStrict\(buildIsolationCommand\(\)\)/);
  // 反例：自检里不许再出现宽松调用
  assert.doesNotMatch(STRICT_GUARD_SRC, /runRemote\(buildIsolationCommand\(\)\)/);
  assert.doesNotMatch(STRICT_GUARD_SRC, /runRemote\('df -T/);
});

test('index.js：第 4 维把隔离灯与 SHA256 灯合并成一条 checks', () => {
  assert.match(STRICT_GUARD_SRC, /import \{[^}]*runSha256ParityCheck[^}]*\} from '\.\.?\/selfcheck\.js'/s);
  assert.match(STRICT_GUARD_SRC, /import \{[^}]*mergeIsolationChecks[^}]*\} from '\.\.?\/selfcheck\.js'/s);
  assert.match(STRICT_GUARD_SRC, /const merged = mergeIsolationChecks\(isolation, runSha256ParityCheck\(\)\)/);
  assert.match(STRICT_GUARD_SRC, /checks\.push\(\{/);
});

test('P17：index.js 把合并灯的结构化子灯下发给前端（sub_checks）', () => {
  assert.match(STRICT_GUARD_SRC, /sub_checks:/, '第 4 维要下发 sub_checks');
  assert.match(STRICT_GUARD_SRC, /merged\.subChecks/, '要遍历 mergeIsolationChecks 返回的 subChecks');
  for (const sub of ['id', 'label', 'status', 'value', 'detail']) {
    assert.match(STRICT_GUARD_SRC, new RegExp(sub + ':'), '子灯字段要齐全：' + sub);
  }
});

test('P17：App.tsx 渲染 sub_checks 子灯', () => {
  function readViewTsx(dir) {
    return fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return readViewTsx(fullPath);
        // 扫描面只许放宽：子灯类型定义在 views/shared/types.ts，只看 .tsx 会让
        // 「前端要有子灯类型」退化成「App.tsx 必须保留一条未被使用的 type import」。
        return entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))
          ? [fs.readFileSync(fullPath, 'utf8')]
          : [];
      });
  }
  const appSrc = [
    fs.readFileSync(path.join(REPO_ROOT, 'BioanalysDesktop', 'src', 'App.tsx'), 'utf8'),
    ...readViewTsx(path.join(REPO_ROOT, 'BioanalysDesktop', 'src', 'views')),
  ].join('\n');
  assert.match(appSrc, /sub_checks/, '前端要读 sub_checks');
  assert.match(appSrc, /selfcheck-subs/, '前端要渲染子灯容器');
  assert.match(appSrc, /SelfCheckSubItem/, '前端要有子灯类型');
  const css = fs.readFileSync(path.join(REPO_ROOT, 'BioanalysDesktop', 'src', 'app.css'), 'utf8');
  assert.match(css, /\.selfcheck-subs/, 'CSS 要有子灯容器');
  assert.match(css, /\.selfcheck-sub-dot\.selfcheck-dot-pass/, 'CSS 要有子灯四档颜色');
});

test('index.js：五维结构没被改动（fs_type / storage / memory / isolation / link 各一条）', () => {
  for (const id of ['fs_type', 'storage', 'memory', 'isolation', 'link']) {
    assert.match(STRICT_GUARD_SRC, new RegExp(`id: '${id}'`), `缺少第 ${id} 维`);
  }
  assert.match(STRICT_GUARD_SRC, /const allPass = checks\.every\(\(c\) => c\.status === 'pass'\)/);
});
