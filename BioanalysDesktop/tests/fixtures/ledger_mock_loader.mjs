/**
 * 台账解析测试的模块加载钩子：只把 ledger_fetch.js 的 ./remote_exec.js
 * 换成读取 globalThis.__LEDGER_FIXTURE__ 的桩，不影响其他模块。
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === './remote_exec.js'
    && String(context.parentURL || '').includes('/server/ledger_fetch.js')) {
    return {
      url: new URL('./remote_exec_stub.js', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
