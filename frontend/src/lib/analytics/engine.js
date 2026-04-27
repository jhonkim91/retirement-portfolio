import {
  fillForwardSeries,
  normalizeAnalyticsInputs,
  round,
  toNumber
} from './normalizers';
import {
  alignPairs,
  annualizeReturn,
  annualizeVolatility,
  covariance,
  downsideDeviation,
  maxDrawdown,
  mean,
  rollingStandardDeviation,
  safeDivide,
  standardDeviation,
  xirr
} from './math';

const RISK_FREE_RATE = 0.02;
const TRADING_DAYS = 252;
const CASH_ASSET_ID = '__cash__';

const getMonthKey = (dateKey) => String(dateKey || '').slice(0, 7);

const compoundReturns = (returns = []) => (
  returns.reduce((total, value) => total * (1 + toNumber(value)), 1) - 1
);

const inferCashMultiplier = (rows = []) => {
  const sample = rows.find((row) => row.quantity > 0 && row.price > 0 && row.evaluationValue > 0);
  if (!sample) return 1;
  return safeDivide(sample.evaluationValue, sample.quantity * sample.price, 1);
};

const buildExternalCashFlows = ({ cashFlows, transactions, accountType }) => {
  if (cashFlows.length > 0) {
    return cashFlows.map((row) => ({ ...row, amount: Math.abs(toNumber(row.amount)) }));
  }

  const depositFlows = transactions
    .filter((row) => row.type === 'deposit')
    .map((row) => ({
      id: row.id,
      date: row.date,
      amount: Math.abs(toNumber(row.totalAmount)),
      label: row.productName || 'Deposit'
    }));

  if (depositFlows.length > 0) return depositFlows;

  if (accountType === 'brokerage') {
    return transactions
      .filter((row) => row.type === 'buy' || row.type === 'sell')
      .map((row) => ({
        id: row.id,
        date: row.date,
        amount: row.type === 'buy' ? Math.abs(toNumber(row.totalAmount)) : -Math.abs(toNumber(row.totalAmount)),
        label: row.productName || row.type
      }));
  }

  return [];
};

const buildCashLedger = ({ calendar, currentCash, transactions, enabled }) => {
  if (!enabled || calendar.length === 0) {
    return calendar.map((date) => ({ date, value: 0 }));
  }

  const deltaByDate = new Map();
  transactions.forEach((transaction) => {
    const amount = toNumber(transaction.totalAmount);
    if (!transaction.date || !amount) return;
    const previous = deltaByDate.get(transaction.date) || 0;
    if (transaction.type === 'deposit') {
      deltaByDate.set(transaction.date, previous + amount);
    } else if (transaction.type === 'buy') {
      deltaByDate.set(transaction.date, previous - amount);
    } else if (transaction.type === 'sell') {
      deltaByDate.set(transaction.date, previous + amount);
    }
  });

  const totalDelta = Array.from(deltaByDate.values()).reduce((total, value) => total + value, 0);
  let runningCash = toNumber(currentCash) - totalDelta;

  return calendar.map((date) => {
    runningCash += deltaByDate.get(date) || 0;
    return {
      date,
      value: round(runningCash, 6)
    };
  });
};

