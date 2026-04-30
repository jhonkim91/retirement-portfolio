import { expect, type Browser, type Locator, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

type RuntimeLog = {
  console: Array<{ type: string; text: string; url: string }>;
  pageErrors: Array<{ message: string }>;
  requestFailures: Array<{ url: string; method: string; failure: string | null }>;
};

const username = process.env.E2E_PROD_USERNAME || '';
const password = process.env.E2E_PROD_PASSWORD || '';

const ensureArtifactDir = async () => {
  const timestamp = new Date().toISOString().replace(/[^\d]/g, '').slice(0, 14);
  const runDir = path.resolve(process.cwd(), 'test-results', 'prod-smoke', `run-${timestamp}`);
  await fs.mkdir(runDir, { recursive: true });
  return runDir;
};

const isVisibleLocator = async (locator: Locator) => {
  try {
    if ((await locator.count()) === 0) return false;
    return await locator.first().isVisible();
  } catch {
    return false;
  }
};

const fillFirstVisible = async (locators: Locator[], value: string) => {
  for (const locator of locators) {
    if (await isVisibleLocator(locator)) {
      await locator.first().fill(value);
      return true;
    }
  }
  return false;
};

const clickFirstVisible = async (locators: Locator[]) => {
  for (const locator of locators) {
    if (await isVisibleLocator(locator)) {
      await locator.first().click();
      return true;
    }
  }
  return false;
};

const registerRuntimeLog = (browser: Browser, runDir: string) => {
  const runtimeLog: RuntimeLog = {
    console: [],
    pageErrors: [],
    requestFailures: []
  };

  const harPath = path.join(runDir, 'network.har');

  const contextPromise = browser.newContext({
    recordHar: { path: harPath, mode: 'full' },
    viewport: { width: 1440, height: 1024 }
  });

  return { contextPromise, runtimeLog, harPath };
};

test.describe('production smoke', () => {
  test.skip(!username || !password, 'E2E_PROD_USERNAME / E2E_PROD_PASSWORD 환경변수가 필요합니다.');

  test('login + dashboard data visibility', async ({ baseURL, browser }, testInfo) => {
    if (!baseURL) throw new Error('baseURL이 비어 있습니다.');

    const runDir = await ensureArtifactDir();
    const { contextPromise, runtimeLog } = registerRuntimeLog(browser, runDir);
    const context = await contextPromise;
    const page = await context.newPage();

    page.on('console', (message) => {
      runtimeLog.console.push({
        type: message.type(),
        text: message.text(),
        url: page.url()
      });
    });

    page.on('pageerror', (error) => {
      runtimeLog.pageErrors.push({ message: error.message });
    });

    page.on('requestfailed', (request) => {
      runtimeLog.requestFailures.push({
        url: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText || null
      });
    });

    let testError: Error | null = null;

    try {
      await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });

      const usernameFilled = await fillFirstVisible([
        page.getByLabel(/사용자명|아이디|username/i),
        page.getByPlaceholder(/사용자명|username/i),
        page.locator('input[name="username"]')
      ], username);
      if (!usernameFilled) throw new Error('로그인 사용자명 입력 필드를 찾지 못했습니다.');

      const passwordFilled = await fillFirstVisible([
        page.getByLabel(/비밀번호|password/i),
        page.getByPlaceholder(/비밀번호|password/i),
        page.locator('input[name="password"]')
      ], password);
      if (!passwordFilled) throw new Error('로그인 비밀번호 입력 필드를 찾지 못했습니다.');

      const clicked = await clickFirstVisible([
        page.getByRole('button', { name: /로그인|sign in/i }),
        page.locator('button[type="submit"]')
      ]);
      if (!clicked) throw new Error('로그인 버튼을 찾지 못했습니다.');

      const loginByToken = page.waitForFunction(() => Boolean(window.localStorage.getItem('access_token')), undefined, { timeout: 20_000 });
      const loginByUrl = page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });
      await Promise.race([loginByToken, loginByUrl]);

      await page.goto(`${baseURL}/dashboard`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: '운영 대시보드' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('총자산')).toBeVisible({ timeout: 20_000 });

      await page.screenshot({
        path: path.join(runDir, 'dashboard-full.png'),
        fullPage: true
      });
    } catch (error) {
      testError = error as Error;
      await page.screenshot({
        path: path.join(runDir, 'failure-full.png'),
        fullPage: true
      });
      throw error;
    } finally {
      await fs.writeFile(
        path.join(runDir, 'runtime-log.json'),
        JSON.stringify(
          {
            baseURL,
            status: testError ? 'failed' : 'passed',
            error: testError ? testError.message : null,
            runtimeLog
          },
          null,
          2
        ),
        'utf8'
      );
      await context.close();

      await testInfo.attach('prod-smoke-run-dir', {
        body: runDir,
        contentType: 'text/plain'
      });
    }
  });
});

