/**
 * 机器回执与生信报错“人话”翻译器 (BioanalysDesktop/server/services/error_translator.js)
 * 用于将 receipt.v1.json 中的底层错误码、退出码与异常特征，
 * 翻译为外网普通客户能直接看懂的中文业务解释与自检建议。
 */

export const HUMAN_ERROR_MAP = {
  // 1. 输入数据阶段
  ERR_INPUT_FILE: '上传的样本数据格式不符合规范或表头损坏，请核对是否包含样本名称与有效数值。',
  ERR_EMPTY_INPUT: '上传的文件体积为 0 或内容为空，请重新上传测序表达矩阵。',
  ERR_TUMOR_BLACKLIST: '样本名称命中已知肿瘤黑名单，根据合规与伦理约束已被自动拦截。',
  ERR_SAMPLE_COUNT_TOO_LOW: '有效样本数量过少（少于最低统计阈值），无法执行分组差异分析。',

  // 2. 算力与通道阶段
  ERR_ADB_OFFLINE: '后台物理算力计算通道离线，系统正在尝试自动重连，请稍候刷新。',
  ERR_MEMORY_GUARD: '本次样本规模超出了单机 ARM 计算节点的临时内存上限（生产默认 7.5GB，单任务最高 8GB），已触发主动保护熔断。',
  ERR_MEMORY_HEADROOM: '当前算力节点的可用内存不足，任务已在启动前被安全拦截。请关闭后台应用或稍后重试。',
  ERR_TIMEOUT: '算力节点计算超时（超过了预设的最大安全等待时间），请联系工程师评估数据集规模。',

  // 3. 算法计算阶段
  ERR_DESEQ2_FIT: '负二项广义线性模型拟合未收敛，通常是由于样本内存在极端离群值或分组方差过大。',
  ERR_HARMONY_CONVERGENCE: '单细胞批次整合在指定最大迭代步数内未收敛，请检查批次标签是否混杂。',
  ERR_LOW_COVERAGE: '有效检测到的基因/UMI 总数过低，未通过单细胞严格质控门禁。',

  // 4. 交付与验收阶段
  ERR_DELIVERY_UNVERIFIED: '最终分析图件未通过 300DPI 分辨率或 SHA256 哈希防伪验收，系统拒绝交付半成品。',
  ERR_ADMIN_REVIEW_REQUIRED: '由于检测到边界数据指标，本工单已自动转入后台专家人工核验通道，请耐心等待放行。',
};

export function translateErrorToHuman(receiptError) {
  if (!receiptError) return null;

  const code = receiptError.code || receiptError.failure_stage || '';
  if (HUMAN_ERROR_MAP[code]) {
    return HUMAN_ERROR_MAP[code];
  }

  // 模糊匹配特征
  const msg = String(receiptError.message || receiptError.detail || '');
  if (msg.includes('INSUFFICIENT_MEMORY_HEADROOM')) {
    return HUMAN_ERROR_MAP.ERR_MEMORY_HEADROOM;
  }
  if (msg.includes('OutOfMemory') || msg.includes('OOM') || msg.includes('memory limit')) {
    return HUMAN_ERROR_MAP.ERR_MEMORY_GUARD;
  }
  if (msg.includes('device offline') || msg.includes('adb')) {
    return HUMAN_ERROR_MAP.ERR_ADB_OFFLINE;
  }

  return receiptError.message || '系统在执行生信计算时遇到异常阻断，已自动安全停机并记录审计快照。';
}