const buildAssetSeries = ({ priceSeries, calendar }) => {
  const grouped = new Map();
  priceSeries.forEach((row) => {
    const key = String(row.productId);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  return Array.from(grouped.entries()).map(([assetId, rows]) => {
    const ordered = [...rows].sort((left, right) => left.date.localeCompare(right.date));
    const firstDate = ordered[0]?.date;
    const lastDate = ordered[ordered.length - 1]?.date;
    const multiplier = inferCashMultiplier(ordered);

    const series = fillForwardSeries(ordered, calendar, (row, date, carried) => {
      if (!row || (firstDate && date < firstDate) || (lastDate && date > lastDate)) {
        return {
          date,
          value: 0,
          quantity: 0,
          price: null,
          purchaseValue: 0,
          carried: true
        };
      }

      const price = row.price > 0 ? row.price : null;
      const quantity = toNumber(row.quantity);
      const value = row.evaluationValue > 0
        ? row.evaluationValue
        : quantity * (price || 0) * multiplier;

      return {
        date,
        value: round(value, 6),
        quantity,
        price,
        purchaseValue: round(row.purchaseValue, 6),
        carried
      };
    });

    return {
      assetId,
      productName: ordered[ordered.length - 1]?.productName || assetId,
      assetType: ordered[ordered.length - 1]?.assetType || 'risk',
      multiplier,
      series
    };
  });
};

const buildBenchmarkTimeline = ({ benchmarkSeries, calendar }) => {
  if (benchmarkSeries.length === 0) return [];

  const normalized = fillForwardSeries(benchmarkSeries, calendar, (row, date) => ({
    date,
    price: row?.price || null
  }));

  let previousPrice = null;
  let indexValue = 100;
  let peak = 100;

  return normalized.map((row, index) => {
    const price = row.price;
    let dailyReturn = 0;
    if (index > 0 && previousPrice && price) {
      dailyReturn = safeDivide(price - previousPrice, previousPrice, 0);
      indexValue *= (1 + dailyReturn);
      peak = Math.max(peak, indexValue);
    }
    previousPrice = price || previousPrice;
    return {
      date: row.date,
      price,
      dailyReturn: round(dailyReturn, 8),
      indexValue: round(indexValue, 8),
      drawdown: round(safeDivide(indexValue, peak, 1) - 1, 8)
    };
  });
};

const buildPortfolioTimeline = ({
  assetSeries,
  cashSeries,
  externalCashFlows,
  includeCashInBreakdown
}) => {
  const externalFlowMap = new Map();
  externalCashFlows.forEach((flow) => {
    externalFlowMap.set(flow.date, (externalFlowMap.get(flow.date) || 0) + toNumber(flow.amount));
  });

  const timeline = [];
  const assetContributionMap = new Map();
  const firstCalendar = assetSeries[0]?.series?.map((row) => row.date) || cashSeries.map((row) => row.date);

  const initialBreakdownKeys = new Set();
  assetSeries.forEach((asset) => initialBreakdownKeys.add(asset.assetId));
  if (includeCashInBreakdown) initialBreakdownKeys.add(CASH_ASSET_ID);

  initialBreakdownKeys.forEach((assetId) => {
    assetContributionMap.set(assetId, {
      assetId,
      name: assetId === CASH_ASSET_ID ? '현금' : assetSeries.find((asset) => asset.assetId === assetId)?.productName || assetId,
      assetType: assetId === CASH_ASSET_ID ? 'cash' : assetSeries.find((asset) => asset.assetId === assetId)?.assetType || 'risk',
      marketPnl: 0,
      contributionReturn: 0,
      endingValue: 0
    });
  });

  let previousTotal = null;
  let indexValue = 100;
  let peak = 100;

  firstCalendar.forEach((date, index) => {
    const holdings = {};
    let holdingsValue = 0;
    let marketPnl = 0;

    assetSeries.forEach((asset) => {
      const current = asset.series[index];
      const previous = asset.series[index - 1];
      const currentValue = toNumber(current?.value);
      const priceChange = (current?.price != null && previous?.price != null)
        ? (current.price - previous.price)
        : 0;
      const assetMarketPnl = previous ? previous.quantity * asset.multiplier * priceChange : 0;
      const assetReturn = previous && previous.price
        ? safeDivide(priceChange, previous.price, 0)
        : 0;

      holdings[asset.assetId] = {
        name: asset.productName,
        assetType: asset.assetType,
        value: round(currentValue, 6),
        weight: 0,
        quantity: current?.quantity || 0,
        price: current?.price,
        dailyReturn: round(assetReturn, 8),
        marketPnl: round(assetMarketPnl, 6)
      };

      holdingsValue += currentValue;
      marketPnl += assetMarketPnl;
    });

    const cashValue = toNumber(cashSeries[index]?.value);
    const totalValue = holdingsValue + cashValue;
    const externalFlow = externalFlowMap.get(date) || 0;
    const dailyReturn = previousTotal && previousTotal > 0
      ? safeDivide(totalValue - previousTotal - externalFlow, previousTotal, 0)
      : 0;

    if (index > 0) {
      indexValue *= (1 + dailyReturn);
      peak = Math.max(peak, indexValue);
    }

    assetSeries.forEach((asset) => {
      const holding = holdings[asset.assetId];
      if (!holding) return;
      holding.weight = totalValue > 0 ? round(holding.value / totalValue, 8) : 0;
      const summary = assetContributionMap.get(asset.assetId);
      if (!summary) return;
      summary.marketPnl += holding.marketPnl;
      if (previousTotal > 0) {
        const previousWeight = safeDivide(toNumber(asset.series[index - 1]?.value), previousTotal, 0);
        summary.contributionReturn += previousWeight * holding.dailyReturn;
      }
      summary.endingValue = holding.value;
    });

    if (includeCashInBreakdown) {
      const cashSummary = assetContributionMap.get(CASH_ASSET_ID);
      if (cashSummary) {
        cashSummary.endingValue = round(cashValue, 6);
      }
    }

    timeline.push({
      date,
      totalValue: round(totalValue, 6),
      holdingsValue: round(holdingsValue, 6),
      cashValue: round(cashValue, 6),
      externalFlow: round(externalFlow, 6),
      dailyReturn: round(dailyReturn, 8),
      indexValue: round(indexValue, 8),
      drawdown: round(safeDivide(indexValue, peak, 1) - 1, 8),
      marketPnl: round(marketPnl, 6),
      holdings
    });

    previousTotal = totalValue;
  });

  return {
    timeline,
    assetContributions: Array.from(assetContributionMap.values())
  };
};

const buildMonthlyReturns = (timeline) => {
  const grouped = new Map();
  timeline.forEach((row) => {
    const key = getMonthKey(row.date);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row.dailyReturn);
  });

  return Array.from(grouped.entries()).map(([month, returns]) => ({
    month,
    return: round(compoundReturns(returns), 8)
  }));
};

const buildAllocationTimeline = ({ timeline, includeCashInBreakdown }) => timeline.map((row) => {
  const point = {
    date: row.date,
    risk: 0,
    safe: 0,
    cash: row.totalValue > 0 ? round(row.cashValue / row.totalValue, 8) : 0
  };

  Object.values(row.holdings).forEach((holding) => {
    if (holding.assetType === 'safe') {
      point.safe += holding.weight;
    } else {
      point.risk += holding.weight;
    }
  });

  if (!includeCashInBreakdown) {
    delete point.cash;
  }
  return point;
});

const buildRollingVolatility = (dailyReturns) => {
  const buildValue = (windowSize) => {
    const series = rollingStandardDeviation(dailyReturns, windowSize).map((value) => (
      value == null ? null : round(annualizeVolatility(value), 8)
    ));
    return {
      latest: series.filter((value) => value != null).slice(-1)[0] ?? null,
      series
    };
  };

  return {
    d30: buildValue(30),
    d90: buildValue(90),
    y1: buildValue(252)
  };
};

const buildRebalancedComparison = ({ timeline, includeCashInBreakdown }) => {
  if (timeline.length < 2) {
    return {
      actual: null,
      rebalanced: null,
      delta: null
    };
  }

  const assetKeys = Object.keys(timeline[0].holdings).filter((key) => timeline.some((row) => row.holdings[key]?.value > 0));
  if (includeCashInBreakdown && timeline.some((row) => row.cashValue > 0)) {
    assetKeys.push(CASH_ASSET_ID);
  }

  const firstRow = timeline.find((row) => row.totalValue > 0) || timeline[0];
  const targetWeights = {};
  assetKeys.forEach((assetId) => {
    if (assetId === CASH_ASSET_ID) {
      targetWeights[assetId] = safeDivide(firstRow.cashValue, firstRow.totalValue, 0);
    } else {
      targetWeights[assetId] = firstRow.holdings[assetId]?.weight || 0;
    }
  });

  let weights = { ...targetWeights };
  let indexValue = 100;
  let peak = 100;
  const rebalancedSeries = [{
    date: timeline[0].date,
    indexValue,
    drawdown: 0,
    dailyReturn: 0
  }];

  for (let index = 1; index < timeline.length; index += 1) {
    const current = timeline[index];
    const previous = timeline[index - 1];

    const monthChanged = getMonthKey(current.date) !== getMonthKey(previous.date);
    if (monthChanged) {
      weights = { ...targetWeights };
    }

    let dailyReturn = 0;
    for (const assetId of assetKeys) {
      if (assetId === CASH_ASSET_ID) continue;
      dailyReturn += (weights[assetId] || 0) * (current.holdings[assetId]?.dailyReturn || 0);
    }

    indexValue *= (1 + dailyReturn);
    peak = Math.max(peak, indexValue);

    const grownWeights = {};
    let totalGrownWeight = 0;
    for (const assetId of assetKeys) {
      const assetReturn = assetId === CASH_ASSET_ID ? 0 : (current.holdings[assetId]?.dailyReturn || 0);
      const nextWeight = (weights[assetId] || 0) * (1 + assetReturn);
      grownWeights[assetId] = nextWeight;
      totalGrownWeight += nextWeight;
    }
    for (const assetId of assetKeys) {
      weights[assetId] = totalGrownWeight > 0 ? grownWeights[assetId] / totalGrownWeight : 0;
    }

    rebalancedSeries.push({
      date: current.date,
      indexValue: round(indexValue, 8),
      drawdown: round(safeDivide(indexValue, peak, 1) - 1, 8),
      dailyReturn: round(dailyReturn, 8)
    });
  }

  const actualReturn = safeDivide(timeline[timeline.length - 1].indexValue, 100, 1) - 1;
  const rebalancedReturn = safeDivide(rebalancedSeries[rebalancedSeries.length - 1].indexValue, 100, 1) - 1;
  const actualVol = annualizeVolatility(standardDeviation(timeline.slice(1).map((row) => row.dailyReturn)));
  const rebalancedVol = annualizeVolatility(standardDeviation(rebalancedSeries.slice(1).map((row) => row.dailyReturn)));

  return {
    actual: {
      cumulativeReturn: round(actualReturn, 8),
      maxDrawdown: round(maxDrawdown(timeline.map((row) => row.indexValue)), 8),
      volatility: round(actualVol, 8)
    },
    rebalanced: {
      cumulativeReturn: round(rebalancedReturn, 8),
      maxDrawdown: round(maxDrawdown(rebalancedSeries.map((row) => row.indexValue)), 8),
      volatility: round(rebalancedVol, 8)
    },
    delta: {
      cumulativeReturn: round(rebalancedReturn - actualReturn, 8),
      maxDrawdown: round(
        maxDrawdown(rebalancedSeries.map((row) => row.indexValue)) - maxDrawdown(timeline.map((row) => row.indexValue)),
        8
      ),
      volatility: round(rebalancedVol - actualVol, 8)
    },
    targetWeights: Object.entries(targetWeights).map(([assetId, weight]) => ({
      assetId,
      weight: round(weight, 8)
    })),
    series: rebalancedSeries
  };
};

function sumEnding(assetContributions = []) {
  return assetContributions.reduce((total, asset) => total + toNumber(asset.endingValue), 0);
}

const buildTemplates = ({ accountType, metrics, allocationTimeline, cashFlows, assetContributions, benchmarkCoverage }) => {
  const lastAllocation = allocationTimeline[allocationTimeline.length - 1] || { risk: 0, safe: 0, cash: 0 };
  const largestWeight = Math.max(...assetContributions.map((asset) => safeDivide(asset.endingValue, sumEnding(assetContributions), 0)), 0);

  const retirementRules = [
    {
      label: '안전자산 완충',
      passed: ((lastAllocation.safe || 0) + (lastAllocation.cash || 0)) >= 0.2,
      detail: `안전자산 + 현금 ${(100 * ((lastAllocation.safe || 0) + (lastAllocation.cash || 0))).toFixed(1)}%`
    },
    {
      label: '입금 흐름 기록',
      passed: cashFlows.length > 0,
      detail: `외부 현금흐름 ${cashFlows.length}건`
    },
    {
      label: '낙폭 완충',
      passed: metrics.maxDrawdown >= -0.25,
      detail: `최대낙폭 ${(metrics.maxDrawdown * 100).toFixed(1)}%`
    }
  ];

  const brokerageRules = [
    {
      label: '집중도 점검',
      passed: largestWeight <= 0.45,
      detail: `최대 단일 비중 ${(largestWeight * 100).toFixed(1)}%`
    },
    {
      label: '벤치마크 커버리지',
      passed: benchmarkCoverage >= 60,
      detail: `겹치는 거래일 ${benchmarkCoverage}일`
    },
    {
      label: '변동성 감내',
      passed: (metrics.rollingVolatility?.d90?.latest || 0) <= 0.45,
      detail: `90일 연환산 변동성 ${((metrics.rollingVolatility?.d90?.latest || 0) * 100).toFixed(1)}%`
    }
  ];

  return [
    {
      id: 'retirement',
      label: '연금 적립형 템플릿',
      isActive: accountType === 'retirement',
      description: '장기 적립, 안전자산 완충, 낙폭 관리 중심으로 보는 템플릿입니다.',
      rules: retirementRules
    },
    {
      id: 'brokerage',
      label: '일반 계좌 템플릿',
      isActive: accountType === 'brokerage',
      description: '집중도, 변동성, 벤치마크 대비 성과를 더 강하게 보는 템플릿입니다.',
      rules: brokerageRules
    }
  ];
};

export const computePortfolioAnalytics = (inputs = {}, options = {}) => {
  const normalized = normalizeAnalyticsInputs({
    ...inputs,
    includeCashInBreakdown: options.includeCashInBreakdown ?? inputs.includeCashInBreakdown
  });

  if (normalized.calendar.length === 0) {
    return {
      meta: {
        startDate: null,
        endDate: null,
        tradingDays: 0,
        benchmarkName: normalized.benchmarkName,
        accountType: normalized.accountType
      },
      series: {},
      metrics: {
        twr: 0,
        mwr: null,
        cagr: 0,
        cumulativeReturn: 0,
        maxDrawdown: 0,
        rollingVolatility: {
          d30: { latest: null, series: [] },
          d90: { latest: null, series: [] },
          y1: { latest: null, series: [] }
        },
        sharpe: 0,
        sortino: 0,
        beta: null,
        correlation: null,
        trackingError: null,
        benchmarkExcessReturn: null
      },
      contributions: {
        byAsset: [],
        flowVsMarket: []
      },
      rebalancing: {
        actual: null,
        rebalanced: null,
        delta: null
      },
      templates: []
    };
  }

  const externalCashFlows = buildExternalCashFlows(normalized);
  const useCashLedger = normalized.accountType !== 'brokerage' || externalCashFlows.some((flow) => flow.amount > 0);
  const cashSeries = buildCashLedger({
    calendar: normalized.calendar,
    currentCash: normalized.currentCash,
    transactions: normalized.transactions,
    enabled: useCashLedger
  });
  const assetSeries = buildAssetSeries(normalized);
  const { timeline, assetContributions } = buildPortfolioTimeline({
    assetSeries,
    cashSeries,
    externalCashFlows,
    accountType: normalized.accountType,
    includeCashInBreakdown: normalized.includeCashInBreakdown
  });
  const benchmarkTimeline = buildBenchmarkTimeline(normalized);
  const alignedBenchmarkPairs = alignPairs(timeline, benchmarkTimeline);

  const dailyReturns = timeline.slice(1).map((row) => row.dailyReturn);
  const twr = compoundReturns(dailyReturns);
  const cumulativeReturn = safeDivide(timeline[timeline.length - 1].indexValue, 100, 1) - 1;
  const cagr = annualizeReturn(cumulativeReturn, Math.max(timeline.length - 1, 1));
  const drawdown = maxDrawdown(timeline.map((row) => row.indexValue));
  const rollingVolatility = buildRollingVolatility(dailyReturns);

  const benchmarkReturns = alignedBenchmarkPairs.map(([, benchmark]) => benchmark.dailyReturn);
  const portfolioReturns = alignedBenchmarkPairs.map(([portfolio]) => portfolio.dailyReturn);
  const benchmarkVol = standardDeviation(benchmarkReturns);
  const portfolioVol = standardDeviation(dailyReturns);
  const dailyRiskFree = RISK_FREE_RATE / TRADING_DAYS;
  const sharpe = portfolioVol > 0
    ? ((mean(dailyReturns) - dailyRiskFree) / portfolioVol) * Math.sqrt(TRADING_DAYS)
    : 0;
  const sortinoBase = downsideDeviation(dailyReturns, dailyRiskFree);
  const sortino = sortinoBase > 0
    ? ((mean(dailyReturns) - dailyRiskFree) / sortinoBase) * Math.sqrt(TRADING_DAYS)
    : 0;
  const beta = benchmarkVol > 0 ? covariance(portfolioReturns, benchmarkReturns) / (benchmarkVol ** 2) : null;
  const correlation = (portfolioReturns.length > 1 && benchmarkReturns.length > 1 && portfolioVol > 0 && benchmarkVol > 0)
    ? covariance(portfolioReturns, benchmarkReturns) / (standardDeviation(portfolioReturns) * standardDeviation(benchmarkReturns))
    : null;
  const trackingError = benchmarkReturns.length > 1
    ? annualizeVolatility(standardDeviation(portfolioReturns.map((value, index) => value - benchmarkReturns[index])))
    : null;
  const benchmarkCumulativeReturn = benchmarkTimeline.length
    ? safeDivide(benchmarkTimeline[benchmarkTimeline.length - 1].indexValue, 100, 1) - 1
    : null;

  const allocationTimeline = buildAllocationTimeline({
    timeline,
    includeCashInBreakdown: normalized.includeCashInBreakdown
  });
  const monthlyReturns = buildMonthlyReturns(timeline);

  const cashFlowStream = [];
  const firstValue = timeline[0]?.totalValue || 0;
  if (firstValue > 0) {
    cashFlowStream.push({ date: timeline[0].date, amount: -firstValue });
  }
  externalCashFlows.forEach((flow) => {
    cashFlowStream.push({
      date: flow.date,
      amount: -toNumber(flow.amount)
    });
  });
  cashFlowStream.push({
    date: timeline[timeline.length - 1].date,
    amount: timeline[timeline.length - 1].totalValue
  });
  const mwr = xirr(cashFlowStream);

  const netExternalFlows = externalCashFlows.reduce((total, flow) => total + flow.amount, 0);
  const flowVsMarket = [
    {
      key: 'starting-value',
      label: '기초 평가액',
      amount: round(timeline[0]?.totalValue || 0, 2),
      kind: 'neutral'
    },
    {
      key: 'cash-flow',
      label: '현금흐름 효과',
      amount: round(netExternalFlows, 2),
      kind: netExternalFlows >= 0 ? 'positive' : 'negative'
    },
    {
      key: 'market-return',
      label: '시장 수익 효과',
      amount: round((timeline[timeline.length - 1]?.totalValue || 0) - (timeline[0]?.totalValue || 0) - netExternalFlows, 2),
      kind: (((timeline[timeline.length - 1]?.totalValue || 0) - (timeline[0]?.totalValue || 0) - netExternalFlows) >= 0) ? 'positive' : 'negative'
    },
    {
      key: 'ending-value',
      label: '기말 평가액',
      amount: round(timeline[timeline.length - 1]?.totalValue || 0, 2),
      kind: 'neutral'
    }
  ];

  const rebalancing = buildRebalancedComparison({
    timeline,
    includeCashInBreakdown: normalized.includeCashInBreakdown
  });

  const templates = buildTemplates({
    accountType: normalized.accountType,
    metrics: {
      maxDrawdown: drawdown,
      rollingVolatility
    },
    allocationTimeline,
    cashFlows: externalCashFlows,
    assetContributions,
    benchmarkCoverage: alignedBenchmarkPairs.length
  });

  return {
    meta: {
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      tradingDays: timeline.length,
      benchmarkName: normalized.benchmarkName,
      accountType: normalized.accountType
    },
    series: {
      timeline,
      benchmarkTimeline,
      allocationTimeline,
      monthlyReturns
    },
    metrics: {
      twr: round(twr, 8),
      mwr: mwr == null ? null : round(mwr, 8),
      cagr: round(cagr, 8),
      cumulativeReturn: round(cumulativeReturn, 8),
      maxDrawdown: round(drawdown, 8),
      rollingVolatility,
      sharpe: round(sharpe, 8),
      sortino: round(sortino, 8),
      beta: beta == null ? null : round(beta, 8),
      correlation: correlation == null ? null : round(correlation, 8),
      trackingError: trackingError == null ? null : round(trackingError, 8),
      benchmarkExcessReturn: benchmarkCumulativeReturn == null ? null : round(cumulativeReturn - benchmarkCumulativeReturn, 8),
      benchmarkCumulativeReturn: benchmarkCumulativeReturn == null ? null : round(benchmarkCumulativeReturn, 8)
    },
    contributions: {
      byAsset: assetContributions
        .map((asset) => ({
          ...asset,
          marketPnl: round(asset.marketPnl, 2),
          contributionReturn: round(asset.contributionReturn, 8),
          endingValue: round(asset.endingValue, 2)
        }))
        .sort((left, right) => Math.abs(right.marketPnl) - Math.abs(left.marketPnl)),
      flowVsMarket
    },
    rebalancing,
    templates
  };
};
