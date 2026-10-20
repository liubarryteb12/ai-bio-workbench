// 2026-10-18 临时探针：验证 portal 第 5 步「打印 / 存为 PDF」是否输出完整需求单 + 时间戳。
// 用法：用 chrome-devtools 的 evaluate_script 以 function 格式执行本文件。
// 不提交需求（避免写用户收件箱的 JSON）；只从参考文献上传（会落 inbox/refs/<sid>/）取到真实 refs。
() => {
  const out = { missing: [], notes: [] };
  const set = (id, v) => {
    const e = document.getElementById(id);
    if (!e) { out.missing.push(id); return; }
    e.value = v;
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const check = (id) => {
    const e = document.getElementById(id);
    if (!e) { out.missing.push(id); return; }
    e.checked = true;
    e.dispatchEvent(new Event('change', { bubbles: true }));
  };
  // 分析步骤勾选框的真实 DOM id 是 `st-<stepId>`，裸 stepId 取不到元素。
  // 曾直接 forEach(check) 传裸 id，getElementById 全返回 null，6 步静默落空
  // （报告里只剩渲染时默认勾上的 must 步），却被误当成"页面没渲染步骤"。
  const checkStep = (step) => check('st-' + step);

  // 第 1 步
  set('f-name', '缺血性卒中空间转录组分析');
  set('f-desc', '基于空间转录组数据解析缺血性卒中后脑组织各区域细胞类型分布与基因表达差异，定位缺血半暗带的关键调控基因，给出可用于后续实验验证的候选靶点清单。');
  set('f-disease', '缺血性卒中');
  set('f-species', 'Homo sapiens');
  set('f-domain', '心脑血管');
  set('f-contact', '张研究员 / zhang@example.org');

  // 第 2 步：数据类型决定分析线；GSE/GPL 配对
  set('f-datatype', 'spatial');
  set('f-source', 'GEO');
  set('f-sample-count', '12');
  set('f-tissue', '脑组织（皮层 + 缺血半暗带）');
  set('d-gse-d1', 'GSE123456');
  set('d-gpl-d1', 'GPL24676');
  set('d-gse-d2', 'GSE654321');
  set('d-gpl-d2', 'GPL24676');

  // 第 3 步：批量粘贴分组表（样本编号,分组名）
  const bulk = document.getElementById('f-bulk');
  if (bulk) {
    bulk.value = 'GSM000001,对照组\nGSM000002,对照组\nGSM000003,实验组\nGSM000004,实验组';
  } else { out.missing.push('f-bulk'); }
  const applyBtn = document.getElementById('btn-bulk-apply');
  if (applyBtn) { applyBtn.click(); } else { out.missing.push('btn-bulk-apply'); }

  // 第 4 步：勾选分析步骤（注意走 checkStep，会补 st- 前缀）+ 目标敲除基因
  ['spatial_domains', 'spatial_markers', 'spatial_autocorr', 'spatial_knockout',
   'enrichment_figures', 'spatial_figures'].forEach(checkStep);
  out.checkedSteps = ['spatial_domains', 'spatial_markers', 'spatial_autocorr', 'spatial_knockout',
   'enrichment_figures', 'spatial_figures'].filter((s) => {
     const e = document.getElementById('st-' + s);
     return e && e.checked;
   });
  const koInput = document.querySelector('[id^="ko-"]');
  if (koInput) { koInput.value = 'PLP1'; koInput.dispatchEvent(new Event('input', { bubbles: true })); }
  else { out.notes.push('ko 输入框未出现（虚拟敲除步骤可能未生效）'); }

  // 第 5 步：交付物 + 备注
  // 注意：勾选框 UI key 与 manifest formats 口径不同（UI: web_preview/tsv_tables/pdf_vector/
  // checkpoint_archive/audit_ledger；manifest: png_300dpi/rds_checkpoint/audit_json）。
  // 探针必须按 UI key 勾选，用 manifest 口径会全部落空（曾踩过，missing 多出 4 项）。
  check('out-web_preview');
  check('out-tsv_tables');
  check('out-pdf_vector');
  check('out-checkpoint_archive');
  check('out-audit_ledger');
  set('f-notes', '重点关注缺血半暗带与核心梗死区的基因表达差异；\n希望给出可用于后续实验验证的候选靶点清单，并附上每个靶点的证据强度说明。');

  // 走真实点击路径：拦截 window.print 避免弹出系统打印对话框
  window.__printCalled = false;
  window.__titleAtPrint = '';
  window.print = function () {
    window.__printCalled = true;
    window.__titleAtPrint = document.title;
    window.dispatchEvent(new Event('beforeprint'));
  };
  const btn = document.getElementById('btn-print');
  if (btn) { btn.click(); } else { out.missing.push('btn-print'); }

  const rep = document.getElementById('print-report');
  const txt = rep ? rep.textContent : '';
  out.printCalled = !!window.__printCalled;
  out.titleAtPrint = window.__titleAtPrint;
  out.sectionHeadings = rep ? Array.from(rep.querySelectorAll('.pr-h')).map((h) => h.textContent) : [];
  out.tableRowCounts = rep ? Array.from(rep.querySelectorAll('table.pr-t')).map((t) => t.rows.length) : [];
  out.tableCount = rep ? rep.querySelectorAll('table.pr-t').length : 0;
  // 内容完整性断言：报告必须覆盖全部 5 步填过的内容，一屏之外的信息不能丢
  const STEPS = ['spatial_domains', 'spatial_markers', 'spatial_autocorr', 'spatial_knockout',
    'enrichment_figures', 'spatial_figures'];
  out.hasAllSteps = STEPS.every((s) => txt.includes(s));
  out.hasSamples = txt.includes('GSM000001') && txt.includes('GSM000004');
  out.hasDatasets = txt.includes('GSE123456') && txt.includes('GPL24676');
  out.hasKoGene = txt.includes('PLP1');
  out.hasNotes = txt.includes('缺血半暗带与核心梗死区的基因表达差异');
  out.hasOutputs = ['Web 预览图集', '全量统计结果表', '发表级矢量图副本',
    '中间态检查点', '结构化审计台账'].every((s) => txt.includes(s));
  out.stampInBody = /生成时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(txt);
  out.stampInTitle = /\d{8}_\d{6}$/.test(window.__titleAtPrint);
  out.totalChars = txt.length;
  out.emptyMarkCount = (txt.match(/（未填写）|（未设置|（未上传|（未勾选/g) || []).length;
  out.text = txt;

  // 标题还原回归：afterprint 触发后必须把 document.title 的临时时间戳去掉，
  // 否则第二次打印会把「已加时间戳的标题」当原始值备份，标题被时间戳粘住（曾复现）。
  window.dispatchEvent(new Event('afterprint'));
  out.titleAfterAfterprint = document.title;
  out.titleRestored = !/\d{8}_\d{6}$/.test(document.title);

  // 直接 Ctrl+P 的兜底：屏幕元素被隐藏后若不重建，#print-report 为空会打出白纸，
  // 故 beforeprint 也挂 buildPrintReport。这里清空容器后仅派发 beforeprint 验证会被重建。
  rep.innerHTML = '';
  window.dispatchEvent(new Event('beforeprint'));
  out.rebuiltOnBeforeprint = rep.textContent.length > 0;
  out.rebuiltChars = rep.textContent.length;
  return out;
}
