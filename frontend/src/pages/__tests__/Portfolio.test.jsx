import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import Portfolio, { __portfolioTestables } from '../Portfolio';
import { __mocks } from '../../utils/api';

const mockUseResolvedAccount = jest.fn();

jest.mock('../../components/AccountSelector', () => function MockAccountSelector() {
  return <div data-testid="account-selector">account-selector</div>;
});

jest.mock('../../components/DataBadge', () => function MockDataBadge() {
  return <span data-testid="data-badge">badge</span>;
});

jest.mock('../../hooks/useResolvedAccount', () => ({
  __esModule: true,
  default: () => mockUseResolvedAccount()
}));

jest.mock('../../utils/api', () => {
  const portfolioAPI = {
    getProducts: jest.fn(),
    getTrends: jest.fn(),
    searchProducts: jest.fn(),
    addProduct: jest.fn(),
    addCashDeposit: jest.fn(),
    updatePrice: jest.fn(),
    deleteProduct: jest.fn(),
    sellProduct: jest.fn(),
    addBuy: jest.fn(),
    updateProduct: jest.fn()
  };

  return {
    __esModule: true,
    __mocks: { portfolioAPI },
    portfolioAPI
  };
});

const mockPortfolioAPI = __mocks.portfolioAPI;

const productFixtures = [
  {
    id: 1,
    product_name: 'Alpha Core',
    product_code: 'ALP-1',
    purchase_date: '2026-01-05',
    purchase_price: 100000,
    current_price: 112000,
    current_value: 1120000,
    quantity: 10,
    unit_type: 'share',
    asset_type: 'risk',
    profit_rate: 12
  },
  {
    id: 2,
    product_name: 'Beta Dividend',
    product_code: 'BET-2',
    purchase_date: '2026-02-10',
    purchase_price: 90000,
    current_price: 97000,
    current_value: 970000,
    quantity: 10,
    unit_type: 'share',
    asset_type: 'safe',
    profit_rate: 7.8
  },
  {
    id: 3,
    product_name: 'Gamma Value',
    product_code: 'GAM-3',
    purchase_date: '2026-03-11',
    purchase_price: 80000,
    current_price: 86000,
    current_value: 860000,
    quantity: 10,
    unit_type: 'share',
    asset_type: 'risk',
    profit_rate: 7.5
  },
  {
    id: 4,
    product_name: 'Delta Cashflow',
    product_code: 'DEL-4',
    purchase_date: '2026-03-20',
    purchase_price: 70000,
    current_price: 72000,
    current_value: 360000,
    quantity: 5,
    unit_type: 'share',
    asset_type: 'safe',
    profit_rate: 2.8
  }
];

const trendFixtures = [
  { product_id: 1, product_name: 'Alpha Core', product_code: 'ALP-1', record_date: '2026-04-01', purchase_price: 100000, price: 108000, quantity: 10, unit_type: 'share', evaluation_value: 1080000, purchase_value: 1000000, profit_loss: 80000, price_return_rate: 8 },
  { product_id: 1, product_name: 'Alpha Core', product_code: 'ALP-1', record_date: '2026-04-20', purchase_price: 100000, price: 112000, quantity: 10, unit_type: 'share', evaluation_value: 1120000, purchase_value: 1000000, profit_loss: 120000, price_return_rate: 12 },
  { product_id: 2, product_name: 'Beta Dividend', product_code: 'BET-2', record_date: '2026-04-01', purchase_price: 90000, price: 94000, quantity: 10, unit_type: 'share', evaluation_value: 940000, purchase_value: 900000, profit_loss: 40000, price_return_rate: 4.44 },
  { product_id: 2, product_name: 'Beta Dividend', product_code: 'BET-2', record_date: '2026-04-20', purchase_price: 90000, price: 97000, quantity: 10, unit_type: 'share', evaluation_value: 970000, purchase_value: 900000, profit_loss: 70000, price_return_rate: 7.78 },
  { product_id: 3, product_name: 'Gamma Value', product_code: 'GAM-3', record_date: '2026-04-01', purchase_price: 80000, price: 83000, quantity: 10, unit_type: 'share', evaluation_value: 830000, purchase_value: 800000, profit_loss: 30000, price_return_rate: 3.75 },
  { product_id: 3, product_name: 'Gamma Value', product_code: 'GAM-3', record_date: '2026-04-20', purchase_price: 80000, price: 86000, quantity: 10, unit_type: 'share', evaluation_value: 860000, purchase_value: 800000, profit_loss: 60000, price_return_rate: 7.5 },
  { product_id: 4, product_name: 'Delta Cashflow', product_code: 'DEL-4', record_date: '2026-04-20', purchase_price: 70000, price: 72000, quantity: 5, unit_type: 'share', evaluation_value: 360000, purchase_value: 350000, profit_loss: 10000, price_return_rate: 2.86 }
];

