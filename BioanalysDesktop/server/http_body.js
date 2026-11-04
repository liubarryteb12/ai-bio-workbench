/**
 * 请求体收集闸门（T3-7）：JSON 入口的字节上限与 413 出口。
 *
 * 存在的理由：server/ 下 12 处 JSON 入口原本把请求体无上限累积成字符串再
 * JSON.parse（形如 req.on('data', (chunk) => { body += chunk; })）。任何能连到
 * 监听端口的本地进程发一个无限 body 就能把服务进程的内存打爆，属 DoS。
 * 上限判定必须落在 data 事件里：等 end 之后再看长度，内存已经打爆了，
 * 那时候查出来的数字只是验尸报告。
 *
 * 分片上传链路（/api/upload/chunk）不在此列：它是 raw 二进制进 Buffer 数组，
 * 已有会话预留额度做 413 硬闸门，形态与预算都不同，保持原样。
 */

/**
 * JSON 配置类端点的请求体上限：1MB。
 *
 * 真源只有这一处：各路由引用常量而不写裸数字，「哪个端点多宽」才是可查的事实。
 * 取值依据是这些端点的合法请求形态：建项 manifest、图件勾选、任务参数都是
 * KB 量级 JSON，1MB 留出百倍余量，同时把攻击面可分配的内存钉死在常数上。
 */
export const JSON_BODY_LIMIT = 1024 * 1024;

/**
 * 回完 413 之后留给客户端读走响应的时间（毫秒）。
 *
 * 超限连接不能立刻 req.destroy()：'finish' 只说明字节已交给操作系统，不说明对端
 * 收到过。实测立刻断连会让客户端只拿到 ECONNRESET/timeout，看不到「你的 body 太大」
 * 这个事实，排查方向整个跑偏。留一个短窗口让它 flush 干净，窗口一到就断开，
 * 免得赖着不走的客户端长期占住连接。
 */
const OVER_LIMIT_RELEASE_MS = 250;

/**
 * 收集 JSON 请求体，超限即回 413 并交回 null。
 *
 * @param {import('node:http').IncomingMessage} req 请求流（测试里伪造 EventEmitter 也可，只要发 data/end）
 * @param {import('node:http').ServerResponse} res 超限时的 413 出口
 * @param {Function} json 响应出口，由调用方注入（形状口径在 http_response.js）
 * @param {{ maxBytes: number }} options 上限；正整数，非法即抛错
 * @returns {Promise<string|null>} 正文原文；null 表示「已短路，调用方直接 return」
 *
 * null 的三种来路（调用方一律以 null 短路，绝不继续 JSON.parse）：
 *   1. 超过 maxBytes：本函数已回出 413；
 *   2. 客户端中途断开：连接已没了，回什么都没意义；
 *   3. 收集出错（流 error 事件）。
 * 拿到 null 之后再写第二个响应会抛 ERR_HTTP_HEADERS_SENT 打死进程，所以短路是硬要求。
 */
export function collectJsonBody(req, res, json, options) {
  const maxBytes = options ? options.maxBytes : undefined;
  // 上限非法就地抛错：静默换一套默认上限等于悄悄关掉闸门，且让「哪个端点多宽」失去真源。
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('collectJsonBody 需要正整数 maxBytes（引用 JSON_BODY_LIMIT 之类的命名常量），收到: ' + String(maxBytes));
  }
  return new Promise((resolve) => {
    const chunks = [];
    let receivedBytes = 0;
    let settled = false;
    // 一次性收尾：413、断开、error 会竞争这一次，settled 保证只有一个赢家
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on('data', (chunk) => {
      if (settled) return; // 已判超限：字节继续被排空丢弃，一个都不缓冲
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      receivedBytes += buf.length;
      if (receivedBytes > maxBytes) {
        chunks.length = 0; // 丢弃已缓冲的字节：内存防线在这里，不在 end 之后
        json(res, 413, { error: '请求体超过上限 ' + maxBytes + ' 字节' });
        // 断连延后一个短窗口，让 413 先被客户端读走（见 OVER_LIMIT_RELEASE_MS 的理由）。
        // 窗口到点就断开：客户端「发完超限字节就静音」不能长期占住连接与服务端句柄。
        const release = setTimeout(() => {
          if (typeof req.destroy === 'function') { try { req.destroy(); } catch { /* 连接已经没了 */ } }
        }, OVER_LIMIT_RELEASE_MS);
        if (typeof release.unref === 'function') release.unref();
        finish(null);
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      // 按字节缓冲、整体解码：逐 chunk 强转会破坏跨 chunk 的多字节 UTF-8 字符
      finish(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => finish(null));
    req.on('aborted', () => finish(null));
    // 客户端半截断开不会触发 end：close 兜底，否则这个 Promise 永远悬着，
    // 处理体连同它的闭包留在内存里（真实场景是断点续传客户端直接跑掉）。
    // 伪造的 req（无 once 能力）跳过：兜底路径不该成为使用约束。
    if (typeof req.once === 'function') req.once('close', () => finish(null));
  });
}

/**
 * 驱动一个 JSON 请求处理体，把抛错收敛成 500。
 *
 * 为什么需要它：处理体改成 await collectJsonBody(...) 之后就是异步的，
 * 原来包在 req.on('end') 外面的同步 try/catch 罩不住它，抛错会变成
 * unhandled rejection 打死服务进程（一次崩溃把所有在跑任务与 SSE 连接一起带走）。
 * 这里统一收敛，并守住「一个请求只回一个响应」：已经写出响应就不再补 500。
 *
 * 调用方不 await 本函数的返回值：派发约定是「命中即 return true」，响应稍后再回，
 * 与改造前 req.on('end', ...) 的时序一致。
 *
 * @param {() => Promise<void>} run 处理体
 * @param {import('node:http').ServerResponse} res
 * @param {Function} json
 */
export async function runJsonRoute(run, res, json) {
  try {
    await run();
  } catch (cause) {
    if (res && (res.headersSent || res.writableEnded)) return;
    const message = cause instanceof Error ? cause.message : String(cause);
    json(res, 500, { error: '请求处理失败: ' + message });
  }
}
