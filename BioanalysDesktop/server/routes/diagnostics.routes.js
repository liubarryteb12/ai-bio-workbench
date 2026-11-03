// 诊断路由：五维环境自检、链路检查、台账巡检、数据面目录树。
//
// 从 server/index.js 逐字搬来，处理体未做改写。json、uploadError、runRemote、
// runRemoteStrict、fetchLedgerFromServer、resolveProjectParam 由 index.js 注入而不是在
// 这里重复定义，理由与 upload.routes.js 相同：这些辅助在 index.js 的其它路由里仍在用，
// 复制一份会造出两个真源（改一处漏一处）。
//
// 返回约定：命中本模块管辖的 pathname 就返回 true（含"已注册异步回调、稍后才回响应"
// 的情形），未命中返回 false 让 index.js 继续往下派发。json() 与 uploadError() 都返回
// undefined，所以绝不能拿它们的返回值当命中信号，必须显式 return true。
import {
  DEFAULT_SERIAL, SYSTEM_LOGS, LINES, sanitizeProjectId, projectLineDir,
} from '../domain.js';
import { checkLink } from '../link.js';
import {
  buildHardwareCommand, parseHardwareOutput, evaluateHardware,
  buildIsolationCommand, parseIsolationOutput, evaluateIsolation,
  runSha256ParityCheck, mergeIsolationChecks,
  STORAGE_MIN_FREE_PCT,
} from '../selfcheck.js';
import { summarizeLedger, auditLedgerEntry } from '../ledger.js';
import { assertPathInsideProject, buildTreeFromFind } from '../files.js';

