import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import Dashboard from '../Dashboard';
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
    getSummary: jest.fn(),
    getProducts: jest.fn(),
    getAllProducts: jest.fn(),
    getTrends: jest.fn(),
    getDomainModel: jest.fn(),
    searchProducts: jest.fn(),
    syncPrices: jest.fn(),
    getBenchmarkChart: jest.fn()
  };
  const tradeLogAPI = {
    getLogs: jest.fn()
  };
  return {
    __esModule: true,
    __mocks: { portfolioAPI, tradeLogAPI },
    DEFAULT_ACCOUNT_NAME: '퇴직연금',
    readStoredAccountName: jest.fn(() => '퇴직연금'),
    writeStoredAccountName: jest.fn(),
    portfolioAPI,
    tradeLogAPI
  };
});

const mockPortfolioAPI = __mocks.portfolioAPI;
const mockTradeLogAPI = __mocks.tradeLogAPI;

describe('Dashboard cockpit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseResolvedAccount.mockReturnValue({
      accountName: '퇴직연금',
      accountReady: true,
      changeAccountName: jest.fn(),
      syncAccountProfiles: jest.fn()
    });
  });

  it('matches loading snapshot', () => {
    const pending = new Promise(() => {});
    mockPortfolioAPI.getSummary.mockReturnValue(pending);
    mockPortfolioAPI.getProducts.mockReturnValue(pending);
    mockTradeLogAPI.getLogs.mockReturnValue(pending);

    const { asFragment } = render(<Dashboard />);
    expect(asFragment()).toMatchSnapshot();
  });

  it('matches error snapshot', async () => {
    mockPortfolioAPI.getSummary.mockRejectedValue(new Error('네트워크 오류'));
    mockPortfolioAPI.getProducts.mockResolvedValue([]);
    mockTradeLogAPI.getLogs.mockResolvedValue([]);

    const { asFragment } = render(<Dashboard />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(asFragment()).toMatchSnapshot();
  });

  it('matches empty/onboarding snapshot', async () => {
    mockPortfolioAPI.getSummary.mockResolvedValue({
      account_type: 'retirement',
      total_current_value: 0,
      total_investment: 0,
      total_profit_rate: 0,
      asset_allocation: { risk: { percentage: 0 } }
    });
    mockPortfolioAPI.getProducts.mockResolvedValue([]);
    mockTradeLogAPI.getLogs.mockResolvedValue([]);

    const { asFragment } = render(<Dashboard />);
    await waitFor(() => expect(screen.getByText('아직 보유 상품이 없습니다')).toBeInTheDocument());
    expect(asFragment()).toMatchSnapshot();
  });

  it('renders on mobile viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 });
    window.dispatchEvent(new Event('resize'));

    mockPortfolioAPI.getSummary.mockResolvedValue({
      account_type: 'retirement',
      total_current_value: 1200000,
      total_investment: 1000000,
      total_profit_rate: 20,
      asset_allocation: { risk: { percentage: 55 } }
    });
    mockPortfolioAPI.getProducts.mockResolvedValue([
      { id: 1, product_name: 'KODEX AI', product_code: '487240', profit_rate: 15, current_value: 600000 }
    ]);
    mockTradeLogAPI.getLogs.mockResolvedValue([
      { id: 1, product_name: 'KODEX AI', trade_type: 'buy', total_amount: 500000, trade_date: '2026-04-29', created_at: new Date().toISOString() }
    ]);

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByLabelText('핵심 운영 카드')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /카드$/ }).length).toBeGreaterThanOrEqual(7);
  });

  it('shows stale badge when asOf is old', async () => {
    mockPortfolioAPI.getSummary.mockResolvedValue({
      account_type: 'retirement',
      total_current_value: 1200000,
      total_investment: 1000000,
      total_profit_rate: 20,
      asset_allocation: { risk: { percentage: 55 } }
    });
    mockPortfolioAPI.getProducts.mockResolvedValue([
      { id: 1, product_name: 'KODEX AI', product_code: '487240', profit_rate: 15, current_value: 600000 }
    ]);
    mockTradeLogAPI.getLogs.mockResolvedValue([
      {
        id: 1,
        product_name: '오래된 기록',
        trade_type: 'buy',
        total_amount: 100000,
        trade_date: '2025-01-01',
        created_at: '2025-01-01T00:00:00Z'
      }
    ]);

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByLabelText('stale data warning')).toBeInTheDocument());
    expect(screen.getByText('STALE')).toBeInTheDocument();
  });
});
