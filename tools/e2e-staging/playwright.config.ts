import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://13-140-159-201.sslip.io',
    viewport: { width: 1280, height: 800 },
    video: 'on',
    screenshot: 'on',
    // visible run: headed Chromium, slowed down so each action is watchable
    launchOptions: { slowMo: 700 },
  },
});
