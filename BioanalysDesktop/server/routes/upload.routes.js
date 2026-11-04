// 数据导入路由：分片上传的 init / chunk / status / complete 四步。
//
// 从 server/index.js 逐字搬来，处理体未做改写。json、uploadError、runRemote 由 index.js
// 注入而不是在这里重复定义，理由是这三个辅助函数在 index.js 的其它路由里仍在用，
// 复制一份会造出两个真源（改一处漏一处）。
//
// 返回约定：命中本模块管辖的 pathname 就返回 true（含"已交给 runJsonRoute 异步处理、
// 稍后才回响应"的情形，T3-7 起），未命中返回 false 让 index.js 继续往下派发。
// json() 与 uploadError() 都返回 undefined，所以绝不能拿它们的返回值当命中信号，
// 必须显式 return true。
import fs from 'node:fs';

import { LINES, DEFAULT_PROJECT, sanitizeProjectId } from '../domain.js';
import { runAsync, runSshAsync, scpArgv, shellQuote } from '../proc.js';
import {
  CHUNK_SIZE, initUpload, writeChunk, listChunks, assembleChunks,
  readHeader, validateUpload, remoteRawPath, cleanupUpload, sanitizeFilename,
  uploadStatus, resolveUploadId, maybeGcStaleUploads, normalizeReservedBytes,
  checkChunkAdmission, writeSessionMeta, clearSessionMeta,
} from '../upload.js';
import { collectJsonBody, runJsonRoute, JSON_BODY_LIMIT } from '../http_body.js';

