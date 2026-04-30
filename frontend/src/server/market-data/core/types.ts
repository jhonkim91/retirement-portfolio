export type MarketDataSource = 'kis' | 'kiwoom' | 'opendart' | 'krx' | 'manual';

export type LatencyClass = 'realtime' | 'delayed' | 'eod' | 'filing';

export type DataProvenance = {
  source: MarketDataSource;
  asOf: string;
  latencyClass: LatencyClass;
  reconciled: boolean;
};

export type QuoteSnapshot = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  currency: string;
  provenance: DataProvenance;
};

export type ProviderRateLimit = {
  maxRequests: number;
  windowMs: number;
};

export type ProviderTimeoutConfig = {
  timeoutMs: number;
};

export type ProviderExecutionMeta = {
  provider: string;
  cacheKey: string;
  fromFallback: boolean;
  stale: boolean;
  elapsedMs: number;
  warning?: string;
};

export type ProviderResult<T> = {
  data: T;
  meta: ProviderExecutionMeta;
};

export type FallbackEntry<T> = {
  value: T;
  savedAt: number;
};

export type MarketDataLogFn = (message: string, payload?: Record<string, unknown>) => void;

export type MarketDataLogger = {
  info: MarketDataLogFn;
  warn: MarketDataLogFn;
  error: MarketDataLogFn;
};

export type MarketDataErrorPayload = {
  provider: string;
  cacheKey: string;
  internalMessage: string;
  cause?: unknown;
};

export class MarketDataProviderError extends Error {
  userMessage: string;

  internalMessage: string;

  payload: MarketDataErrorPayload;

  constructor(userMessage: string, payload: MarketDataErrorPayload) {
    super(userMessage);
    this.name = 'MarketDataProviderError';
    this.userMessage = userMessage;
    this.internalMessage = payload.internalMessage;
    this.payload = payload;
  }
}
