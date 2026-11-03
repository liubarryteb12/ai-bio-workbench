import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleDiagnosticsRoutes } from '../server/routes/diagnostics.routes.js';
import { projectLineDir } from '../server/domain.js';
import { resolveProjectParam } from '../server/query_views.js';

// ── routes/diagnostics.routes.js 契约面测试（2026-11-03，4 Argon 第十八轮 P2）──
//
// 这个模块是 18787 管理台的诊断面：五维环境自检、链路检查、台账巡检、数据面目录树。
// 它的返回约定特殊：命中就返回 true，未命中返回 false 让 index.js 继续派发；
// json() / uploadError() 都返回 undefined，所以绝不能拿它们的返回值当命中信号。
//
// 测试难点是它内置了真实探测：checkLink 会跑 adb devices 与两段 ssh，
// 既有副作用又慢。因此实现里把 checkLink 做成可注入（默认仍是真实实现），
// 测试全部走注入，既有用例都确定。
//
// 另外三盏灯的解析器（parseHardwareOutput / parseIsolationOutput / sha 比对）
// 各有自己的契约测试，这里只钉「这一层怎么组装与降级」：探测抛错必须落 unknown，
// 不能落 pass，也不能把整盏灯吞掉。

const SELFCHECK = 'http://127.0.0.1:18787/api/selfcheck';

function linkFixture(overrides = {}) {
  return {
    overall: 'pass',
    segments: [
      { name: '设备在线', pass: true, detail: '' },
      { name: 'forward 在位', pass: true, detail: '' },
    ],
    services: [],
    compute: { cpus: 8, cpusTotal: 8, memoryGb: 11.5 },
    checkedAt: '2026-11-03T00:00:00.000Z',
    ...overrides,
  };
}

function harness(overrides = {}) {
  const seen = { json: [], remote: [], remoteStrict: [] };
  const deps = {
    json: (res, status, payload) => { seen.json.push({ status, payload }); },
    uploadError: (res, status, message) => { seen.json.push({ status, payload: { ok: false, error: message } }); },
    runRemote: (cmd) => {
      seen.remote.push(cmd);
      return overrides.runRemote ? overrides.runRemote(cmd) : 'MISSING';
    },
    runRemoteStrict: (cmd) => {
      seen.remoteStrict.push(cmd);
      if (overrides.runRemoteStrict) return overrides.runRemoteStrict(cmd);
      throw new Error('链路不可用');
    },
    fetchLedgerFromServer: overrides.fetchLedgerFromServer ?? (async () => ({ entries: [] })),
    resolveProjectParam,
    adb: 'adb',
    checkLink: overrides.checkLink ?? linkFixture,
  };
  return { deps, seen };
}

async function call(pathname, overrides = {}) {
  const { deps, seen } = harness(overrides);
  const url = new URL('http://127.0.0.1:18787' + pathname);
  const handled = await handleDiagnosticsRoutes({}, {}, url, deps);
  return { handled, seen, last: seen.json[seen.json.length - 1] };
}

test('未命中本模块管辖的 pathname 时返回 false，且不写任何响应', async () => {
  const r = await call('/api/projects/list');
  assert.equal(r.handled, false);
  assert.equal(r.seen.json.length, 0);
});

test('四条路由命中后都显式返回 true：json() 返回 undefined 不能当命中信号', async () => {
  const results = [
    await call('/api/selfcheck'),
    await call('/api/link/check'),
    await call('/api/ledger/check'),
    await call('/api/files/tree?project=PRJ_X'),
  ];
  for (const r of results) assert.equal(r.handled, true);
  assert.deepEqual(results.map((r) => r.last.status), [200, 200, 200, 200]);
});

test('/api/selfcheck 固定五盏灯（fs_type/storage/memory/isolation/link），all_pass 严格等价于全 pass', async () => {
  const r = await call('/api/selfcheck', {
    runRemoteStrict: (cmd) => {
      if (cmd.includes('df -T')) return 'ext4\n';
      if (cmd.includes('df -P')) return 'overlay 100G 20G 80G 20% /mnt/ssd/bio_data\n';
      throw new Error('其余探测不可用');
    },
  });
  const payload = r.last.payload;
  assert.deepEqual(payload.checks.map((c) => c.id), ['fs_type', 'storage', 'memory', 'isolation', 'link']);
  assert.equal(payload.checks[0].status, 'pass');
  assert.equal(payload.checks[0].detail, '原生 ext4/f2fs');
  assert.equal(payload.checks[1].status, 'pass');
  assert.equal(payload.checks[1].value, '80% free');
  assert.equal(payload.checks[2].status, 'unknown');
  assert.match(payload.checks[2].detail, /^无法读取/);
  assert.equal(payload.checks[3].status, 'unknown');
  assert.equal(payload.checks[4].status, 'pass');
  assert.equal(payload.all_pass, false);
  assert.equal(payload.all_pass, payload.checks.every((c) => c.status === 'pass'));
});

