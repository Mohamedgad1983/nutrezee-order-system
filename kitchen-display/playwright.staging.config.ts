import { defineConfig } from '@playwright/test';

const baseURL = process.env.KDS_E2E_BASE_URL;
const username = process.env.KDS_E2E_USERNAME;
const password = process.env.KDS_E2E_PASSWORD;

if (!baseURL || !username || !password) {
  throw new Error('KDS_E2E_BASE_URL, KDS_E2E_USERNAME, and KDS_E2E_PASSWORD are required');
}

const url = new URL(baseURL);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
  throw new Error('KDS_E2E_BASE_URL must be a credential-free HTTPS origin');
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: url.origin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium-live', use: { browserName: 'chromium' } }],
});
