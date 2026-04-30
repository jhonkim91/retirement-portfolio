import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import AccountSelector from '../components/AccountSelector';
import DataBadge from '../components/DataBadge';
import {
  buildAnalyticsInputs,
  buildAnalyticsInputsFromDomain,
  DEFAULT_BENCHMARKS
} from '../lib/analytics/adapters';
import { computePortfolioAnalytics } from '../lib/analytics/engine';
import {
  getBenchmarkPresetOptions,
  readStoredBenchmarkSelection,
  writeStoredBenchmarkSelection
} from '../lib/analytics/preferences';
import { buildDataBadgeDescriptor, inferSourceKeyFromCode } from '../lib/sourceRegistry';
import useResolvedAccount from '../hooks/useResolvedAccount';
import { portfolioAPI, tradeLogAPI } from '../utils/api';
import '../styles/Dashboard.css';

const LazyAnalyticsDashboard = lazy(() => import('../components/analytics/AnalyticsDashboard'));
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const formatCurrency = (value) => new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0
}).format(Number(value || 0));

const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;

const formatDate = (value) => {
  if (!value) return '-';
  const asDate = new Date(value);
  if (Number.isNaN(asDate.getTime())) return String(value);
  return asDate.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const parseDateMs = (value) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const isStaleAsOf = (asOf, freshnessClass = 'internal_ledger') => {
  const timestamp = parseDateMs(asOf);
  if (!timestamp) return true;
  const ageMs = Date.now() - timestamp;
  if (freshnessClass === 'realtime') return ageMs > (15 * 60 * 1000);
  if (freshnessClass === 'delayed_20m') return ageMs > (45 * 60 * 1000);
  if (freshnessClass === 'internal_ledger') return ageMs > (2 * ONE_DAY_MS);
  return ageMs > (2 * ONE_DAY_MS);
};

const nextRebalanceDate = () => {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  return next;
};

const isToday = (value) => {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
};

function Dashboard() {
  const {
    accountName,
    accountReady,
    changeAccountName: persistAccountName,
    selectedAccountProfile,
    syncAccountProfiles
  } = useResolvedAccount();
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const [analyticsRaw, setAnalyticsRaw] = useState({
    allProducts: [],
    transactions: [],
    trends: [],
    benchmark: { name: DEFAULT_BENCHMARKS.retirement.name, series: [] }
  });
  const analyticsScope = 'account';
  const [domainModel, setDomainModel] = useState(null);
  const [selectedAnalyticsAccountId, setSelectedAnalyticsAccountId] = useState('');
  const [benchmarkSelection, setBenchmarkSelection] = useState(null);
  const [benchmarkQuery, setBenchmarkQuery] = useState('');
  const [benchmarkSearchResults, setBenchmarkSearchResults] = useState([]);
  const [benchmarkSearchLoading, setBenchmarkSearchLoading] = useState(false);

  const fetchCoreDashboardData = useCallback(async ({ silent = false } = {}) => {
    if (!accountReady) return;
    try {
      if (!silent) setLoading(true);
      setError('');
      const [summaryResponse, productsResponse, logsResponse] = await Promise.all([
        portfolioAPI.getSummary(accountName),
        portfolioAPI.getProducts(accountName),
        tradeLogAPI.getLogs({ accountName })
      ]);
      setSummary(summaryResponse);
      setProducts(Array.isArray(productsResponse) ? productsResponse : []);
      setRecentLogs(Array.isArray(logsResponse) ? logsResponse : []);
      setAnalyticsRaw((prev) => ({
        ...prev,
        benchmark: prev.benchmark?.code
          ? prev.benchmark
          : { name: DEFAULT_BENCHMARKS[summaryResponse?.account_type]?.name || DEFAULT_BENCHMARKS.retirement.name, series: [] }
      }));
    } catch (fetchError) {
      setError(fetchError.message || '현황을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [accountName, accountReady]);

  const fetchAnalyticsData = useCallback(async () => {
    if (!accountReady) return;
    try {
      setAnalyticsLoading(true);
      setAnalyticsError('');
      const [allProductsResponse, trendsResponse, tradeLogsResponse, domainResponse] = await Promise.all([
        portfolioAPI.getAllProducts(accountName),
        portfolioAPI.getTrends(accountName, { includeSold: true }),
        tradeLogAPI.getLogs({ accountName }),
        portfolioAPI.getDomainModel(accountName, analyticsScope)
      ]);
      setAnalyticsRaw((prev) => ({
        ...prev,
        allProducts: Array.isArray(allProductsResponse) ? allProductsResponse : [],
        transactions: Array.isArray(tradeLogsResponse) ? tradeLogsResponse : [],
        trends: Array.isArray(trendsResponse) ? trendsResponse : []
      }));
      setDomainModel(domainResponse || null);
    } catch (fetchError) {
      setAnalyticsError(fetchError.message || '심층 분석 데이터를 불러오지 못했습니다.');
      setDomainModel(null);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [accountName, accountReady, analyticsScope]);

  useEffect(() => {
    if (!accountReady) return undefined;
    fetchCoreDashboardData();
    const interval = setInterval(() => fetchCoreDashboardData({ silent: true }), 60000);
    return () => clearInterval(interval);
  }, [accountReady, fetchCoreDashboardData]);

  useEffect(() => {
    if (accountReady && showInsights) fetchAnalyticsData();
  }, [accountReady, fetchAnalyticsData, showInsights]);

  useEffect(() => {
    if (!summary?.account_type) return;
    const storedSelection = readStoredBenchmarkSelection(accountName, summary.account_type);
    setBenchmarkSelection({ ...storedSelection, accountName });
  }, [accountName, summary?.account_type]);

  useEffect(() => {
    if (!showInsights || !summary?.account_type || !benchmarkSelection?.code) return;
    let active = true;
    (async () => {
      try {
        const response = await portfolioAPI.getBenchmarkChart(benchmarkSelection.code, 520);
        if (!active) return;
        setAnalyticsRaw((prev) => ({
          ...prev,
          benchmark: {
            code: benchmarkSelection.code,
            name: benchmarkSelection.name,
            series: response?.series || []
          }
        }));
      } catch (fetchError) {
        if (!active) return;
        setAnalyticsRaw((prev) => ({
          ...prev,
          benchmark: {
            code: benchmarkSelection.code,
            name: benchmarkSelection.name,
            series: []
          }
        }));
      }
    })();
    return () => {
      active = false;
    };
  }, [benchmarkSelection, showInsights, summary?.account_type]);

  useEffect(() => {
    if (!showInsights) return undefined;
    const query = benchmarkQuery.trim();
    if (query.length < 2) {
      setBenchmarkSearchResults([]);
      setBenchmarkSearchLoading(false);
      return undefined;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setBenchmarkSearchLoading(true);
      try {
        const results = await portfolioAPI.searchProducts(query);
        if (active) setBenchmarkSearchResults((results || []).slice(0, 8));
      } catch (fetchError) {
        if (active) setBenchmarkSearchResults([]);
      } finally {
        if (active) setBenchmarkSearchLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [benchmarkQuery, showInsights]);

  useEffect(() => {
    const wrappers = Array.isArray(domainModel?.account_wrappers) ? domainModel.account_wrappers : [];
    if (wrappers.length === 0 || analyticsScope === 'all') {
      setSelectedAnalyticsAccountId('');
      return;
    }
    const matched = wrappers.find((wrapper) => wrapper.account_name === accountName) || wrappers[0];
    setSelectedAnalyticsAccountId(matched?.id || '');
  }, [accountName, analyticsScope, domainModel]);

  const benchmarkPresetOptions = useMemo(
    () => getBenchmarkPresetOptions(summary?.account_type || 'retirement'),
    [summary?.account_type]
  );

  const benchmarkOptions = useMemo(() => {
    const options = [...benchmarkPresetOptions];
    if (benchmarkSelection?.code && !options.some((option) => option.code === benchmarkSelection.code)) {
      options.push({
        code: benchmarkSelection.code,
        name: benchmarkSelection.name,
        source: benchmarkSelection.source || 'custom'
      });
    }
    return options;
  }, [benchmarkPresetOptions, benchmarkSelection]);

  const applyBenchmarkSelection = useCallback((selection, source = selection?.source || 'custom') => {
    if (!selection?.code || !selection?.name) return;
    const nextSelection = {
      accountName,
      code: selection.code,
      name: selection.name,
      source
    };
    writeStoredBenchmarkSelection(accountName, nextSelection);
    setBenchmarkSelection(nextSelection);
    setBenchmarkQuery('');
    setBenchmarkSearchResults([]);
    setNotice(`${nextSelection.name} 벤치마크를 적용했습니다.`);
  }, [accountName]);

  const moveBenchmarkFromSearchResult = useCallback((item) => {
    applyBenchmarkSelection({ code: item.code, name: item.name }, 'custom');
  }, [applyBenchmarkSelection]);

  const chooseBenchmarkPreset = useCallback((code) => {
    const selected = benchmarkOptions.find((option) => option.code === code);
    if (!selected) return;
    applyBenchmarkSelection(selected, selected.source || 'preset');
  }, [applyBenchmarkSelection, benchmarkOptions]);

  const analyticsResult = useMemo(() => {
    if (!showInsights || !summary) return { report: null, runtimeError: '' };
    try {
      const hasDomainModel = Array.isArray(domainModel?.account_wrappers) && domainModel.account_wrappers.length > 0;
      const analyticsInputs = hasDomainModel
        ? buildAnalyticsInputsFromDomain(domainModel, {
          mode: analyticsScope,
          accountWrapperId: selectedAnalyticsAccountId
        })
        : buildAnalyticsInputs({
          accountType: summary?.account_type || 'retirement',
          holdings: analyticsRaw.allProducts,
          products: analyticsRaw.allProducts,
          summary,
          transactions: analyticsRaw.transactions,
          trends: analyticsRaw.trends,
          benchmarkSeries: analyticsRaw.benchmark
        });
      return {
        report: computePortfolioAnalytics(analyticsInputs),
        runtimeError: ''
      };
    } catch (engineError) {
      return {
        report: null,
        runtimeError: engineError.message || '분석 계산 중 오류가 발생했습니다.'
      };
    }
  }, [analyticsRaw, analyticsScope, domainModel, selectedAnalyticsAccountId, showInsights, summary]);

  const analyticsReport = analyticsResult.report;
  const analyticsRuntimeError = analyticsResult.runtimeError;

  const dashboardAsOf = useMemo(() => (
    domainModel?.provenance?.asOf
    || analyticsReport?.meta?.endDate
    || recentLogs[0]?.created_at
    || ''
  ), [analyticsReport?.meta?.endDate, domainModel?.provenance?.asOf, recentLogs]);

  const staleLedger = isStaleAsOf(dashboardAsOf, 'internal_ledger');
  const firstMarketCode = products.find((item) => item?.product_code)?.product_code || '';
  const marketBadge = useMemo(() => buildDataBadgeDescriptor({
    source: inferSourceKeyFromCode(firstMarketCode),
    freshnessClass: 'delayed_20m',
    asOf: dashboardAsOf,
    code: firstMarketCode,
    note: '시세 기준'
  }), [dashboardAsOf, firstMarketCode]);

  const ledgerBadge = useMemo(() => buildDataBadgeDescriptor({
    source: 'portfolio_ledger',
    freshnessClass: 'internal_ledger',
    asOf: dashboardAsOf,
    note: '계좌 원장'
  }), [dashboardAsOf]);

  const staleMarket = isStaleAsOf(marketBadge.asOf, marketBadge.freshnessClass);
  const isStale = staleLedger || staleMarket;

  const todaysLogs = useMemo(
    () => recentLogs.filter((row) => isToday(row.trade_date || row.created_at)),
    [recentLogs]
  );

  const todayChange = useMemo(() => {
    return todaysLogs.reduce((sum, row) => {
      const amount = Number(row.total_amount || 0);
      if (row.trade_type === 'sell') return sum + amount;
      if (row.trade_type === 'buy') return sum - amount;
      if (row.trade_type === 'deposit') return sum + amount;
      return sum;
    }, 0);
  }, [todaysLogs]);

  const targetRate = summary?.account_type === 'brokerage' ? 12 : 8;
  const targetDeviation = Number(summary?.total_profit_rate || 0) - targetRate;
  const riskShare = Number(summary?.asset_allocation?.risk?.percentage || 0);
  const safeShare = Number(summary?.asset_allocation?.safe?.percentage || 0);
  const accountTypeLabel = selectedAccountProfile?.account_type_label || summary?.account_type_label || '계좌';
  const accountCategoryLabel = selectedAccountProfile?.account_category_label || summary?.account_category_label || '';
  const accountContextLabel = [accountName, accountTypeLabel, accountCategoryLabel].filter(Boolean).join(' · ');
  const accountStrategyHint = summary?.account_type === 'brokerage'
    ? '주식 통장 기준으로 오늘 변동, 편차, 경고를 먼저 보고 필요한 상세 영역으로 내려가세요.'
    : '퇴직연금 규칙과 오늘 변동을 먼저 확인하고, 필요한 상세 영역으로 이어서 점검하세요.';

  const anomalies = useMemo(() => {
    const issues = [];
    if (isStale) issues.push('데이터 기준 시각이 오래되었습니다.');
    if (products.some((item) => !item.product_code || Number(item.current_price || 0) <= 0)) {
      issues.push('현재가 또는 종목코드가 비어있는 보유상품이 있습니다.');
    }
    if (recentLogs.length === 0) {
      issues.push('최근 매매일지 기록이 없습니다.');
    } else {
      const latestLogAt = parseDateMs(recentLogs[0]?.created_at || recentLogs[0]?.trade_date);
      if (latestLogAt && (Date.now() - latestLogAt) > (14 * ONE_DAY_MS)) {
        issues.push('최근 14일간 매매일지 업데이트가 없습니다.');
      }
    }
    if (summary?.account_type !== 'brokerage' && riskShare > 70) {
      issues.push('퇴직연금 위험자산 비중이 70%를 초과했습니다.');
    }
    return issues;
  }, [isStale, products, recentLogs, riskShare, summary?.account_type]);

  const watchlistStatus = useMemo(() => (
    [...products]
      .sort((left, right) => Number(right.profit_rate || 0) - Number(left.profit_rate || 0))
      .slice(0, 4)
  ), [products]);

  const largestHolding = useMemo(() => (
    [...products]
      .sort((left, right) => Number(right.current_value || 0) - Number(left.current_value || 0))[0] || null
  ), [products]);

  const topLoss = useMemo(() => (
    [...products]
      .sort((left, right) => Number(left.profit_rate || 0) - Number(right.profit_rate || 0))[0]
  ), [products]);

  const focusTone = anomalies.length > 0 ? 'warning' : (isStale ? 'stale' : 'stable');
  const focusLabel = anomalies.length > 0 ? '주의 필요' : (isStale ? '갱신 필요' : '안정');
  const focusDescription = anomalies[0]
    || (isStale ? '시세 또는 원장 기준 시각을 한 번 갱신하는 편이 좋습니다.' : '큰 경고 없이 운영 중입니다.');
  const dashboardAsOfLabel = dashboardAsOf ? formatDate(dashboardAsOf) : '기준 시각 없음';

  const todayFocusItems = useMemo(() => {
    const focus = [];
    if (isStale) focus.push('먼저 가격 동기화를 눌러 최신 시세로 맞춰주세요.');
    if (anomalies.length > 0) focus.push(`이상 징후 ${anomalies.length}건을 확인해 주세요.`);
    if (topLoss) focus.push(`수익률 하위 종목: ${topLoss.product_name} (${formatPercent(topLoss.profit_rate)})`);
    if (largestHolding) focus.push(`비중 점검 종목: ${largestHolding.product_name} (${formatCurrency(largestHolding.current_value)})`);
    focus.push(`다음 리밸런싱 예정: ${nextRebalanceDate().toLocaleDateString('ko-KR')}`);
    return focus;
  }, [anomalies.length, isStale, largestHolding, topLoss]);

  const emptyState = !loading && !error && products.length === 0;

  const goSection = (sectionId) => {
    const element = document.getElementById(sectionId);
    if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const syncPrices = async () => {
    try {
      setSyncing(true);
      setError('');
      setNotice('');
      const result = await portfolioAPI.syncPrices(accountName);
      await fetchCoreDashboardData({ silent: true });
      setNotice(result?.message || '가격 동기화를 완료했습니다.');
    } catch (syncError) {
      setError(syncError.message || '가격 동기화에 실패했습니다.');
    } finally {
      setSyncing(false);
    }
  };

  const changeAccountName = (value) => {
    persistAccountName(value);
    setSummary(null);
    setProducts([]);
    setRecentLogs([]);
    setNotice('');
    setError('');
    setLoading(true);
    setShowInsights(false);
    setAnalyticsLoading(false);
    setAnalyticsError('');
  };

  const primaryCards = [
    {
      key: 'total',
      title: '총자산',
      value: formatCurrency(summary?.total_current_value),
      description: `원금 ${formatCurrency(summary?.total_investment)}`,
      onClick: () => goSection('ops-drill-holdings'),
      badge: ledgerBadge
    },
    {
      key: 'today',
      title: '오늘 변동',
      value: formatCurrency(todayChange),
      description: '오늘 매매/입금 기준 변동',
      trend: todayChange >= 0 ? 'positive' : 'negative',
      onClick: () => goSection('ops-drill-events'),
      badge: ledgerBadge
    },
    {
      key: 'goal',
      title: '목표 대비 편차',
      value: formatPercent(targetDeviation),
      description: `목표 수익률 ${targetRate}%`,
      trend: targetDeviation >= 0 ? 'positive' : 'negative',
      onClick: () => goSection('ops-drill-holdings'),
      badge: ledgerBadge
    }
  ];

  const secondaryCards = [
    {
      key: 'anomaly',
      title: '데이터 이상 징후',
      value: `${anomalies.length}건`,
      description: anomalies[0] || '현재 이상 징후가 없습니다.',
      onClick: () => goSection('ops-drill-anomalies'),
      badge: marketBadge
    },
    {
      key: 'allocation',
      title: '자산 비중',
      value: `위험 ${formatPercent(riskShare)}`,
      description: `안전자산 ${formatPercent(safeShare)}`,
      trend: summary?.account_type !== 'brokerage' && riskShare > 70 ? 'negative' : 'positive',
      onClick: () => goSection('ops-drill-holdings'),
      badge: marketBadge
    },
    {
      key: 'journal',
      title: '최근 일지',
      value: `${Math.min(recentLogs.length, 3)}건`,
      description: recentLogs[0]
        ? `${recentLogs[0].product_name} (${recentLogs[0].trade_type})`
        : '기록이 없습니다.',
      onClick: () => goSection('ops-drill-journal'),
      badge: ledgerBadge
    },
    {
      key: 'watch',
      title: '보유 상위 종목',
      value: `${watchlistStatus.length}종목`,
      description: largestHolding
        ? `${largestHolding.product_name} ${formatCurrency(largestHolding.current_value)}`
        : '보유 종목이 없습니다.',
      onClick: () => goSection('ops-drill-holdings'),
      badge: marketBadge
    }
  ];

  if (loading) {
    return (
      <main className="dashboard dashboard-cockpit">
        <AccountSelector value={accountName} onChange={changeAccountName} onAccountsChange={syncAccountProfiles} />
        <section className="ops-loading" aria-label="운영 대시보드 로딩" role="status" aria-live="polite">
          <h1>운영 대시보드</h1>
          <div className="ops-skeleton-grid">
            {Array.from({ length: 7 }).map((_, index) => (
              <article key={`sk-${index}`} className="ops-skeleton-card" aria-hidden="true" />
            ))}
          </div>
        </section>
      </main>
    );
  }

  if (error && !summary) {
    return (
      <main className="dashboard dashboard-cockpit">
        <AccountSelector value={accountName} onChange={changeAccountName} onAccountsChange={syncAccountProfiles} />
        <section className="ops-error" role="alert" aria-live="assertive">
          <h1>운영 대시보드</h1>
          <p>{error}</p>
          <button type="button" onClick={() => fetchCoreDashboardData()} aria-label="현황 다시 불러오기">
            다시 시도
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard dashboard-cockpit">
      <AccountSelector value={accountName} onChange={changeAccountName} onAccountsChange={syncAccountProfiles} />

      <header className="ops-hero">
        <div className="ops-hero-main">
          <p className="ops-eyebrow">{accountContextLabel}</p>
          <h1>운영 대시보드</h1>
          <p className="ops-hero-copy">{accountStrategyHint}</p>
          <div className="ops-source-row" aria-label="데이터 기준 정보">
            <DataBadge descriptor={ledgerBadge} compact />
            <DataBadge descriptor={marketBadge} compact />
            <span className="ops-asof">기준 {dashboardAsOfLabel}</span>
          </div>
        </div>

        <aside className="ops-command-panel" aria-label="빠른 작업">
          <div className="ops-command-status">
            <span className={`ops-status-chip ${focusTone}`}>{focusLabel}</span>
            <p>{focusDescription}</p>
          </div>
          <div className="ops-header-actions">
            <button type="button" onClick={syncPrices} disabled={syncing} aria-label="가격 동기화">
              {syncing ? '동기화 중...' : '가격 동기화'}
            </button>
            <button type="button" onClick={() => fetchCoreDashboardData({ silent: true })} aria-label="대시보드 새로고침">
              새로고침
            </button>
          </div>
          <button
            type="button"
            className="ops-link-button ops-link-button-inline"
            onClick={() => setShowInsights((prev) => !prev)}
            aria-label="심층 차트 토글"
          >
            {showInsights ? '심층 분석 접기' : '심층 분석 열기'}
          </button>
        </aside>
      </header>

      {notice && <div className="ops-notice" role="status">{notice}</div>}
      {error && <div className="ops-error-inline" role="alert">{error}</div>}
      {isStale && (
        <div className="ops-stale-banner" role="alert" aria-label="stale data warning">
          <strong>주의:</strong> 일부 데이터 기준 시각이 오래되었습니다. 시세/원장을 다시 동기화해 주세요.
          <span className="stale-badge">STALE</span>
        </div>
      )}

      <section className="ops-priority-layout" aria-label="오늘의 우선순위">
        <div className="ops-priority-main">
          <div className="ops-section-copy">
            <h2>지금 확인할 핵심</h2>
            <p>총자산, 오늘 변동, 목표 편차부터 본 뒤 필요한 상세 패널로 내려가세요.</p>
          </div>
          <section className="ops-cards ops-cards-primary" aria-label="핵심 운영 카드">
            {primaryCards.map((card) => (
              <article
                key={card.key}
                className="ops-card ops-card-primary"
                role="button"
                tabIndex={0}
                aria-label={`${card.title} 카드`}
                onClick={card.onClick}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    card.onClick();
                  }
                }}
              >
                <div className="ops-card-head">
                  <h3>{card.title}</h3>
                </div>
                <p className={`ops-card-value ${card.trend || ''}`}>{card.value}</p>
                <p className="ops-card-desc">{card.description}</p>
              </article>
            ))}
          </section>
        </div>

        <aside className="ops-focus-panel" aria-label="오늘 볼 것">
          <div className="ops-focus-head">
            <h2>오늘 볼 것</h2>
            <span className={`ops-status-chip ${focusTone}`}>{focusLabel}</span>
          </div>
          <ul className="ops-focus-list">
            {todayFocusItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="ops-focus-actions">
            <button type="button" onClick={() => goSection('ops-drill-anomalies')}>
              경고 보기
            </button>
            <button type="button" onClick={() => goSection('ops-drill-holdings')}>
              보유 보기
            </button>
          </div>
        </aside>
      </section>

      <section className="ops-secondary-band" aria-label="보조 운영 카드">
        <div className="ops-section-copy">
          <h2>운영 요약</h2>
          <p>자산 비중, 경고, 최근 기록, 보유 상위 종목을 한 줄에서 빠르게 훑습니다.</p>
        </div>
        <section className="ops-cards ops-cards-secondary" aria-label="보조 운영 카드">
          {secondaryCards.map((card) => (
            <article
              key={card.key}
              className="ops-card ops-card-secondary"
              role="button"
              tabIndex={0}
              aria-label={`${card.title} 카드`}
              onClick={card.onClick}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  card.onClick();
                }
              }}
            >
              <div className="ops-card-head">
                <h3>{card.title}</h3>
              </div>
              <p className={`ops-card-value ${card.trend || ''}`}>{card.value}</p>
              <p className="ops-card-desc">{card.description}</p>
            </article>
          ))}
        </section>
      </section>

      {emptyState && (
        <section className="ops-onboarding" aria-label="초기 설정 안내">
          <h2>아직 보유 상품이 없습니다</h2>
          <p>매매일지에서 첫 매수 기록을 입력하면 운영 대시보드가 자동으로 채워집니다.</p>
          <div className="ops-onboarding-actions">
            <button type="button" onClick={() => (window.location.href = '/trade-logs')}>매매일지로 이동</button>
            <button type="button" onClick={() => (window.location.href = '/portfolio')}>상품 추이 보기</button>
          </div>
        </section>
      )}

      <section className="ops-drill-grid" aria-label="상세 운영 패널">
        <section id="ops-drill-anomalies" className="ops-panel" aria-label="데이터 이상 징후 상세">
          <div className="ops-panel-head">
            <h2>데이터 이상 징후</h2>
            <DataBadge descriptor={marketBadge} compact />
          </div>
          {anomalies.length === 0 ? (
            <p className="ops-empty">현재 확인된 이상 징후가 없습니다.</p>
          ) : (
            <ul className="ops-list">
              {anomalies.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          )}
        </section>

        <section id="ops-drill-events" className="ops-panel" aria-label="오늘의 이벤트">
          <div className="ops-panel-head">
            <h2>오늘의 이벤트</h2>
            <DataBadge descriptor={ledgerBadge} compact />
          </div>
          <p className="ops-next-rebalance">다음 리밸런싱: {nextRebalanceDate().toLocaleDateString('ko-KR')}</p>
          {todaysLogs.length === 0 ? (
            <p className="ops-empty">오늘 기록된 이벤트가 없습니다.</p>
          ) : (
            <ul className="ops-list">
              {todaysLogs.slice(0, 5).map((log) => (
                <li key={log.id}>{log.product_name} {log.trade_type} {formatCurrency(log.total_amount)}</li>
              ))}
            </ul>
          )}
        </section>

        <section id="ops-drill-journal" className="ops-panel" aria-label="최근 일지">
          <div className="ops-panel-head">
            <h2>최근 일지 3개</h2>
            <DataBadge descriptor={ledgerBadge} compact />
          </div>
          {recentLogs.length === 0 ? (
            <p className="ops-empty">최근 기록이 없습니다.</p>
          ) : (
            <ul className="ops-log-list">
              {recentLogs.slice(0, 3).map((log) => (
                <li key={log.id}>
                  <strong>{log.product_name}</strong>
                  <span>{log.trade_type}</span>
                  <span>{formatCurrency(log.total_amount)}</span>
                  <time>{formatDate(log.trade_date)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="ops-drill-holdings" className="ops-panel" aria-label="관심 종목 상태">
          <div className="ops-panel-head">
            <h2>관심 종목 상태</h2>
            <DataBadge descriptor={marketBadge} compact />
          </div>
          {watchlistStatus.length === 0 ? (
            <p className="ops-empty">보유 종목이 없습니다.</p>
          ) : (
            <ul className="ops-holding-list">
              {watchlistStatus.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.product_name}</strong>
                    <p>{item.product_code}</p>
                  </div>
                  <div>
                    <strong className={Number(item.profit_rate || 0) >= 0 ? 'positive' : 'negative'}>
                      {formatPercent(item.profit_rate)}
                    </strong>
                    <p>{formatCurrency(item.current_value)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      <section className="ops-insights" aria-label="심층 분석">
        <div className="ops-panel-head">
          <h2>심층 분석</h2>
          <span className="ops-insight-caption">필요할 때만 열기</span>
        </div>
        {!showInsights && (
          <p className="ops-empty">첫 화면 성능을 위해 심층 차트는 필요할 때만 불러옵니다.</p>
        )}
        {showInsights && (
          <Suspense fallback={<div className="ops-skeleton-card">심층 차트를 불러오는 중...</div>}>
            <LazyAnalyticsDashboard
              report={analyticsReport}
              loading={analyticsLoading}
              error={analyticsError || analyticsRuntimeError || ''}
              benchmarkSelection={benchmarkSelection}
              benchmarkOptions={benchmarkOptions}
              benchmarkQuery={benchmarkQuery}
              benchmarkSearchResults={benchmarkSearchResults}
              benchmarkSearchLoading={benchmarkSearchLoading}
              onChangeBenchmarkQuery={setBenchmarkQuery}
              onSelectBenchmark={moveBenchmarkFromSearchResult}
              onChangeBenchmarkPreset={chooseBenchmarkPreset}
              onExportReport={() => {}}
              exportingReport={false}
              linkedCandidate={benchmarkSelection?.source === 'screener' ? benchmarkSelection : null}
              dataBadges={[ledgerBadge, marketBadge]}
              freshnessWarning={isStale ? '데이터 최신성을 먼저 확인하세요.' : ''}
            />
          </Suspense>
        )}
      </section>
    </main>
  );
}

export const __dashboardTestables = { isStaleAsOf };
export default Dashboard;
