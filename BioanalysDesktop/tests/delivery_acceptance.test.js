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

// ── 第二十轮 Q1：四关判据真源移进 ops/delivery_acceptance_core.mjs ──
//
// ps1 退化为人用的一行包装。理由：打包链路的内联后置条件（server/report.js）不可能
// 起 pwsh 子进程（进程单接缝门禁），四关必须有一份纯 Node 真源；若 ps1 继续自带
// 一套判据，两条路会漂移，服务端绿/手敲红无法自证。下面这组断言把「真源在内联处」
// 与「包装只做委托」钉死。
const CORE = path.join(REPO, 'ops', 'delivery_acceptance_core.mjs');

test('acceptance core exists and pins all four gates (single source of truth)', () => {
  assert.ok(fs.existsSync(CORE), 'ops/delivery_acceptance_core.mjs 缺失');
  const text = fs.readFileSync(CORE, 'utf8');
  // 关 1：侧车命名两套都要认（演练包 legacy + 打包器 .sha256）
  assert.ok(text.includes('tar_sha256_sidecar.txt'), '关 1 缺失：未校验 legacy 侧车命名');
  assert.ok(text.includes("'.sha256'"), '关 1 缺失：未兼容 <name>.tar.gz.sha256 命名');
  // 关 2：三件套齐检
  for (const need of ['CHECKSUMS.sha256', 'CHECKSUMS.sig', 'delivery_manifest.json']) {
    assert.ok(text.includes(need), '关 2 缺失：未校验 ' + need);
  }
  // 关 3：验签口径复用 ed25519_tools 的 verifyDelivery（不许有第二份验签实现）
  assert.ok(text.includes("import { verifyDelivery } from './ed25519_tools.mjs'"),
    '关 3 缺失：验签必须复用 ops/ed25519_tools.mjs 的 verifyDelivery');
  assert.ok(text.includes('VERIFIED'), '关 3 判据缺失：未断言 VERIFIED');
  // 关 4：集合双向差集 + 覆盖完备 + counts（判据关键词全部在核内）
  for (const kw of ['ghosts', 'missingFiles', 'uncovered', 'phantom', 'coverageMeta', 'metaFiles']) {
    assert.ok(text.includes(kw), '关 4 缺失判据关键词: ' + kw);
  }
  assert.ok(text.includes('allowedUnlistedPrefixes') && text.includes('allowedUnlistedFiles'),
    '关 4 白名单缺失：解读报告前缀与 README/_report.txt 必须显式放行');
  // 哨兵
  assert.ok(text.includes('DELIVERY_ACCEPTANCE_OK'), '缺成功哨兵');
  assert.ok(text.includes('ACCEPTANCE_FAILED'), '缺失败哨兵');
  // zip-slip：解包前拒绝 .. / 绝对路径 / 盘符，且必须在写盘之前
  assert.ok(text.includes('unsafe_tar_path'), '缺 zip-slip 防护');
  assert.ok(text.includes('startsWith(\'..\')') || text.includes("includes('..')"),
    'zip-slip 判据缺失：条目名含 .. 必须拒');
  // PAX 扩展头：GNU tar 长路径机制必须消费，否则演练包实测当场 bad_octal_field
  assert.ok(/typeflag === 'x'/.test(text), '缺 PAX 扩展头消费（type x）');
  // 验收红的短路顺序：关 1 红不许跑关 2-4，否则篡改包的报错会被下游噪声淹没
  assert.ok(text.includes('if (!g1.ok) return summarize'), '缺关 1 短路');
  assert.ok(text.includes('if (!g2.ok'), '缺关 2 短路');
  assert.ok(text.includes('if (!g3.ok) return summarize'), '缺关 3 短路');
});

