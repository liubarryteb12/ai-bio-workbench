/**
 * portal/lib/archive.mjs — 提交包归档契约（"一次提交 = 一个包目录"）
 *
 * 背景：客户端一次提交早期只落一个平铺 JSON，上传的文献落在随机 sid 目录下，
 * 对接人拿到收件箱后无法判断"哪几个文件属于哪次需求"。本模块把命名与校验规则
 * 固化为可测契约：包名 / 归档名 / 数据文件校验 / 包计划。
 *
 * 硬要求：**上传的文件名必须和用户自己填写的名称对得上**。这条最容易做成
 * "看起来校验了、其实没比对"，所以 validateDataFiles 逐条锁死，契约由
 * BioanalysDesktop/tests/portal_archive.test.js 固化（改这里必须先让那边红）。
 *
 * 白名单与体积上限的默认值统一来自仓库根 shared/data_formats.mjs（S30 /
 * 架构评审 2.3 A8），本模块只做提交台侧适配（环境变量覆盖）并保留既有导出名；
 * 其余约定（角色枚举、包名、校验规则）仍只在本模块。
 */

import {
  DATA_EXT as SHARED_DATA_EXT,
  MAX_DATA_BYTES as SHARED_MAX_DATA_BYTES,
  extOf,
} from '../../shared/data_formats.mjs';

/** 数据文件角色枚举：三类必需文件 + 平台注解 + 兜底 */
export const DATA_ROLES = [
  'train_matrix', 'val_matrix', 'sample_sheet', 'group_map',
  'platform_annotation', 'other',
];

/**
 * 扩展名白名单：常见生信输入；可执行与脚本一律拒绝。
 * 唯一权威在 shared/data_formats.mjs（两端并集，14 项）；这里 re-export 既有导出名，
 * 既有 import 方（portal/serve.mjs、tests）不受影响。
 */
export const DATA_EXT = SHARED_DATA_EXT;

/**
 * 单文件体积上限（字节）。2026-10-20 用户拍板 5 GiB；依据：单细胞/空间 RAW tar
 * 常见 1–3GB，IS 项目 line3 原始包实测 1.89GB（con_hf/handoff.md 有记录）。
 * 默认值（5 GiB）的唯一来源是 shared/data_formats.mjs 的 MAX_DATA_BYTES；
 * 可用环境变量 PORTAL_MAX_DATA_BYTES（字节数）覆盖，仅为让超限负路径可被真测，
 * 默认行为不变；validateDataFiles 与 serve.mjs 均 import 本常量，覆盖后两端同步生效。
 */
export const MAX_DATA_BYTES = Number(process.env.PORTAL_MAX_DATA_BYTES) > 0
  ? Number(process.env.PORTAL_MAX_DATA_BYTES)
  : SHARED_MAX_DATA_BYTES;

/** 同一角色允许的文件数：仅约束 other 角色；其余角色由 validateDataFiles 硬编码为每角色 1 个 */
export const MAX_DATA_FILES_PER_ROLE = 5;

/** 取 basename：吃掉路径分隔，`../../etc/passwd` → `passwd` */
function basename(name) {
  return String(name ?? '').split(/[\\/]+/).pop();
}

/**
 * 文件名安全化：保留扩展名、剔除路径分隔与危险字符。
 * 只做字符白名单，不做 basename 截断——调用方需要全名时（如包名）另见 buildPackageName。
 */
export function sanitizeFileName(name) {
  const base = basename(name) || '';
  const cleaned = base
    .replace(/\s+/g, '_')
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 120);
  return cleaned || 'file';
}

/**
 * 包目录名：`PKG_<时间戳>_<项目名>`。
 * 项目名里的路径分隔要换成下划线而不是截断（`银屑病皮损分期/演进` 必须保留前段），
 * 否则用户看不出这是哪个项目的包。空项目名用 requirement 兜底。
 */
