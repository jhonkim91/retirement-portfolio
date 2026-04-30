import { toNumber } from './normalizers';

export const DEFAULT_BENCHMARKS = {
  retirement: {
    code: '069500',
    name: 'KODEX 200'
  },
  brokerage: {
    code: '069500',
    name: 'KODEX 200'
  }
};

export const buildAnalyticsInputs = ({
  accountType,
  holdings,
  products,
  summary,
  transactions,
  trends,
  benchmarkSeries
}) => {
  const accountHoldings = (holdings?.length ? holdings : products || []).map((product) => ({
    id: product.id,
    product_name: product.product_name,
    product_code: product.product_code,
    asset_type: product.asset_type,
    quantity: product.quantity,
    total_purchase_value: product.total_purchase_value,
    current_value: product.current_value
  }));

  const priceSeries = (trends || []).map((row) => ({
    product_id: row.product_id,
    product_name: row.product_name,
    asset_type: row.asset_type,
    quantity: row.quantity,
    price: row.price,
    evaluation_value: row.evaluation_value,
    purchase_value: row.purchase_value,
    record_date: row.record_date
  }));

  const depositCashFlows = (transactions || [])
    .filter((transaction) => transaction.trade_type === 'deposit')
    .map((transaction) => ({
      id: transaction.id,
      date: transaction.trade_date,
      amount: transaction.total_amount,
      label: transaction.product_name || 'Deposit'
    }));

  const benchmarkName = benchmarkSeries?.name || DEFAULT_BENCHMARKS[accountType]?.name || 'Benchmark';
  const seriesRows = benchmarkSeries?.series || [];

  return {
    accountType,
    holdings: accountHoldings,
    transactions,
    cashFlows: depositCashFlows,
    benchmarkName,
    benchmarkSeries: seriesRows,
    priceSeries,
    currentCash: toNumber(summary?.total_cash),
    includeCashInBreakdown: accountType !== 'brokerage'
  };
};

const normalizeWrapperTypeToAccountType = (wrapperType) => (
  wrapperType === 'brokerage' ? 'brokerage' : 'retirement'
);

const buildSyntheticPriceSeriesFromSnapshots = (snapshots = [], selectedWrapperIds = new Set()) => {
  const rows = [];
  snapshots.forEach((snapshot) => {
    const payload = snapshot?.payload || {};
    const holdings = Array.isArray(payload?.holdings) ? payload.holdings : [];
    holdings.forEach((holding) => {
      const accountWrapperId = holding.account_wrapper_id || snapshot.account_wrapper_id;
      if (selectedWrapperIds.size > 0 && accountWrapperId && !selectedWrapperIds.has(accountWrapperId)) return;
      const symbol = String(holding.product_code || holding.symbol || holding.product_name || '').trim();
      if (!symbol) return;
      rows.push({
        product_id: `${accountWrapperId || 'all'}:${symbol}`,
        product_name: holding.product_name || symbol,
        asset_type: holding.asset_type || 'risk',
        quantity: holding.quantity || 0,
        price: holding.price || 0,
        evaluation_value: holding.evaluation_value || 0,
        purchase_value: holding.purchase_value || 0,
        record_date: snapshot.snapshot_date
      });
    });
  });
  return rows;
};

const groupLotsToHoldings = (lots = []) => {
  const grouped = new Map();
  lots.forEach((lot) => {
    const key = `${lot.account_wrapper_id}:${lot.symbol}`;
    const previous = grouped.get(key) || {
      id: key,
      product_name: lot.product_name || lot.symbol,
      product_code: lot.symbol,
      asset_type: lot.asset_type || 'risk',
      quantity: 0,
      total_purchase_value: 0,
      current_value: 0
    };
    const quantity = Number(lot.quantity || 0);
    const unitCost = Number(lot.unit_cost || 0);
    previous.quantity += quantity;
    previous.total_purchase_value += quantity * unitCost;
    grouped.set(key, previous);
  });
  return Array.from(grouped.values());
};

const buildTransactionsFromCashFlows = (cashFlows = []) => (
  (cashFlows || []).map((flow, index) => ({
    id: flow.id || `flow-${index}`,
    trade_date: flow.flow_date || flow.date,
    trade_type: flow.flow_type || 'deposit',
    product_name: flow.symbol || flow.flow_type || 'cash_flow',
    product_id: null,
    quantity: 0,
    price: 0,
    total_amount: Number(flow.amount || 0),
    asset_type: 'cash',
    notes: flow.notes || ''
  }))
);

