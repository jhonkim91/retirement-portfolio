import { InMemoryFallbackCache } from './core/provider';
import { MarketDataLogger, ProviderResult, QuoteSnapshot } from './core/types';
import { KRXQuoteProvider, ManualQuoteProvider } from './providers';
import { QuoteSnapshotSchema } from './providers/schemas';

const defaultLogger: MarketDataLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};

export type MarketDataServiceOptions = {
  logger?: MarketDataLogger;
};

export class MarketDataService {
  private readonly fallbackCache = new InMemoryFallbackCache<QuoteSnapshotSchema>();

  private readonly logger: MarketDataLogger;

  private readonly providers = [
    new KRXQuoteProvider(),
    new ManualQuoteProvider()
  ];

  constructor(options: MarketDataServiceOptions = {}) {
    this.logger = options.logger || defaultLogger;
  }

  async getQuoteSnapshot(symbol: string): Promise<ProviderResult<QuoteSnapshot>> {
    let lastError: unknown = null;

    for (const provider of this.providers) {
      try {
        const result = await provider.getQuote(symbol, {
          fallbackCache: this.fallbackCache,
          logger: this.logger
        });
        if (result.meta.fromFallback) {
          this.logger.warn('served quote from fallback cache', {
            provider: result.meta.provider,
            symbol
          });
        }
        return result;
      } catch (error) {
        lastError = error;
        this.logger.error('provider failed, trying next provider', {
          provider: provider.providerId,
          symbol,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    throw lastError || new Error('No market data provider could serve this request.');
  }
}
