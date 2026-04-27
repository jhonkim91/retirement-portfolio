import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  Brush,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  buildAllocationDriftChart,
  buildContributionWaterfall,
  buildCumulativeComparisonChart,
  buildDrawdownChart,
  buildFlowAttributionChart,
  buildMonthlyHeatmap,
  buildRiskCards
} from '../../lib/analytics/transformers';
import '../../styles/Analytics.css';

const POSITIVE_COLOR = '#256f68';
const NEGATIVE_COLOR = '#d94841';
const BENCHMARK_COLOR = '#8d6cab';
const PORTFOLIO_COLOR = '#33658a';
const RISK_COLOR = '#d94841';
const SAFE_COLOR = '#256f68';
const CASH_COLOR = '#7b8794';

const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;
const formatNumber = (value, digits = 2) => Number(value || 0).toFixed(digits);
const formatCurrency = (value) => new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0
}).format(Number(value || 0));

const colorForValue = (value) => (Number(value || 0) >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR);

function MetricCard({ card }) {
  const empty = card.value == null;
  const numericValue = Number(card.value || 0);
  const tone = empty ? '' : (numericValue >= 0 ? 'positive' : 'negative');

  return (
    <article className={`analytics-metric-card ${tone}`}>
      <span>{card.label}</span>
      <strong>{empty ? '-' : `${formatNumber(card.value, card.suffix === '%' ? 2 : 3)}${card.suffix}`}</strong>
    </article>
  );
}

