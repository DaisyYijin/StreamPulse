import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 单文件打包:产物是一个 index.html(内联全部 js/css),Go 侧 go:embed 后
// 依旧单二进制交付。开发时 `npm run dev` 走本机 1024 端口的 API。
export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  build: {
    outDir: '../internal/api/web/dist',
    emptyOutDir: true,
    reportCompressedSize: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:1024',
      '/d': 'http://127.0.0.1:2048',
    },
  },
})
