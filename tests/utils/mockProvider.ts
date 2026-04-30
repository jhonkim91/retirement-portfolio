import {
  executeProviderRequest,
  InMemoryFallbackCache,
  WindowRateLimiter
} from '../../frontend/src/server/market-data/core/provider';
import { quoteSnapshotSchema } from '../../frontend/src/server/market-data/providers/schemas';

export const makeQuote = (symbol: string) => ({
  symbol,
  name: `Mock ${symbol}`,
  price: 12345,
  change: 10,
  changePct: 0.08,
  currency: 'KRW',
  provenance: {
    source: 'manual' as const,
    asOf: new Date().toISOString(),
    latencyClass: 'eod' as const,
    reconciled: false
  }
});

export const runProviderWithFallback = async (
  cacheKey: string,
  shouldFail = false
) => {
  const cache = new InMemoryFallbackCache<any>();
  cache.set(cacheKey, makeQuote(cacheKey));

  return executeProviderRequest({
    provider: 'manual',
    cacheKey,
    timeoutMs: 50,
    request: async () => {
      if (shouldFail) {
        throw new Error('mock provider failed');
      }
      return makeQuote(cacheKey);
    },
    schema: quoteSnapshotSchema,
    fallbackCache: cache,
    rateLimiter: new WindowRateLimiter({ maxRequests: 100, windowMs: 60_000 }),
    userMessageOnFailure: 'mock provider unavailable'
  });
};
