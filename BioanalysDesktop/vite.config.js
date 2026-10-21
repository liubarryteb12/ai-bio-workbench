import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';

// 本地交互层：Vite 只做前端壳，所有数据来自 Node 后端（见 server/）。
// 后端默认监听 127.0.0.1，不对外暴露。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // 前端会 import 仓库根 shared/*.mjs（与后端共用的纯函数单一事实源）。
    // allow 里的相对路径按项目根（BioanalysDesktop）解析，'..' 即仓库根；
    // 保留 searchForWorkspaceRoot 以免丢掉 vite 默认白名单。
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), '..'] },
    proxy: {
      // 前端 /api 一律转发到后端，避免前端直连服务器（本地零算力红线）
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
