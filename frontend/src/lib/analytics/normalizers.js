const DAY_MS = 24 * 60 * 60 * 1000;

export const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
};

export const toDateKey = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const text = String(value).trim();
  if (!text) return null;
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return toDateKey(date);
};

export const toDate = (value) => {
  const key = toDateKey(value);
  return key ? new Date(`${key}T00:00:00`) : null;
};

export const businessDayCalendar = (startValue, endValue) => {
  const startDate = toDate(startValue);
  const endDate = toDate(endValue);
  if (!startDate || !endDate || startDate > endDate) return [];

  const calendar = [];
  for (let current = new Date(startDate); current <= endDate; current = new Date(current.getTime() + DAY_MS)) {
    const day = current.getDay();
    if (day === 0 || day === 6) continue;
    calendar.push(toDateKey(current));
  }
  return calendar;
};

const sortByDate = (rows) => (
  [...rows].sort((left, right) => {
    const leftDate = toDateKey(left.date) || '';
    const rightDate = toDateKey(right.date) || '';
    return leftDate.localeCompare(rightDate);
  })
);

export const fillForwardSeries = (rows, calendar, mapRow) => {
  const rowMap = new Map();
  sortByDate(rows).forEach((row) => {
    const date = toDateKey(row.date);
    if (date) rowMap.set(date, row);
  });

  let lastKnown = null;
  return calendar.map((date) => {
    const exact = rowMap.get(date);
    if (exact) {
      lastKnown = exact;
      return mapRow(exact, date, false);
    }
    if (!lastKnown) return mapRow(null, date, true);
    return mapRow(lastKnown, date, true);
  });
};

export const normalizeHoldings = (holdings = []) => (
  holdings
    .map((holding, index) => ({
      id: String(holding.id ?? holding.product_id ?? `holding-${index}`),
      name: String(holding.product_name || holding.name || `Asset ${index + 1}`),
      code: String(holding.product_code || holding.code || ''),
      assetType: String(holding.asset_type || holding.assetType || 'risk'),
      quantity: toNumber(holding.quantity),
      purchaseValue: toNumber(holding.total_purchase_value ?? holding.purchaseValue),
      currentValue: toNumber(holding.current_value ?? holding.currentValue),
      isCash: Boolean(holding.is_cash || holding.isCash)
    }))
    .filter((holding) => holding.name)
);

export const normalizeTransactions = (transactions = []) => (
  sortByDate(
    transactions.map((transaction, index) => ({
      id: String(transaction.id ?? `txn-${index}`),
      date: toDateKey(transaction.trade_date || transaction.date),
      productId: transaction.product_id != null ? String(transaction.product_id) : null,
      productName: String(transaction.product_name || transaction.productName || ''),
      type: String(transaction.trade_type || transaction.type || '').toLowerCase(),
      quantity: toNumber(transaction.quantity),
      price: toNumber(transaction.price),
      totalAmount: toNumber(transaction.total_amount ?? transaction.totalAmount),
      assetType: String(transaction.asset_type || transaction.assetType || 'risk')
    }))
  ).filter((transaction) => transaction.date && transaction.type)
);

export const normalizeCashFlows = (cashFlows = []) => (
  sortByDate(
    cashFlows.map((cashFlow, index) => ({
      id: String(cashFlow.id ?? `flow-${index}`),
      date: toDateKey(cashFlow.trade_date || cashFlow.date),
      amount: toNumber(cashFlow.amount ?? cashFlow.total_amount ?? cashFlow.totalAmount),
      label: String(cashFlow.label || cashFlow.product_name || cashFlow.productName || 'Cash flow'),
      direction: cashFlow.direction || null
    }))
  ).filter((cashFlow) => cashFlow.date)
);

export const normalizeBenchmarkSeries = (benchmarkSeries = []) => (
  sortByDate(
    benchmarkSeries.map((row) => ({
      date: toDateKey(row.record_date || row.date),
      price: toNumber(row.price)
    }))
  ).filter((row) => row.date && row.price > 0)
);

export const normalizePriceSeries = (priceSeries = []) => (
  sortByDate(
    priceSeries.map((row, index) => ({
      id: String(row.id ?? `price-${index}`),
      date: toDateKey(row.record_date || row.date),
      productId: String(row.product_id ?? row.productId ?? `asset-${index}`),
      productName: String(row.product_name || row.productName || `Asset ${index + 1}`),
      assetType: String(row.asset_type || row.assetType || 'risk'),
      quantity: toNumber(row.quantity),
      price: toNumber(row.price),
      evaluationValue: toNumber(row.evaluation_value ?? row.evaluationValue),
      purchaseValue: toNumber(row.purchase_value ?? row.purchaseValue)
    }))
  ).filter((row) => row.date)
);

export const normalizeAnalyticsInputs = (inputs = {}) => {
  const holdings = normalizeHoldings(inputs.holdings);
  const transactions = normalizeTransactions(inputs.transactions);
  const cashFlows = normalizeCashFlows(inputs.cashFlows);
  const benchmarkSeries = normalizeBenchmarkSeries(inputs.benchmarkSeries);
  const priceSeries = normalizePriceSeries(inputs.priceSeries);

  const allDates = [
    ...priceSeries.map((row) => row.date),
    ...benchmarkSeries.map((row) => row.date),
    ...transactions.map((row) => row.date),
    ...cashFlows.map((row) => row.date)
  ].filter(Boolean);

  const startDate = allDates.length > 0 ? allDates.reduce((min, value) => (value < min ? value : min), allDates[0]) : null;
  const endDate = allDates.length > 0 ? allDates.reduce((max, value) => (value > max ? value : max), allDates[0]) : null;
  const calendar = startDate && endDate ? businessDayCalendar(startDate, endDate) : [];

  return {
    holdings,
    transactions,
    cashFlows,
    benchmarkSeries,
    priceSeries,
    calendar,
    startDate,
    endDate,
    accountType: String(inputs.accountType || 'retirement'),
    benchmarkName: String(inputs.benchmarkName || 'Benchmark'),
    currentCash: toNumber(inputs.currentCash),
    includeCashInBreakdown: inputs.includeCashInBreakdown !== false
  };
};
