import { defineConfig } from '@playwright/test';
import staging from './playwright.config';

export default defineConfig({
  ...staging,
  testDir: './flows',
  timeout: 180000,
  use: { ...staging.use, video: 'off', screenshot: 'only-on-failure' },
});
