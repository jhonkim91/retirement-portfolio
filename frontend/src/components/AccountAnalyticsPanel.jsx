import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
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
import { portfolioAPI, tradeLogAPI } from '../utils/api';
import '../styles/AccountAnalyticsPanel.css';

const LazyAnalyticsDashboard = lazy(() => import('./analytics/AnalyticsDashboard'));
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const createEmptyAnalyticsRaw = (accountType = 'retirement') => ({
  allProducts: [],
  transactions: [],
  trends: [],
  benchmark: {
    name: DEFAULT_BENCHMARKS[accountType]?.name || DEFAULT_BENCHMARKS.retirement.name,
    series: []
  }
});

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

function AccountAnalyticsPanel({
  accountName,
  accountReady,
  accountType = 'retirement',
  defaultOpen = false,
  title = '계좌 심층 분석',
  description = '벤치마크 비교, 누적 수익률, 자산 배분 드리프트 같은 깊은 분석은 이 탭에서 확인합니다.'
}) {
  const analyticsScope = 'account';
  const [expanded, setExpanded] = useState(defaultOpen);
  const [summary, setSummary] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const [notice, setNotice] = useState('');
  const [analyticsRaw, setAnalyticsRaw] = useState(createEmptyAnalyticsRaw(accountType));
  const [domainModel, setDomainModel] = useState(null);
  const [selectedAnalyticsAccountId, setSelectedAnalyticsAccountId] = useState('');
  const [benchmarkSelection, setBenchmarkSelection] = useState(null);
  const [benchmarkQuery, setBenchmarkQuery] = useState('');
  const [benchmarkSearchResults, setBenchmarkSearchResults] = useState([]);
  const [benchmarkSearchLoading, setBenchmarkSearchLoading] = useState(false);

  useEffect(() => {
    setSummary(null);
    setAnalyticsError('');
    setNotice('');
    setDomainModel(null);
    setSelectedAnalyticsAccountId('');
    setBenchmarkSelection(null);
    setBenchmarkQuery('');
    setBenchmarkSearchResults([]);
    setBenchmarkSearchLoading(false);
    setAnalyticsRaw(createEmptyAnalyticsRaw(accountType));
  }, [accountName, accountType]);

  const fetchAnalyticsData = useCallback(async () => {
    if (!accountReady) return;

    try {
      setAnalyticsLoading(true);
      setAnalyticsError('');

      const [summaryResponse, allProductsResponse, trendsResponse, tradeLogsResponse, domainResult] = await Promise.all([
        portfolioAPI.getSummary(accountName),
        portfolioAPI.getAllProducts(accountName),
        portfolioAPI.getTrends(accountName, { includeSold: true }),
        tradeLogAPI.getLogs({ accountName }),
        portfolioAPI.getDomainModel(accountName, analyticsScope)
          .then((data) => ({ data, error: null }))
          .catch((error) => ({ data: null, error }))
      ]);

      setSummary(summaryResponse || null);
      setAnalyticsRaw((prev) => ({
        ...prev,
        allProducts: Array.isArray(allProductsResponse) ? allProductsResponse : [],
        transactions: Array.isArray(tradeLogsResponse) ? tradeLogsResponse : [],
        trends: Array.isArray(trendsResponse) ? trendsResponse : [],
        benchmark: prev.benchmark?.code
          ? prev.benchmark
          : {
              name: DEFAULT_BENCHMARKS[summaryResponse?.account_type]?.name || DEFAULT_BENCHMARKS.retirement.name,
              series: []
            }
      }));
      setDomainModel(domainResult.data || null);

      if (domainResult.error) {
        setNotice(
          domainResult.error.status === 404
            ? '심층 분석 전용 데이터 모델이 아직 배포되지 않아 기본 분석 경로로 계산했습니다.'
            : '심층 분석 보조 데이터를 불러오지 못해 기본 분석 경로로 계산했습니다.'
        );
      }
    } catch (fetchError) {
      setAnalyticsError(fetchError.message || '계좌 분석 데이터를 불러오지 못했습니다.');
      setDomainModel(null);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [accountName, accountReady, analyticsScope]);

  useEffect(() => {
    if (accountReady && expanded) {
      fetchAnalyticsData();
    }
  }, [accountReady, expanded, fetchAnalyticsData]);

  useEffect(() => {
    if (!summary?.account_type) return;
    const storedSelection = readStoredBenchmarkSelection(accountName, summary.account_type);
    setBenchmarkSelection({ ...storedSelection, accountName });
  }, [accountName, summary?.account_type]);

  useEffect(() => {
    if (!expanded || !summary?.account_type || !benchmarkSelection?.code) return;

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
  }, [benchmarkSelection, expanded, summary?.account_type]);

  useEffect(() => {
    if (!expanded) return undefined;

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
  }, [benchmarkQuery, expanded]);

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
    () => getBenchmarkPresetOptions(summary?.account_type || accountType),
    [accountType, summary?.account_type]
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
    if (!expanded || !summary) return { report: null, runtimeError: '' };

    try {
      const hasDomainModel = Array.isArray(domainModel?.account_wrappers) && domainModel.account_wrappers.length > 0;
      const analyticsInputs = hasDomainModel
        ? buildAnalyticsInputsFromDomain(domainModel, {
            mode: analyticsScope,
            accountWrapperId: selectedAnalyticsAccountId
          })
        : buildAnalyticsInputs({
            accountType: summary?.account_type || accountType,
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
  }, [
    accountType,
    analyticsRaw,
    analyticsScope,
    domainModel,
    expanded,
    selectedAnalyticsAccountId,
    summary
  ]);

  const analyticsReport = analyticsResult.report;
  const analyticsRuntimeError = analyticsResult.runtimeError;
  const dashboardAsOf = useMemo(() => (
    domainModel?.provenance?.asOf
    || analyticsReport?.meta?.endDate
    || analyticsRaw.transactions[0]?.created_at
    || ''
  ), [analyticsRaw.transactions, analyticsReport?.meta?.endDate, domainModel?.provenance?.asOf]);

  const firstMarketCode = analyticsRaw.allProducts.find((item) => item?.product_code)?.product_code || '';
  const marketBadge = useMemo(() => buildDataBadgeDescriptor({
    source: firstMarketCode ? inferSourceKeyFromCode(firstMarketCode) : 'portfolio_ledger',
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

  const isStale = isStaleAsOf(dashboardAsOf, 'internal_ledger') || isStaleAsOf(marketBadge.asOf, marketBadge.freshnessClass);

  return (
    <section className="account-analytics-shell" aria-label={title}>
      <div className="account-analytics-header">
        <div className="account-analytics-copy">
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button
          type="button"
          className="account-analytics-toggle"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? '접기' : '열기'}
        </button>
      </div>

      {notice && <div className="account-analytics-notice" role="status">{notice}</div>}

      {!expanded && (
        <p className="account-analytics-empty">
          이 계좌의 누적 수익률, 벤치마크 비교, 자산 배분 변화를 한 번에 확인할 수 있습니다.
        </p>
      )}

      {expanded && (
        <Suspense fallback={<div className="account-analytics-loading">계좌 분석을 불러오는 중...</div>}>
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
            freshnessWarning={isStale ? '데이터 최신성을 먼저 확인한 뒤 해석해 주세요.' : ''}
          />
        </Suspense>
      )}
    </section>
  );
}

export default AccountAnalyticsPanel;
