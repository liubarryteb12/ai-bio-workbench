/**
 * 非肿瘤 / 非免疫浸润正则黑名单校验
 *
 * aims v2.5 铁律 1：非肿瘤、非免疫浸润专精原则。
 * 前端实时拦截 + 后端建项前再校验（双保险）。
 * 命中时返回违规词列表，调用方拒绝建项。
 *
 * 规格正本：aims/aims.txt §三.1 模块 A「黑名单确认清单」，共 20 条
 * （2026-10-21 二次裁定：以 aims 为准，吸纳实现侧 27 条中可用的 12 条，
 * 剔除 8 条被父词覆盖的冗余项）。本文件与 aims 清单逐条同序，
 * 增删规则必须同时改 aims 清单与本文件，不允许任一侧单方面漂移。
 *
 * 沿革（不要重演）：本数组曾自行扩充到 27 条 -> 2026-10-21 收敛回 8 条
 * -> 同日二次裁定吸纳 12 条可用项后定为 20 条。判据是「明确肿瘤/免疫浸润
 * 语义 + 不被父词覆盖 + 误伤可接受」，不是「实现方觉得该拦」。
 */

/**
 * 黑名单正则：中英文肿瘤/免疫浸润关键词，共 20 条，与 aims 清单逐条同序。
 * 导出仅供 tests/tumor_blacklist.test.js 与 tumor_blacklist_parity.test.js 锁定口径
 * （条数与逐条正则），业务代码请走 checkTumorBlacklist / validateProjectFields。
 *
 * PD-L1 / PD-1 两条刻意加左右边界：原实现的 /PD-?L?1/i 会把 GPD1、SLC40A1
 * 这类基因符号当成 PD1 命中（2026-10-21 实测），属于把非肿瘤项目误拦的真误伤。
 */
export const BLACKLIST_PATTERNS = [
  /cancer/i,
  /tumor/i,
  /tumour/i,
  /carcinoma/i,
  /glioma/i,
  /sarcoma/i,
  /lymphoma/i,
  /leukemia/i,
  /leukaemia/i,
  /melanoma/i,
  /immune\s*infiltration/i,
  /immune\s*checkpoint/i,
  /(?<![A-Za-z0-9])PD-?L1(?![0-9])/i,
  /(?<![A-Za-z0-9])PD-?1(?![0-9])/i,
  /CTLA-?4/i,
  /oncogene/i,
  /肿瘤/,
  /癌/,
  /免疫浸润/,
  /免疫检查点/,
];

/** 匹配后的友好提示 */
export const BLACKLIST_HINT =
  '本平台专精非肿瘤领域（心脑血管、神经退行、代谢、纤维化、发育等），' +
  '不接收肿瘤/免疫浸润相关项目。';

/**
 * 扫描文本是否含黑名单词。
 * @param {string} text 待校验文本
 * @returns {{hit: boolean, matches: string[]}} hit=true 时 matches 列出命中的原始词
 */
export function checkTumorBlacklist(text) {
  const input = String(text || '');
  if (!input.trim()) return { hit: false, matches: [] };
  const matches = [];
  for (const pattern of BLACKLIST_PATTERNS) {
    const found = input.match(pattern);
    if (found) matches.push(found[0]);
  }
  return { hit: matches.length > 0, matches: [...new Set(matches)] };
}

/**
 * 校验建项请求的全部文本字段（名称、描述、疾病名、组织来源、客户备注、
 * 分组名、关注基因等）。任一字段命中即拒绝。
 *
 * keys 只列"固定语义字段"作为保底；调用方传入的其余 key（group_* / focus_gene_*）
 * 一律全量扫描。此前这里把 keys 当成唯一扫描范围，导致分组名与关注基因
 * 虽然被调用方塞进 fields 却从未真正过检（字段白名单硬编码的经典坑，
 * 见 con_hf/踩坑台账.md #153）。
 * @param {object} fields
 * @returns {{hit: boolean, matches: string[], field: string|null}}
 */
export function validateProjectFields(fields) {
  // fields 允许缺省或非对象：正常调用方总会传对象，但这里不该成为崩溃点
  const source = fields && typeof fields === 'object' ? fields : {};
  const keys = ['name', 'description', 'disease', 'tissue', 'notes'];
  const allKeys = [...new Set([...keys, ...Object.keys(source)])];
  for (const key of allKeys) {
    const val = source[key];
    if (!val) continue;
    const result = checkTumorBlacklist(val);
    if (result.hit) {
      return { ...result, field: key };
    }
  }
  return { hit: false, matches: [], field: null };
}
