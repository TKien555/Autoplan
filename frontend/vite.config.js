import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      input: {
        planner: fileURLToPath(new URL('./index.html', import.meta.url)),
        connector: fileURLToPath(new URL('./connector.html', import.meta.url))
      }
    }
  },
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      // Mọi request bắt đầu bằng /api sẽ được Vite chuyển thẳng sang Backend cổng 3001
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false
      }
    }
  }
});