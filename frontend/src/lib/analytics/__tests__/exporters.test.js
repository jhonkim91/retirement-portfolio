import {
  buildAnalyticsReportFilename,
  buildAnalyticsReportHtml
} from '../exporters';
import { createSyntheticAnalyticsReport } from '../testFixtures';

describe('analytics exporters', () => {
  it('builds a stable account analytics report html', () => {
    const report = createSyntheticAnalyticsReport();
    const html = buildAnalyticsReportHtml({
      report,
      accountName: '퇴직연금',
      benchmarkSelection: { code: '069500', name: 'KODEX 200' },
      exportedAt: '2026-04-28 10:30:00'
    });

    expect(html).toContain('퇴직연금 계좌 분석 리포트');
    expect(html).toContain('KODEX 200');
    expect(html).toContain('자산 기여도');
    expect(html).toMatchSnapshot();
  });

  it('sanitizes export filenames', () => {
    expect(buildAnalyticsReportFilename({
      accountName: '주식/통장',
      exportedAt: '2026-04-28 10:30:00'
    })).toBe('주식-통장-analytics-report-2026-04-28-10-30-00.html');
  });
});