test('receipt is written only on full green, never into SYSTEM_LEDGER', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  // Argon 指定落点：ops/delivery_acceptance/records/<project_id>.receipt.json
  assert.ok(text.includes("path.join('ops', 'delivery_acceptance', 'records')") || text.includes('RECEIPT_SUBDIR'),
    '回执落点必须是 ops/delivery_acceptance/records');
  // 注释里讲「严禁混入 SYSTEM_LEDGER」是正当文档；行为上必须真没写：
  assert.ok(!/writeFileSync\([^)]*SYSTEM_LEDGER/s.test(text),
    '核心不得写 SYSTEM_LEDGER（架构模具台账 vs 业务运行时产物）');
  assert.ok(!/RECEIPT_SUBDIR[^\n]*generated/.test(text.replace(/\/\/.*$/gm, '')),
    '回执落点不得指向 docs/generated 机器覆写区');
  // 红时拒写：writeReceipt 内部再检查一次 verdict.ok（双保险）
  assert.ok(text.includes("if (!verdict.ok) throw new Error('验收未通过，禁止写回执"),
    'writeReceipt 必须拒绝未通过的验收');
  // 回执字段齐全（Argon 点名 schema）
  for (const field of ['project_id', 'tar_sha256', 'verified_count', 'coverage_ok', 'verified_at', 'verifier_version']) {
    assert.ok(text.includes(field), '回执缺字段: ' + field);
  }
  // 放行判据 = 回执存在 && tar_sha256 == 实时哈希
  assert.ok(text.includes('ERR_DELIVERY_UNVERIFIED'), '缺 409 错误码字面量');
  assert.ok(text.includes('actual !== receipt.tar_sha256'), '放行判据缺失：未比对实时哈希');
});

test('ps1 wrapper delegates to the core instead of keeping its own gate logic', () => {
  const text = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(text.includes('delivery_acceptance_core.mjs'), '包装必须调用核心真源');
  // 反证锚点：判据实体不许留在 ps1 里（漂移就是这么发生的）
  for (const leftover of ['ghosts', 'missingFiles', 'Get-FileHash', 'verify_delivery_signature']) {
    assert.ok(!text.includes(leftover), 'ps1 不得自带判据（应只在核心）: ' + leftover);
  }
  // 哨兵仍由这条人用路径打印（核心打印，包装透传退出码）
  assert.ok(text.includes('$LASTEXITCODE'), '包装必须透传核心退出码');
  assert.ok(text.includes('*Client_Delivery.tar.gz'), '包装负责找 tar');
});

test('packaging tail runs the inline acceptance postcondition (Q1 ruling)', () => {
  const routes = fs.readFileSync(path.join(REPO, 'BioanalysDesktop', 'server', 'routes', 'report.routes.js'), 'utf8');
  const report = fs.readFileSync(path.join(REPO, 'BioanalysDesktop', 'server', 'report.js'), 'utf8');
  // 调用点锚串（不能用裸函数名：import 行在文件顶部会污染 indexOf）
  const at = (s, sub) => s.indexOf(sub);
  const build = at(routes, 'await runReportBuild(projectId)');
  const pull = at(routes, 'await pullDeliverables(projectId)');
  const side = at(routes, 'const sidecars = writeSha256Sidecars');
  const acc = at(routes, 'const acceptance = runInlineAcceptance(projectId)');
  assert.ok([build, pull, side, acc].every((x) => x > 0), 'build 路由四步必须齐');
  assert.ok(build < pull && pull < side && side < acc,
    '后置条件顺序必须是 build → pull → sidecars → acceptance');
  assert.ok(routes.includes("json(res, 500") && /acceptance\.ok/.test(routes),
    '验收红必须 500 且不发回执，不许继续返回 200');
  // 下载门禁：放行前先过回执校验
  assert.ok(routes.includes('deliveryGateStatus(projectId)'), 'download 路由必须查回执门禁');
  assert.ok(routes.includes('json(res, 409'), 'download 无回执必须 409');
  // 公钥缺失 fail-closed：核心第 3 关没有兜底信任
  assert.ok(report.includes('trustedPublicKeyPath'), '服务端公钥口径必须复用 trustedPublicKeyPath');
});

test('wrapper is UTF-8 with BOM so Windows PowerShell 5.1 parses it', () => {
  // 第 21 轮实测：无 BOM 的 UTF-8 ps1 在 PS5.1 下按 ANSI 代码页解码，中文注释
  // 尾字节吃掉紧邻引号，node 收到残缺 argv（bad option: --project-id）。
  // 本机没有 pwsh 7，这条包装必须同时喂得进 5.1；带 BOM 是唯一稳的写法。
  const bytes = fs.readFileSync(SCRIPT);
  assert.equal(bytes[0], 0xEF, 'ps1 必须以 UTF-8 BOM 开头（EF）');
  assert.equal(bytes[1], 0xBB, 'ps1 必须以 UTF-8 BOM 开头（BB）');
  assert.equal(bytes[2], 0xBF, 'ps1 必须以 UTF-8 BOM 开头（BF）');
});

