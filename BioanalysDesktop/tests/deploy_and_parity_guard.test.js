import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 2026-10-21 加固：部署通道与「仓库 -> 引擎实际执行落点」一致性校验的静态守卫。
// 背景见 con_hf/pitfalls_ledger.md P-20 / P-21 与 con_hf/SPEC_DECISIONS.md D-17 / D-18。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const deployPath = path.join(repoRoot, 'ops', '06_deploy_scripts.ps1');
const syncPath = path.join(repoRoot, 'ops', 'sync_and_verify_remote.ps1');

const deployText = fs.readFileSync(deployPath, 'utf8');
const syncText = fs.readFileSync(syncPath, 'utf8');
const deployBytes = fs.readFileSync(deployPath);
const syncBytes = fs.readFileSync(syncPath);

test('06_deploy_scripts.ps1 是 UTF-8 with BOM（中文 .ps1 硬性规范）', () => {
  assert.equal(deployBytes[0], 0xef);
  assert.equal(deployBytes[1], 0xbb);
  assert.equal(deployBytes[2], 0xbf);
});

test('06_deploy_scripts.ps1 校验阶段必须是单次 ssh 批量（禁止逐文件 ssh stat）', () => {
  assert.ok(deployText.includes('while IFS= read -r p'), '缺少批量读取循环');
  assert.ok(deployText.includes('stat -c %s \"$p\"'), '缺少远端 stat 批量调用');
  assert.ok(deployText.includes('printf \"MISSING|%s'), '缺少 MISSING 标记输出');
  assert.ok(deployText.includes('FILE|%s|%s|%s'), '缺少 FILE|size|exec 行协议');
  assert.ok(!deployText.includes("stat -c '%s' '$($item.Remote)'"), '仍残留逐文件 ssh stat（P-20 假红灯根因）');
});

test('06_deploy_scripts.ps1 链路失败与文件缺失必须分开判定', () => {
  assert.ok(deployText.includes('校验链路失败（ssh 连续两次非 0，不是文件缺失）'), '缺少链路失败专属文案');
  assert.ok(deployText.includes('$attempt -le 2'), '缺少 ssh 重试');
  assert.ok(deployText.includes('NO_RESULT'), '缺少「远端没回结果」这一档');
});

test('06_deploy_scripts.ps1 可执行位一次批量置位（不再逐文件 chmod）', () => {
  assert.ok(deployText.includes('批量 chmod 755'), '缺少批量 chmod');
  assert.ok(deployText.includes('CHMOD_OK'), '缺少 chmod 成功标记');
  assert.ok(deployText.includes('NOT_EXECUTABLE'), '缺少可执行位复核');
});

test('sync_and_verify_remote.ps1 含第 6 步部署一致性（仓库 vs bin/ 执行落点）', () => {
  assert.ok(syncText.includes('第 6 步'), '缺少第 6 步');
  assert.ok(syncText.includes('$deployPairs'), '缺少部署配对集合');
  assert.ok(syncText.includes("'/bin/' + $Matches[1]"), '缺少 bin 落点拼接');
  assert.ok(syncText.includes('部署一致性'), '缺少一致性输出');
  assert.ok(syncText.includes('部署漂移'), '缺少漂移告警');
});

test('sync 第 6 步：xargs 必须 || true，否则 123 退出码会让解析整段跳过', () => {
  const binCmdLine = syncText.split('\n').find((l) => l.includes('$binCmd ='));
  assert.ok(binCmdLine, '缺少 $binCmd');
  assert.ok(binCmdLine.includes('|| true'), 'xargs 缺少 || true（P-21：任一文件缺失即退 123）');
});

test('sync 第 6 步：README.md 等文档不算部署漂移', () => {
  assert.ok(syncText.includes("$rel -notlike '*.md'"), '缺少 .md 排除');
});

test('sync 第 6 步：-FailOnDrift 时部署漂移必须 exit 1', () => {
  assert.ok(syncText.includes('-FailOnDrift：检测到部署漂移'), '缺少 FailOnDrift 分支');
});

test('sync manifest 与台账都要带部署一致性结论', () => {
  assert.ok(syncText.includes('deploy = $deployNote'), 'manifest 缺少 deploy 字段');
  assert.ok(syncText.includes("' | 部署: ' + $deployNote"), '台账行缺少部署列');
});

test('sync_and_verify_remote.ps1 保持 LF-only（gitattributes 钉 eol=lf）', () => {
  for (let i = 0; i < syncBytes.length - 1; i += 1) {
    assert.ok(!(syncBytes[i] === 13 && syncBytes[i + 1] === 10), `第 ${i} 字节处出现 CRLF`);
  }
});
