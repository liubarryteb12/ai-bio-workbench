/**
 * 验证集分组映射契约验证（用户端 /api/submit）
 *
 * 覆盖四种提交形态：合法、缺一侧、两侧重叠、编号不合规。
 * 目的：确认「只给一半映射」不会静默通过（那会让下游拿残缺样本集做冻结评估）。
 *
 * 注意：/api/submit 的合法提交会真实落盘到 portal/inbox，
 * 所以脚本记录提交前后的目录差异，结束时只删本次新产生的文件，
 * 不碰收件箱里既有的客户样例。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'http://127.0.0.1:8080/api/submit';
const INBOX = fileURLToPath(new URL('../portal/inbox/', import.meta.url));

const before = new Set(fs.existsSync(INBOX) ? fs.readdirSync(INBOX) : []);

function basePayload() {
  return {
    basicInfo: { name: '验证集映射验证', disease: 'Psoriasis', species: 'Homo sapiens' },
    dataSource: {
      dataType: 'microarray',
      data_source_mode: 'PUBLIC_DB',
      datasets: [{ gse: 'GSE277173', gpl: 'GPL11532', role: 'train' }],
    },
    groupingDesign: {
      mode: 'two_group',
      groups: [
        { groupName: 'Control', role: 'reference', stageOrder: 0, sampleIds: ['GSM8515001'] },
        { groupName: 'Disease', role: 'disease_stage', stageOrder: 1, sampleIds: ['GSM8515002'] },
      ],
    },
  };
}

async function post(payload) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const cases = [
  {
    name: '合法映射（两侧齐全、编号合规、无重叠）',
    payload: { ...basePayload(), validationGroupMapping: { valControlSamples: ['GSM337001'], valTreatSamples: ['GSM337050'] } },
    expect: (r) => r.status === 200,
  },
  {
    name: '缺处理侧（只给对照）',
    payload: { ...basePayload(), validationGroupMapping: { valControlSamples: ['GSM337001'], valTreatSamples: [] } },
    expect: (r) => r.status === 400 && /都不能为空/.test(r.body.error || ''),
  },
  {
    name: '两侧重叠（同一样本既是照又处理）',
    payload: { ...basePayload(), validationGroupMapping: { valControlSamples: ['GSM337001'], valTreatSamples: ['GSM337001'] } },
    expect: (r) => r.status === 400 && /同时出现在验证集对照与处理两侧/.test(r.body.error || ''),
  },
  {
    name: '编号不合规（PUBLIC_DB 下用 Ctrl_1）',
    payload: { ...basePayload(), validationGroupMapping: { valControlSamples: ['Ctrl_1'], valTreatSamples: ['GSM337050'] } },
    expect: (r) => r.status === 400 && /验证集样本编号格式非法/.test(r.body.error || ''),
  },
  {
    name: '未声明映射（null）应正常通过',
    payload: { ...basePayload(), validationGroupMapping: null },
    expect: (r) => r.status === 200,
  },
];

let failed = 0;
for (const c of cases) {
  const r = await post(c.payload);
  const ok = c.expect(r);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${c.name} | status=${r.status} | ${r.body.error || r.body.file || ''}`);
}
console.log(failed === 0 ? '\n全部符合预期' : `\n${failed} 条不符合预期`);

// 清理本次新落盘的需求包（只删 before 快照里没有的）。
// 提交产物已从单个 JSON 变成 PKG_ 目录，必须带 recursive，否则 EISDIR。
const created = fs.readdirSync(INBOX).filter((n) => !before.has(n) && n !== 'refs' && n !== 'uploads');
for (const name of created) {
  fs.rmSync(path.join(INBOX, name), { recursive: true, force: true });
  console.log(`已清理本次验证产生的收件箱产物：${name}`);
}
// 不用 process.exit：undici 的 keep-alive 连接还在关闭中，强制退出会触发
// libuv 的 UV_HANDLE_CLOSING 断言。设置 exitCode 让事件循环自然排空即可。
process.exitCode = failed === 0 ? 0 : 1;
