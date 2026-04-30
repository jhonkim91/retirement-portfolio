import { executeProviderRequest, WindowRateLimiter } from '../core/provider';
import { ProviderResult } from '../core/types';
import { quoteSnapshotSchema, QuoteSnapshotSchema } from './schemas';
import { ProviderContext, QuoteProvider } from './types';

const MANUAL_QUOTES: Record<string, { name: string; price: number; change: number; changePct: number }> = {
  '487240': { name: 'KODEX AI전력핵심설비', price: 45340, change: 120, changePct: 0.27 },
  '001550': { name: '페스카로', price: 17300, change: -230, changePct: -1.31 }
};

export class ManualQuoteProvider implements QuoteProvider {
  providerId = 'manual';

  timeoutMs = 500;

  rateLimit = { maxRequests: 120, windowMs: 60_000 };

  rateLimiter = new WindowRateLimiter(this.rateLimit);

  async getQuote(symbol: string, context: ProviderContext): Promise<ProviderResult<QuoteSnapshotSchema>> {
    const code = String(symbol || '').trim().toUpperCase();
    return executeProviderRequest({
      provider: this.providerId,
      cacheKey: `${this.providerId}:${code}`,
      timeoutMs: this.timeoutMs,
      request: async () => {
        const row = MANUAL_QUOTES[code];
        if (!row) throw new Error(`manual quote not found: ${code}`);
        return {
          symbol: code,
          name: row.name,
          price: row.price,
          change: row.change,
          changePct: row.changePct,
          currency: 'KRW',
          provenance: {
            source: 'manual',
            asOf: new Date().toISOString(),
            latencyClass: 'eod',
            reconciled: false
          }
        };
      },
      schema: quoteSnapshotSchema,
      fallbackCache: context.fallbackCache,
      rateLimiter: this.rateLimiter,
      userMessageOnFailure: '수동 데이터 조회에 실패했습니다. 잠시 후 다시 시도해주세요.',
      logger: context.logger
    });
  }
}
