const percent = (value) => `${(Number(value || 0) * 100).toFixed(2)}%`;
const number = (value, digits = 3) => Number(value || 0).toFixed(digits);
const money = (value) => new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0
}).format(Number(value || 0));

const escapeHtml = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const metricRows = (report) => ([
  ['TWR', percent(report.metrics?.twr)],
  ['MWR / IRR', report.metrics?.mwr == null ? '-' : percent(report.metrics.mwr)],
  ['CAGR', percent(report.metrics?.cagr)],
  ['Cumulative return', percent(report.metrics?.cumulativeReturn)],
  ['Max drawdown', percent(report.metrics?.maxDrawdown)],
  ['Rolling vol 30d', report.metrics?.rollingVolatility?.d30?.latest == null ? '-' : percent(report.metrics.rollingVolatility.d30.latest)],
  ['Rolling vol 90d', report.metrics?.rollingVolatility?.d90?.latest == null ? '-' : percent(report.metrics.rollingVolatility.d90.latest)],
  ['Rolling vol 1y', report.metrics?.rollingVolatility?.y1?.latest == null ? '-' : percent(report.metrics.rollingVolatility.y1.latest)],
  ['Sharpe', number(report.metrics?.sharpe, 3)],
  ['Sortino', number(report.metrics?.sortino, 3)],
  ['Beta', report.metrics?.beta == null ? '-' : number(report.metrics.beta, 3)],
  ['Correlation', report.metrics?.correlation == null ? '-' : number(report.metrics.correlation, 3)],
  ['Tracking error', report.metrics?.trackingError == null ? '-' : percent(report.metrics.trackingError)],
  ['Benchmark excess return', report.metrics?.benchmarkExcessReturn == null ? '-' : percent(report.metrics.benchmarkExcessReturn)]
]);

export const buildAnalyticsReportHtml = ({ report, accountName, benchmarkSelection, exportedAt }) => {
  const contributionRows = (report.contributions?.byAsset || [])
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.assetType)}</td>
        <td>${money(item.endingValue)}</td>
        <td>${money(item.marketPnl)}</td>
        <td>${percent(item.contributionReturn)}</td>
      </tr>
    `)
    .join('');

  const flowRows = (report.contributions?.flowVsMarket || [])
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.label)}</td>
        <td>${money(item.amount)}</td>
      </tr>
    `)
    .join('');

  const templateRows = (report.templates || [])
    .map((template) => `
      <section class="template-card">
        <h3>${escapeHtml(template.label)} ${template.isActive ? '<small>(현재 계좌)</small>' : ''}</h3>
        <p>${escapeHtml(template.description)}</p>
        <ul>
          ${template.rules.map((rule) => `
            <li>
              <strong>${escapeHtml(rule.label)}</strong>
              <span>${escapeHtml(rule.detail)}</span>
              <em>${rule.passed ? '적합' : '주의'}</em>
            </li>
          `).join('')}
        </ul>
      </section>
    `)
    .join('');

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(accountName)} 분석 리포트</title>
    <style>
      body { font-family: Arial, "Noto Sans KR", sans-serif; margin: 32px; color: #102a43; }
      h1, h2, h3 { margin: 0 0 12px; }
      p { line-height: 1.6; color: #486581; }
      .meta { margin: 12px 0 24px; padding: 16px; background: #f7fafc; border: 1px solid #d9e2ec; border-radius: 8px; }
      .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0 26px; }
      .metric-card { border: 1px solid #d9e2ec; border-radius: 8px; padding: 12px; background: #fff; }
      .metric-card span { display: block; color: #486581; font-size: 13px; }
      .metric-card strong { display: block; margin-top: 6px; font-size: 18px; }
      table { width: 100%; border-collapse: collapse; margin: 14px 0 22px; }
      th, td { padding: 10px 12px; border-bottom: 1px solid #e5eaf0; text-align: left; }
      th { background: #f7fafc; }
      .template-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
      .template-card { border: 1px solid #d9e2ec; border-radius: 8px; padding: 14px; }
      .template-card ul { margin: 12px 0 0; padding-left: 18px; }
      .template-card li { margin-bottom: 10px; }
      .small { color: #697586; font-size: 13px; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(accountName)} 계좌 분석 리포트</h1>
    <div class="meta">
      <p><strong>분석 구간:</strong> ${escapeHtml(report.meta?.startDate)} ~ ${escapeHtml(report.meta?.endDate)}</p>
      <p><strong>비교 benchmark:</strong> ${escapeHtml(benchmarkSelection?.name || report.meta?.benchmarkName || 'Benchmark')}</p>
      <p><strong>내보낸 시각:</strong> ${escapeHtml(exportedAt)}</p>
      <p><strong>계좌 유형:</strong> ${escapeHtml(report.meta?.accountType === 'brokerage' ? '일반/주식 통장' : '연금 계좌')}</p>
    </div>

    <h2>핵심 지표</h2>
    <div class="metric-grid">
      ${metricRows(report).map(([label, value]) => `
        <article class="metric-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </article>
      `).join('')}
    </div>

    <h2>자산 기여도</h2>
    <table>
      <thead>
        <tr>
          <th>자산</th>
          <th>유형</th>
          <th>기말 평가액</th>
          <th>시장 기여 손익</th>
          <th>기여 수익률</th>
        </tr>
      </thead>
      <tbody>${contributionRows}</tbody>
    </table>

    <h2>현금흐름 vs 시장수익</h2>
    <table>
      <thead>
        <tr>
          <th>항목</th>
          <th>금액</th>
        </tr>
      </thead>
      <tbody>${flowRows}</tbody>
    </table>

    <h2>계좌별 템플릿 평가</h2>
    <div class="template-grid">${templateRows}</div>

    <p class="small">이 리포트는 자산관리 대장의 포트폴리오 분석 엔진 결과를 기준으로 생성했습니다.</p>
  </body>
</html>`;
};

export const buildAnalyticsReportFilename = ({ accountName, exportedAt }) => {
  const safeAccountName = String(accountName || 'account').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'account';
  const dateToken = String(exportedAt || '').replace(/[: ]/g, '-');
  return `${safeAccountName}-analytics-report-${dateToken}.html`;
};

export const downloadAnalyticsReport = ({ filename, html }) => {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
};
