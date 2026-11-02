import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SCRIPT = path.join(REPO, 'ops', 'delivery_acceptance.ps1');

// ── 交付验收脚本的静态契约（2026-11-02，4 Argon 第十六轮 Priority 1）──
//
// 客户买到的是 tar 包（报告 + 图 + 表 + .sig），不是仓库里的中间产物。
// 这条断言钉住「验收必须覆盖的四道关」，防止后来人把某一道偷偷删掉：
//   1. tar 本体 SHA256 与侧车一致
//   2. 解包成功且交付根目录存在三件套
//   3. 清单哈希 + Ed25519 验签返回 VERIFIED
//   4. 清单计数与磁盘实际文件数核对

test('delivery acceptance script exists and covers all four gates', () => {
  assert.ok(fs.existsSync(SCRIPT), 'ops/delivery_acceptance.ps1 缺失');
  const text = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(text.includes('tar_sha256_sidecar.txt'), '关 1 缺失：未校验 tar 侧车哈希');
  assert.ok(text.includes('CHECKSUMS.sig'), '关 2 缺失：未校验签名文件存在');
  assert.ok(text.includes('verify_delivery_signature.mjs'), '关 3 缺失：未调用验签核');
  assert.ok(text.includes('VERIFIED'), '关 3 判据缺失：未断言 VERIFIED 输出');
  assert.ok(text.includes('delivery_manifest.json'), '关 4 缺失：未读交付清单');
  // 关 4 必须是集合双向差集，不能退化成总数相减（后者放行磁盘夹带的幽灵文件）
  assert.ok(text.includes('ghosts'), '关 4 缺失：未做幽灵文件（磁盘多出未登记文件）检测');
  assert.ok(text.includes('missingFiles'), '关 4 缺失：未做清单漂移（清单有、磁盘无）检测');
  assert.ok(text.includes('$metaFiles'), '关 4 缺失：未定义签名元数据白名单');
  assert.ok(text.includes('$sectionDir'), '关 4 缺失：未按小节拼装磁盘相对路径（清单路径不带目录前缀）');
  assert.ok(text.includes('$allowedUnlistedFiles'), '关 4 缺失：未把打包器写的说明文件纳入白名单');
  assert.ok(text.includes('.sha256'), '关 1 缺失：未兼容 <name>.tar.gz.sha256 这种侧车命名');
  assert.ok(text.includes('CHECKSUMS'), '关 4 缺失：未校验 CHECKSUMS 覆盖完备性');
  assert.ok(text.includes('$protected'), '关 4 缺失：未收集被哈希保护的文件集合');
  assert.ok(text.includes("TrimStart('*')") || text.includes("Trim"), '关 4 缺失：未规范化 sha256sum 输出的路径前缀');
  assert.ok(text.includes('DELIVERY_ACCEPTANCE_OK'), '缺成功哨兵，无法从日志判定全绿');
  assert.ok(text.includes('ACCEPTANCE_FAILED'), '缺失败哨兵，失败时无法区分「没跑」与「跑挂了」');
});

test('delivery acceptance script declares a public key parameter with a repo default', () => {
  const text = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(text.includes('$PublicKeyPath'), '未把公钥路径参数化');
  assert.match(text, /ops[/\\]secrets[/\\]ed25519_public\.pem/, '默认公钥路径未指向 ops/secrets');
});

test('the reference drill package still carries its sidecar and signature', () => {
  const drill = path.join(REPO, 'con_hf', 'runs', '2026-10-31_phase3_delivery_drill');
  if (!fs.existsSync(drill)) return; // 演练目录是运行产物，缺失时该测试不主张
  for (const need of ['tar_sha256_sidecar.txt', 'CHECKSUMS.sha256', 'CHECKSUMS.sig', 'delivery_manifest.json']) {
    assert.ok(fs.existsSync(path.join(drill, need)), '演练包缺 ' + need);
  }
});