export async function handleUploadRoutes(req, res, url, { json, uploadError, runRemote }) {
  if (url.pathname === '/api/upload/init' && req.method === 'POST') {
    // 数据导入第 1 步：创建上传会话（强制归属线）
    runJsonRoute(async () => {
      // T3-7：请求体上限闸门。超限时 collectJsonBody 已回出 413 并交回 null，
      // 这里必须短路：再写第二个响应会抛 ERR_HTTP_HEADERS_SENT 打死进程。
      const body = await collectJsonBody(req, res, json, { maxBytes: JSON_BODY_LIMIT });
      if (body === null) return;
      let requested;
      try {
        requested = JSON.parse(body || '{}');
      } catch (cause) {
        return uploadError(res, 400, `请求体不是合法 JSON: ${cause.message}`);
      }
      const lineId = requested.lineId;
      if (!LINES.includes(lineId)) {
        return uploadError(res, 400, `必须指定归属线，且只能是 ${LINES.join(' / ')}`);
      }
      const projectId = sanitizeProjectId(requested.projectId || DEFAULT_PROJECT);
      if (!projectId) {
        return uploadError(res, 400, `projectId 非法（只允许字母数字 . _ -）: ${requested.projectId}`);
      }
      const safe = sanitizeFilename(requested.filename);
      if (!safe) {
        return uploadError(res, 400, `文件名非法或含路径穿越: ${requested.filename}`);
      }
      // 确定性 id：客户端带指纹（project|lineId|name|size|lastModified 的纯函数派生）时，
      // 前后端算出同一个 id，刷新或换浏览器都能接着传；不带指纹则回落 randomUUID，
      // 老客户端的 HTTP 契约完全不变（响应里多一个 deterministic 字段，旧调用方会忽略）。
      const resolved = resolveUploadId({
        fingerprint: requested.fingerprint,
        projectId,
        lineId,
        filename: safe,
        size: requested.size,
        lastModified: requested.lastModified,
      });
      if (!resolved.uploadId) {
        return uploadError(res, 400, 'fingerprint 非法：必须是 <=1024 字符的字符串且不含控制字符');
      }
      // 惰性清理陈旧会话：放在参数校验之后、建目录之前。内部节流 10 分钟一次，
      // 且自己吞掉所有异常（清理失败不能连累上传）。
      // task-8 A：清理完若仍超过 .uploads 总量配额（大量「正在传」的会话撑爆磁盘），
      // 直接拒绝新会话，回 507 Payload Too Large：请求本身合法，是服务端存储配额
      // 已耗尽；用 400 会误导用户去改请求参数。配额数字进错误体，前端能直接展示。
      const gcReport = maybeGcStaleUploads();
      if (gcReport && gcReport.overQuota === true) {
        return uploadError(
          res, 507,
          `上传暂存空间已满：当前占用 ${gcReport.totalBytes} 字节，超过配额 ${gcReport.quotaBytes} 字节；`
          + `请等待进行中的上传完成或清理旧会话后重试`
        );
      }
      const uploadId = resolved.uploadId;
      try {
        initUpload(uploadId);
      } catch (cause) {
        return uploadError(res, 500, cause.message);
      }
      // P4：把客户端声明的大小落成会话级预留额度（原子写 session.json），
      // chunk 端据此做 413 硬闸门，挡住「声明 10MB 却传 100GB」。
      // fileSize 缺失或非法时 reservedBytes = null：不硬拦老客户端，只是没有预留额度。
      // 元数据落盘失败也只降级（响应里如实回 null），不能让一次写文件失败把上传挡在门外。
      let reservedBytes = normalizeReservedBytes(requested.fileSize);
      try {
        writeSessionMeta(uploadId, {
          name: safe,
          project: projectId,
          lineId,
          fileSize: reservedBytes,
          reservedBytes,
        });
      } catch (cause) {
        reservedBytes = null;
        console.warn?.(`[bioanalys-desktop] 会话元数据写入失败（降级为无预留额度）: ${cause.message}`);
      }
      return json(res, 200, {
        uploadId, projectId, lineId, filename: safe, chunkSize: CHUNK_SIZE,
        deterministic: resolved.deterministic,
        reservedBytes,
        hint: '按 chunkSize 切分后依次 POST /api/upload/chunk?uploadId=&index=',
      });
    });
    return true;
  }

  if (url.pathname === '/api/upload/chunk' && req.method === 'POST') {
    // 数据导入第 2 步：上传单个分片（原始二进制 body）
    const uploadId = url.searchParams.get('uploadId') || '';
    const index = url.searchParams.get('index') || '';
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > CHUNK_SIZE * 2) { req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      // P4：写盘之前先过两道闸门，顺序固定：
      //   1. 会话预留额度 reservedBytes（超了 413，一个字节都不写）；
      //   2. .uploads 总量配额（超了 507）。
      // 413 必须优先：客户端多报/少报文件大小时，先明确告诉它「本会话额度不够」，
      // 而不是让它去猜是不是全局空间满了（那个它自己修不了）。
      const admission = checkChunkAdmission({ uploadId, index, chunkLength: buf.length });
      if (!admission.ok) return uploadError(res, admission.status, admission.error);
      try {
        writeChunk(uploadId, index, buf);
        return json(res, 200, { ok: true, index: Number(index), received: listChunks(uploadId) });
      } catch (cause) {
        return uploadError(res, 400, cause.message);
      }
    });
    return true;
  }

  if (url.pathname === '/api/upload/status') {
    // 数据导入第 2.5 步：查询已落盘分片，供前端断点续传（S32 / 架构评审 A8-R5）。
    // 向后兼容：uploadId / received 两个既有键原样保留（既有调用方按 received 判空），
    // 本次只增补 exists / chunks / nextIndex / receivedBytes / chunkSize。
    const uploadId = url.searchParams.get('uploadId') || '';
    const status = uploadStatus(uploadId);
    if (status.reason === 'invalid_id') {
      // 缺失或含路径穿越（'..'、分隔符、隐藏名）：400，绝不下探文件系统
      uploadError(res, 400, `uploadId 非法或缺失: ${uploadId}`);
      return true;
    }
    if (!status.ok) {
      // 没传过：HTTP 仍 200（404 会让前端走错误分支），前端据 nextIndex=0 从 0 开始
      json(res, 200, {
        uploadId, received: [], exists: false, chunks: [], nextIndex: 0,
        receivedBytes: 0, chunkSize: CHUNK_SIZE, ok: false, reason: 'not_found',
      });
      return true;
    }
    json(res, 200, {
      ok: true, uploadId, exists: true,
      chunks: status.chunks, nextIndex: status.nextIndex,
      receivedBytes: status.receivedBytes, chunkSize: status.chunkSize,
      received: status.chunks,
    });
    return true;
  }

  if (url.pathname === '/api/upload/complete' && req.method === 'POST') {
    // 数据导入第 3 步：合并 + 格式校验 + scp 到线内 raw_data + 字节校验
    //
    // 这个回调必须是 async（T1.5）：scp 与随后的 stat 探针都改成 await runAsync /
    // runSshAsync。两条 argv 的 timeoutMs 是 900000（15 分钟），同步出口一旦卡住，
    // 主线程会整段停摆，/api/health、SSE 日志流、其它上传全部排在后面。
    // 回调体里抛错不再有同步 try/catch 兜底，末尾统一收敛成 500，避免请求悬挂。
    runJsonRoute(async () => {
      // T3-7：请求体上限闸门。超限时 collectJsonBody 已回出 413 并交回 null，
      // 这里必须短路：再写第二个响应会抛 ERR_HTTP_HEADERS_SENT 打死进程。
      const body = await collectJsonBody(req, res, json, { maxBytes: JSON_BODY_LIMIT });
      if (body === null) return;
      // 异步化之后，抛错不再被同步 try/catch 捕获：这里统一收敛成 500，
      // 避免异常变成未处理的 rejection 让请求一直悬着。
      try {
        let requested;
        try {
          requested = JSON.parse(body || '{}');
        } catch (cause) {
          return uploadError(res, 400, `请求体不是合法 JSON: ${cause.message}`);
        }
        const { uploadId, lineId, filename } = requested;
        if (!LINES.includes(lineId)) {
          return uploadError(res, 400, `lineId 非法: ${lineId}`);
        }
        const projectId = sanitizeProjectId(requested.projectId || DEFAULT_PROJECT);
        if (!projectId) {
          return uploadError(res, 400, `projectId 非法（只允许字母数字 . _ -）: ${requested.projectId}`);
        }
        let localPath;
        try {
          localPath = assembleChunks(uploadId, filename);
        } catch (cause) {
          return uploadError(res, 400, `合并分片失败: ${cause.message}`);
        }
        const header = readHeader(localPath);
        const validation = validateUpload(filename, header);
        if (!validation.ok) {
          cleanupUpload(uploadId);
          return json(res, 200, {
            ok: false, validation,
            hint: '格式校验未通过，未落盘到服务器（文件已从暂存清理）',
          });
        }
        const remote = remoteRawPath(projectId, lineId, filename);
        const localSize = fs.statSync(localPath).size;
        const scp = await runAsync(scpArgv(localPath, remote), { timeoutMs: 900000 });
        if (scp.code !== 0) {
          return uploadError(res, 500, `scp 上传失败（code=${scp.code}）: ${scp.stderr || scp.stdout}`);
        }
        const remoteStat = (await runSshAsync('k40-ubuntu', `stat -c %s ${shellQuote(remote)} 2>/dev/null || echo MISSING`, { timeoutMs: 40000 })).text;
        const remoteSize = Number(remoteStat.trim());
        const sizeMatch = Number.isFinite(remoteSize) && remoteSize === localSize;
        // P4：上传成功后会话元数据（预留额度）随会话一起作废。显式清一次，不依赖
        // cleanupUpload 里 rm -rf 的副作用；清理顺序变了也不会留下一个「已完成的预留额度」。
        clearSessionMeta(uploadId);
        cleanupUpload(uploadId);
        return json(res, 200, {
          ok: sizeMatch, validation, remotePath: remote,
          localSize, remoteSize: Number.isFinite(remoteSize) ? remoteSize : null, sizeMatch,
          hint: sizeMatch ? '上传完成，字节校验通过' : '上传后字节数不一致，请重试',
        });
      } catch (cause) {
        return uploadError(res, 500, `上传完成处理失败: ${(cause && cause.message) || cause}`);
      }
    });
    return true;
  }

  return false;
}