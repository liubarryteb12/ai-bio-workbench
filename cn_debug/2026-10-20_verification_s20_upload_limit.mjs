/**
 * S20 验证脚本：portal 上传上限 5GiB + 每角色 5 + 流式写盘（2026-10-20）
 *
 * 起真进程、打真 HTTP（照 BioanalysDesktop/tests/portal_submit.test.js 的做法：
 * 空闲端口 + 临时 PORTAL_INBOX），覆盖：
 *   C0  默认配置（无 env）常量：MAX_DATA_BYTES = 5368709120（5 GiB）、MAX_DATA_FILES_PER_ROLE = 5
 *   C1  正路径：64MiB 随机文件 → 200、size 正确
 *   C2  正路径落盘 md5 与源一致（流式写全的硬证据）
 *   C3  内存有界性：64MiB 上传前后 portal 进程 RSS 增量 < 64MiB（powershell 实测；取不到记「未验证」）
 *   C3b 支持证据：第二次 64MiB 上传 RSS 增量同样 < 64MiB（非累积增长）
 *   C4  空文件 → 400「上传内容为空」且不落盘（既有行为不破）
 *   C5  扩展名拒绝 → 400 且不落盘（既有行为不破）
 *   C6  同 sid 同角色同名重传 → _2 追加且旧文件不被删（latent「先删旧的」失效取证，本切片不改）
 *   C7  建流失败 → 500「写入数据文件失败: ...」（写出错路径）
 *   C8  全链路 /api/submit → PKG_ 包、raw_data md5 与源一致、manifest 计数正确
 *   C9  超限负路径：PORTAL_MAX_DATA_BYTES=1048576，上传 4MiB → 400「单文件超过上限 1MiB」且无半成品残留
 *
 * 幂等：每次运行用独立临时收件箱/临时源文件/随机 sid，结束即清理，可重复跑。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const PORTAL = path.join(REPO, 'portal', 'serve.mjs');
const BIG_BYTES = 64 * 1024 * 1024; // 正路径上传体积
const OVER_BYTES = 4 * 1024 * 1024; // 超限用例上传体积
const CAP_BYTES = 1024 * 1024;      // 超限用例服务端上限（PORTAL_MAX_DATA_BYTES）

const results = [];
let failures = 0;

function record(name, ok, detail) {
  if (!ok) failures += 1;
  results.push({ name, ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  | ${detail}` : ''}`);
}

function skip(name, reason) {
  results.push({ name, ok: null, detail: reason });
  console.log(`SKIP  ${name}  | ${reason}（未验证）`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startPortal(extraEnv) {
  const port = await freePort();
  const inbox = fs.mkdtempSync(path.join(os.tmpdir(), 's20_inbox_'));
  const logs = [];
  const child = spawn(process.execPath, [PORTAL], {
    env: { ...process.env, PORTAL_PORT: String(port), PORTAL_INBOX: inbox, ...(extraEnv || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logs.push(`[stdout] ${String(d).trim()}`));
  child.stderr.on('data', (d) => logs.push(`[stderr] ${String(d).trim()}`));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) { up = true; break; }
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!up) {
    try { child.kill(); } catch { /* 已退出 */ }
    fs.rmSync(inbox, { recursive: true, force: true });
    throw new Error(`portal 未在 10s 内就绪（port=${port}）\n${logs.join('\n')}`);
  }
  return { child, inbox, base, port, logs };
}

function stopPortal(portal) {
  try { portal.child.kill(); } catch { /* 已退出 */ }
  try { fs.rmSync(portal.inbox, { recursive: true, force: true }); } catch { /* 已删 */ }
}

function md5File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(file);
    stream.on('data', (d) => hash.update(d));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** powershell 读 portal 进程 WorkingSet64（RSS）；取不到返回 null，调用方记「未验证」 */
function rssOf(pid) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      `Get-Process -Id ${pid} | Select-Object -ExpandProperty WorkingSet64`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const value = Number(String(out).trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch (cause) {
    console.log(`（RSS 读取失败: ${cause.message}）`);
    return null;
  }
}

/** 随机内容源文件：流式生成 + 边写边算 md5，不在内存里攒整包 */
async function makeSource(dir, bytes) {
  const file = path.join(dir, `source_${crypto.randomBytes(4).toString('hex')}.bin`);
  const hash = crypto.createHash('md5');
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    let left = bytes;
    out.on('error', reject);
    out.on('finish', resolve);
    const pump = () => {
      while (left > 0) {
        const n = Math.min(left, 4 * 1024 * 1024);
        const buf = crypto.randomBytes(n);
        hash.update(buf);
        left -= n;
        if (!out.write(buf)) { out.once('drain', pump); return; }
      }
      out.end();
    };
    pump();
  });
  return { file, md5: hash.digest('hex'), size: bytes };
}

