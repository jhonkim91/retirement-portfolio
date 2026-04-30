import { defineConfig } from '@playwright/test';
import path from 'node:path';

const pythonBin = process.env.PYTHON_BIN
  || (process.platform === 'win32' ? 'py -3' : 'python');

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:5200',
    ignoreHTTPSErrors: true
  },
  webServer: {
    command: `${pythonBin} backend/app.py`,
    cwd: path.resolve(__dirname, '..'),
    url: 'http://127.0.0.1:5200/api/version',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
        TESTING: '1',
        PORT: '5200',
        DATABASE_URL: 'sqlite:///quality_gate_e2e.db',
      JWT_SECRET_KEY: 'quality-gate-e2e-secret-key'
    }
  }
});
