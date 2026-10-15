import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      args: ['--no-sandbox'],
    },
  },
  webServer: [
    {
      command: 'cargo run --locked --manifest-path ../backend/Cargo.toml',
      url: 'http://127.0.0.1:3081',
      timeout: 120_000,
      env: {
        SOLANA_GATEWAY_BIND: '127.0.0.1:3081',
        SOLANA_GATEWAY_TOKEN: 'browser-test-token-only-not-production-0001',
        SOLANA_DASHBOARD_CONFIG: 'tests/browser/dashboard.json',
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      env: { SOLANA_GATEWAY_PROXY: 'http://127.0.0.1:3081' },
    },
  ],
});
