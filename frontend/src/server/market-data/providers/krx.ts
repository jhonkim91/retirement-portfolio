import { z } from 'zod';
import { executeProviderRequest, WindowRateLimiter } from '../core/provider';
import { ProviderResult } from '../core/types';
import { fetchJson } from './http';
import { quoteSnapshotSchema, QuoteSnapshotSchema } from './schemas';
import { ProviderContext, QuoteProvider } from './types';

const naverChartRowSchema = z.array(z.union([z.number(), z.string()])).min(2);
const naverChartSchema = z.array(naverChartRowSchema).min(1);

const parseAsOfDate = (value: unknown): string => {
  const text = String(value ?? '').trim();
  if (!/^\d{8}$/.test(text)) return new Date().toISOString();
  const year = text.slice(0, 4);
  const month = text.slice(4, 6);
  const day = text.slice(6, 8);
  return new Date(`${year}-${month}-${day}T15:30:00+09:00`).toISOString();
};

const toNumber = (value: unknown): number => {
  const normalized = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(normalized)) throw new Error(`invalid number: ${value}`);
  return normalized;
};

export class KRXQuoteProvider implements QuoteProvider {
  providerId = 'krx';

  timeoutMs = 5_000;

  rateLimit = { maxRequests: 30, windowMs: 60_000 };

  rateLimiter = new WindowRateLimiter(this.rateLimit);

  async getQuote(symbol: string, context: ProviderContext): Promise<ProviderResult<QuoteSnapshotSchema>> {
    const code = String(symbol || '').trim().toUpperCase();
    return executeProviderRequest({
      provider: this.providerId,
      cacheKey: `${this.providerId}:${code}`,
      timeoutMs: this.timeoutMs,
      request: async () => {
        const url = `https://finance.naver.com/api/sise/chartlog.nhn?code=${encodeURIComponent(code)}&type=day&count=2`;
        const raw = await fetchJson(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; market-data-adapter/1.0)'
          }
        });
        const rows = naverChartSchema.parse(raw);
        const latest = rows[rows.length - 1];
        const previous = rows.length > 1 ? rows[rows.length - 2] : null;

        const latestClose = toNumber(latest[1]);
        const previousClose = previous ? toNumber(previous[1]) : latestClose;
        const change = latestClose - previousClose;
        const changePct = previousClose > 0 ? (change / previousClose) * 100 : 0;
        const asOf = parseAsOfDate(latest[0]);

        return {
          symbol: code,
          name: code,
          price: latestClose,
          change,
          changePct,
          currency: 'KRW',
          provenance: {
            source: 'krx',
            asOf,
            latencyClass: 'delayed',
            reconciled: false
          }
        };
      },
      schema: quoteSnapshotSchema,
      fallbackCache: context.fallbackCache,
      rateLimiter: this.rateLimiter,
      userMessageOnFailure: 'KRX 시세를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
      logger: context.logger
    });
  }
}
