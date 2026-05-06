import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AccountAnalyticsPanel from '../AccountAnalyticsPanel';
import { __mocks } from '../../utils/api';

const mockComputePortfolioAnalytics = jest.fn();

jest.mock('../analytics/AnalyticsDashboard', () => ({
  __esModule: true,
  default: function MockAnalyticsDashboard({ error, report }) {
    return (
      <div data-testid="analytics-dashboard">
        {error || (report ? 'dashboard-ready' : 'dashboard-empty')}
      </div>
    );
  }
}));

jest.mock('../../lib/analytics/engine', () => ({
  __esModule: true,
  computePortfolioAnalytics: (...args) => mockComputePortfolioAnalytics(...args)
}));

jest.mock('../../utils/api', () => {
  const portfolioAPI = {
    getSummary: jest.fn(),
    getAllProducts: jest.fn(),
    getTrends: jest.fn(),
    getDomainModel: jest.fn(),
    getBenchmarkChart: jest.fn(),
    searchProducts: jest.fn()
  };
  const tradeLogAPI = {
    getLogs: jest.fn()
  };

  return {
    __esModule: true,
    __mocks: { portfolioAPI, tradeLogAPI },
    portfolioAPI,
    tradeLogAPI
  };
});

const mockPortfolioAPI = __mocks.portfolioAPI;
const mockTradeLogAPI = __mocks.tradeLogAPI;

describe('AccountAnalyticsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockComputePortfolioAnalytics.mockReturnValue({
      meta: {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        benchmarkName: 'KODEX 200'
      },
      series: {
        timeline: [{ date: '2026-01-01' }]
      }
    });

    mockPortfolioAPI.getSummary.mockResolvedValue({
      account_type: 'retirement',
      total_cash: 0
    });
    mockPortfolioAPI.getAllProducts.mockResolvedValue([]);
    mockPortfolioAPI.getTrends.mockResolvedValue([]);
    mockPortfolioAPI.getBenchmarkChart.mockResolvedValue({ series: [] });
    mockPortfolioAPI.searchProducts.mockResolvedValue([]);
    mockTradeLogAPI.getLogs.mockResolvedValue([]);
  });

  it('falls back to the legacy analytics inputs when domain-model is unavailable', async () => {
    const missingDomainModel = new Error('not found');
    missingDomainModel.status = 404;
    mockPortfolioAPI.getDomainModel.mockRejectedValue(missingDomainModel);

    render(
      <AccountAnalyticsPanel
        accountName="퇴직연금"
        accountReady
        accountType="retirement"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '열기' }));

    await waitFor(() => expect(screen.getByTestId('analytics-dashboard')).toBeInTheDocument());
    await waitFor(() => expect(mockComputePortfolioAnalytics).toHaveBeenCalled());

    expect(screen.getByText('심층 분석 전용 데이터 모델이 아직 배포되지 않아 기본 분석 경로로 계산했습니다.')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-dashboard')).toHaveTextContent('dashboard-ready');
    expect(screen.queryByText('계좌 분석 데이터를 불러오지 못했습니다.')).not.toBeInTheDocument();
  });
});