test('wrapper still declares the public key parameter with the repo default', () => {
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

// ── 包根 README 契约（2026-11-03，4 Argon 第十八轮第 3 节：双层正交不合并）──
//
// 交付包里有 manifest 与 CHECKSUMS 两套登记，客户第一反应是「以哪套为准」。
// README 必须在 CHECKSUMS 之前落盘（否则自身不受签名保护），且必须写清分工。
// 这两条断言钉住顺序与关键句，防止将来有人把 README 挪到签名之后或删掉分工说明。

test('packaged README explains the two registries and is itself signed', () => {
  const delivery = path.join(REPO, 'local_projects', 'PRJ_AIMS_V3_20261027',
    'deliverables', 'PRJ_AIMS_V3_20261027_Client_Delivery');
  const readme = path.join(delivery, 'README.md');
  if (!fs.existsSync(readme)) return; // 交付目录是运行产物，缺失时不主张
  const text = fs.readFileSync(readme, 'utf8');
  // 文案在 Markdown 里带反引号与加粗（**`delivery_manifest.json` 管业务分类索引**），
  // 用正则跨过反引号会脆；这里按「关键字都在」断言，既能钉住职责又不怕排版微调。
  assert.ok(text.includes('delivery_manifest.json') && text.includes('管业务分类索引'),
    '必须写明 manifest 职责（业务分类索引）');
  assert.ok(text.includes('完整性以 CHECKSUMS 为准'), '必须写明完整性归属');
  assert.match(text, /sha256sum -c CHECKSUMS\.sha256/, '必须给出系统自带命令的自验方式');
  const cks = fs.readFileSync(path.join(delivery, 'CHECKSUMS.sha256'), 'utf8');
  assert.ok(cks.split(/\r?\n/).some((l) => l.trim().split(/\s+/).pop() === 'README.md'),
    'README.md 必须进 CHECKSUMS，否则不受签名保护');
});

// ── -SkipExtract 契约（2026-11-03，4 Argon 第十八轮第 1 节）──
//
// 脚本默认每次先 Remove-Item 再 tar -xzf，所以「篡改包内文件」这个动作会被
// 重新解包覆盖掉，验出来是假绿。实测证据：把 01_Adapted_Code/_report.txt
// 追加一行后，不带开关跑仍是 DELIVERY_ACCEPTANCE_OK（重新解包把篡改洗掉了）。
// -SkipExtract 复用既有 unpacked，才能让篡改走到第 3 关：
//   带开关 -> VERIFICATION_FAILED hash_mismatch:01_Adapted_Code/_report.txt，exit 1。
// 这条断言钉住「重解包只发生在 else 分支」，并钉住复用模式下目录缺失必须判红。

// ── -SkipExtract 契约（原第十八轮；现判据在核心，包装透传开关） ──
test('acceptance can reuse an existing unpack without re-extracting', () => {
  const core = fs.readFileSync(CORE, 'utf8');
  const wrapper = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(wrapper.includes('[switch]$SkipExtract'), '包装未提供 -SkipExtract');
  assert.ok(wrapper.includes('--skip-extract'), '包装未把开关透传给核心');
  assert.ok(core.includes('if (skipExtract) {'), '核心缺复用分支');
  // 结构性断言：重新解包（rm + extractTarGz）只许在 else 分支——顺序比较抓不到
  // 「两个分支都重解包」的写法，必须钉花括号归属（第十八轮的原坑原钉）。
  assert.match(core, /if \(skipExtract\) \{[\s\S]*?\} else \{[\s\S]*?extractTarGz\(/,
    '重解包必须只在 else 分支发生，否则 -SkipExtract 失效');
  // 复用模式下 unpacked 缺失直接判红，绝不默默重建一份干净解包顶替
  assert.ok(core.includes('-SkipExtract 要求 unpacked 目录已存在'),
    '复用模式下 unpacked 缺失必须判红');
});

// ── 功能级反证：直接在真演练包上跑四关 + 篡改探针（第十八轮的 -SkipExtract 演练，
//    现在同一份核心同时被内联与手敲复用，演练一次两侧都算数）。演练目录不在时跳过。
const DRILL = path.join(REPO, 'con_hf', 'runs', '2026-10-31_phase3_delivery_drill');
test('drill package passes all four gates, tamper probes each turn a dedicated gate red', async () => {
  const tar = path.join(DRILL, 'Client_Delivery.tar.gz');
  if (!fs.existsSync(tar)) return; // 演练包是运行产物，缺失时不主张
  const core = await import('../../ops/delivery_acceptance_core.mjs');
  const work = fs.mkdtempSync(path.join(REPO, '.tmp', 'acc-drill-'));
  try {
    // 基线：绿（复用既有 unpacked，避免动演练目录原件）
    const unpackRoot = path.join(work, 'unpacked');
    fs.cpSync(path.join(DRILL, 'unpacked'), unpackRoot, { recursive: true });
    const g1 = core.gateSidecar(tar);
    assert.equal(g1.ok, true, g1.detail);
    const g2 = core.gateUnpack(tar, unpackRoot, true);
    assert.equal(g2.ok, true, g2.detail);
    const g3 = core.gateSignature(g2.delivery, path.join(REPO, 'ops', 'secrets', 'ed25519_public.pem'));
    assert.equal(g3.ok, true, g3.detail);
    assert.ok(g3.verifiedCount >= 112, '演练包受保护业务件应 >= 112：' + g3.verifiedCount);
    const g4 = core.gateSetEquality(g2.delivery);
    assert.equal(g4.ok, true, g4.detail);

    // 探针 A：解包内多塞幽灵文件 -> 关 4 的 ghosts 点名（旧版第 3 关单向检查 100% 放行的形态）
    const ghost = path.join(g2.delivery, 'ghost_probe.txt');
    fs.writeFileSync(ghost, 'not registered anywhere\n');
    const g4ghost = core.gateSetEquality(g2.delivery);
    assert.equal(g4ghost.ok, false);
    assert.match(g4ghost.detail, /ghost_probe\.txt/);
    fs.rmSync(ghost);

    // 探针 B：篡改包内文件 -> 关 3 验签点名 hash_mismatch（第十八轮 _report.txt 同款）。
    // 演练包的 01_Adapted_Code 下按线分目录：取第一个真实文件，不是第一个条目（那是目录，EISDIR）。
    const findFirstFile = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isFile()) return path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const nested = findFirstFile(path.join(dir, entry.name));
          if (nested) return nested;
        }
      }
      return null;
    };
    const victimPath = findFirstFile(path.join(g2.delivery, '01_Adapted_Code'));
    assert.ok(victimPath, '演练包 01_Adapted_Code 里必须能找到文件');
    const victimRel = path.relative(g2.delivery, victimPath).split(path.sep).join('/');
    const before = fs.readFileSync(victimPath);
    fs.appendFileSync(victimPath, 'TAMPER\n');
    const g3tamper = core.gateSignature(g2.delivery, path.join(REPO, 'ops', 'secrets', 'ed25519_public.pem'));
    assert.equal(g3tamper.ok, false, '篡改后验签必须红');
    assert.ok(g3tamper.detail.includes('hash_mismatch:' + victimRel),
      '关 3 必须点名被篡改文件（期望 hash_mismatch:' + victimRel + '，实际 ' + g3tamper.detail + '）');
    fs.writeFileSync(victimPath, before);
    const g3restored = core.gateSignature(g2.delivery, path.join(REPO, 'ops', 'secrets', 'ed25519_public.pem'));
    assert.equal(g3restored.ok, true, '还原后验签必须回绿（探针只测篡改，不测恢复就是半条腿）');

    // 探针 C：tar 本体翻一字节 -> 关 1 侧车哈希当场红
    const tarCopy = path.join(work, 'Client_Delivery.tar.gz');
    fs.copyFileSync(tar, tarCopy);
    fs.copyFileSync(path.join(DRILL, 'tar_sha256_sidecar.txt'), path.join(work, 'tar_sha256_sidecar.txt'));
    const bytes = fs.readFileSync(tarCopy);
    bytes[500] ^= 0x01;
    fs.writeFileSync(tarCopy, bytes);
    const g1tamper = core.gateSidecar(tarCopy);
    assert.equal(g1tamper.ok, false);
    assert.match(g1tamper.detail, /SHA256 不一致/);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('tampered tar cannot earn a receipt nor pass the download gate', async () => {
  // Q1 裁定的完整闭环：传输层全绿（侧车按篡改包重算）时红线必须落在关 3；
  // 且 writeReceipt 拒收红 verdict、verifyTarReceipt 对换过的包拒绝放行。
  const core = await import('../../ops/delivery_acceptance_core.mjs');
  const fixture = await import('./support/delivery_fixture.js');
  const crypto = await import('node:crypto');
  const zlib = await import('node:zlib');
  const os = await import('node:os');
  const keys = crypto.generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-tamper-'));
  const records = path.join(work, 'records');
  try {
    const fx = fixture.buildMiniDeliveryPackage({ root: work, projectId: 'PRJ_TM', publicKey, privateKey });
    const pubFile = path.join(work, 'pub.pem');
    fs.writeFileSync(pubFile, publicKey);
    // 先给干净包立一份回执
    const green = core.acceptDelivery({ tarPath: fx.tarPath, publicKeyPath: pubFile });
    assert.equal(green.ok, true, green.failures.join('；'));
    core.writeReceipt({ projectId: 'PRJ_TM', verdict: green, recordsDir: records });
    // 包被替换：实时哈希 != 回执哈希 -> 拒绝放行，错误码就是路由 409 的 code
    const raw = zlib.gunzipSync(fs.readFileSync(fx.tarPath));
    const at = raw.indexOf(Buffer.from('#!/bin/sh'));
    assert.ok(at > 0, 'fixture 必须有 run.sh 锚点');
    raw[at + 7] ^= 0x20;
    const swapped = zlib.gzipSync(raw);
    fs.writeFileSync(fx.tarPath, swapped);
    fs.writeFileSync(fx.sidecarPath,
      fixture.sha256Hex(swapped) + '  ' + path.basename(fx.tarPath) + '\n', 'utf8');
    const blocked = core.verifyTarReceipt('PRJ_TM', fx.tarPath, records);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'ERR_DELIVERY_UNVERIFIED');
    assert.match(blocked.reason, /回执哈希与当前 tar 不一致/);
    // 完整验收对换过的包也必须红，且红在第 3 关（传输层已被重算侧车洗绿）
    const red = core.acceptDelivery({ tarPath: fx.tarPath, publicKeyPath: pubFile });
    assert.equal(red.ok, false);
    assert.equal(red.gates[0].ok, true, '关 1 应被重算侧车洗成绿（这正是回执存在的理由）');
    assert.equal(red.gates[2].name, 'signature');
    assert.equal(red.gates[2].ok, false, '红线必须落在关 3 验签');
    // 红的 verdict 换不来回执
    assert.throws(() => core.writeReceipt({ projectId: 'PRJ_TM', verdict: red, recordsDir: records }), /禁止写回执/);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('zip-slip and traversal entries are rejected before any write', async () => {
  // 核心解包器面对恶意 tar 的第一红线：条目名含 .. / 绝对路径 / 盘符，必须在写盘前拒。
  const core = await import('../../ops/delivery_acceptance_core.mjs');
  const zlib = await import('node:zlib');
  const os = await import('node:os');
  const fixture = await import('./support/delivery_fixture.js');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-slip-'));
  try {
    for (const evil of ['../escape.txt', '/absolute.txt', 'C:/windows.txt', '..\\up.txt']) {
      const tarPath = path.join(work, 'evil.tar.gz');
      const blocks = [];
      const data = Buffer.from('payload\n');
      // 手工拼一条 ustar（typeflag '0'）条目，不走 fixture 的 sanitize
      const h = Buffer.alloc(512);
      h.write(evil.slice(0, 100), 0, 'latin1');
      h.write('0000644\0', 100, 'latin1');
      h.write('0001000\0', 108, 'latin1');
      h.write('0001000\0', 116, 'latin1');
      h.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'latin1');
      h.write('00000000000\0', 136, 'latin1');
      h.write('0', 156, 'latin1');
      h.write('ustar\0', 257, 'latin1');
      h.write('00', 263, 'latin1');
      let sum = 0;
      for (const b of h) sum += b;
      h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
      const padded = Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
      blocks.push(h, padded, Buffer.alloc(1024));
      fs.writeFileSync(tarPath, zlib.gzipSync(Buffer.concat(blocks)));
      assert.throws(() => core.extractTarGz(tarPath, path.join(work, 'out')), /unsafe_tar_path/,
        '条目名必须被 zip-slip 防护拒绝: ' + evil);
    }
    // 合法嵌套名不得误伤（同一写入器，正向锚点）
    const good = path.join(work, 'good.tar.gz');
    fixture.createTarGz(good, [{ name: 'P/deliv/x.txt', data: Buffer.from('ok\n') }]);
    const names = core.extractTarGz(good, path.join(work, 'out2'));
    assert.deepEqual(names, ['P/deliv/x.txt']);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
test('packager writes README before checksums (order is the contract)', () => {
  const src = fs.readFileSync(path.join(REPO, 'ops', 'build_client_report.py'), 'utf8');
  const readmeAt = src.indexOf('"README.md"');
  const cksAt = src.indexOf('checksums = write_checksums(delivery)');
  assert.ok(readmeAt > 0, '打包器必须写包根 README');
  assert.ok(cksAt > 0, '打包器必须生成 CHECKSUMS');
  assert.ok(readmeAt < cksAt, 'README 必须在 CHECKSUMS 之前落盘，否则自身不被签名覆盖');
});

