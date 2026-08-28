import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '');
  // VITE_API_URL can be "http://localhost:8001/api" (absolute, used by axios)
  // or "/api" (proxy mode). For proxy target we need just the origin.
  const rawApi = env.VITE_API_URL || process.env.VITE_API_URL || 'http://localhost:8001';
  let proxyTarget = rawApi;
  try {
    if (rawApi.startsWith('/')) {
      proxyTarget = 'http://localhost:8001';
    } else {
      const u = new URL(rawApi);
      proxyTarget = `${u.protocol}//${u.host}`;
    }
  } catch {
    proxyTarget = 'http://localhost:8001';
  }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 5174,
      strictPort: true,
      host: '0.0.0.0',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
