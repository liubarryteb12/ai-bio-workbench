/**
 * 非肿瘤 / 非免疫浸润正则黑名单校验
 *
 * aims v2.3 铁律 1：非肿瘤、非免疫浸润专精原则。
 * 前端实时拦截 + 后端建项前再校验（双保险）。
 * 命中时返回违规词列表，调用方拒绝建项。
 */

/** 黑名单正则：中英文肿瘤/免疫浸润关键词 */
const BLACKLIST_PATTERNS = [
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
  /adenocarcinoma/i,
  /squamous\s*cell\s*carcinoma/i,
  /immune\s*infiltration/i,
  /tumor\s*microenvironment/i,
  /tumour\s*microenvironment/i,
  /immune\s*checkpoint/i,
  /PD-?L?1/i,
  /CTLA-?4/i,
  /oncogene/i,
  /tumor\s*suppressor/i,
  /癌症/i,
  /肿瘤/i,
  /癌/i,
  /免疫浸润/i,
  /免疫检查点/i,
  /肿瘤微环境/i,
  /癌细胞/i,
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
  const keys = ['name', 'description', 'disease', 'tissue', 'notes'];
  const allKeys = [...new Set([...keys, ...Object.keys(fields || {})])];
  for (const key of allKeys) {
    const val = fields[key];
    if (!val) continue;
    const result = checkTumorBlacklist(val);
    if (result.hit) {
      return { ...result, field: key };
    }
  }
  return { hit: false, matches: [], field: null };
}
