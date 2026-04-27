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
