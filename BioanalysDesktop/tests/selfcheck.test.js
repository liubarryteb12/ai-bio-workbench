/**
 * 五维环境自检（D6 收敛）测试：只测 server/selfcheck.js 的纯函数。
 *
 * 为什么不打 HTTP：自检第 3/4 维要跑 ssh，打 HTTP 就得垫片伪造整段远端输出，
 * 断言的是垫片而不是判据。这里把「命令构造 / 输出解析 / 判据评估」当纯逻辑测，
 * 真链路是否通由 /api/link/check 与 ops 侧脚本负责。
 *
 * 覆盖：正常读数、缺 END 标记（截断）、温度告警/阻断两档、内存 90%/100% 两档、
 * 负载超核数、cgroup memory.max=max 时回落到 7.5GB 配额、三线隔离逐线判定、
 * 桥接脚本缺失降级为 warn。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MEM_QUOTA_BYTES, TEMP_WARN_C, TEMP_FAIL_C,
  buildHardwareCommand, parseHardwareOutput, evaluateHardware, EXPECTED_R_VERSION, RSCRIPT_PROJECT_BIN,
  buildIsolationCommand, parseIsolationOutput, evaluateIsolation,
} from '../server/selfcheck.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const HARDWARE_OK = [
  'LOAD|0.52|0.61|0.70',
  'CPUS|8',
  'TEMP|52000',
  'MEM|MemTotal:|16318476',
  'MEM|MemAvailable:|12000000',
  'MEMMAX|8053063680',
  'MEMCUR|3221225472',
  'RVER|Rscript (R) version 4.5.3 (2026-03-11)',
  'END|',
].join('\n');

const ISOLATION_OK = [
  'LINE|line1_bulk|0',
  'LINE|line2_scrna|0',
  'LINE|line3_spatial|0',
  'BRIDGE|present',
  'END|',
].join('\n');

// ------------------------------------------------------------
// 第 3 维：SoC 算力 / 温度 / 7.5GB 内存
// ------------------------------------------------------------

test('buildHardwareCommand：一条命令取全负载、核数、温度、内存配额与用量，并以 END 收尾', () => {
  const command = buildHardwareCommand();
  for (const tag of ['LOAD|', 'CPUS|', 'TEMP|', 'MemTotal:', 'MemAvailable:', 'MEMMAX|', 'MEMCUR|', "echo 'END|'"]) {
    assert.ok(command.includes(tag), `命令缺少 ${tag}`);
  }
  assert.ok(command.includes('/sys/fs/cgroup/memory.max'), '内存配额必须读 cgroup v2');
});

test('parseHardwareOutput：正常读数逐字段解析，毫摄氏度折算成摄氏度', () => {
  const parsed = parseHardwareOutput(HARDWARE_OK);
  assert.deepEqual(parsed.load, [0.52, 0.61, 0.7]);
  assert.equal(parsed.cpus, 8);
  assert.equal(parsed.tempC, 52);
  assert.equal(parsed.memTotalKb, 16318476);
  assert.equal(parsed.memAvailKb, 12000000);
  assert.equal(parsed.memMaxBytes, 8053063680);
  assert.equal(parsed.memCurBytes, 3221225472);
  assert.equal(parsed.sawEnd, true);
});

test('parseHardwareOutput：cgroup memory.max 为 max 时不当数值，配额回落 7.5GB', () => {
  const parsed = parseHardwareOutput(['MEMMAX|max', 'MEMCUR|1073741824', 'END|'].join('\n'));
  assert.equal(parsed.memMaxBytes, null);
  const light = evaluateHardware(parsed);
  assert.equal(light.status, 'pass');
  assert.ok(light.value.includes('1.0/7.5GB'), `内存应显示 1.0/7.5GB，实际: ${light.value}`);
});

test('evaluateHardware：缺 END 标记 → unknown（截断不许当通过）', () => {
  const parsed = parseHardwareOutput('LOAD|0.1|0.1|0.1\nCPUS|8');
  assert.equal(parsed.sawEnd, false);
  const light = evaluateHardware(parsed);
  assert.equal(light.status, 'unknown');
  assert.match(light.detail, /END/);
});

test('evaluateHardware：读数健康 → pass，value 同时给出负载/温度/内存三要素', () => {
  const light = evaluateHardware(parseHardwareOutput(HARDWARE_OK));
  assert.equal(light.status, 'pass');
  assert.match(light.value, /CPU 0\.52\/0\.61\/0\.70（8 核）/);
  assert.match(light.value, /52°C/);
  assert.match(light.value, /内存 3\.0\/7\.5GB（40%）/);
  assert.match(light.detail, new RegExp(`温度告警 ${TEMP_WARN_C}°C / 阻断 ${TEMP_FAIL_C}°C`));
});

test('evaluateHardware：温度到告警线 → warn，到阻断线 → fail', () => {
  const warn = evaluateHardware(parseHardwareOutput(['TEMP|86000', 'CPUS|8', 'END|'].join('\n')));
  assert.equal(warn.status, 'warn');
  const fail = evaluateHardware(parseHardwareOutput(['TEMP|96000', 'CPUS|8', 'END|'].join('\n')));
  assert.equal(fail.status, 'fail');
});

test('evaluateHardware：内存贴到 90% → warn，超配额 → fail', () => {
  const quota = String(MEM_QUOTA_BYTES);
  const warn = evaluateHardware(parseHardwareOutput(
    [`MEMMAX|${quota}`, `MEMCUR|${Math.round(MEM_QUOTA_BYTES * 0.92)}`, 'END|'].join('\n')
  ));
  assert.equal(warn.status, 'warn');
  const fail = evaluateHardware(parseHardwareOutput(
    [`MEMMAX|${quota}`, `MEMCUR|${Math.round(MEM_QUOTA_BYTES * 1.05)}`, 'END|'].join('\n')
  ));
  assert.equal(fail.status, 'fail');
});

test('evaluateHardware：1 分钟负载超核数 1.5 倍 → warn（提示有并发重型任务）', () => {
  const light = evaluateHardware(parseHardwareOutput(['LOAD|12.5|9.0|6.0', 'CPUS|8', 'END|'].join('\n')));
  assert.equal(light.status, 'warn');
  assert.match(light.detail, /负载 1\.56 核当量/);
});

test('evaluateHardware：温度与内存都读不到 → pass 但 value 如实写"不可读"，不假装有数', () => {
  const light = evaluateHardware(parseHardwareOutput('END|'));
  assert.equal(light.status, 'pass');
  assert.match(light.value, /温度 不可读/);
  assert.match(light.value, /内存 不可读/);
});

// ------------------------------------------------------------
// 第 4 维：三线隔离 + 桥接四项断言
// ------------------------------------------------------------

test('buildIsolationCommand：三条线逐线跑门禁（不再写死 line1_bulk），并探桥接脚本', () => {
  const command = buildIsolationCommand();
  for (const line of ['line1_bulk', 'line2_scrna', 'line3_spatial']) {
    assert.ok(command.includes(`check_storage_and_isolation.sh ${line}`), `缺少 ${line} 的逐线门禁`);
  }
  assert.ok(command.includes('verify_bridge_checkpoint.py'), '必须探桥接四项断言脚本');
  assert.ok(command.includes('echo "LINE|'), '必须回显逐线退出码');
  assert.ok(command.includes("echo 'END|'"));
});

test('parseIsolationOutput：逐线退出码与桥接脚本存在性', () => {
  const parsed = parseIsolationOutput(ISOLATION_OK);
  assert.deepEqual(parsed.lines, [
    { line: 'line1_bulk', rc: 0 },
    { line: 'line2_scrna', rc: 0 },
    { line: 'line3_spatial', rc: 0 },
  ]);
  assert.equal(parsed.bridgePresent, true);
  assert.equal(parsed.sawEnd, true);
});

test('evaluateIsolation：三线全过 + 桥接脚本在 → pass', () => {
  const light = evaluateIsolation(parseIsolationOutput(ISOLATION_OK));
  assert.equal(light.status, 'pass');
  assert.match(light.value, /line1_bulk:ok/);
  assert.match(light.detail, /三线隔离门禁全部通过/);
  assert.match(light.detail, /已接线/);
});

test('evaluateIsolation：任一线门禁不过 → fail 且点名该线与退出码', () => {
  const text = ['LINE|line1_bulk|0', 'LINE|line2_scrna|2', 'LINE|line3_spatial|0', 'BRIDGE|present', 'END|'].join('\n');
  const light = evaluateIsolation(parseIsolationOutput(text));
  assert.equal(light.status, 'fail');
  assert.match(light.value, /line2_scrna:FAIL\(rc=2\)/);
  assert.match(light.detail, /1 条线隔离门禁未过/);
});

test('evaluateIsolation：桥接脚本未部署 → warn（提交层已接线，但脚本缺失要说清）', () => {
  const text = ['LINE|line1_bulk|0', 'LINE|line2_scrna|0', 'LINE|line3_spatial|0', 'BRIDGE|missing', 'END|'].join('\n');
  const light = evaluateIsolation(parseIsolationOutput(text));
  assert.equal(light.status, 'warn');
  assert.match(light.detail, /未部署/);
});

test('evaluateIsolation：无任何逐线结果（脚本未部署）→ unknown 且点名脚本路径', () => {
  const light = evaluateIsolation(parseIsolationOutput('BRIDGE|missing\nEND|'));
  assert.equal(light.status, 'unknown');
  assert.match(light.detail, /check_storage_and_isolation\.sh/);
});

test('evaluateIsolation：缺 END 标记 → unknown', () => {
  const light = evaluateIsolation(parseIsolationOutput('LINE|line1_bulk|0'));
  assert.equal(light.status, 'unknown');
});

// ------------------------------------------------------------
// R 版本漂移锁死（2026-11-02，Argon 双 R 三重锁死第二重）
// 容器里系统 R 4.3.3（/usr/bin）与项目 4.5.3（layout_autoload 垫片）并存；
// 非交互 SSH 裸调 Rscript 必中 4.3.3，包库整棵错掉且结果看似正常，属静默漂移。
// ------------------------------------------------------------

test('buildHardwareCommand：RVER 探针必须走项目垫片绝对路径（不裸调 Rscript）', () => {
  const command = buildHardwareCommand();
  assert.ok(command.includes('RVER|'), '命令缺少 RVER 探针');
  assert.ok(command.includes(RSCRIPT_PROJECT_BIN),
    'RVER 必须用 layout_autoload 垫片绝对路径，裸 Rscript 会命中系统 4.3.3');
});

test('parseHardwareOutput：RVER 行解析出三段版本号', () => {
  const parsed = parseHardwareOutput(HARDWARE_OK);
  assert.equal(parsed.rVersion, '4.5.3');
});

test('evaluateHardware：R 版本回退到系统 4.3.3 → fail（漂移即失败，不许看似正常）', () => {
  const drift = ['CPUS|8', 'RVER|Rscript (R) version 4.3.3 (2024-02-29)', 'END|'].join('\n');
  const light = evaluateHardware(parseHardwareOutput(drift));
  assert.equal(light.status, 'fail');
  assert.match(light.detail, /漂移/);
});

test('evaluateHardware：RVER 无输出 → 不判 fail（探针缺失≠漂移），value 如实标未探测', () => {
  const light = evaluateHardware(parseHardwareOutput(['CPUS|8', 'END|'].join('\n')));
  assert.equal(light.status, 'pass');
  assert.match(light.value, /R 版本 未探测/);
});

test('EXPECTED_R_VERSION 与 software_versions.json 真源一致（账实分离从测试侧焊死）', () => {
  const svPath = path.resolve(HERE, '..', '..', 'docs', 'software_versions.json');
  const sv = JSON.parse(fs.readFileSync(svPath, 'utf8'));
  const rEntry = (sv.interpreters || []).find((i) => i.name === 'R');
  assert.ok(rEntry, 'software_versions.json 缺 R 条目');
  assert.equal(EXPECTED_R_VERSION, rEntry.version,
    'selfcheck 常量与 docs/software_versions.json 不一致：改真源必须同步这里');
});