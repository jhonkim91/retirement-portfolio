import { expect, test } from '@playwright/test';

test('finance workflow e2e: signup/login -> portfolio -> stock query -> journal -> screener', async ({ request, baseURL }) => {
  const suffix = Date.now().toString();
  const username = `e2e_user_${suffix}`;
  const email = `e2e_${suffix}@example.com`;
  const password = 'pw123456';

  const registerResponse = await request.post(`${baseURL}/api/auth/register`, {
    data: { username, email, password }
  });
  expect(registerResponse.ok()).toBeTruthy();

  const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
    data: { username, password }
  });
  expect(loginResponse.ok()).toBeTruthy();
  const loginPayload = await loginResponse.json();
  const token = loginPayload.access_token as string;
  expect(token).toBeTruthy();

  const authHeaders = {
    Authorization: `Bearer ${token}`
  };

  const createProduct = await request.post(`${baseURL}/api/products`, {
    headers: authHeaders,
    data: {
      product_name: 'E2E test symbol',
      product_code: '069500',
      purchase_price: 11000,
      quantity: 2,
      purchase_date: '2026-01-15',
      asset_type: 'risk'
    }
  });
  expect(createProduct.ok()).toBeTruthy();

  const search = await request.get(`${baseURL}/api/products/search?q=069500`, {
    headers: authHeaders
  });
  expect(search.ok()).toBeTruthy();
  const searchRows = await search.json() as Array<Record<string, unknown>>;
  expect(Array.isArray(searchRows)).toBe(true);

  const journal = await request.post(`${baseURL}/api/trade-journals`, {
    headers: authHeaders,
    data: {
      thesis: 'E2E thesis sample',
      entry_date: '2026-01-16'
    }
  });
  if (!journal.ok()) {
    const reason = await journal.text();
    throw new Error(`journal create failed: ${journal.status()} ${reason}`);
  }

  const screener = await request.post(`${baseURL}/api/screener/scan`, {
    headers: authHeaders,
    data: {
      market: 'KOSPI',
      pages: 1,
      limit: 5,
      filters: {
        candidate: {
          include_etf_candidates: true
        }
      }
    }
  });
  expect(screener.ok()).toBeTruthy();
  const screenerPayload = await screener.json() as {
    result_count: number;
    provenance?: { source?: string };
  };
  expect(typeof screenerPayload.result_count).toBe('number');
  expect((screenerPayload.provenance?.source || '').length).toBeGreaterThan(0);
});
