import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEnvironmentManifest, readEnvironmentManifest } from '../server/manifest.js';
import { LINES } from '../server/domain.js';

test('parse 解析 key=value，跳过注释与空行', () => {
  const text = [
    '# 注释行',
    '',
    'language=R',
    'version=4.3.3',
    'env_name=line1_bulk_env',
    'container_image=proot-ubuntu24.04-aarch64',
  ].join('\n');
  const parsed = parseEnvironmentManifest(text);
  assert.equal(parsed.language, 'R');
  assert.equal(parsed.version, '4.3.3');
  assert.equal(parsed.env_name, 'line1_bulk_env');
  assert.equal(parsed.container_image, 'proot-ubuntu24.04-aarch64');
});

test('parse 容忍值里的等号与首尾空白', () => {
  const parsed = parseEnvironmentManifest('language=R\nnote=a=b\nspaced = value \n');
  assert.equal(parsed.note, 'a=b');
  assert.equal(parsed.spaced, 'value');
});

test('parse 忽略没有等号的坏行，不抛异常', () => {
  const parsed = parseEnvironmentManifest('language=R\n坏行没有等号\nversion=4.3.3\n');
  assert.equal(parsed.language, 'R');
  assert.equal(parsed.version, '4.3.3');
});

// 回归 2026-10-13 缺口 B：台账 environment 曾硬编码（language=R/version=4.3.3/env_name=<line>_env），
// 环境声明应在 src/<line>/envs/manifest.txt，分析中途不更换，台账从这里读。
test('readEnvironmentManifest 读本地正本，返回台账 environment 需要的四个字段', () => {
  for (const line of LINES) {
    const env = readEnvironmentManifest(line);
    assert.ok(env, `${line} 的 envs/manifest.txt 缺失或必填字段不全`);
    assert.ok(env.language && env.version, `${line} 缺 language/version`);
    assert.ok(env.env_name, `${line} 缺 env_name`);
    assert.ok(env.container_image, `${line} 缺 container_image`);
    // 隔离红线：本线 manifest 不得出现其他两条线的字面量
    for (const other of LINES.filter((candidate) => candidate !== line)) {
      assert.ok(!JSON.stringify(env).includes(other), `${line} 的 manifest 掺进了 ${other}`);
    }
  }
});

test('line1_bulk 环境声明版本为 4.5.3', () => {
  const env = readEnvironmentManifest('line1_bulk');
  assert.ok(env, 'line1_bulk 的 envs/manifest.txt 缺失或必填字段不全');
  assert.equal(env.version, '4.5.3');
});

test('manifest 缺失时返回 null 而不是抛（exit handler 里抛错会杀进程）', () => {
  assert.equal(readEnvironmentManifest('line9_not_exist'), null);
});
