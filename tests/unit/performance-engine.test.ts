import { describe, expect, it } from 'vitest';
import {
  calculateAverageUnitCost,
  calculateMWR,
  calculateTWR
} from '../../frontend/src/lib/analytics/performance';
import {
  normalizeAnalyticsInputs,
  toNumber
} from '../../frontend/src/lib/analytics/normalizers';

describe('performance engine unit', () => {
  it('computes TWR from daily returns', () => {
    const twr = calculateTWR([0.01, -0.005, 0.02]);
    expect(twr).toBeCloseTo(0.025049, 6);
  });

  it('computes average unit cost from multi-lot holdings', () => {
    const avg = calculateAverageUnitCost([
      { quantity: 10, unitCost: 1000, fee: 10, tax: 0 },
      { quantity: 20, unitCost: 1200, fee: 20, tax: 10 }
    ]);
    expect(avg).toBeCloseTo(1134.6666, 3);
  });

  it('keeps MWR calculable with inflow/outflow stream', () => {
    const mwr = calculateMWR([
      { amount: -1_000_000, date: '2026-01-01' },
      { amount: -500_000, date: '2026-03-01' },
      { amount: 1_700_000, date: '2026-12-31' }
    ]);
    expect(Number.isFinite(mwr)).toBe(true);
  });

  it('normalizes raw analytics payload with sorted calendar', () => {
    const normalized = normalizeAnalyticsInputs({
      holdings: [{ id: 1, product_name: 'KODEX', quantity: '10', total_purchase_value: '10000', current_value: '12000' }],
      transactions: [{ id: 1, trade_date: '2026-02-03', trade_type: 'buy', quantity: '10', price: '1000', total_amount: '10000' }],
      cashFlows: [{ id: 1, date: '2026-02-03', amount: '10000', category: 'deposit' }],
      benchmarkSeries: [{ date: '2026-02-03', price: 1000 }],
      priceSeries: [{ id: 1, date: '2026-02-03', product_id: 1, quantity: 10, price: 1000, evaluation_value: 10000 }]
    });
    expect(normalized.calendar.length).toBeGreaterThan(0);
    expect(normalized.startDate).toBe('2026-02-03');
    expect(normalized.holdings[0].currentValue).toBe(12000);
  });

  it('applies numeric fallback for invalid values', () => {
    expect(toNumber('abc', 7)).toBe(7);
    expect(toNumber(undefined, 3)).toBe(3);
  });
});