async function postDataFile(base, { sid, role, bind, name, body }) {
  const url = `${base}/api/datafiles?sid=${encodeURIComponent(sid)}`
    + `&role=${encodeURIComponent(role)}&bind=${encodeURIComponent(bind)}`
    + `&name=${encodeURIComponent(name)}`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
    duplex: 'half', // undici 规范：流式 body 必须显式声明
  });
}

async function main() {
  const runId = crypto.randomBytes(4).toString('hex');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 's20_run_'));
  console.log(`run=${runId} scratch=${scratch}`);

  // ---------- C0：默认配置常量（干净 env 子进程实测，打印常量） ----------
  const cleanEnv = { ...process.env };
  delete cleanEnv.PORTAL_MAX_DATA_BYTES;
  const archiveUrl = pathToFileURL(path.join(REPO, 'portal', 'lib', 'archive.mjs')).href;
  const constOut = execFileSync(process.execPath, ['--input-type', 'module', '-e',
    `import(${JSON.stringify(archiveUrl)}).then((m) => console.log(JSON.stringify({ max: m.MAX_DATA_BYTES, perRole: m.MAX_DATA_FILES_PER_ROLE })))`],
    { env: cleanEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const consts = JSON.parse(constOut.split('\n').pop().trim());
  record('C0 默认配置（无 env）MAX_DATA_BYTES = 5368709120 字节（5 GiB）', consts.max === 5368709120, constOut);
  record('C0b 默认配置 MAX_DATA_FILES_PER_ROLE = 5', consts.perRole === 5, constOut);

  // ---------- portal A：默认配置（5 GiB） ----------
  const A = await startPortal();
  console.log(`portal A pid=${A.child.pid} port=${A.port} inbox=${A.inbox}（默认配置，无 PORTAL_MAX_DATA_BYTES）`);
  try {
    // ---------- C1/C2：正路径 64MiB + md5 ----------
    const sidPos = `s20pos${runId}`;
    const src = await makeSource(scratch, BIG_BYTES);
    const rssBefore = rssOf(A.child.pid);
    const resPos = await postDataFile(A.base, {
      sid: sidPos, role: 'train_matrix', bind: 'GSE10001',
      name: 'GSE10001_series_matrix.txt.gz', body: fs.createReadStream(src.file),
    });
    const bodyPos = await resPos.json();
    const rssAfter = rssOf(A.child.pid);
    record('C1 正路径：200 且 size=64MiB', resPos.status === 200 && bodyPos.size === BIG_BYTES,
      `status=${resPos.status} ok=${bodyPos.ok} size=${bodyPos.size} path=${bodyPos.path}`);
    const savedPath = path.join(A.inbox, String(bodyPos.path || ''));
    const md5Saved = fs.existsSync(savedPath) ? await md5File(savedPath) : '(missing)';
    record('C2 正路径：落盘 md5 与源一致（流式写全的硬证据）', md5Saved === src.md5,
      `src=${src.md5} saved=${md5Saved}`);

    // ---------- C3：内存有界性（RSS 增量 < 64MiB） ----------
    if (rssBefore !== null && rssAfter !== null) {
      const delta = rssAfter - rssBefore;
      record('C3 内存有界性：64MiB 上传前后 RSS 增量 < 64MiB', delta >= 0 && delta < BIG_BYTES,
        `pid=${A.child.pid} rss ${rssBefore} → ${rssAfter}（增量 ${(delta / 1024 / 1024).toFixed(2)}MB）`);
    } else {
      skip('C3 内存有界性', 'powershell Get-Process 读取失败');
    }

    // ---------- C3b：第二次 64MiB 上传，RSS 不累积增长 ----------
    // 注意用独立 sid：C8 全链路要断言「提交后上传会话目录被清空」，不能留第二个文件
    const sidPos2 = `s20pos2${runId}`;
    const src2 = await makeSource(scratch, BIG_BYTES);
    const rssBefore2 = rssOf(A.child.pid);
    const resPos2 = await postDataFile(A.base, {
      sid: sidPos2, role: 'train_matrix', bind: 'GSE10001',
      name: 'GSE10001_series_matrix_2nd.txt.gz', body: fs.createReadStream(src2.file),
    });
    const bodyPos2 = await resPos2.json();
    const rssAfter2 = rssOf(A.child.pid);
    if (rssBefore2 !== null && rssAfter2 !== null) {
      const delta2 = rssAfter2 - rssBefore2;
      // 判据是「增量 < 64MiB」；负值=内存被回收，比正值更强
      record('C3b 第二次 64MiB 上传 RSS 增量同样 < 64MiB（非累积增长）',
        resPos2.status === 200 && bodyPos2.size === BIG_BYTES && delta2 < BIG_BYTES,
        `status=${resPos2.status} rss ${rssBefore2} → ${rssAfter2}（增量 ${(delta2 / 1024 / 1024).toFixed(2)}MB）`);
    } else {
      skip('C3b 第二次 64MiB 上传 RSS', 'powershell Get-Process 读取失败');
    }

    // ---------- C4：空文件 ----------
    const sidEmpty = `s20empty${runId}`;
    const resEmpty = await postDataFile(A.base, { sid: sidEmpty, role: 'other', bind: '', name: 'empty.tsv', body: Buffer.alloc(0) });
    const bodyEmpty = await resEmpty.json();
    record('C4 空文件：400「上传内容为空」且不落盘',
      resEmpty.status === 400 && bodyEmpty.error === '上传内容为空'
        && !fs.existsSync(path.join(A.inbox, 'uploads', sidEmpty)),
      `status=${resEmpty.status} error=${bodyEmpty.error}`);

    // ---------- C5：扩展名拒绝 ----------
    const sidExe = `s20exe${runId}`;
    const resExe = await postDataFile(A.base, { sid: sidExe, role: 'other', bind: '', name: 'evil.exe', body: Buffer.from('x') });
    const bodyExe = await resExe.json();
    record('C5 扩展名拒绝：.exe → 400 且不落盘',
      resExe.status === 400 && /evil\.exe/.test(bodyExe.error || '')
        && !fs.existsSync(path.join(A.inbox, 'uploads', sidExe)),
      `status=${resExe.status} error=${bodyExe.error}`);

    // ---------- C6：同名重传 _2 + latent「先删旧的」失效取证 ----------
    const sidDup = `s20dup${runId}`;
    const resDup1 = await postDataFile(A.base, { sid: sidDup, role: 'train_matrix', bind: 'GSE10001', name: 'dup_matrix.tsv', body: Buffer.from('first') });
    const resDup2 = await postDataFile(A.base, { sid: sidDup, role: 'train_matrix', bind: 'GSE10001', name: 'dup_matrix.tsv', body: Buffer.from('second') });
    const bodyDup1 = await resDup1.json();
    const bodyDup2 = await resDup2.json();
    const dupDir = path.join(A.inbox, 'uploads', sidDup);
    const dupFiles = fs.existsSync(dupDir) ? fs.readdirSync(dupDir).sort() : [];
    record('C6 同名重传追加 _2，旧文件仍在（latent「同角色先删旧的」失效现场取证，本切片不改）',
      resDup1.status === 200 && resDup2.status === 200
        && bodyDup2.path === `uploads/${sidDup}/dup_matrix_2.tsv`
        && dupFiles.length === 2,
      `path1=${bodyDup1.path} path2=${bodyDup2.path} dir=[${dupFiles.join(', ')}]`);

    // ---------- C7：建流失败 → 500 ----------
    const sidFail = `s20fail${runId}`;
    fs.mkdirSync(path.join(A.inbox, 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(A.inbox, 'uploads', sidFail), 'not a directory');
    const resFail = await postDataFile(A.base, { sid: sidFail, role: 'other', bind: '', name: 'x.tsv', body: Buffer.from('data') });
    const bodyFail = await resFail.json();
    record('C7 建流失败：500「写入数据文件失败: ...」（写出错路径）',
      resFail.status === 500 && /^写入数据文件失败/.test(bodyFail.error || ''),
      `status=${resFail.status} error=${bodyFail.error}`);

    // ---------- C10：客户端中途断传（raw socket 发一半即断开） ----------
    // 硬要求：删半成品、不往已断的连接里写响应；且成功上传后的 close 不得误删文件
    //（C6 的 dupFiles.length === 2 已覆盖「success 后 close 不删文件」）
    const sidAbort = `s20abort${runId}`;
    await new Promise((resolve) => {
      const sock = net.connect(A.port, '127.0.0.1', () => {
        sock.write(`POST /api/datafiles?sid=${encodeURIComponent(sidAbort)}`
          + `&role=train_matrix&bind=GSE10001&name=abort_matrix.tsv HTTP/1.1\r\n`
          + 'Host: 127.0.0.1\r\nContent-Type: application/octet-stream\r\n'
          + `Content-Length: ${OVER_BYTES}\r\n\r\n`);
        sock.write(Buffer.alloc(64 * 1024, 3));
        setTimeout(() => sock.destroy(), 100);
      });
      sock.on('error', () => { /* 断开即预期 */ });
      sock.on('close', resolve);
    });
    await new Promise((r) => setTimeout(r, 800)); // 给服务端 close/aborted 回调留时间
    const abortDir = path.join(A.inbox, 'uploads', sidAbort);
    const abortFiles = fs.existsSync(abortDir) ? fs.readdirSync(abortDir) : [];
    record('C10 客户端断传：半成品被删、不落垃圾、服务进程不崩', abortFiles.length === 0,
      `dir=${abortDir} files=[${abortFiles.join(', ')}]`);

    // ---------- C8：全链路 /api/submit → PKG_ 包 ----------
    const payload = {
      manifest_version: '1.0',
      basicInfo: { name: 'S20验证项目', description: '流式写盘全链路', domain: '免疫', disease: 'Sepsis', species: 'Homo sapiens', nonTumorVerified: true },
      dataSource: {
        dataType: 'microarray', sampleCount: 12, tissue: 'Blood', species: 'Homo sapiens',
        data_source_mode: 'PUBLIC_DB', source: 'GEO',
        datasets: [{ gse: 'GSE10001', gpl: 'GPL570', role: 'train' }],
      },
      groupingDesign: { mode: 'two_group', groups: [], contrasts: [] },
      dataFiles: [{
        role: 'train_matrix', bind: 'GSE10001', name: 'GSE10001_series_matrix.txt.gz',
        path: bodyPos.path, size: BIG_BYTES,
      }],
      references: [],
      uploadSid: sidPos,
      notes: 'S20 验证脚本',
    };
    const resSubmit = await fetch(`${A.base}/api/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const bodySubmit = await resSubmit.json();
    const pkgDir = path.join(A.inbox, String(bodySubmit.savedAs || ''));
    const manifestPath = path.join(pkgDir, 'package_manifest.json');
    let chainOk = resSubmit.status === 200 && /^PKG_\d{4}-\d{2}-\d{2}_\d{6}_/.test(bodySubmit.savedAs || '')
      && fs.existsSync(pkgDir) && fs.existsSync(manifestPath);
    let md5InPkg = '(missing)';
    if (chainOk) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      chainOk = manifest.counts.data_files === 1 && manifest.data_files.length === 1;
      const inPkg = path.join(pkgDir, 'raw_data', manifest.data_files[0].archive_name);
      md5InPkg = fs.existsSync(inPkg) ? await md5File(inPkg) : '(missing)';
      chainOk = chainOk && md5InPkg === src.md5
        && !fs.existsSync(path.join(A.inbox, 'uploads', sidPos));
    }
    record('C8 全链路 /api/submit → PKG_ 包：raw_data md5 与源一致、manifest 计数正确、uploads 已清',
      chainOk, `savedAs=${bodySubmit.savedAs} md5=${md5InPkg} src=${src.md5}`);
  } finally {
    stopPortal(A);
    console.log('---- portal A 日志（证据：收到数据文件日志行仍在） ----');
    for (const line of A.logs) console.log(line);
  }

  // ---------- portal B：PORTAL_MAX_DATA_BYTES=1MiB，超限负路径 ----------
  const B = await startPortal({ PORTAL_MAX_DATA_BYTES: String(CAP_BYTES) });
  console.log(`portal B pid=${B.child.pid} port=${B.port} inbox=${B.inbox}（PORTAL_MAX_DATA_BYTES=${CAP_BYTES}）`);
  try {
    const sidBig = `s20big${runId}`;
    const bigSrc = await makeSource(scratch, OVER_BYTES);
    const resBig = await postDataFile(B.base, {
      sid: sidBig, role: 'train_matrix', bind: 'GSE10001',
      name: 'big_series_matrix.txt.gz', body: fs.createReadStream(bigSrc.file),
    });
    const bodyBig = await resBig.json();
    record('C9 超限负路径：400 且文案含覆盖值「单文件超过上限 1MiB」',
      resBig.status === 400 && String(bodyBig.error || '').includes('单文件超过上限 1MiB'),
      `status=${resBig.status} error=${bodyBig.error}`);
    const bigDir = path.join(B.inbox, 'uploads', sidBig);
    const leftovers = fs.existsSync(bigDir) ? fs.readdirSync(bigDir) : [];
    record('C9b 超限负路径：uploads/<sid>/ 无半成品残留', leftovers.length === 0,
      `dir=${bigDir} files=[${leftovers.join(', ')}]`);
  } finally {
    stopPortal(B);
    console.log('---- portal B 日志 ----');
    for (const line of B.logs) console.log(line);
  }

  fs.rmSync(scratch, { recursive: true, force: true });

  // ---------- 汇总 ----------
  const passed = results.filter((r) => r.ok === true).length;
  const failed = results.filter((r) => r.ok === false).length;
  const skipped = results.filter((r) => r.ok === null).length;
  console.log(`\n==== 汇总：PASS ${passed} / FAIL ${failed} / SKIP ${skipped} ====`);
  if (failed > 0) {
    for (const r of results.filter((x) => x.ok === false)) console.log(`FAIL  ${r.name}  | ${r.detail}`);
    process.exitCode = 1;
  }
}

main().catch((cause) => {
  console.error(`验证脚本异常终止: ${cause && cause.stack ? cause.stack : cause}`);
  process.exitCode = 1;
});
