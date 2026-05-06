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
    syncPrices: jest.fn()
  };

  return {
    __esModule: true,
    __mocks: { portfolioAPI },
    portfolioAPI
  };
});

const mockPortfolioAPI = __mocks.portfolioAPI;

describe('Dashboard overview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseResolvedAccount.mockReturnValue({
      accountName: '퇴직연금',
      accountReady: true,
      changeAccountName: jest.fn(),
      selectedAccountProfile: {
        account_type_label: '퇴직연금',
        account_category_label: 'IRP'
      },
      syncAccountProfiles: jest.fn()
    });
  });

  it('shows the loading skeleton while data is pending', () => {
    const pending = new Promise(() => {});
    mockPortfolioAPI.getSummary.mockReturnValue(pending);
    mockPortfolioAPI.getProducts.mockReturnValue(pending);

    render(<Dashboard />);
    expect(screen.getByLabelText('현황 로딩')).toBeInTheDocument();
  });

  it('shows the error state when the summary request fails', async () => {
    mockPortfolioAPI.getSummary.mockRejectedValue(new Error('네트워크 오류'));
    mockPortfolioAPI.getProducts.mockResolvedValue([]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('네트워크 오류')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });

  it('shows the onboarding state when there are no holdings or cash', async () => {
    mockPortfolioAPI.getSummary.mockResolvedValue({
      account_type: 'retirement',
      account_type_label: '퇴직연금',
      account_category_label: 'IRP',
      total_current_value: 0,
      total_investment: 0,
      total_cash: 0,
      total_profit_loss: 0,
      total_profit_rate: 0,
      asset_allocation: {
        risk: { percentage: 0, value: 0 },
        safe: { percentage: 0, value: 0 }
      }
    });
    mockPortfolioAPI.getProducts.mockResolvedValue([]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText('아직 보유 상품이 없습니다')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '매매일지로 이동' })).toBeInTheDocument();
  });

  it('renders the summary cards and core charts', async () => {
    mockPortfolioAPI.getSummary.mockResolvedValue({
      account_type: 'retirement',
      account_type_label: '퇴직연금',
      account_category_label: 'IRP',
      total_current_value: 1320000,
      total_investment: 1000000,
      total_cash: 120000,
      total_profit_loss: 320000,
      total_profit_rate: 32,
      asset_allocation: {
        risk: { percentage: 58, value: 696000 },
        safe: { percentage: 42, value: 504000 }
      }
    });
    mockPortfolioAPI.getProducts.mockResolvedValue([
      {
        id: 1,
        product_name: 'KODEX AI전력',
        product_code: '487240',
        asset_type: 'risk',
        purchase_date: '2026-04-01',
        total_purchase_value: 520000,
        current_value: 640000,
        profit_loss: 120000,
        profit_rate: 23.08
      },
      {
        id: 2,
        product_name: 'KOSEF 국고채10년',
        product_code: '148070',
        asset_type: 'safe',
        purchase_date: '2026-03-20',
        total_purchase_value: 280000,
        current_value: 300000,
        profit_loss: 20000,
        profit_rate: 7.14
      }
    ]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText('위험 / 안전 자산 비율')).toBeInTheDocument());
    expect(screen.getByText('원금 대비 성과')).toBeInTheDocument();
    expect(screen.getByText('현재 보유 종목 수익률')).toBeInTheDocument();
    expect(screen.getByText('현재 보유 종목')).toBeInTheDocument();
    expect(screen.getByText('종목 분석으로 이어서 보기')).toBeInTheDocument();
    expect(screen.getAllByTestId('data-badge').length).toBeGreaterThanOrEqual(5);
  });
});
