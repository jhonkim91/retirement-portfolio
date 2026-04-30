import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerAndLogin, apiCall } from '../utils/apiClient';
import { startBackendServer } from '../utils/backendServer';
import { runProviderWithFallback } from '../utils/mockProvider';

type ServerContext = Awaited<ReturnType<typeof startBackendServer>>;

let server: ServerContext;

describe('portfolio api integration', () => {
  beforeAll(async () => {
    server = await startBackendServer(5100, 'quality_gate_integration.db');
  }, 150_000);

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  it('persists portfolio product and journal via api routes', async () => {
    const { token } = await registerAndLogin(server.baseUrl, `integration_${Date.now()}`);

    const createdProduct = await apiCall<{ product: { id: number; product_name: string } }>(
      server.baseUrl,
      '/api/products',
      'POST',
      {
        product_name: 'Test KODEX',
        product_code: '069500',
        purchase_price: 10000,
        quantity: 3,
        purchase_date: '2026-01-10',
        asset_type: 'risk'
      },
      token
    );

    expect(createdProduct.product.id).toBeGreaterThan(0);

    const products = await apiCall<Array<{ id: number; product_name: string }>>(
      server.baseUrl,
      '/api/portfolio/products',
      'GET',
      undefined,
      token
    );

    expect(products.some((row) => row.id === createdProduct.product.id)).toBe(true);

    const journalCreate = await apiCall<{ journal: { id: number; thesis: string } }>(
      server.baseUrl,
      '/api/trade-journals',
      'POST',
      {
        thesis: 'Momentum range check',
        trigger: 'Quarterly earnings',
        invalidation: 'Guidance turns down',
        targetHorizon: '3m',
        tags: ['integration', 'qa'],
        confidence: 65,
        attachedSymbol: '069500',
        entry_date: '2026-01-11'
      },
      token
    );

    expect(journalCreate.journal.id).toBeGreaterThan(0);

    const journals = await apiCall<{ count: number; journals: Array<{ thesis: string }> }>(
      server.baseUrl,
      '/api/trade-journals',
      'GET',
      undefined,
      token
    );

    expect(journals.count).toBeGreaterThan(0);
    expect(journals.journals.some((row) => row.thesis.includes('Momentum'))).toBe(true);
  });

  it('returns screener response with provenance and cache metadata', async () => {
    const { token } = await registerAndLogin(server.baseUrl, `screener_${Date.now()}`);
    const scan = await apiCall<{
      result_count: number;
      cache_hit: boolean;
      provenance: { source: string; asOf: string };
    }>(
      server.baseUrl,
      '/api/screener/scan',
      'POST',
      {
        market: 'KOSPI',
        pages: 1,
        limit: 5,
        filters: {
          candidate: {
            include_etf_candidates: true,
            include_pension_candidates: true
          }
        }
      },
      token
    );

    expect(typeof scan.result_count).toBe('number');
    expect(typeof scan.cache_hit).toBe('boolean');
    expect(scan.provenance.source.length).toBeGreaterThan(0);
    expect(scan.provenance.asOf).toBeTruthy();
  }, 120_000);

  it('uses provider fallback path through mock provider utility', async () => {
    const result = await runProviderWithFallback('mock:069500', true);
    expect(result.meta.fromFallback).toBe(true);
    expect(result.meta.stale).toBe(true);
    expect(result.data.symbol).toContain('mock:069500');
  });
});
