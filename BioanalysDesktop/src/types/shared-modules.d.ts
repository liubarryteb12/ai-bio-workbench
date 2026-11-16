/**
 * 共享传输层与 Uppy 6 的类型桥接。
 *
 * chunkUpload.mjs 是 Node 与浏览器共用的纯 ESM 实现，靠契约测试钉行为；
 * 这里只声明消费方用到的形状，字段漂移由 tests/upload_session_contract.test.js 拦截。
 */
declare module '../lib/chunkUpload.mjs' {
  export const DEFAULT_CHUNK_SIZE: number;
  export function uploadInChunks(options: {
    file: File;
    project: string;
    lineId: string;
    fetchImpl?: typeof fetch;
    onProgress?: (percent: number, detail?: { sentChunks: number; totalChunks: number; resumedFrom: number }) => void;
    signal?: AbortSignal | null;
  }): Promise<{
    uploadId: string;
    resumedFrom: number;
    totalChunks: number;
    result: Record<string, unknown>;
  }>;
}
