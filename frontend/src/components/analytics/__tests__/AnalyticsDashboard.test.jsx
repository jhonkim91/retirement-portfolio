import React from 'react';
import { render, screen } from '@testing-library/react';
import AnalyticsDashboard from '../AnalyticsDashboard';
import { createSyntheticAnalyticsReport } from '../../../lib/analytics/testFixtures';

describe('AnalyticsDashboard', () => {
  it('renders the analytics widget stack', () => {
    const report = createSyntheticAnalyticsReport();
    const { asFragment } = render(
      <AnalyticsDashboard
        report={report}
        loading={false}
        error=""
        benchmarkSelection={{ code: '069500', name: 'KODEX 200' }}
        benchmarkOptions={[{ code: '069500', name: 'KODEX 200' }]}
        benchmarkQuery=""
        benchmarkSearchResults={[]}
        benchmarkSearchLoading={false}
        onChangeBenchmarkQuery={() => {}}
        onSelectBenchmark={() => {}}
        onChangeBenchmarkPreset={() => {}}
        onExportReport={() => {}}
        exportingReport={false}
      />
    );

    expect(screen.getByText('포트폴리오 분석 엔진')).toBeInTheDocument();
    expect(screen.getByText('누적수익률 vs benchmark')).toBeInTheDocument();
    expect(screen.getByText('리밸런싱 전후 성과')).toBeInTheDocument();
    expect(screen.getByText('Benchmark 선택')).toBeInTheDocument();
    expect(asFragment()).toMatchSnapshot();
  });
});
