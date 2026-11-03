/**
 * 测试交付包工装（第二十轮 Q1）：造一个结构合法的迷你 Client_Delivery 包。
 *
 * 与 ops/build_client_report.py 的产物同构：
 *   <pid>_Client_Delivery/ 01_Adapted_Code/ 02_Figures_and_Tables/
 *   03_Interpretation_Report/ + README.md + delivery_manifest.json
 *   + CHECKSUMS.sha256 + CHECKSUMS.sig + ED25519_PUBLIC_KEY.pem
 * 打成 <root>/<pid>_Client_Delivery.tar.gz 并写 <tar>.sha256 侧车（打包器命名）。
 *
 * ustar 写入器是纯 Node 的（测试不许依赖系统 tar；本地零算力红线同样适用于测试工装）。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { writeChecksums, signDelivery, writeDeliveryPublicKey } from '../../../ops/ed25519_tools.mjs';

export function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function ustarHeader(name, size, typeflag) {
  // typeflag 传字符（'0' 文件 / '5' 目录），不是码点数字：
  // 写 String(0x30) 会落 "48" 进 156 字节，解包端把文件当链接跳过（本工装实测踩过）。
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, 'latin1');
  h.write('0000644\0', 100, 'latin1');
  h.write('0001000\0', 108, 'latin1');
  h.write('0001000\0', 116, 'latin1');
  h.write(size.toString(8).padStart(11, '0') + '\0', 124, 'latin1');
  h.write('00000000000\0', 136, 'latin1'); // mtime 固定：工装必须确定性
  h.write(String(typeflag), 156, 'latin1');
  h.write('\0'.repeat(100), 157, 'latin1'); // linkname
  h.write('ustar\0', 257, 'latin1');
  h.write('00', 263, 'latin1');
  h.write('owner\0'.slice(0, 32), 265, 'latin1');
  h.write('group\0'.slice(0, 32), 297, 'latin1');
  h.write('0000000\0', 329, 'latin1');
  h.write('0000000\0', 337, 'latin1');
  // checksum：先把 148..156 填空格求和，再写八进制
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
  return h;
}

export function createTarGz(outPath, files) {
  // files: [{ name, data: Buffer }]，name 含一级目录前缀（与引擎产物一致）
  const blocks = [];
  const seenDirs = new Set();
  for (const f of files) {
    const parts = f.name.split('/');
    for (let d = 1; d < parts.length; d++) {
      const dirName = parts.slice(0, d).join('/') + '/';
      if (!seenDirs.has(dirName)) {
        seenDirs.add(dirName);
        blocks.push(ustarHeader(dirName, 0, '5'));
      }
    }
    blocks.push(ustarHeader(f.name, f.data.length, '0'));
    blocks.push(f.data);
    const pad = (512 - (f.data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024)); // 双零块结尾
  fs.writeFileSync(outPath, zlib.gzipSync(Buffer.concat(blocks)));
  return outPath;
}

function manifestFor(fileRows) {
  return JSON.stringify({
    schema_version: 1,
    counts: {
      scripts: fileRows.scripts.length,
      adapted_code: fileRows.adapted_code.length,
      figures: fileRows.figures.length,
      tables: fileRows.tables.length,
    },
    files: fileRows,
  }, null, 2) + '\n';
}

/**
 * 生成一个通过四关验收的迷你交付包。
 * @param {{root: string, projectId: string, publicKey: string, privateKey: string, extraFiles?: Record<string, string|Buffer>}} options
 * @returns {{tarPath: string, sidecarPath: string, deliveryDir: string, tarSha256: string}}
 */
export function buildMiniDeliveryPackage({ root, projectId, publicKey, privateKey, extraFiles = {} }) {
  const deliveryName = projectId + '_Client_Delivery';
  const deliveryDir = path.join(root, deliveryName);
  fs.rmSync(deliveryDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(deliveryDir, '01_Adapted_Code'), { recursive: true });
  fs.mkdirSync(path.join(deliveryDir, '02_Figures_and_Tables'), { recursive: true });
  fs.mkdirSync(path.join(deliveryDir, '03_Interpretation_Report'), { recursive: true });
  fs.writeFileSync(path.join(deliveryDir, '01_Adapted_Code', 'run.sh'), '#!/bin/sh\necho ok\n', 'utf8');
  fs.writeFileSync(path.join(deliveryDir, '01_Adapted_Code', '_report.txt'), 'Delivered-SHA256: n/a (fixture)\n', 'utf8');
  fs.writeFileSync(path.join(deliveryDir, '02_Figures_and_Tables', 'deg_sig.tsv'), 'gene\tlogFC\nTNF\t2.5\n', 'utf8');
  fs.writeFileSync(path.join(deliveryDir, '02_Figures_and_Tables', 'fig1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
  // 报告字节数钉死 1024 / 2048：report.test.js 的拉取断言用这两个数字，
  // 垫片改成回放工装真实字节后，尺寸必须继续吻合，不然改一处测试要连坐三处。
  const mdBody = '# 报告 fixture\n';
  const htmlBody = '<html><body>fixture</body></html>\n';
  fs.writeFileSync(path.join(deliveryDir, '03_Interpretation_Report', 'Analysis_Report.md'),
    mdBody + 'm'.repeat(1024 - Buffer.byteLength(mdBody, 'utf8')), 'utf8');
  fs.writeFileSync(path.join(deliveryDir, '03_Interpretation_Report', 'Analysis_Report.html'),
    htmlBody + '<'.repeat(2048 - Buffer.byteLength(htmlBody, 'utf8')), 'utf8');
  fs.writeFileSync(path.join(deliveryDir, 'README.md'), '完整性以 CHECKSUMS 为准\n', 'utf8');
  for (const [rel, content] of Object.entries(extraFiles)) {
    const file = path.join(deliveryDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  fs.writeFileSync(path.join(deliveryDir, 'delivery_manifest.json'), manifestFor({
    scripts: ['run.sh'],
    adapted_code: [],
    figures: ['fig1.png'],
    tables: ['deg_sig.tsv'],
  }), 'utf8');
  // 顺序与引擎产物对齐（演练包实测）：README/manifest 在 CHECKSUMS 之前落盘所以受保护，
  // 公钥在 CHECKSUMS 与签名**之后**落盘，不进哈希清单（第 4 关的 coverageMeta 认这个口径）。
  // 密钥走参数直传，绝不写 process.env：工装污染全局环境会让同文件后续测试假绿。
  writeChecksums(deliveryDir);
  signDelivery(deliveryDir, { privateKey });
  writeDeliveryPublicKey(deliveryDir, { publicKey });
  const files = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullRel = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), fullRel);
      else files.push({ name: deliveryName + '/' + fullRel, data: fs.readFileSync(path.join(dir, entry.name)) });
    }
  };
  walk(deliveryDir, '');
  const tarPath = path.join(root, projectId + '_Client_Delivery.tar.gz');
  createTarGz(tarPath, files);
  const tarSha256 = sha256Hex(fs.readFileSync(tarPath));
  const sidecarPath = tarPath + '.sha256';
  fs.writeFileSync(sidecarPath, tarSha256 + '  ' + path.basename(tarPath) + '\n', 'utf8');
  return { tarPath, sidecarPath, deliveryDir, tarSha256 };
}