export const buildAnalyticsInputsFromDomain = (domainPayload = {}, options = {}) => {
  const wrappers = Array.isArray(domainPayload.account_wrappers) ? domainPayload.account_wrappers : [];
  const selectedMode = options.mode === 'account' ? 'account' : 'all';
  const selectedAccountId = options.accountWrapperId || '';
  const selectedWrapperIds = selectedMode === 'account' && selectedAccountId
    ? new Set([selectedAccountId])
    : new Set(wrappers.map((wrapper) => wrapper.id));

  const lots = (Array.isArray(domainPayload.holdings_lots) ? domainPayload.holdings_lots : [])
    .filter((lot) => selectedWrapperIds.has(lot.account_wrapper_id));
  const cashFlows = (Array.isArray(domainPayload.cash_flows) ? domainPayload.cash_flows : [])
    .filter((flow) => selectedWrapperIds.has(flow.account_wrapper_id));
  const snapshots = (Array.isArray(domainPayload.portfolio_snapshots) ? domainPayload.portfolio_snapshots : [])
    .filter((row) => (
      row.account_name === '__all__'
        ? selectedMode !== 'account'
        : selectedWrapperIds.has(row.account_wrapper_id)
    ));

  const allPriceSeries = Array.isArray(domainPayload.price_series) && domainPayload.price_series.length > 0
    ? domainPayload.price_series
    : buildSyntheticPriceSeriesFromSnapshots(snapshots, selectedWrapperIds);
  const filteredPriceSeries = allPriceSeries.filter((row) => {
    if (selectedMode !== 'account') return true;
    const wrapperId = row.account_wrapper_id || String(row.product_id || '').split(':')[0];
    return wrapperId === selectedAccountId;
  });

  const holdings = groupLotsToHoldings(lots);
  const latestByHoldingId = new Map();
  filteredPriceSeries.forEach((row) => {
    const key = String(row.product_id || '');
    if (!key) return;
    const previous = latestByHoldingId.get(key);
    if (!previous || String(row.record_date || '') > String(previous.record_date || '')) {
      latestByHoldingId.set(key, row);
    }
  });
  holdings.forEach((holding) => {
    const symbol = String(holding.product_code || '').trim();
    const matched = Array.from(latestByHoldingId.values()).find(
      (row) => String(row.product_code || '').trim() === symbol
    );
    if (matched) {
      holding.current_value = Number(matched.evaluation_value || 0);
    }
  });

  const snapshotCandidates = selectedMode === 'all'
    ? snapshots.filter((row) => row.account_name === '__all__')
    : snapshots.filter((row) => row.account_name !== '__all__' && row.account_wrapper_id === selectedAccountId);
  const latestSnapshot = [...snapshotCandidates]
    .sort((left, right) => String(right.snapshot_date || '').localeCompare(String(left.snapshot_date || '')))[0];
  const totalCash = Number(latestSnapshot?.cash_balance || 0);

  const selectedWrapper = wrappers.find((wrapper) => wrapper.id === selectedAccountId);
  let accountType = 'retirement';
  if (selectedMode === 'account' && selectedWrapper) {
    accountType = normalizeWrapperTypeToAccountType(selectedWrapper.type);
  } else {
    const hasBrokerage = wrappers.some((wrapper) => wrapper.type === 'brokerage');
    const hasRetirement = wrappers.some((wrapper) => wrapper.type !== 'brokerage');
    accountType = hasBrokerage && hasRetirement ? 'multi' : (hasBrokerage ? 'brokerage' : 'retirement');
  }

  const transactions = buildTransactionsFromCashFlows(cashFlows);
  const benchmarkRows = Array.isArray(domainPayload.benchmarks) ? domainPayload.benchmarks : [];
  const selectedBenchmark = selectedMode === 'account' && selectedAccountId
    ? benchmarkRows.find((row) => row.account_wrapper_id === selectedAccountId && row.is_default)
      || benchmarkRows.find((row) => row.account_wrapper_id === selectedAccountId)
    : benchmarkRows.find((row) => row.is_default) || benchmarkRows[0];

  return {
    accountType,
    holdings,
    transactions,
    cashFlows: cashFlows.map((flow) => ({
      id: flow.id,
      date: flow.flow_date,
      amount: Number(flow.amount || 0),
      label: flow.symbol || flow.flow_type || 'cash_flow',
      category: flow.flow_type || 'other'
    })),
    benchmarkName: selectedBenchmark?.name || 'Benchmark',
    benchmarkSeries: selectedBenchmark?.series || [],
    priceSeries: filteredPriceSeries,
    currentCash: totalCash,
    includeCashInBreakdown: accountType !== 'brokerage'
  };
};
