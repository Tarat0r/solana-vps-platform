import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/v1': {
        target: process.env.SOLANA_GATEWAY_PROXY ?? 'http://127.0.0.1:3000',
        bypass(req) {
          // Navigation loads the app; its explicit JSON requests reach the gateway.
          if (req.method === 'GET' && req.headers.accept?.includes('text/html')) return '/index.html';
        },
      },
    },
  },
});