test('/api/selfcheck FUSE 层与低水位都要判 fail 并点名理由，不能只给个红点', async () => {
  const r = await call('/api/selfcheck', {
    runRemoteStrict: (cmd) => {
      if (cmd.includes('df -T')) return 'fuse.rclone\n';
      if (cmd.includes('df -P')) return 'overlay 100G 95G 5G 95% /mnt/ssd/bio_data\n';
      throw new Error('x');
    },
  });
  const checks = r.last.payload.checks;
  assert.equal(checks[0].status, 'fail');
  assert.equal(checks[0].detail, 'FUSE 层违规');
  assert.equal(checks[1].status, 'fail');
  assert.equal(checks[1].value, '5% free');
  assert.match(checks[1].detail, /20%/);
});

test('/api/selfcheck 链路灯：失败段点名到 detail，全通时回填 CPU/内存', async () => {
  const bad = await call('/api/selfcheck', {
    checkLink: () => linkFixture({
      overall: 'warn',
      segments: [
        { name: '设备在线', pass: true, detail: '' },
        { name: '容器 sshd', pass: false, detail: 'Connection closed by 127.0.0.1' },
      ],
      compute: null,
    }),
  });
  const warn = bad.last.payload.checks[4];
  assert.equal(warn.status, 'warn');
  assert.match(warn.value, /容器 sshd:FAIL/);
  assert.match(warn.detail, /容器 sshd \(Connection closed by 127\.0\.0\.1\)/);

  const good = await call('/api/selfcheck');
  const pass = good.last.payload.checks[4];
  assert.equal(pass.status, 'pass');
  assert.match(pass.value, /设备在线:ok/);
  assert.equal(pass.detail, 'CPU=8/8 Mem=11.5GB');
});

test('/api/link/check 回 serial/adb/link 三段；checkLink 抛错时 500 并给定位提示', async () => {
  const ok = await call('/api/link/check');
  assert.equal(ok.last.status, 200);
  assert.equal(typeof ok.last.payload.serial, 'string');
  assert.equal(ok.last.payload.adb, 'adb');
  assert.equal(ok.last.payload.link.overall, 'pass');

  const bad = await call('/api/link/check', {
    checkLink: () => { throw new Error('adb 不在 PATH'); },
  });
  assert.equal(bad.last.status, 500);
  assert.equal(bad.last.payload.error, 'adb 不在 PATH');
  assert.match(bad.last.payload.hint, /踩坑台账/);
});

test('/api/ledger/check 目录不可达时显式报阻塞，绝不假装零违规', async () => {
  const r = await call('/api/ledger/check?dir=/mnt/ssd/bio_data/system_logs');
  assert.equal(r.last.status, 200);
  assert.equal(r.last.payload.blocked, true);
  assert.equal(r.last.payload.summary, null);
  assert.match(r.last.payload.reason, /system_logs/);
  assert.match(r.last.payload.hint, /不得当作/);
});

test('/api/ledger/check 目录存在时逐条审计并汇总，文件名与路径原样带回', async () => {
  const entries = [
    {
      file: 'a.json',
      path: '/mnt/ssd/bio_data/system_logs/a.json',
      data: { project_id: 'PRJ_X', line_id: 'line1_bulk', step_name: 'l1_qc', status: 'success', io_files: { input: [], output: [] } },
    },
    {
      file: 'b.json',
      path: '/mnt/ssd/bio_data/system_logs/b.json',
      data: { project_id: 'PRJ_X', line_id: 'line9', step_name: 'l1_de', status: 'failed', error_log: 'boom', io_files: { input: [], output: [] } },
    },
  ];
  const r = await call('/api/ledger/check', {
    runRemote: () => 'EXISTS',
    fetchLedgerFromServer: async () => ({ entries }),
  });
  const p = r.last.payload;
  assert.equal(p.blocked, false);
  assert.equal(p.summary.total, 2);
  assert.equal(p.summary.legal, 1);
  assert.equal(p.summary.violations, 1);
  assert.equal(p.entries[0].file, 'a.json');
  assert.equal(p.entries[0].path, '/mnt/ssd/bio_data/system_logs/a.json');
  assert.equal(p.entries[0].legal, true);
  assert.equal(p.entries[1].file, 'b.json');
  assert.match(p.entries[1].problems[0], /line_id 非法/);
});

