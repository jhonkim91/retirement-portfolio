import { buildAnalyticsInputs } from './adapters';
import { computePortfolioAnalytics } from './engine';

const businessDays = (count, start = '2025-01-02') => {
  const dates = [];
  let cursor = new Date(`${start}T00:00:00`);
  while (dates.length < count) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      const year = cursor.getFullYear();
      const month = String(cursor.getMonth() + 1).padStart(2, '0');
      const date = String(cursor.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${date}`);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

export const createSyntheticAnalyticsPayload = () => {
  const dates = businessDays(280);
  const priceSeries = [];
  const benchmarkSeries = [];
  const transactions = [
    {
      id: 'deposit-1',
      trade_date: dates[0],
      trade_type: 'deposit',
      total_amount: 20000,
      product_name: '초기 입금'
    },
    {
      id: 'buy-a',
      trade_date: dates[0],
      trade_type: 'buy',
      product_id: 1,
      product_name: 'Alpha ETF',
      quantity: 100,
      price: 100,
      total_amount: 10000,
      asset_type: 'risk'
    },
    {
      id: 'buy-b',
      trade_date: dates[30],
      trade_type: 'buy',
      product_id: 2,
      product_name: 'Beta Bond',
      quantity: 50,
      price: 200,
      total_amount: 10000,
      asset_type: 'safe'
    }
  ];

  let alphaPrice = 100;
  let betaPrice = 200;
  let benchmarkPrice = 100;

  dates.forEach((date, index) => {
    alphaPrice *= 1.0012;
    benchmarkPrice *= 1.0009;
    priceSeries.push({
      product_id: 1,
      product_name: 'Alpha ETF',
      asset_type: 'risk',
      quantity: 100,
      price: Number(alphaPrice.toFixed(4)),
      evaluation_value: Number((100 * alphaPrice).toFixed(4)),
      purchase_value: 10000,
      record_date: date
    });

    if (index >= 30) {
      betaPrice *= 1.0005;
      priceSeries.push({
        product_id: 2,
        product_name: 'Beta Bond',
        asset_type: 'safe',
        quantity: 50,
        price: Number(betaPrice.toFixed(4)),
        evaluation_value: Number((50 * betaPrice).toFixed(4)),
        purchase_value: 10000,
        record_date: date
      });
    }

    benchmarkSeries.push({
      date,
      price: Number(benchmarkPrice.toFixed(4))
    });
  });

  const latestAlpha = priceSeries.filter((row) => row.product_id === 1).slice(-1)[0];
  const latestBeta = priceSeries.filter((row) => row.product_id === 2).slice(-1)[0];

  return buildAnalyticsInputs({
    accountType: 'retirement',
    holdings: [
      {
        id: 1,
        product_name: 'Alpha ETF',
        product_code: '111111',
        asset_type: 'risk',
        quantity: 100,
        total_purchase_value: 10000,
        current_value: latestAlpha.evaluation_value
      },
      {
        id: 2,
        product_name: 'Beta Bond',
        product_code: '222222',
        asset_type: 'safe',
        quantity: 50,
        total_purchase_value: 10000,
        current_value: latestBeta.evaluation_value
      }
    ],
    products: [],
    summary: {
      total_cash: 0
    },
    transactions,
    trends: priceSeries,
    benchmarkSeries: {
      name: 'Synthetic Benchmark',
      series: benchmarkSeries
    }
  });
};

export const createSyntheticAnalyticsReport = () => computePortfolioAnalytics(createSyntheticAnalyticsPayload());
