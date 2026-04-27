import { round, toNumber } from './normalizers';

export const sum = (values = []) => values.reduce((total, value) => total + toNumber(value), 0);

export const mean = (values = []) => {
  const filtered = values.filter((value) => Number.isFinite(value));
  return filtered.length ? sum(filtered) / filtered.length : 0;
};

export const variance = (values = []) => {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length < 2) return 0;
  const average = mean(filtered);
  return filtered.reduce((total, value) => total + ((value - average) ** 2), 0) / (filtered.length - 1);
};

export const standardDeviation = (values = []) => Math.sqrt(variance(values));

export const covariance = (left = [], right = []) => {
  const pairs = left
    .map((value, index) => [value, right[index]])
    .filter(([first, second]) => Number.isFinite(first) && Number.isFinite(second));
  if (pairs.length < 2) return 0;
  const leftMean = mean(pairs.map(([value]) => value));
  const rightMean = mean(pairs.map(([, value]) => value));
  return pairs.reduce((total, [first, second]) => total + ((first - leftMean) * (second - rightMean)), 0) / (pairs.length - 1);
};

export const safeDivide = (numerator, denominator, fallback = 0) => {
  const top = toNumber(numerator);
  const bottom = toNumber(denominator);
  return Math.abs(bottom) > 1e-12 ? top / bottom : fallback;
};

export const annualizeVolatility = (dailyStandardDeviation, periods = 252) => (
  toNumber(dailyStandardDeviation) * Math.sqrt(periods)
);

export const annualizeReturn = (totalReturn, tradingDays) => {
  if (!Number.isFinite(totalReturn) || tradingDays <= 0) return 0;
  return (1 + totalReturn) ** (252 / tradingDays) - 1;
};

export const downsideDeviation = (returns = [], marDaily = 0) => {
  const downside = returns
    .map((value) => Math.min(toNumber(value) - marDaily, 0))
    .map((value) => value ** 2);
  return Math.sqrt(mean(downside));
};

export const rollingStandardDeviation = (returns = [], windowSize = 30) => (
  returns.map((_, index) => {
    if (index + 1 < windowSize) return null;
    return standardDeviation(returns.slice(index + 1 - windowSize, index + 1));
  })
);

export const xnpv = (rate, cashFlows = []) => {
  if (!cashFlows.length) return 0;
  const firstDate = new Date(`${cashFlows[0].date}T00:00:00`);
  return cashFlows.reduce((total, cashFlow) => {
    const currentDate = new Date(`${cashFlow.date}T00:00:00`);
    const years = (currentDate.getTime() - firstDate.getTime()) / (365 * 24 * 60 * 60 * 1000);
    return total + (cashFlow.amount / ((1 + rate) ** years));
  }, 0);
};

export const xirr = (cashFlows = [], guess = 0.1) => {
  if (cashFlows.length < 2) return null;
  const hasPositive = cashFlows.some((cashFlow) => cashFlow.amount > 0);
  const hasNegative = cashFlows.some((cashFlow) => cashFlow.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  let lower = -0.9999;
  let upper = 10;
  let lowerValue = xnpv(lower, cashFlows);
  let upperValue = xnpv(upper, cashFlows);

  let expandCount = 0;
  while (lowerValue * upperValue > 0 && expandCount < 25) {
    upper *= 1.5;
    upperValue = xnpv(upper, cashFlows);
    expandCount += 1;
  }

  let rate = guess;
  for (let index = 0; index < 80; index += 1) {
    rate = (lower + upper) / 2;
    const value = xnpv(rate, cashFlows);
    if (Math.abs(value) < 1e-7) return rate;
    if (lowerValue * value <= 0) {
      upper = rate;
      upperValue = value;
    } else {
      lower = rate;
      lowerValue = value;
    }
  }

  return rate;
};

export const alignPairs = (leftRows = [], rightRows = []) => {
  const rightMap = new Map(rightRows.map((row) => [row.date, row]));
  return leftRows
    .map((row) => {
      const pair = rightMap.get(row.date);
      if (!pair) return null;
      return [row, pair];
    })
    .filter(Boolean);
};

export const maxDrawdown = (indexSeries = []) => {
  let peak = null;
  let worst = 0;
  indexSeries.forEach((value) => {
    const numeric = toNumber(value);
    peak = peak == null ? numeric : Math.max(peak, numeric);
    if (peak > 0) {
      worst = Math.min(worst, (numeric / peak) - 1);
    }
  });
  return round(worst, 6);
};
