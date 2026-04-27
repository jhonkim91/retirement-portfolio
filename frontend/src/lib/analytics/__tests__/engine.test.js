import { createSyntheticAnalyticsPayload } from '../testFixtures';
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
});
