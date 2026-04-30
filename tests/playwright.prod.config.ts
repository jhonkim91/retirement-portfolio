import { defineConfig } from '@playwright/test';
import path from 'node:path';

const baseURL = process.env.E2E_PROD_BASE_URL || 'https://retirement-portfolio-omega.vercel.app';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  outputDir: path.resolve(__dirname, '..', 'test-results', 'prod-smoke'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.resolve(__dirname, '..', 'test-results', 'playwright-prod-report'), open: 'never' }]
  ],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  }
});