export function buildPackageName(timestamp, projectName) {
  const safe = String(projectName ?? '')
    .replace(/[\\/]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 60) || 'requirement';
  return `PKG_${timestamp}_${safe}`;
}

/** 参考文献归档名：两位序号前缀 + 原名（序号让人工核对顺序，原名便于人工辨认） */
export function refArchiveName(index, originalName) {
  return `${String(Number(index) + 1).padStart(2, '0')}_${sanitizeFileName(originalName)}`;
}

/** 数据文件归档名：`<角色>__<绑定编号>__<原名>`；无绑定编号时只留角色与原名 */
export function dataArchiveName(role, bind, originalName) {
  const parts = [
    String(role || 'other'),
    sanitizeFileName(bind || ''),
    sanitizeFileName(originalName),
  ].filter((part) => part && part !== 'file');
  return parts.join('__');
}

/**
 * 数据文件校验：返回 `{ok, errors[]}`，不抛错（调用方决定怎么呈现）。
 *
 * 规则分三层：
 *   1. 通用：角色合法、文件名非空、扩展名白名单、体积上限、同角色不重复；
 *   2. IN_HOUSE_UPLOAD（自有上传）：上传文件名必须与用户在需求里填写的文件名
 *      （basename 比对，允许用户填相对路径）一致；
 *   3. PUBLIC_DB（公共库）：绑定编号必须是需求里已填写的 GSE；train_matrix 必须绑
 *      训练集、val_matrix 必须绑验证集；sample_sheet / group_map / platform_annotation
 *      可不绑编号；文件名里出现的 GSE 编号必须与绑定编号一致（防止张冠李戴）。
 */