function WaterfallWidget({ title, rows }) {
  return (
    <section className="analytics-panel">
      <div className="analytics-panel-header">
        <h3>{title}</h3>
      </div>
      <div className="analytics-chart-shell">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart layout="vertical" data={rows} margin={{ top: 12, right: 16, bottom: 8, left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tickFormatter={(value) => formatCurrency(value)} />
            <YAxis dataKey="label" type="category" width={120} />
            <Tooltip
              formatter={(value, key, item) => {
                if (key === 'span') {
                  return [formatCurrency(item.payload.amount), item.payload.label];
                }
                return [formatCurrency(value), key];
              }}
            />
            <Bar dataKey="start" stackId="waterfall" fill="transparent" />
            <Bar dataKey="span" stackId="waterfall" radius={[0, 4, 4, 0]}>
              {rows.map((row) => (
                <Cell
                  key={row.key || row.label}
                  fill={row.kind === 'positive' ? POSITIVE_COLOR : row.kind === 'negative' ? NEGATIVE_COLOR : PORTFOLIO_COLOR}
                />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function MonthlyHeatmap({ data }) {
  const colorScale = (value) => {
    if (value == null) return '#f4f7fb';
    if (value >= 12) return '#256f68';
    if (value >= 4) return '#4f8c83';
    if (value >= 0) return '#dce6f2';
    if (value >= -8) return '#f1c7c3';
    return '#d94841';
  };

  return (
    <section className="analytics-panel">
      <div className="analytics-panel-header">
        <h3>월간 heatmap</h3>
      </div>
      <div className="analytics-heatmap">
        <div className="analytics-heatmap-grid analytics-heatmap-head">
          <span />
          {data.years.map((year) => <strong key={year}>{year}</strong>)}
        </div>
        {data.rows.map((row) => (
          <div key={row.month} className="analytics-heatmap-grid">
            <span className="analytics-heatmap-label">{row.month}월</span>
            {data.years.map((year) => {
              const value = row.values[year];
              return (
                <div
                  key={`${year}-${row.month}`}
                  className="analytics-heatmap-cell"
                  style={{ backgroundColor: colorScale(value) }}
                  title={value == null ? '데이터 없음' : `${year}-${String(row.month).padStart(2, '0')}: ${formatPercent(value)}`}
                >
                  {value == null ? '-' : `${value.toFixed(1)}%`}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function TemplatePanel({ templates }) {
  return (
    <section className="analytics-panel analytics-template-panel">
      <div className="analytics-panel-header">
        <h3>분석 템플릿</h3>
      </div>
      <div className="analytics-template-grid">
        {templates.map((template) => (
          <article key={template.id} className={`analytics-template-card ${template.isActive ? 'active' : ''}`}>
            <div className="analytics-template-top">
              <strong>{template.label}</strong>
              <span>{template.isActive ? '현재 계좌' : '참고 템플릿'}</span>
            </div>
            <p>{template.description}</p>
            <ul className="analytics-rule-list">
              {template.rules.map((rule) => (
                <li key={rule.label} className={rule.passed ? 'pass' : 'fail'}>
                  <div>
                    <strong>{rule.label}</strong>
                    <span>{rule.detail}</span>
                  </div>
                  <em>{rule.passed ? '적합' : '주의'}</em>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

function RebalancingPanel({ rebalancing }) {
  if (!rebalancing?.actual || !rebalancing?.rebalanced) {
    return null;
  }

  const rows = [
    {
      label: '누적 수익률',
      actual: rebalancing.actual.cumulativeReturn * 100,
      rebalanced: rebalancing.rebalanced.cumulativeReturn * 100,
      delta: rebalancing.delta.cumulativeReturn * 100
    },
    {
      label: '최대 낙폭',
      actual: rebalancing.actual.maxDrawdown * 100,
      rebalanced: rebalancing.rebalanced.maxDrawdown * 100,
      delta: rebalancing.delta.maxDrawdown * 100
    },
    {
      label: '변동성',
      actual: rebalancing.actual.volatility * 100,
      rebalanced: rebalancing.rebalanced.volatility * 100,
      delta: rebalancing.delta.volatility * 100
    }
  ];

  return (
    <section className="analytics-panel">
      <div className="analytics-panel-header">
        <h3>리밸런싱 전후 성과</h3>
        <p>기초 비중 기준 월간 리밸런싱 가정과 실제 보유 경로를 비교합니다.</p>
      </div>
      <div className="analytics-rebalance-grid">
        {rows.map((row) => (
          <article key={row.label} className="analytics-rebalance-card">
            <span>{row.label}</span>
            <div className="analytics-rebalance-values">
              <div>
                <small>실제</small>
                <strong>{formatPercent(row.actual)}</strong>
              </div>
              <div>
                <small>리밸런싱</small>
                <strong>{formatPercent(row.rebalanced)}</strong>
              </div>
              <div>
                <small>차이</small>
                <strong style={{ color: colorForValue(row.delta) }}>{formatPercent(row.delta)}</strong>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AnalyticsDashboard({
  report,
  loading,
  error,
  benchmarkSelection,
  benchmarkOptions = [],
  benchmarkQuery,
  benchmarkSearchResults = [],
  benchmarkSearchLoading,
  onChangeBenchmarkQuery,
  onSelectBenchmark,
  onChangeBenchmarkPreset,
  onExportReport,
  exportingReport,
  linkedCandidate
}) {
  const [scaleMode, setScaleMode] = useState('linear');
  const [showBenchmark, setShowBenchmark] = useState(true);

  const cumulativeData = useMemo(
    () => buildCumulativeComparisonChart(report, { showBenchmark }),
    [report, showBenchmark]
  );
  const drawdownData = useMemo(
    () => buildDrawdownChart(report, { showBenchmark }),
    [report, showBenchmark]
  );
  const heatmapData = useMemo(() => buildMonthlyHeatmap(report), [report]);
  const contributionRows = useMemo(() => buildContributionWaterfall(report), [report]);
  const flowAttributionRows = useMemo(() => buildFlowAttributionChart(report), [report]);
  const driftData = useMemo(() => buildAllocationDriftChart(report), [report]);
  const riskCards = useMemo(() => buildRiskCards(report), [report]);
  const cumulativePortfolioKey = scaleMode === 'log' ? 'portfolioIndex' : 'portfolio';
  const cumulativeBenchmarkKey = scaleMode === 'log' ? 'benchmarkIndex' : 'benchmark';

  if (loading) {
    return <section className="analytics-section"><div className="analytics-empty">분석 엔진을 계산하는 중입니다...</div></section>;
  }

  if (error) {
    return <section className="analytics-section"><div className="analytics-empty error">{error}</div></section>;
  }

  if (!report?.series?.timeline?.length) {
    return <section className="analytics-section"><div className="analytics-empty">분석할 시계열이 아직 충분하지 않습니다.</div></section>;
  }

  return (
    <section className="analytics-section">
      <div className="analytics-header">
        <div>
          <h2>포트폴리오 분석 엔진</h2>
          <p>
            {report.meta.startDate} ~ {report.meta.endDate} · {report.meta.benchmarkName} 비교
          </p>
        </div>
        <div className="analytics-actions">
          <label className="analytics-toggle">
            <span>Benchmark overlay</span>
            <input type="checkbox" checked={showBenchmark} onChange={() => setShowBenchmark((value) => !value)} />
          </label>
          <div className="analytics-segment">
            <button type="button" className={scaleMode === 'linear' ? 'active' : ''} onClick={() => setScaleMode('linear')}>Linear</button>
            <button type="button" className={scaleMode === 'log' ? 'active' : ''} onClick={() => setScaleMode('log')}>Log</button>
          </div>
          <button type="button" className="analytics-export-btn" onClick={onExportReport} disabled={exportingReport}>
            {exportingReport ? 'Export 중...' : '리포트 export'}
          </button>
        </div>
      </div>

      <section className="analytics-panel analytics-control-panel">
        <div className="analytics-panel-header">
          <h3>Benchmark 선택</h3>
          {linkedCandidate && (
            <span className="analytics-linked-badge">
              스크리너 후보 연결: {linkedCandidate.name}
            </span>
          )}
        </div>
        <div className="analytics-benchmark-row">
          <label className="analytics-benchmark-field">
            <span>프리셋</span>
            <select
              value={benchmarkSelection?.code || ''}
              onChange={(event) => onChangeBenchmarkPreset(event.target.value)}
            >
              {benchmarkOptions.map((option) => (
                <option key={option.code} value={option.code}>{option.name}</option>
              ))}
            </select>
          </label>
          <label className="analytics-benchmark-field analytics-benchmark-search">
            <span>직접 검색</span>
            <input
              type="text"
              placeholder="예: KODEX 200, S&P500"
              value={benchmarkQuery}
              onChange={(event) => onChangeBenchmarkQuery(event.target.value)}
            />
            {benchmarkSearchLoading && <small className="analytics-benchmark-hint">검색 중...</small>}
            {benchmarkSearchResults.length > 0 && (
              <div className="analytics-benchmark-results">
                {benchmarkSearchResults.map((item) => (
                  <button
                    key={`${item.code}-${item.name}`}
                    type="button"
                    onClick={() => onSelectBenchmark(item)}
                  >
                    <strong>{item.name}</strong>
                    <span>{item.code} · {item.exchange || item.source}</span>
                  </button>
                ))}
              </div>
            )}
          </label>
        </div>
      </section>

      <div className="analytics-risk-grid">
        {riskCards.map((card) => <MetricCard key={card.key} card={card} />)}
      </div>

      <section className="analytics-panel">
        <div className="analytics-panel-header">
          <h3>누적수익률 vs benchmark</h3>
        </div>
        <div className="analytics-chart-shell">
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={cumulativeData} syncId="analytics-sync" margin={{ top: 12, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" minTickGap={28} />
              <YAxis
                tickFormatter={(value) => (
                  scaleMode === 'log'
                    ? `${Number(value).toFixed(0)}`
                    : `${Number(value).toFixed(0)}%`
                )}
                scale={scaleMode === 'log' ? 'log' : 'auto'}
                domain={scaleMode === 'log' ? ['dataMin', 'dataMax'] : ['auto', 'auto']}
              />
              <Tooltip
                formatter={(value) => (
                  scaleMode === 'log'
                    ? Number(value).toFixed(2)
                    : `${Number(value).toFixed(2)}%`
                )}
              />
              <Legend />
              <Line type="monotone" dataKey={cumulativePortfolioKey} stroke={PORTFOLIO_COLOR} strokeWidth={2.5} dot={false} name="Portfolio" />
              {showBenchmark && <Line type="monotone" dataKey={cumulativeBenchmarkKey} stroke={BENCHMARK_COLOR} strokeWidth={2} dot={false} name="Benchmark" />}
              <Brush dataKey="date" height={28} travellerWidth={12} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="analytics-two-column">
        <section className="analytics-panel">
          <div className="analytics-panel-header">
            <h3>Drawdown area</h3>
          </div>
          <div className="analytics-chart-shell">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={drawdownData} syncId="analytics-sync" margin={{ top: 12, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" minTickGap={28} />
                <YAxis tickFormatter={(value) => `${Number(value).toFixed(0)}%`} />
                <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
                <Legend />
                <Area type="monotone" dataKey="portfolio" stroke={PORTFOLIO_COLOR} fill={PORTFOLIO_COLOR} fillOpacity={0.18} name="Portfolio" />
                {showBenchmark && (
                  <Area type="monotone" dataKey="benchmark" stroke={BENCHMARK_COLOR} fill={BENCHMARK_COLOR} fillOpacity={0.1} name="Benchmark" />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <MonthlyHeatmap data={heatmapData} />
      </div>

      <div className="analytics-two-column">
        <WaterfallWidget title="기여도 waterfall" rows={contributionRows} />
        <WaterfallWidget title="현금흐름 vs 시장수익" rows={flowAttributionRows} />
      </div>

      <section className="analytics-panel">
        <div className="analytics-panel-header">
          <h3>자산배분 drift stacked area</h3>
        </div>
        <div className="analytics-chart-shell">
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={driftData} syncId="analytics-sync" margin={{ top: 12, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" minTickGap={28} />
              <YAxis tickFormatter={(value) => `${Number(value).toFixed(0)}%`} />
              <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
              <Legend />
              <Area type="monotone" dataKey="risk" stackId="1" stroke={RISK_COLOR} fill={RISK_COLOR} fillOpacity={0.6} name="위험자산" />
              <Area type="monotone" dataKey="safe" stackId="1" stroke={SAFE_COLOR} fill={SAFE_COLOR} fillOpacity={0.6} name="안전자산" />
              {'cash' in (driftData[0] || {}) && (
                <Area type="monotone" dataKey="cash" stackId="1" stroke={CASH_COLOR} fill={CASH_COLOR} fillOpacity={0.6} name="현금" />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <RebalancingPanel rebalancing={report.rebalancing} />
      <TemplatePanel templates={report.templates || []} />
    </section>
  );
}

export default AnalyticsDashboard;
