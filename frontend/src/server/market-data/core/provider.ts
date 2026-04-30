import { z } from 'zod';
import {
  FallbackEntry,
  MarketDataLogger,
  MarketDataProviderError,
  ProviderRateLimit,
  ProviderResult
} from './types';

const defaultLogger: MarketDataLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};

export class InMemoryFallbackCache<T> {
  private store = new Map<string, FallbackEntry<T>>();

  get(cacheKey: string): FallbackEntry<T> | null {
    return this.store.get(cacheKey) || null;
  }

  set(cacheKey: string, value: T, now = Date.now()): void {
    this.store.set(cacheKey, { value, savedAt: now });
  }
}

export class WindowRateLimiter {
  private readonly maxRequests: number;

  private readonly windowMs: number;

  private timestamps: number[] = [];

  constructor(config: ProviderRateLimit) {
    this.maxRequests = Math.max(config.maxRequests, 1);
    this.windowMs = Math.max(config.windowMs, 1);
  }

  canProceed(now = Date.now()): boolean {
    const windowStart = now - this.windowMs;
    this.timestamps = this.timestamps.filter((timestamp) => timestamp >= windowStart);
    if (this.timestamps.length >= this.maxRequests) return false;
    this.timestamps.push(now);
    return true;
  }
}

const timeoutPromise = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`provider timeout (${timeoutMs}ms)`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

type ExecuteProviderRequestArgs<T> = {
  provider: string;
  cacheKey: string;
  timeoutMs: number;
  request: () => Promise<unknown>;
  schema: z.ZodType<T>;
  fallbackCache: InMemoryFallbackCache<T>;
  rateLimiter: WindowRateLimiter;
  userMessageOnFailure: string;
  logger?: MarketDataLogger;
};

export const executeProviderRequest = async <T>({
  provider,
  cacheKey,
  timeoutMs,
  request,
  schema,
  fallbackCache,
  rateLimiter,
  userMessageOnFailure,
  logger = defaultLogger
}: ExecuteProviderRequestArgs<T>): Promise<ProviderResult<T>> => {
  const startedAt = Date.now();
  const fallbackEntry = fallbackCache.get(cacheKey);

  if (!rateLimiter.canProceed(startedAt)) {
    logger.warn('provider rate limit exceeded', { provider, cacheKey });
    if (fallbackEntry) {
      return {
        data: fallbackEntry.value,
        meta: {
          provider,
          cacheKey,
          fromFallback: true,
          stale: true,
          elapsedMs: Date.now() - startedAt,
          warning: '요청이 많아 최근 캐시 데이터를 표시합니다.'
        }
      };
    }
    throw new MarketDataProviderError(userMessageOnFailure, {
      provider,
      cacheKey,
      internalMessage: 'rate limit exceeded'
    });
  }

  try {
    const rawResponse = await timeoutPromise(request(), timeoutMs);
    const parsed = schema.parse(rawResponse);
    fallbackCache.set(cacheKey, parsed);

    return {
      data: parsed,
      meta: {
        provider,
        cacheKey,
        fromFallback: false,
        stale: false,
        elapsedMs: Date.now() - startedAt
      }
    };
  } catch (error) {
    logger.error('provider request failed', {
      provider,
      cacheKey,
      error: error instanceof Error ? error.message : String(error)
    });

    if (fallbackEntry) {
      return {
        data: fallbackEntry.value,
        meta: {
          provider,
          cacheKey,
          fromFallback: true,
          stale: true,
          elapsedMs: Date.now() - startedAt,
          warning: '일시 오류로 최근 캐시 데이터를 표시합니다.'
        }
      };
    }

    throw new MarketDataProviderError(userMessageOnFailure, {
      provider,
      cacheKey,
      internalMessage: error instanceof Error ? error.message : 'unknown provider error',
      cause: error
    });
  }
};