export function validateDataFiles(files, payload) {
  const errors = [];
  const list = Array.isArray(files) ? files : [];
  const dataSource = (payload && payload.dataSource) || {};
  const mode = String(dataSource.data_source_mode || '');
  const datasets = Array.isArray(dataSource.datasets) ? dataSource.datasets : [];
  const uploaded = (mode === 'IN_HOUSE_UPLOAD' && dataSource.uploaded_files) || {};
  const trainGse = String((datasets.find((d) => d && d.role === 'train') || {}).gse || '');
  const valGses = datasets.filter((d) => d && d.role === 'validation').map((d) => String(d.gse || ''));
  const perRole = new Map();

  for (let i = 0; i < list.length; i += 1) {
    const file = list[i] || {};
    const role = String(file.role || '');
    const name = String(file.name || '');
    const bind = String(file.bind || '');
    const size = Number(file.size) || 0;
    const label = `第 ${i + 1} 个文件（${name || '未命名'}）`;

    if (!DATA_ROLES.includes(role)) {
      errors.push(`${label} 角色非法: ${role || '(空)'}（允许 ${DATA_ROLES.join(' / ')}）`);
      continue;
    }
    if (!name) { errors.push(`${label} 缺少文件名`); continue; }
    if (!DATA_EXT.includes(extOf(name))) {
      errors.push(`${label} 扩展名不在白名单: ${name}（允许 ${DATA_EXT.join(' / ')}）`);
      continue;
    }
    if (size > MAX_DATA_BYTES) {
      errors.push(`${label} 体积 ${size} 字节超过单文件上限 ${MAX_DATA_BYTES}`);
      continue;
    }

    perRole.set(role, (perRole.get(role) || 0) + 1);
    if (role !== 'other' && perRole.get(role) > 1) {
      errors.push(`${label} 角色 ${role} 只允许一个文件（已收到 ${perRole.get(role)} 个）`);
      continue;
    }
    if (role === 'other' && perRole.get(role) > MAX_DATA_FILES_PER_ROLE) {
      errors.push(`${label} other 角色最多 ${MAX_DATA_FILES_PER_ROLE} 个文件`);
      continue;
    }

    if (mode === 'IN_HOUSE_UPLOAD') {
      const filled = uploaded[role];
      if (!filled) {
        errors.push(role === 'val_matrix'
          ? `${label} 需求未填写验证集矩阵（val_matrix）`
          : `${label} 需求未填写该角色的文件名（${role}）`);
        continue;
      }
      if (basename(filled) !== basename(name)) {
        errors.push(`${label} 与填写的矩阵文件名 ${filled} 不一致`);
        continue;
      }
      continue;
    }

    if (mode === 'PUBLIC_DB') {
      // train / val 必须绑定到对应角色的数据集
      if (role === 'train_matrix' || role === 'val_matrix') {
        if (!bind) {
          errors.push(`${label} ${role} 必须绑定数据集编号（GSE）`);
          continue;
        }
        if (!datasets.some((d) => String((d || {}).gse || '') === bind)) {
          errors.push(`${label} 绑定编号 ${bind} 不在需求填写的数据集列表里`);
          continue;
        }
        if (role === 'train_matrix' && bind !== trainGse) {
          errors.push(`${label} 绑定编号 ${bind} 不是训练集（训练集为 ${trainGse || '未填写'}）`);
          continue;
        }
        if (role === 'val_matrix' && !valGses.includes(bind)) {
          errors.push(`${label} 绑定编号 ${bind} 不是验证集`);
          continue;
        }
      } else if (bind && !datasets.some((d) => String((d || {}).gse || '') === bind)) {
        errors.push(`${label} 绑定编号 ${bind} 不在需求填写的数据集列表里`);
        continue;
      }
      // 文件名里出现的 GSE 编号必须与绑定编号一致（未绑编号的角色不查，如 GPL 注解）
      if (bind) {
        const tokens = name.match(/(GSE|GPL)\d+/gi) || [];
        const bad = tokens.find((t) => t.toUpperCase() !== bind.toUpperCase());
        if (bad) {
          errors.push(`${label} 文件名中的 ${bad} 与绑定编号 ${bind} 不一致`);
          continue;
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 包计划：给出包目录名、需求/清单落点、每个参考文献与数据文件的归档落点。
 * 只算路径、不碰磁盘——落盘由调用方（serve.mjs）执行，便于测试。
 */
export function buildPackagePlan({
  payload = {}, sid = '', timestamp, projectName, references = [], dataFiles = [],
} = {}) {
  const pkgName = String(projectName || (payload && payload.basicInfo && payload.basicInfo.name) || '');
  const packageDir = buildPackageName(timestamp, pkgName);

  const refs = (Array.isArray(references) ? references : []).map((ref, index) => {
    const archiveName = refArchiveName(index, ref && ref.name);
    return {
      from: `refs/${sid}/${sanitizeFileName(ref && ref.name)}`,
      to: `${packageDir}/references/${archiveName}`,
      archiveName,
      originalName: (ref && ref.name) || '',
      size: Number((ref && ref.size) || 0),
    };
  });

  const used = new Set();
  const files = (Array.isArray(dataFiles) ? dataFiles : []).map((file) => {
    const wanted = dataArchiveName(file && file.role, file && file.bind, file && file.name);
    // 同名文件不互相覆盖：追加 _2 / _3 …
    let archiveName = wanted;
    let n = 2;
    while (used.has(archiveName)) {
      const dot = wanted.lastIndexOf('.');
      archiveName = dot >= 0 ? `${wanted.slice(0, dot)}_${n}${wanted.slice(dot)}` : `${wanted}_${n}`;
      n += 1;
    }
    used.add(archiveName);
    return {
      role: (file && file.role) || '',
      bind: (file && file.bind) || '',
      original_name: (file && file.name) || '',
      archive_name: archiveName,
      size: Number((file && file.size) || 0),
      from: (file && file.path) || '',
      to: `${packageDir}/raw_data/${archiveName}`,
    };
  });

  return {
    packageDir,
    sid,
    timestamp,
    requirementPath: `${packageDir}/requirement.json`,
    manifestPath: `${packageDir}/package_manifest.json`,
    references: refs,
    dataFiles: files,
  };
}
