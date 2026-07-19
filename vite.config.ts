import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 后端已抽离为独立 Express 服务（server/），开发期通过 proxy 把 /api 转发到 :2999。
// 生产：vite build 产出 dist/，由 Nginx 托管静态资源 + 反代 /api 到 Express。
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:2999',
        changeOrigin: true,
      },
    },
  },
});