describe('Portfolio trend workspace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();

    mockUseResolvedAccount.mockReturnValue({
      accountName: '주식 메인',
      accountReady: true,
      changeAccountName: jest.fn(),
      selectedAccountProfile: {
        account_type: 'brokerage',
        account_category: 'general'
      },
      syncAccountProfiles: jest.fn()
    });

    mockPortfolioAPI.getProducts.mockResolvedValue(productFixtures);
    mockPortfolioAPI.getTrends.mockResolvedValue(trendFixtures);
  });

  it('auto-selects the top 3 holdings for the chart on first load', async () => {
    render(<Portfolio />);

    const selectedList = await screen.findByLabelText('선택된 추이 상품');

    expect(within(selectedList).getAllByRole('button')).toHaveLength(3);
    expect(within(selectedList).getByRole('button', { name: /Alpha Core/i })).toBeInTheDocument();
    expect(within(selectedList).getByRole('button', { name: /Beta Dividend/i })).toBeInTheDocument();
    expect(within(selectedList).getByRole('button', { name: /Gamma Value/i })).toBeInTheDocument();
    expect(within(selectedList).queryByRole('button', { name: /Delta Cashflow/i })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem('portfolio_trend_selection_v1:주식 메인'))).toEqual(['1', '2', '3']);
    });
  });

  it('restores a saved chart selection for the current account', async () => {
    window.localStorage.setItem('portfolio_trend_selection_v1:주식 메인', JSON.stringify(['4', '2']));

    render(<Portfolio />);

    const selectedList = await screen.findByLabelText('선택된 추이 상품');

    expect(within(selectedList).getAllByRole('button')).toHaveLength(2);
    expect(within(selectedList).getByRole('button', { name: /Delta Cashflow/i })).toBeInTheDocument();
    expect(within(selectedList).getByRole('button', { name: /Beta Dividend/i })).toBeInTheDocument();
    expect(within(selectedList).queryByRole('button', { name: /Alpha Core/i })).not.toBeInTheDocument();
  });

  it('anchors manual trend ranges to the latest date instead of the purchase date', () => {
    const { buildTrendDateWindow, formatDateKey } = __portfolioTestables;
    const selected = new Set(['1', '2', '3']);

    const window = buildTrendDateWindow({
      products: productFixtures,
      selectedTrendProductSet: selected,
      rangeAmount: 1,
      rangeUnit: 'month',
      todayDate: new Date(2026, 4, 4)
    });

    expect(formatDateKey(window.startDate)).toBe('2026-04-04');
    expect(formatDateKey(window.endDate)).toBe('2026-05-04');
  });

  it('does not start a trend range before the selected holdings exist', () => {
    const { buildTrendDateWindow, formatDateKey } = __portfolioTestables;
    const selected = new Set(['3']);

    const window = buildTrendDateWindow({
      products: productFixtures,
      selectedTrendProductSet: selected,
      rangeAmount: 1,
      rangeUnit: 'year',
      todayDate: new Date(2026, 4, 4)
    });

    expect(formatDateKey(window.startDate)).toBe('2026-03-11');
    expect(formatDateKey(window.endDate)).toBe('2026-05-04');
  });
});