test('/api/ledger/check 读台账失败回 500，错误信息里保留文件名', async () => {
  const r = await call('/api/ledger/check', {
    runRemote: () => 'EXISTS',
    fetchLedgerFromServer: async () => { throw new Error('坏 JSON: c.json'); },
  });
  assert.equal(r.last.status, 500);
  assert.equal(r.last.payload.error, '坏 JSON: c.json');
  assert.match(r.last.payload.hint, /文件名/);
});

test('/api/files/tree project 非法直接 400，且不触达远端', async () => {
  const r = await call('/api/files/tree?project=' + encodeURIComponent('../etc'));
  assert.equal(r.last.status, 400);
  assert.match(r.last.payload.error, /project 参数非法/);
  assert.equal(r.seen.remote.length, 0);
});

test('/api/files/tree line 非法 400，并把三条合法线列全', async () => {
  const r = await call('/api/files/tree?project=PRJ_X&line=line9');
  assert.equal(r.last.status, 400);
  assert.match(r.last.payload.error, /line1_bulk \/ line2_scrna \/ line3_spatial/);
});

test('/api/files/tree sub 跨线时 400，理由点名真正属于哪条线', async () => {
  const sub = encodeURIComponent('../line2_scrna/processed');
  const r = await call('/api/files/tree?project=PRJ_X&line=line1_bulk&sub=' + sub);
  assert.equal(r.last.status, 400);
  assert.match(r.last.payload.error, /line2_scrna/);
  assert.match(r.last.payload.error, /三线互不交叉/);
});

test('/api/files/tree 线目录不存在时报阻塞态而不是空树', async () => {
  const r = await call('/api/files/tree?project=PRJ_X&line=line1_bulk');
  assert.equal(r.last.status, 200);
  assert.equal(r.last.payload.blocked, true);
  assert.equal(r.last.payload.tree, null);
  assert.match(r.last.payload.reason, /line1_bulk/);
  assert.match(r.last.payload.hint, /不得当作/);
});

test('/api/files/tree 目录存在时把 find 输出解析成树，root 用规范化后的路径', async () => {
  const root = projectLineDir('PRJ_X', 'line1_bulk');
  const findOut = [
    root + '/processed|d|0|1',
    root + '/processed/deg_all.tsv|f|2048|2',
    '/mnt/ssd/bio_data/projects/PRJ_OTHER/line1_bulk/processed/leak.tsv|f|1|3',
  ].join('\n');
  const r = await call('/api/files/tree?project=PRJ_X&line=line1_bulk', {
    runRemote: (cmd) => (cmd.startsWith('find ') ? findOut : 'EXISTS'),
  });
  const p = r.last.payload;
  assert.equal(p.blocked, false);
  assert.equal(p.root, root);
  assert.equal(p.projectId, 'PRJ_X');
  assert.equal(p.lineId, 'line1_bulk');
  assert.ok(p.tree && Array.isArray(p.tree.children));
  assert.equal(p.tree.children[0].name, 'processed');
});

test('结构：本模块的链路探测只走注入入口，杜绝测试期跑真实 adb/ssh', async () => {
  const src = await readFile(new URL('../server/routes/diagnostics.routes.js', import.meta.url), 'utf8');
  assert.ok(src.includes('checkLink: checkLinkImpl = checkLink'), '必须保留默认注入写法');
  assert.ok(src.includes('checkLinkImpl(adb)'), '自检灯必须走注入入口');
  assert.ok(src.includes('checkLinkImpl()'), '链路检查必须走注入入口');
  assert.equal(src.includes('checkLink(adb)'), false, '不得残留直连调用');
  assert.equal(src.includes('checkLink()'), false, '不得残留直连调用');
});
