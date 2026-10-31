const logSinks = new Map();

function createSink(taskId, write) {
  if (!logSinks.has(taskId)) logSinks.set(taskId, new Set());
  logSinks.get(taskId).add(write);
  return write;
}

function dropSink(taskId, sink) {
  const sinks = logSinks.get(taskId);
  if (!sinks) return;
  sinks.delete(sink);
  if (sinks.size === 0) logSinks.delete(taskId);
}

/** 把一个 SSE 事件推给该任务的所有订阅者 */
function sendEvent(taskId, event, data) {
  const sinks = logSinks.get(taskId);
  if (!sinks || sinks.size === 0) return;
  // data 里可能有换行，SSE 要求按行拆成多个 data: 字段
  const payload = String(data)
    .split(/\r?\n/)
    .map((line) => `data: ${line}`)
    .join('\n');
  for (const sink of sinks) {
    try {
      sink(`event: ${event}\n${payload}\n\n`);
    } catch {
      // 单个订阅者写失败（连接已断）不影响其他订阅者
    }
  }
}

function closeSink(taskId) {
  logSinks.delete(taskId);
}

export { createSink, dropSink, sendEvent, closeSink };
