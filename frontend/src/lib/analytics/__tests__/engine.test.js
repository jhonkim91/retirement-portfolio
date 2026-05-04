import { createSyntheticAnalyticsPayload } from '../testFixtures';
import { buildAnalyticsInputsFromDomain } from '../adapters';
import { computePortfolioAnalytics } from '../engine';
import {
  buildContributionWaterfall,
  buildCumulativeComparisonChart,
  buildRiskCards
} from '../transformers';

describe('portfolio analytics engine', () => {
  it('computes core analytics metrics from normalized inputs', () => {
    const report = computePortfolioAnalytics(createSyntheticAnalyticsPayload());

    expect(report.meta.tradingDays).toBeGreaterThan(200);
    expect(report.metrics.twr).toBeGreaterThan(0);
    expect(report.metrics.cumulativeReturn).toBeGreaterThan(0);
    expect(report.metrics.mwr).not.toBeNull();
    expect(report.metrics.rollingVolatility.y1.latest).not.toBeNull();
    expect(report.metrics.sharpe).toBeGreaterThan(0);
    expect(report.metrics.beta).not.toBeNull();
    expect(report.metrics.correlation).not.toBeNull();
    expect(report.contributions.byAsset.length).toBeGreaterThanOrEqual(2);
    expect(report.rebalancing.actual).not.toBeNull();
    expect(report.templates).toHaveLength(2);
  });

  it('keeps chart transformers stable for the dashboard layer', () => {
    const report = computePortfolioAnalytics(createSyntheticAnalyticsPayload());

    expect({
      cumulative: buildCumulativeComparisonChart(report).slice(0, 3),
      contribution: buildContributionWaterfall(report).slice(0, 3),
      cards: buildRiskCards(report).slice(0, 4)
    }).toMatchSnapshot();
  });

  it('keeps domain trade ledger flows separate from performance cash flows', () => {
    const domainPayload = {
      account_wrappers: [
        { id: 'ret-1', type: 'retirement' },
        { id: 'bro-1', type: 'brokerage' }
      ],
      holdings_lots: [],
      portfolio_snapshots: [],
      price_series: [],
      cash_flows: [
        { id: 'ret-buy', account_wrapper_id: 'ret-1', flow_date: '2026-01-02', flow_type: 'buy', amount: -1000, symbol: 'AAA' },
        { id: 'ret-sell', account_wrapper_id: 'ret-1', flow_date: '2026-01-03', flow_type: 'sell', amount: 400, symbol: 'AAA' },
        { id: 'ret-deposit', account_wrapper_id: 'ret-1', flow_date: '2026-01-01', flow_type: 'deposit', amount: 2000, symbol: 'cash' },
        { id: 'bro-buy', account_wrapper_id: 'bro-1', flow_date: '2026-01-02', flow_type: 'buy', amount: -1000, symbol: 'BBB' },
        { id: 'bro-sell', account_wrapper_id: 'bro-1', flow_date: '2026-01-03', flow_type: 'sell', amount: 400, symbol: 'BBB' }
      ]
    };

    const retirementInputs = buildAnalyticsInputsFromDomain(domainPayload, {
      mode: 'account',
      accountWrapperId: 'ret-1'
    });
    expect(retirementInputs.transactions.map((row) => [row.trade_type, row.total_amount])).toEqual([
      ['buy', 1000],
      ['sell', 400],
      ['deposit', 2000]
    ]);
    expect(retirementInputs.cashFlows.map((row) => [row.category, row.amount])).toEqual([
      ['deposit', 2000]
    ]);

    const brokerageInputs = buildAnalyticsInputsFromDomain(domainPayload, {
      mode: 'account',
      accountWrapperId: 'bro-1'
    });
    expect(brokerageInputs.cashFlows.map((row) => [row.category, row.amount])).toEqual([
      ['buy', 1000],
      ['sell', -400]
    ]);
  });
});
