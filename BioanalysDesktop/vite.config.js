import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 本地交互层：Vite 只做前端壳，所有数据来自 Node 后端（见 server/）。
// 后端默认监听 127.0.0.1，不对外暴露。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
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
