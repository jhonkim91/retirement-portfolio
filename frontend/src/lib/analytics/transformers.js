import { round, toNumber } from './normalizers';

const percentage = (value) => round(toNumber(value) * 100, 4);

export const buildCumulativeComparisonChart = (report, options = {}) => {
  const showBenchmark = options.showBenchmark !== false;
  const benchmarkMap = new Map((report.series?.benchmarkTimeline || []).map((row) => [row.date, row]));

  return (report.series?.timeline || []).map((row) => {
    const benchmark = benchmarkMap.get(row.date);
    const point = {
      date: row.date,
      portfolio: percentage((row.indexValue / 100) - 1),
      portfolioIndex: round(row.indexValue, 6)
    };
    if (showBenchmark && benchmark) {
      point.benchmark = percentage((benchmark.indexValue / 100) - 1);
      point.benchmarkIndex = round(benchmark.indexValue, 6);
    }
    return point;
  });
};

export const buildDrawdownChart = (report, options = {}) => {
  const showBenchmark = options.showBenchmark !== false;
  const benchmarkMap = new Map((report.series?.benchmarkTimeline || []).map((row) => [row.date, row]));

  return (report.series?.timeline || []).map((row) => {
    const benchmark = benchmarkMap.get(row.date);
    const point = {
      date: row.date,
      portfolio: percentage(row.drawdown)
    };
    if (showBenchmark && benchmark) {
      point.benchmark = percentage(benchmark.drawdown);
    }
    return point;
  });
};

export const buildMonthlyHeatmap = (report) => {
  const monthly = report.series?.monthlyReturns || [];
  const grid = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    values: {}
  }));

  monthly.forEach((row) => {
    const [year, month] = String(row.month || '').split('-');
    const monthIndex = Number(month) - 1;
    if (monthIndex >= 0 && monthIndex < 12) {
      grid[monthIndex].values[year] = percentage(row.return);
    }
  });

  const years = Array.from(new Set(monthly.map((row) => String(row.month).slice(0, 4)))).sort();

  return {
    years,
    rows: grid
  };
};

export const buildContributionWaterfall = (report) => {
  const rows = report.contributions?.byAsset || [];
  let runningTotal = 0;
  return rows.map((row) => {
    const amount = toNumber(row.marketPnl);
    const start = runningTotal;
    runningTotal += amount;
    return {
      key: row.assetId,
      label: row.name,
      amount: round(amount, 2),
      contributionPct: percentage(row.contributionReturn),
      start: round(Math.min(start, runningTotal), 2),
      span: round(Math.abs(amount), 2),
      kind: amount >= 0 ? 'positive' : 'negative'
    };
  });
};

export const buildAllocationDriftChart = (report) => (
  (report.series?.allocationTimeline || []).map((row) => ({
    date: row.date,
    risk: percentage(row.risk),
    safe: percentage(row.safe),
    ...(row.cash != null ? { cash: percentage(row.cash) } : {})
  }))
);

export const buildRiskCards = (report) => {
  const metrics = report.metrics || {};
  return [
    { key: 'twr', label: 'TWR', value: percentage(metrics.twr), suffix: '%' },
    { key: 'mwr', label: 'MWR / IRR', value: metrics.mwr == null ? null : percentage(metrics.mwr), suffix: '%' },
    { key: 'cagr', label: 'CAGR', value: percentage(metrics.cagr), suffix: '%' },
    { key: 'drawdown', label: 'Max drawdown', value: percentage(metrics.maxDrawdown), suffix: '%' },
    { key: 'vol30', label: '30D vol', value: metrics.rollingVolatility?.d30?.latest == null ? null : percentage(metrics.rollingVolatility.d30.latest), suffix: '%' },
    { key: 'vol90', label: '90D vol', value: metrics.rollingVolatility?.d90?.latest == null ? null : percentage(metrics.rollingVolatility.d90.latest), suffix: '%' },
    { key: 'vol1y', label: '1Y vol', value: metrics.rollingVolatility?.y1?.latest == null ? null : percentage(metrics.rollingVolatility.y1.latest), suffix: '%' },
    { key: 'sharpe', label: 'Sharpe', value: metrics.sharpe == null ? null : round(metrics.sharpe, 3), suffix: '' },
    { key: 'sortino', label: 'Sortino', value: metrics.sortino == null ? null : round(metrics.sortino, 3), suffix: '' },
    { key: 'beta', label: 'Beta', value: metrics.beta == null ? null : round(metrics.beta, 3), suffix: '' },
    { key: 'corr', label: 'Correlation', value: metrics.correlation == null ? null : round(metrics.correlation, 3), suffix: '' },
    { key: 'tracking-error', label: 'Tracking error', value: metrics.trackingError == null ? null : percentage(metrics.trackingError), suffix: '%' },
    { key: 'excess', label: 'Excess return', value: metrics.benchmarkExcessReturn == null ? null : percentage(metrics.benchmarkExcessReturn), suffix: '%' }
  ];
};

export const buildFlowAttributionChart = (report) => {
  const rows = report.contributions?.flowVsMarket || [];
  let cursor = 0;
  return rows.map((row) => {
    const amount = toNumber(row.amount);
    const isTerminal = row.key === 'starting-value' || row.key === 'ending-value';
    const start = isTerminal ? 0 : Math.min(cursor, cursor + amount);
    const span = isTerminal ? Math.abs(amount) : Math.abs(amount);
    if (!isTerminal) cursor += amount;
    return {
      ...row,
      start: round(start, 2),
      span: round(span, 2)
    };
  });
};
