/** 台账解析测试桩：返回测试用例写入 globalThis.__LEDGER_FIXTURE__ 的批量输出。 */
export function runRemote() {
  return String(globalThis.__LEDGER_FIXTURE__ || '');
}