export async function handleDiagnosticsRoutes(req, res, url, {
  json, uploadError, runRemote, runRemoteStrict, fetchLedgerFromServer, resolveProjectParam, adb,
  // checkLink 默认仍用模块内的真实探测；允许注入是为了让本模块可测：
  // 真实 checkLink 会跑 adb devices 与两段 ssh，在测试里既慢又不确定。
  checkLink: checkLinkImpl = checkLink,
}) {
  if (url.pathname === '/api/selfcheck') {
    const checks = [];
    // 1. 路径与 FUSE 红线
    try {
      const fsType = runRemoteStrict('df -T /mnt/ssd/bio_data 2>/dev/null | awk "NR==2 {print $2}"').trim();
      const isFuse = fsType.includes('fuse') || fsType.includes('sdcardfs');
      checks.push({ id: 'fs_type', label: '文件系统类型', status: isFuse ? 'fail' : 'pass', value: fsType, detail: isFuse ? 'FUSE 层违规' : '原生 ext4/f2fs' });
    } catch (e) {
      checks.push({ id: 'fs_type', label: '文件系统类型', status: 'unknown', value: '', detail: '无法读取' });
    }
    // 2. 存储水位
    try {
      const dfOut = runRemoteStrict('df -P /mnt/ssd/bio_data 2>/dev/null | tail -1').trim().split(/\s+/);
      const usedPct = (dfOut[4] || '0').replace('%', '').replace(/[^0-9]/g, '');
      const freePct = 100 - parseInt(usedPct || '0', 10);
      checks.push({ id: 'storage', label: '存储水位', status: freePct >= STORAGE_MIN_FREE_PCT ? 'pass' : 'fail', value: `${freePct}% free`, detail: freePct >= STORAGE_MIN_FREE_PCT ? '安全' : `低于 ${STORAGE_MIN_FREE_PCT}% 门禁` });
    } catch (e) {
      checks.push({ id: 'storage', label: '存储水位', status: 'unknown', value: '', detail: '无法读取' });
    }
    // 3. SoC 算力 / 温度 / 7.5GB 内存水位（aims §3 第 3 条；判据全在 selfcheck.js）
    try {
      const raw = runRemoteStrict(buildHardwareCommand());
      checks.push({ id: 'memory', label: 'SoC 算力/温度/内存', ...evaluateHardware(parseHardwareOutput(raw)) });
    } catch (e) {
      checks.push({ id: 'memory', label: 'SoC 算力/温度/内存', status: 'unknown', value: '', detail: '无法读取: ' + (e instanceof Error ? e.message : String(e)) });
    }
    // 4. 三线隔离 + 桥接引擎 + 远端版本一致性（aims §三.3 第 4 维，一盏灯三件事）
    //    子灯 a：逐线跑 check_storage_and_isolation.sh（原来只跑 line1_bulk，D6 收敛为逐线）
    //    子灯 b：本地与远端核心文件 SHA256 比对（D-07 口径，防版本漂移）
    //    两盏子灯分开算、合并报：detail 能点名到具体哪条坏，界面上仍只占一格。
    try {
      const raw = runRemoteStrict(buildIsolationCommand());
      const isolation = evaluateIsolation(parseIsolationOutput(raw));
      const merged = mergeIsolationChecks(isolation, runSha256ParityCheck());
      // P17：子灯结构化下发（前端 sub_checks），value 仍保持字符串兼容旧前端
      checks.push({
        id: merged.id,
        label: merged.label,
        status: merged.status,
        value: merged.value,
        detail: merged.detail,
        sub_checks: (merged.subChecks ?? []).map((sub) => ({
          id: sub.id,
          label: sub.label,
          status: sub.status,
          value: sub.value,
          detail: sub.detail,
        })),
      });
    } catch (e) {
      checks.push({ id: 'isolation', label: '跨线隔离/桥接/版本', status: 'unknown', value: '', detail: '无法读取: ' + (e instanceof Error ? e.message : String(e)) });
    }
    // 5. ADB/SSH 链路（四段探测 + 服务状态）
    try {
      const linkResult = checkLinkImpl(adb);
      const segSummary = linkResult.segments
        .map((s) => `${s.name}:${s.pass ? 'ok' : 'FAIL'}`)
        .join(' | ');
      const failedSegs = linkResult.segments.filter((s) => !s.pass)
        .map((s) => `${s.name} (${s.detail || ''})`)
        .join('; ');
      checks.push({
        id: 'link',
        label: 'ADB/SSH 链路',
        status: linkResult.overall === 'pass' ? 'pass' : linkResult.overall === 'warn' ? 'warn' : 'fail',
        value: segSummary,
        detail: failedSegs || (linkResult.compute ? `CPU=${linkResult.compute.cpus}/${linkResult.compute.cpusTotal} Mem=${linkResult.compute.memoryGb}GB` : ''),
      });
    } catch (e) {
      checks.push({ id: 'link', label: 'ADB/SSH 链路', status: 'unknown', value: '', detail: '无法检测: ' + (e instanceof Error ? e.message : String(e)) });
    }
    const allPass = checks.every((c) => c.status === 'pass');
    json(res, 200, { all_pass: allPass, checks });
    return true;
  }

  if (url.pathname === '/api/link/check') {
    // 四段自检 + 服务状态，链不通时也能拿到"断在哪段"的结构化结果
    try {
      const result = checkLinkImpl();
      json(res, 200, { serial: DEFAULT_SERIAL, adb, link: result });
      return true;
    } catch (cause) {
      json(res, 500, {
        error: cause instanceof Error ? cause.message : String(cause),
        hint: '先跑一次链路自检定位，或查看 con_hf/踩坑台账.md',
      });
      return true;
    }
  }

  if (url.pathname === '/api/ledger/check') {
    // 台账巡检：SSD 未挂载时必须显式报阻塞，不能假装 0 违规
    const requested = url.searchParams.get('dir') || SYSTEM_LOGS;
    const probe = runRemote(`if [ -d '${requested}' ]; then echo EXISTS; else echo MISSING; fi`);
    if (!probe.includes('EXISTS')) {
      json(res, 200, {
        blocked: true,
        reason: `目录不存在: ${requested}`,
        hint: '外挂 SSD 未挂载或路径不符，先解决数据面再巡检台账。不得当作"无违规"处理',
        summary: null,
      });
      return true;
    }

    try {
      const { entries } = await fetchLedgerFromServer(requested);
      const audited = entries.map((entry) => ({
        file: entry.file,
        path: entry.path,
        ...auditLedgerEntry(entry.data),
      }));
      const summary = summarizeLedger(entries.map((entry) => entry.data));
      json(res, 200, { blocked: false, dir: requested, summary, entries: audited });
      return true;
    } catch (cause) {
      json(res, 500, {
        error: cause instanceof Error ? cause.message : String(cause),
        hint: '读台账失败；若 JSON 单个文件损坏，错误信息里会带文件名',
      });
      return true;
    }
  }

  if (url.pathname === '/api/files/tree') {
    // 数据面浏览：限定本项目本线，越界一律拒绝；SSD 未挂载时阻塞态
    const projectId = resolveProjectParam(url);
    if (!projectId) {
      json(res, 400, { error: `project 参数非法（只允许字母数字 . _ -）` });
      return true;
    }
    const lineId = url.searchParams.get('line') || LINES[0];
    if (!LINES.includes(lineId)) {
      json(res, 400, { error: `line 参数非法: ${lineId}，只能是 ${LINES.join(' / ')}` });
      return true;
    }
    const subdir = url.searchParams.get('sub') || '';
    const lineDir = projectLineDir(projectId, lineId);
    const guard = assertPathInsideProject(`${lineDir}/${subdir}`, projectId, lineId);
    if (!guard.ok) {
      json(res, 400, { error: guard.reason });
      return true;
    }

    const probe = runRemote(`if [ -d '${lineDir}' ]; then echo EXISTS; else echo MISSING; fi`);
    if (!probe.includes('EXISTS')) {
      json(res, 200, {
        blocked: true,
        projectId,
        lineId,
        reason: `线目录不存在: ${lineDir}`,
        hint: '项目未创建或该线目录未建，先在项目管理里建项目。不得当作"这条线没数据"处理',
        tree: null,
      });
      return true;
    }

    const listing = runRemote(
      `find '${guard.normalized}' -printf '%p|%y|%s|%T@\\n' 2>/dev/null | head -5000`
    );
    const tree = buildTreeFromFind(listing, projectId, lineId);
    json(res, 200, { blocked: false, projectId, lineId, root: guard.normalized, tree });
    return true;
  }

  return false;
}
