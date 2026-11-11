/**
 * Uppy 上传面板：拖拽、进度、失败重试由 Uppy 负责，
 * 传输仍走现有 /api/upload/init|status|chunk|complete 四个端点，
 * 不引入 tus，也不改服务端契约。
 */
// @ts-expect-error 共享传输层是纯 ESM，无类型声明
import { uploadInChunks } from '../lib/chunkUpload.mjs';
import { useEffect, useRef } from 'react';
import Uppy from '@uppy/core';
import Dashboard from '@uppy/dashboard';
import '@uppy/core/css/style.css';
import '@uppy/dashboard/css/style.css';

type Props = {
  project: string;
  lineId: string;
  onDone: (result: Record<string, unknown>) => void;
  onError: (message: string) => void;
  onProgress?: (percent: number) => void;
  disabled?: boolean;
};

export function UppyUploader({ project, lineId, onDone, onError, onProgress, disabled }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const uppyRef = useRef<Uppy | null>(null);
  const callbacks = useRef({ onDone, onError, onProgress });
  callbacks.current = { onDone, onError, onProgress };

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const uppy = new Uppy({
      autoProceed: false,
      restrictions: { maxNumberOfFiles: 1, allowMultipleUploadBatches: true },
    });
    uppy.use(Dashboard, {
      inline: true,
      target: hostRef.current,
      height: 260,
      hideUploadButton: false,
      showProgressDetails: true,
      proudlyDisplayPoweredByUppy: false,
      note: '4MB 分片，刷新或换设备后自动从断点续传',
    });

    // 不用 XHRUpload：服务端是分片 + 会话指纹契约，整文件 POST 会对不上。
    uppy.addUploader(async (fileIDs: string[]) => {
      for (const fileID of fileIDs) {
        const file = uppy.getFile(fileID);
        if (!file?.data) continue;
        try {
          const out = await uploadInChunks({
            file: file.data as File,
            project,
            lineId,
            onProgress: (percent: number) => {
              callbacks.current.onProgress?.(percent);
              uppy.emit('upload-progress', file, {
                bytesUploaded: Math.round((percent / 100) * (file.size ?? 0)),
                bytesTotal: file.size ?? 0,
              });
            },
          });
          uppy.emit('upload-success', file, out.result || { ok: true });
          callbacks.current.onDone(out.result || { ok: true });
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          uppy.emit('upload-error', file, error);
          callbacks.current.onError(error.message);
          throw error;
        }
      }
    });

    uppy.on('error', (error: Error) => callbacks.current.onError(error.message));
    uppyRef.current = uppy;

    return () => {
      uppyRef.current = null;
      uppy.destroy();
    };
  }, [project, lineId]);

  useEffect(() => {
    const uppy = uppyRef.current;
    if (!uppy) return;
    if (disabled) uppy.getPlugin('Dashboard')?.setOptions({ disableStatusBar: true });
    else uppy.getPlugin('Dashboard')?.setOptions({ disableStatusBar: false });
  }, [disabled]);

  return <div className="uppy-host" ref={hostRef} />;
}
