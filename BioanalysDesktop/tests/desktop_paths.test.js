/**
 * 桌面路径真源：资产根 / 数据根分离。
 *
 * 判据只锚定行为：
 * 1. 未设置 BIO_DATA_HOME 时，所有数据路径与历史仓库根口径一致；
 * 2. 设置 BIO_DATA_HOME 后，写路径全部落到数据根，只读资产仍从资产根取；
 * 3. 示例路径解析优先数据根、其次资产根，并拒绝路径穿越。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TEST_TMP } from './support/test_tmp.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server');
const REPO_ROOT = path.resolve(HERE, '..', '..');

async function withEnv(patch, fn) {
  const saved = {};
  for (const key of Object.keys(patch)) {
    saved[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('未设置数据根时沿用仓库根，行为与改造前一致', async () => {
  await withEnv({ BIO_ASSET_ROOT: undefined, BIO_DATA_HOME: undefined }, async () => {
    const m = await import(`../server/paths.js?case=legacy-${Date.now()}`);
    assert.equal(m.DATA_HOME, null);
    assert.equal(m.DATA_ROOT, m.ASSET_ROOT);
    assert.equal(m.IS_PACKAGED_RUNTIME, false);
    assert.equal(m.dataPath('workspace', 'projects'), path.join(m.ASSET_ROOT, 'workspace', 'projects'));
    assert.equal(m.assetPath('tools', 'bio'), path.join(m.ASSET_ROOT, 'tools', 'bio'));
  });
});

test('设置数据根后写路径落数据根，只读资产仍走资产根', async () => {
  const dataHome = fs.mkdtempSync(path.join(TEST_TMP, 'bio-data-home-'));
  await withEnv({ BIO_ASSET_ROOT: REPO_ROOT, BIO_DATA_HOME: dataHome }, async () => {
    const m = await import(`../server/paths.js?case=split-${Date.now()}`);
    assert.equal(m.DATA_HOME, path.resolve(dataHome));
    assert.equal(m.DATA_ROOT, path.resolve(dataHome));
    assert.equal(m.IS_PACKAGED_RUNTIME, true);
    assert.equal(m.dataPath('workspace', 'projects'), path.join(path.resolve(dataHome), 'workspace', 'projects'));
    assert.equal(m.assetPath('tools', 'bio'), path.join(REPO_ROOT, 'tools', 'bio'));
  });
});

test('示例路径优先数据根，其次资产根，并拒绝穿越', async () => {
  const dataHome = fs.mkdtempSync(path.join(TEST_TMP, 'bio-example-home-'));
  const assetHome = fs.mkdtempSync(path.join(TEST_TMP, 'bio-example-asset-'));
  fs.mkdirSync(path.join(dataHome, 'workspace', 'projects'), { recursive: true });
  fs.writeFileSync(path.join(dataHome, 'workspace', 'projects', 'from-data.txt'), 'data');
  fs.mkdirSync(path.join(assetHome, 'workspace', 'projects'), { recursive: true });
  fs.writeFileSync(path.join(assetHome, 'workspace', 'projects', 'from-asset.txt'), 'asset');

  await withEnv({ BIO_ASSET_ROOT: assetHome, BIO_DATA_HOME: dataHome }, async () => {
    const m = await import(`../server/paths.js?case=resolve-${Date.now()}`);
    assert.equal(m.resolveDataOrAsset('workspace/projects/from-data.txt'), path.join(dataHome, 'workspace', 'projects', 'from-data.txt'));
    assert.equal(m.resolveDataOrAsset('workspace/projects/from-asset.txt'), path.join(assetHome, 'workspace', 'projects', 'from-asset.txt'));
    assert.equal(m.resolveDataOrAsset('../escape.txt'), null);
    assert.equal(m.resolveDataOrAsset('C:\\Windows\\system.ini'), null);
  });
});

test('服务端模块在数据根下创建收件箱与本地项目根', () => {
  const dataHome = fs.mkdtempSync(path.join(TEST_TMP, 'bio-module-home-'));
  const script = `
    const portal = await import(${JSON.stringify(pathToFileURL(path.join(SERVER, 'portal_inbox.js')).href)});
    const pull = await import(${JSON.stringify(pathToFileURL(path.join(SERVER, 'pull.js')).href)});
    const authority = await import(${JSON.stringify(pathToFileURL(path.join(SERVER, 'services', 'authority.service.js')).href)});
    process.stdout.write(JSON.stringify({
      inbox: portal.PORTAL_INBOX,
      outputs: pull.LOCAL_OUTPUTS_ROOT,
      authority: authority.defaultAuthorityFile(),
    }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.join(HERE, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      BIO_ASSET_ROOT: REPO_ROOT,
      BIO_DATA_HOME: dataHome,
    },
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.inbox.startsWith(path.resolve(dataHome)), payload.inbox);
  assert.ok(payload.outputs.startsWith(path.resolve(dataHome)), payload.outputs);
  assert.ok(payload.authority.startsWith(path.resolve(dataHome)), payload.authority);
  assert.ok(fs.existsSync(payload.inbox), '收件箱目录应在模块加载时创建');
});
