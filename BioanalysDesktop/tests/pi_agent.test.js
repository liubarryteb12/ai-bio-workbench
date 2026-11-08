import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  ALLOWED_MODELS,
  DEFAULT_MODEL,
  buildA2ARpcPayload,
  buildCurrentModelCommand,
  buildSendMessageParams,
  buildSwitchModelCommand,
  parseCurrentModel,
} from '../server/pi_agent.js';

function decodeEnvelope(command) {
  const match = String(command).match(/^echo ([A-Za-z0-9+/=]+) \| base64 -d \| bash$/);
  assert.ok(match, `unexpected ssh envelope: ${command}`);
  return Buffer.from(match[1], 'base64').toString('utf8');
}

test('当前模型探针只输出两行 pin 值，不把 cat 命令拼进输出', () => {
  const script = decodeEnvelope(buildCurrentModelCommand());
  assert.match(script, /cat .*\.provider_name/);
  assert.match(script, /cat .*\.provider_model/);
  assert.doesNotMatch(script, /echo cat /);
  assert.deepEqual(
    parseCurrentModel('zai\nglm-5.3-flash\n'),
    { provider: 'zai', model: 'glm-5.3-flash' }
  );
});

test('默认模型固定为 zai/glm-5.3-flash', () => {
  assert.deepEqual(DEFAULT_MODEL, {
    provider: 'zai',
    model: 'glm-5.3-flash',
  });
});

test('settings 种子脚本拒绝旧默认值复活', () => {
  const script = fs.readFileSync(
    path.join(import.meta.dirname, '..', '..', 'tools', 'ops', 'pi_seed_settings.sh'),
    'utf8'
  );
  assert.doesNotMatch(script, /if not config\.get\("defaultProvider"\):/);
  assert.doesNotMatch(script, /if not config\.get\("defaultModel"\):/);
  assert.match(script, /EXPECTED_DEFAULT_PROVIDER/);
  assert.match(script, /EXPECTED_DEFAULT_MODEL/);
  assert.match(script, /ERR_UNEXPECTED_DEFAULT_MODEL/);
});

test('SendMessage 请求体按 D-06 携带 returnImmediately 开关', () => {
  const params = buildSendMessageParams('run long task', true);
  assert.deepEqual(params.configuration, { returnImmediately: true });
  assert.equal(params.message.parts[0].text, 'run long task');
  const payload = buildA2ARpcPayload('GetTask', { id: 'task-1' });
  assert.equal(payload.method, 'GetTask');
  assert.deepEqual(payload.params, { id: 'task-1' });
});

test('模型白名单以 GLM 为默认项，并保留 deepseek 受控组合', () => {
  assert.deepEqual(ALLOWED_MODELS, [
    { provider: 'zai', model: 'glm-5.3-flash' },
    { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
  ]);
});

test('模型切换原子更新 settings.json 与 pin 文件并重启 pi-a2a daemon', () => {
  const script = decodeEnvelope(buildSwitchModelCommand('zai', 'glm-5.3-flash'));
  assert.match(script, /\.provider_keys\/zai/);
  assert.match(script, /settings\.json/);
  assert.match(script, /defaultProvider/);
  assert.match(script, /defaultModel/);
  assert.match(script, /os\.replace/);
  assert.match(script, /\.provider_name/);
  assert.match(script, /\.provider_model/);
  assert.match(script, /pi_a2a_launch\.sh/);
  assert.match(script, /LAUNCHER_MODEL="\$PIN_MODEL"/);
  assert.match(script, /SWITCH_OK/);
});

test('显式请求 GLM 时启动器模型与默认配置逐字对齐', () => {
  const script = decodeEnvelope(buildSwitchModelCommand('zai', 'glm-5.3-flash'));
  assert.match(script, /LAUNCHER_MODEL="\$PIN_MODEL"/);
  assert.match(script, /pi_a2a_launch\.sh' '\$LAUNCHER_MODEL'/);
  assert.match(script, /export PI_PROVIDER_ENV=ZAI_API_KEY/);
  assert.match(script, /export ZAI_API_KEY="\$\(cat "\$key_file"\)"/);
  assert.match(script, /tmux kill-session -t pi-a2a/);
  assert.match(script, /tmux new-session -d -s pi-a2a/);
});

test('切换脚本从配置与 pin 同源推导实际 CLI 模型', () => {
  const script = decodeEnvelope(buildSwitchModelCommand('deepseek', 'deepseek-v4.1-flash'));
  assert.match(script, /LAUNCHER_MODEL=/);
  assert.match(script, /PIN_PROVIDER=/);
  assert.match(script, /PIN_MODEL=/);
  assert.match(script, /case "\$PIN_PROVIDER\/\$PIN_MODEL" in/);
  assert.match(script, /export PI_PROVIDER_ENV=DEEPSEEK_API_KEY/);
  assert.match(script, /export DEEPSEEK_API_KEY="\$\(cat "\$key_file"\)"/);
  assert.match(script, /ERR_LAUNCH_MODEL_MISMATCH/);
  assert.doesNotMatch(script, /pi_a2a_daemon\.sh/);
});

test('DeepSeek 切换只读取 provider 分目录 Key，不回退 GLM legacy Key', () => {
  const script = decodeEnvelope(buildSwitchModelCommand('deepseek', 'deepseek-v4.1-flash'));
  assert.match(script, /key_file=".*\.provider_keys\/deepseek"/);
  assert.doesNotMatch(script, /legacyKeyPath|\.provider_key"/);
});

test('未知模型在构造与执行任何远程命令前即拒绝', () => {
  assert.throws(() => buildSwitchModelCommand('zai', 'deepseek-v4.1-flash'), /ERR_MODEL_NOT_ALLOWED/);
  assert.throws(() => buildSwitchModelCommand('deepseek', 'glm-5.3-flash'), /ERR_MODEL_NOT_ALLOWED/);
  assert.throws(() => buildSwitchModelCommand('openai', 'gpt-4.1'), /ERR_MODEL_NOT_ALLOWED/);
});

test('非白名单模型组合在构造命令前即拒绝', () => {
  assert.throws(
    () => buildSwitchModelCommand('openai', 'gpt-4.1'),
    /ERR_MODEL_NOT_ALLOWED/
  );
});
