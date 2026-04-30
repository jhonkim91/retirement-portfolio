import { z } from 'zod';
import { WindowRateLimiter } from '../core/provider';
import { DataProvenance, ProviderRateLimit } from '../core/types';
import { fetchJson } from './http';

const dartCompanySchema = z.object({
  status: z.string(),
  corp_name: z.string().optional().default(''),
  ceo_nm: z.string().optional().default(''),
  stock_name: z.string().optional().default(''),
  est_dt: z.string().optional().default('')
});

export type DARTCompanyProfile = {
  corpName: string;
  ceoName: string;
  stockName: string;
  establishedAt: string;
  provenance: DataProvenance;
};

export class OpenDARTProvider {
  providerId = 'opendart';

  timeoutMs = 7_000;

  rateLimit: ProviderRateLimit = { maxRequests: 15, windowMs: 60_000 };

  rateLimiter = new WindowRateLimiter(this.rateLimit);

  async getCompanyProfile(corpCode: string, apiKey: string): Promise<DARTCompanyProfile> {
    if (!apiKey) throw new Error('Open DART API key is not configured.');
    if (!this.rateLimiter.canProceed()) throw new Error('Open DART rate limit exceeded.');

    const url = `https://opendart.fss.or.kr/api/company.json?crtfc_key=${encodeURIComponent(apiKey)}&corp_code=${encodeURIComponent(corpCode)}`;
    const raw = await Promise.race([
      fetchJson(url),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Open DART timeout')), this.timeoutMs))
    ]);
    const parsed = dartCompanySchema.parse(raw);
    if (parsed.status !== '000') throw new Error(`Open DART status ${parsed.status}`);

    return {
      corpName: parsed.corp_name,
      ceoName: parsed.ceo_nm,
      stockName: parsed.stock_name,
      establishedAt: parsed.est_dt,
      provenance: {
        source: 'opendart',
        asOf: new Date().toISOString(),
        latencyClass: 'filing',
        reconciled: false
      }
    };
  }
}
