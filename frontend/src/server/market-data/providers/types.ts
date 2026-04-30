import { InMemoryFallbackCache, WindowRateLimiter } from '../core/provider';
import { MarketDataLogger, ProviderRateLimit, ProviderResult } from '../core/types';
import { QuoteSnapshotSchema } from './schemas';

export type ProviderContext = {
  fallbackCache: InMemoryFallbackCache<QuoteSnapshotSchema>;
  logger?: MarketDataLogger;
};

export interface QuoteProvider {
  providerId: string;
  timeoutMs: number;
  rateLimit: ProviderRateLimit;
  rateLimiter: WindowRateLimiter;
  getQuote(symbol: string, context: ProviderContext): Promise<ProviderResult<QuoteSnapshotSchema>>;
}
