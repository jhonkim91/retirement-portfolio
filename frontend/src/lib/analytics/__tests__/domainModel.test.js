import { buildAnalyticsInputsFromDomain } from '../adapters';
import { computePortfolioAnalytics } from '../engine';
import { calculateAverageUnitCost, calculateMWR } from '../performance';

const makeDomainFixture = () => ({
  account_wrappers: [
    {
      id: 'w-irp',
      account_name: '퇴직연금',
      nickname: '퇴직연금',
      type: 'irp',
      tags: ['퇴직연금', 'IRP']
    },
    {
      id: 'w-stock',
      account_name: '주식통장',
      nickname: '주식통장',
      type: 'brokerage',
      tags: ['주식 통장', '일반과세']
    }
  ],
  holdings_lots: [
    {
      id: 1,
      account_wrapper_id: 'w-irp',
      symbol: '111111',
      product_name: 'Alpha ETF',
      asset_type: 'risk',
      quantity: 10,
      unit_cost: 10000
    },
    {
      id: 2,
      account_wrapper_id: 'w-irp',
      symbol: '111111',
      product_name: 'Alpha ETF',
      asset_type: 'risk',
      quantity: 5,
      unit_cost: 12000
    },
    {
      id: 3,
      account_wrapper_id: 'w-stock',
      symbol: '111111',
      product_name: 'Alpha ETF',
      asset_type: 'risk',
      quantity: 8,
      unit_cost: 9500
    }
  ],
  cash_flows: [
    { id: 11, account_wrapper_id: 'w-irp', flow_date: '2026-01-02', flow_type: 'deposit', amount: 200000 },
    { id: 12, account_wrapper_id: 'w-irp', flow_date: '2026-01-05', flow_type: 'buy', amount: -100000 },
    { id: 13, account_wrapper_id: 'w-irp', flow_date: '2026-01-08', flow_type: 'dividend', amount: 3500 },
    { id: 14, account_wrapper_id: 'w-stock', flow_date: '2026-01-03', flow_type: 'deposit', amount: 150000 }
  ],
  portfolio_snapshots: [
    {
      id: 21,
      account_wrapper_id: 'w-irp',
      account_name: '퇴직연금',
      snapshot_date: '2026-01-02',
      market_value: 100000,
      cost_basis: 100000,
      cash_balance: 100000,
      payload: {
        holdings: [
          {
            account_wrapper_id: 'w-irp',
            product_name: 'Alpha ETF',
            product_code: '111111',
            asset_type: 'risk',
            quantity: 10,
            price: 10000,
            evaluation_value: 100000,
            purchase_value: 100000
          }
        ]
      }
    },
    {
      id: 22,
      account_wrapper_id: 'w-irp',
      account_name: '퇴직연금',
      snapshot_date: '2026-01-08',
      market_value: 180000,
      cost_basis: 160000,
      cash_balance: 103500,
      payload: {
        holdings: [
          {
            account_wrapper_id: 'w-irp',
            product_name: 'Alpha ETF',
            product_code: '111111',
            asset_type: 'risk',
            quantity: 15,
            price: 12000,
            evaluation_value: 180000,
            purchase_value: 160000
          }
        ]
      }
    },
    {
      id: 23,
      account_wrapper_id: 'w-stock',
      account_name: '주식통장',
      snapshot_date: '2026-01-08',
      market_value: 90000,
      cost_basis: 76000,
      cash_balance: 74000,
      payload: {
        holdings: [
          {
            account_wrapper_id: 'w-stock',
            product_name: 'Alpha ETF',
            product_code: '111111',
            asset_type: 'risk',
            quantity: 8,
            price: 11250,
            evaluation_value: 90000,
            purchase_value: 76000
          }
        ]
      }
    },
    {
      id: 24,
      account_wrapper_id: null,
      account_name: '__all__',
      snapshot_date: '2026-01-08',
      market_value: 270000,
      cost_basis: 236000,
      cash_balance: 177500,
      payload: { holdings: [] }
    }
  ],
  benchmarks: [
    {
      id: 31,
      account_wrapper_id: 'w-irp',
      code: '069500',
      name: 'KODEX 200',
      is_default: true,
      series: [
        { date: '2026-01-02', price: 10000 },
        { date: '2026-01-05', price: 10100 },
        { date: '2026-01-08', price: 10200 }
      ]
    }
  ]
});

describe('portfolio domain model adapter', () => {
  it('calculates average unit cost for single/multiple lots', () => {
    expect(calculateAverageUnitCost([{ quantity: 5, unitCost: 10000 }])).toBe(10000);
    expect(calculateAverageUnitCost([
      { quantity: 10, unitCost: 10000 },
      { quantity: 5, unitCost: 12000 }
    ])).toBeCloseTo(10666.6666, 3);
  });

  it('computes MWR with external cash flow stream', () => {
    const mwr = calculateMWR([
      { date: '2026-01-02', amount: -1000000 },
      { date: '2026-03-01', amount: -100000 },
      { date: '2026-12-31', amount: 1300000 }
    ]);
    expect(mwr).not.toBeNull();
    expect(mwr).toBeGreaterThan(0);
  });

  it('supports account-level vs total aggregation inputs', () => {
    const domain = makeDomainFixture();
    const accountInput = buildAnalyticsInputsFromDomain(domain, { mode: 'account', accountWrapperId: 'w-irp' });
    const allInput = buildAnalyticsInputsFromDomain(domain, { mode: 'all' });

    expect(accountInput.holdings.length).toBe(1);
    expect(allInput.holdings.length).toBeGreaterThanOrEqual(2);
    expect(allInput.currentCash).toBeGreaterThan(accountInput.currentCash);
  });

  it('reflects dividend point in flow attribution snapshot', () => {
    const domain = makeDomainFixture();
    const input = buildAnalyticsInputsFromDomain(domain, { mode: 'account', accountWrapperId: 'w-irp' });
    const report = computePortfolioAnalytics(input);
    const dividendRow = report.contributions.flowVsMarket.find((row) => row.key === 'dividend-flow');
    expect(dividendRow).toBeTruthy();
    expect(dividendRow.amount).toBeCloseTo(3500, 0);
  });
});
