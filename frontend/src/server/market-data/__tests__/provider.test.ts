import { z } from 'zod';
import {
  executeProviderRequest,
  InMemoryFallbackCache,
  WindowRateLimiter
} from '../core/provider';
import { quoteSnapshotSchema } from '../providers/schemas';

const makeRateLimiter = () => new WindowRateLimiter({ maxRequests: 1000, windowMs: 60_000 });

describe('market data provider core', () => {
  it('returns graceful fallback when schema validation fails and cache exists', async () => {
    const cache = new InMemoryFallbackCache<z.infer<typeof quoteSnapshotSchema>>();
    cache.set('krx:487240', {
      symbol: '487240',
      name: 'KODEX AI전력핵심설비',
      price: 45340,
      change: 120,
      changePct: 0.27,
      currency: 'KRW',
      provenance: {
        source: 'krx',
        asOf: new Date().toISOString(),
        latencyClass: 'delayed',
        reconciled: false
      }
    });

    const result = await executeProviderRequest({
      provider: 'krx',
      cacheKey: 'krx:487240',
      timeoutMs: 200,
      request: async () => ({ invalid: true }),
      schema: quoteSnapshotSchema,
      fallbackCache: cache,
      rateLimiter: makeRateLimiter(),
      userMessageOnFailure: '시세를 불러오지 못했습니다.'
    });

    expect(result.meta.fromFallback).toBe(true);
    expect(result.meta.stale).toBe(true);
    expect(result.data.symbol).toBe('487240');
  });

  it('throws on provider timeout when fallback cache is missing', async () => {
    const cache = new InMemoryFallbackCache<z.infer<typeof quoteSnapshotSchema>>();

    await expect(
      executeProviderRequest({
        provider: 'krx',
        cacheKey: 'krx:timeout',
        timeoutMs: 10,
        request: async () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 60)),
        schema: quoteSnapshotSchema,
        fallbackCache: cache,
        rateLimiter: makeRateLimiter(),
        userMessageOnFailure: '시세를 불러오지 못했습니다.'
      })
    ).rejects.toThrow('시세를 불러오지 못했습니다.');
  });

  it('returns stale cache on provider exception', async () => {
    const cache = new InMemoryFallbackCache<z.infer<typeof quoteSnapshotSchema>>();
    cache.set('manual:001550', {
      symbol: '001550',
      name: '페스카로',
      price: 17300,
      change: -230,
      changePct: -1.31,
      currency: 'KRW',
      provenance: {
        source: 'manual',
        asOf: new Date().toISOString(),
        latencyClass: 'eod',
        reconciled: false
      }
    });

    const result = await executeProviderRequest({
      provider: 'manual',
      cacheKey: 'manual:001550',
      timeoutMs: 100,
      request: async () => {
        throw new Error('upstream unavailable');
      },
      schema: quoteSnapshotSchema,
      fallbackCache: cache,
      rateLimiter: makeRateLimiter(),
      userMessageOnFailure: '수동 데이터 조회에 실패했습니다.'
    });

    expect(result.meta.fromFallback).toBe(true);
    expect(result.meta.stale).toBe(true);
    expect(result.data.price).toBe(17300);
  });

  it('prevents provenance metadata omission via schema validation', () => {
    const parsed = quoteSnapshotSchema.safeParse({
      symbol: '487240',
      name: 'KODEX AI전력핵심설비',
      price: 45340,
      change: 120,
      changePct: 0.27,
      currency: 'KRW'
    });
    expect(parsed.success).toBe(false);
  });
});
