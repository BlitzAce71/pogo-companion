import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, host: true },
  build: { chunkSizeWarningLimit: 800 },
  // Shown in the Box Scanner's troubleshooting log, to tell which build a device is running
  define: { __BUILD__: JSON.stringify({ time: new Date().toISOString(), sha: (process.env.GITHUB_SHA || 'local').slice(0, 7) }) },
});
