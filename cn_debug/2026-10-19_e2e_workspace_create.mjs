/**
 * 端到端验证 · 第 2 段：工作台（8787）读取收件箱需求 → 建项 → 数据文件落远端。
 *
 * 输入：第 1 段生成的提交包名（命令行参数或环境变量 PKG）。
 * 输出：项目 ID 与远端 raw_data 落盘结果，供第 3 段下发任务使用。
 */

import path from 'node:path';

const BASE = 'http://127.0.0.1:8787';
const PROJECT_ID = process.env.PROJECT_ID || 'PRJ_E2E_GSE277173';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
};

async function main() {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check('工作台服务在线', !!health, JSON.stringify(health).slice(0, 120));

  const listing = await (await fetch(`${BASE}/api/portal/inbox`)).json();
  check('收件箱可读', listing.blocked === false, listing.reason || `${listing.items.length} 条`);
  const item = listing.items.find((i) => (i.summary?.name || '').includes('GSE277173'));
  check('找到本次提交包', !!item, item?.file || '未找到');
  if (!item) throw new Error('收件箱里没有本次提交包');

  const detailRes = await fetch(`${BASE}/api/portal/inbox/item?name=${encodeURIComponent(item.file)}`);
  const detail = await detailRes.json();
  check('需求详情可读', detailRes.status === 200, detail.error || detail.file);
  check('详情带数据集行级三元组',
    detail.datasets?.[0]?.dataType === 'microarray' && detail.datasets?.[0]?.sampleCount === 16,
    JSON.stringify(detail.datasets?.[0] || null));
  check('详情带包清单（3 个数据文件）',
    detail.packageManifest?.counts?.data_files === 3,
    JSON.stringify(detail.packageManifest?.counts || null));

  const m = detail.manifest;
  const dataFiles = (detail.packageManifest?.data_files || []).map((d) => ({
    role: d.role, bind: d.bind, name: d.original_name, path: d.path, size: d.size,
  }));

  const body = {
    projectId: PROJECT_ID,
    name: m.basicInfo?.name,
    description: m.basicInfo?.description,
    basicInfo: m.basicInfo,
    dataSource: m.dataSource,
    groupingDesign: m.groupingDesign,
    pipelineDag: m.pipelineDag,
    aclAndOutput: m.aclAndOutput,
    biologicalPriors: m.biologicalPriors,
    analysisCutoffs: m.analysisCutoffs,
    plotLayoutConfig: m.plotLayoutConfig,
    experimentalDesign: m.experimentalDesign,
    validationGroupMapping: m.validationGroupMapping,
    notes: m.notes,
    references: m.references,
    dataFiles,
  };

  const createRes = await fetch(`${BASE}/api/projects/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const created = await createRes.json();
  check('建项成功（含数据文件部署）', createRes.status === 200 && created.ok === true,
    created.error || `${created.message} | line=${created.line}`);
  if (createRes.status !== 200) {
    console.log(JSON.stringify(created, null, 2));
    throw new Error('建项失败');
  }

  check('推断分析线为 line1_bulk', created.line === 'line1_bulk', created.line || '');
  check('project.json 落盘配对表（含三元组）',
    created.meta?.data_source?.datasets?.[0]?.sampleCount === 16,
    JSON.stringify(created.meta?.data_source?.datasets?.[0] || null));
  check('project.json 保留配对设计', created.meta?.experimental_design?.is_paired === true,
    `pair_map ${Object.keys(created.meta?.experimental_design?.pair_map || {}).length} 项`);

  const deployed = created.dataFiles || [];
  check('三个数据文件全部部署到远端', deployed.length === 3 && deployed.every((d) => d.ok),
    deployed.map((d) => `${d.name}->${d.remotePath || d.error}`).join(' | '));

  console.log('\nPROJECT_ID=' + PROJECT_ID);
  console.log('LINE=' + created.line);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果：${pass}/${results.length} 通过`);
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch((cause) => {
  console.error('脚本异常:', cause.message);
  process.exitCode = 1;
});
