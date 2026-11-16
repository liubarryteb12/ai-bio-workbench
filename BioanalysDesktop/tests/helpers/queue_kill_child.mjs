/**
 * T3.6 验收辅助：在真实子进程里执行工单，runner 永不返回，
 * 由父进程在确认 running 后 kill，模拟服务进程在执行中途被杀。
 *
 * 用法：node queue_kill_child.mjs <baseDir> <workOrderId>
 */
import process from 'node:process';

const [baseDir, workOrderId] = process.argv.slice(2);
if (!baseDir || !workOrderId) {
  console.error('用法：node queue_kill_child.mjs <baseDir> <workOrderId>');
  process.exit(2);
}

const { executeWorkOrderById } = await import(
  new URL('../../server/services/work_order.service.js', import.meta.url).href
);

// 纯 pending Promise 不 удерж事件循环，Node 会以 unsettled top-level await
// 直接退出（code 13）。真实服务进程总有常驻句柄，这里用定时器模拟。
const running = executeWorkOrderById(workOrderId, baseDir, {
  runWorkOrderFn: () => new Promise(() => {}),
});
setInterval(() => {}, 1000);
await running;
