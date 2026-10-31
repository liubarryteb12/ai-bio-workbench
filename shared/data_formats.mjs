/**
 * shared/data_formats.mjs — 数据文件格式白名单的唯一权威（S30 / 架构评审 2.3 A8）
 *
 * 为什么要有这个文件：
 *   同一份数据有两个入口：18787 工作台（BioanalysDesktop/server/upload.js 的
 *   ALLOWED_EXT）与 8080 用户提交台（portal/lib/archive.mjs 的 DATA_EXT）。
 *   两边原来各持一份字面量（14 项 / 9 项），同一份数据走两个入口会得到不同
 *   校验结论。本模块把白名单收敛为单一事实源：两端都 import 这里，只此一份。
 *
 * 两端如何引用（都用相对模块文件路径，与进程 cwd 无关）：
 *   - 工作台：BioanalysDesktop/server/upload.js
 *       import { DATA_EXT, extOf, isAllowedDataFile } from '../../shared/data_formats.mjs';
 *   - 提交台：portal/lib/archive.mjs
 *       import { DATA_EXT, MAX_DATA_BYTES, extOf } from '../../shared/data_formats.mjs';
 *
 * 为什么 portal/index.html 只能是副本：
 *   index.html 是浏览器里的单文件页面，没有打包步骤（不经 vite/webpack），
 *   浏览器的 inline script 无法 import 这个 ESM 文件，所以必须把 DATA_EXT
 *   字面量抄一份。防漂移由 BioanalysDesktop/tests/data_format_parity.test.js
 *   把守：该测试读 index.html 文本、正则取出字面量，逐项断言与本文件相等，
 *   改漏一处就红。
 *
 * 零依赖 ESM：不 import 任何模块，可被工作台、提交台与测试直接加载。
 * 改白名单只改本文件，然后同步 portal/index.html 的字面量、accept 属性与提示文案。
 */

/** 数据文件扩展名白名单（两端并集，顺序固定；改这里必须同步 portal/index.html） */
export const DATA_EXT = [
  '.h5ad', '.h5', '.loom', '.mtx', '.tar', '.gz', '.zip',
  '.txt', '.tsv', '.csv', '.soft', '.xlsx', '.rds', '.rdata',
];

/**
 * 单文件体积上限（字节）：5 GiB，与 portal/lib/archive.mjs 现行默认值一致
 * （2026-10-20 用户拍板；单细胞/空间 RAW tar 常见 1-3GB）。
 * 本常量是"默认值"的唯一来源，不读环境变量；提交台仍可用
 * PORTAL_MAX_DATA_BYTES 覆盖（见 portal/lib/archive.mjs）。
 */
export const MAX_DATA_BYTES = 5 * 1024 * 1024 * 1024;

/** 取 basename：吃掉路径分隔，`../../etc/passwd` → `passwd` */
function basename(name) {
  return String(name ?? '').split(/[\\/]+/).pop();
}

/** 取小写扩展名（`.tar.gz` 这类双扩展名取最后一段；无点返回空串） */
export function extOf(name) {
  const base = basename(name);
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * 文件名扩展名是否在白名单内。
 *
 * 与工作台旧实现 `ALLOWED_EXT.some((e) => lower.endsWith(e))` 同口径：
 * 白名单项都以 '.' 开头且自身不含第二个点，因此"以某项结尾"等价于
 * "最后一段扩展名等于该项"（两边都先转小写）。双扩展名如 .mtx.gz / .tar.gz
 * 取最后一段 .gz，仍在白名单内。
 */
export function isAllowedDataFile(name) {
  return DATA_EXT.includes(extOf(name));
}
