/**
 * 诊断面远端命令的引号注入契约（T0-4）。
 *
 * 背景（2026-11 全量审查 SV-01 / SV-02）：
 *   - server/routes/diagnostics.routes.js 的 /api/ledger/check 把 URL 参数 dir
 *     直接拼进 runRemote 的单引号串： if [ -d '${requested}' ] ...
 *   - 同文件 /api/files/tree 把 sub 拼进 find 的单引号串。
 *   - 单引号对单引号毫无防护：dir 里带一个 ' 就能闭合引号、追加任意命令，
 *     持管理口令者可借此在 k40 上执行任意 shell。
 *
 * 断言方式：不比对字符串字面量（那样改一个字就失效），而是对拼出来的命令做一次
 * POSIX 分词模拟，检查注入载荷里的命令没有变成独立 token。载荷被完整包在一个
 * 单引号段里时，它只会是一个参数；引号被闭合时，touch /tmp/pwned 会分裂成两个 token。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDiagnosticsRoutes } from '../server/routes/diagnostics.routes.js';
import { resolveProjectParam } from '../server/query_views.js';

const PAYLOAD = "/mnt/ssd/bio_data/system_logs'; touch /tmp/pwned; echo '";
const SUB_PAYLOAD = "processed'; touch /tmp/pwned; echo '";

/** 极简 POSIX 分词：只关心引号状态与 ; | & 分隔，够判定载荷有没有逃出引号 */
function tokenize(command) {
  const tokens = [];
  let current = '';
  let has = false;
  let state = 'normal';
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (state === 'single') {
      if (ch === "'") state = 'normal';
      else { current += ch; has = true; }
      continue;
    }
    if (state === 'double') {
      if (ch === '"') state = 'normal';
      else { current += ch; has = true; }
      continue;
    }
    if (ch === "'") { state = 'single'; has = true; continue; }
    if (ch === '"') { state = 'double'; has = true; continue; }
    if (ch === '\\') { current += command[i + 1] || ''; has = true; i += 1; continue; }
    if (/\s/.test(ch)) {
      if (has) { tokens.push(current); current = ''; has = false; }
      continue;
    }
    if (';|&()<>'.includes(ch)) {
      if (has) { tokens.push(current); current = ''; has = false; }
      tokens.push(ch);
      continue;
    }
    current += ch;
    has = true;
  }
  if (has) tokens.push(current);
  return tokens;
}

function harness() {
  const seen = { json: [], remote: [] };
  const deps = {
    json: (res, status, payload) => { seen.json.push({ status, payload }); },
    uploadError: () => {},
    // 目录存在性探针回 EXISTS，好让 files/tree 真正走到 find 那一步
    runRemote: (cmd) => { seen.remote.push(cmd); return cmd.startsWith('if [ -d ') ? 'EXISTS' : ''; },
    runRemoteStrict: () => { throw new Error('stub'); },
    fetchLedgerFromServer: async () => ({ entries: [] }),
    resolveProjectParam,
    adb: 'adb',
    checkLink: () => ({ overall: 'pass', segments: [], services: [], checkedAt: '' }),
    readHeartbeat: () => ({ status: 'ok', stages: [], data: {} }),
  };
  return { deps, seen };
}

async function call(pathname) {
  const { deps, seen } = harness();
  await handleDiagnosticsRoutes({}, {}, new URL('http://127.0.0.1:18787' + pathname), deps);
  return { seen, last: seen.json[seen.json.length - 1] };
}

test('/api/ledger/check 的 dir 参数不能闭合单引号造出第二条命令', async () => {
  const r = await call('/api/ledger/check?dir=' + encodeURIComponent(PAYLOAD));
  assert.equal(r.seen.remote.length, 1, '校验目录存在性时必须只发一条远端命令');
  const tokens = tokenize(r.seen.remote[0]);
  assert.equal(tokens.includes('touch'), false, 'dir 载荷不得逃出引号变成独立命令: ' + r.seen.remote[0]);
  assert.equal(tokens.includes('/tmp/pwned'), false, 'dir 载荷不得逃出引号变成独立参数: ' + r.seen.remote[0]);
});

test('/api/files/tree 的 sub 参数不能闭合单引号造出第二条命令', async () => {
  const r = await call('/api/files/tree?project=PRJ_X&line=line1_bulk&sub=' + encodeURIComponent(SUB_PAYLOAD));
  // sub 落在合法线内，守卫会放行 → 走到 find
  const findCmd = r.seen.remote.find((c) => c.startsWith('find '));
  assert.ok(findCmd, '应发出 find 命令，实际: ' + JSON.stringify(r.seen.remote));
  const tokens = tokenize(findCmd);
  assert.equal(tokens.includes('touch'), false, 'sub 载荷不得逃出引号变成独立命令: ' + findCmd);
  assert.equal(tokens.includes('/tmp/pwned'), false, 'sub 载荷不得逃出引号变成独立参数: ' + findCmd);
});

test('正常路径仍可被引号包裹后原样传给远端（引号修复不能改变语义）', async () => {
  const r = await call('/api/ledger/check?dir=/mnt/ssd/bio_data/system_logs');
  assert.equal(r.seen.remote.length, 1);
  const tokens = tokenize(r.seen.remote[0]);
  assert.ok(tokens.includes('/mnt/ssd/bio_data/system_logs'), '目录参数必须作为完整 token 传给远端: ' + r.seen.remote[0]);
  assert.ok(tokens.includes('['), '命令结构必须保持 if [ -d ... ] 形态: ' + r.seen.remote[0]);
});
