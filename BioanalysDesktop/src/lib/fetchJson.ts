/**
 * 统一 JSON 请求口（T0-5 / T3-3）。
 *
 * 为什么单独成模块：src 下 40 处 fetch 有 21 处不看 res.ok，非 200 时把
 * {error} 当成正常载荷塞进 state，渲染期再抛 TypeError，整页白屏。
 * 这里把「判状态码 -> 解析错误体 -> 抛带 status 的 Error」收成一个出口，
 * 调用方只剩成功路径的写法，失败路径统一走 catch。
 *
 * 类型参数是"成功响应的形状"，不是运行时保证：契约漂移仍由 ErrorBoundary 兜底。
 */

/** 带 HTTP 状态码的请求错误；message 里已经拼好可直接展示的中文句子 */
export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  /** 服务端错误体里的 error 字段（没有就空串）；只用于展示，不进日志的敏感字段 */
  readonly detail: string;
  /** 已解析的响应体（JSON 对象或原始文本），排查时用 */
  readonly body: unknown;

  constructor(message: string, options: { status: number; url: string; detail?: string; body?: unknown }) {
    super(message);
    this.name = 'HttpError';
    this.status = options.status;
    this.url = options.url;
    this.detail = options.detail ?? '';
    this.body = options.body;
  }
}

/** 从任意响应体里取人可读的错误说明；取不到返回空串 */
export function errorDetail(body: unknown): string {
  if (typeof body === 'string') return body.trim();
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['error', 'detail', 'message', 'reason']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return '';
}

/** 读响应体：先按文本读，再尝试 JSON；空体给 null。不因解析失败而丢状态码 */
async function readBody(response: Response): Promise<unknown> {
  let text = '';
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * 发一个请求并要求成功。成功返回已解析的 JSON（T），失败抛 HttpError。
 *
 * 失败文案固定形如 `HTTP 500 服务端暂时不可用`：状态码永远在，
 * 服务端给了 reason 就接在后面，没给就只有状态码。UI 直接展示 message 即可。
 */
export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = await readBody(response);
  if (!response.ok) {
    const detail = errorDetail(body);
    const message = detail ? `HTTP ${response.status} ${detail}` : `HTTP ${response.status}`;
    throw new HttpError(message, { status: response.status, url: String(input), detail, body });
  }
  return body as T;
}

/**
 * 只要状态不要体（中止任务、派发这类"失败也不带载荷"的调用）。
 * 非 2xx 同样抛 HttpError，让调用方按 status 分流 404（任务已结束）这类语义。
 */
export async function fetchOk(input: string, init?: RequestInit): Promise<void> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const body = await readBody(response);
    const detail = errorDetail(body);
    const message = detail ? `HTTP ${response.status} ${detail}` : `HTTP ${response.status}`;
    throw new HttpError(message, { status: response.status, url: String(input), detail, body });
  }
}

/** 只在确实是 HttpError 时取状态码，其余（断网、中止）返回 null */
export function httpStatusOf(cause: unknown): number | null {
  return cause instanceof HttpError ? cause.status : null;
}

/** 统一把未知异常转成可展示文案 */
export function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
