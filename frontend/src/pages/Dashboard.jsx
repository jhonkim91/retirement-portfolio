import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import AccountSelector from '../components/AccountSelector';
import AnalyticsDashboard from '../components/analytics/AnalyticsDashboard';
import { buildAnalyticsInputs, DEFAULT_BENCHMARKS } from '../lib/analytics/adapters';
import { computePortfolioAnalytics } from '../lib/analytics/engine';
import {
  buildAnalyticsReportFilename,
  buildAnalyticsReportHtml,
  downloadAnalyticsReport
} from '../lib/analytics/exporters';
import {
  getBenchmarkPresetOptions,
  readStoredBenchmarkSelection,
  writeStoredBenchmarkSelection
} from '../lib/analytics/preferences';
import { summarizeRetirementEligibility } from '../lib/pensionEligibility';
import { buildDataBadgeDescriptor, buildFreshnessMixWarning, inferSourceKeyFromCode } from '../lib/sourceRegistry';
import {
  DEFAULT_ACCOUNT_NAME,
  portfolioAPI,
  tradeLogAPI,
  readStoredAccountName,
  writeStoredAccountName
} from '../utils/api';
import '../styles/Dashboard.css';

const COLORS = { risk: '#d94841', safe: '#256f68' };
const PRODUCT_COLOR_PALETTE = [
  '#33658a',
  '#8d6cab',
  '#2f7f79',
  '#c57b57',
  '#5271a5',
  '#7b8f45',
  '#b2647d',
  '#4f86c6',
  '#9a6f3f',
  '#4e7d57',
  '#7a5ea6',
  '#5c8099'
];
const CASH_COLOR = '#7b8794';

const getInitialAccountName = () => readStoredAccountName() || DEFAULT_ACCOUNT_NAME;

const formatCurrency = (value) => new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0
}).format(Number(value || 0));

const formatCompactCurrency = (value) => new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  notation: 'compact',
  maximumFractionDigits: 0
}).format(Number(value || 0));

const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;

const assetTypeLabel = (value) => {
  if (value === 'risk') return '위험자산';
  if (value === 'safe') return '안전자산';
  return value || '-';
};

const assetTypeShortLabel = (value) => {
  if (value === 'risk') return '위험';
  if (value === 'safe') return '안전';
  return '-';
};

const getProductColor = (index) => {
  if (index < PRODUCT_COLOR_PALETTE.length) return PRODUCT_COLOR_PALETTE[index];
  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue} 42% 48%)`;
};

const wrapChartLabel = (value, maxChars = 12) => {
  const text = String(value || '').trim();
  if (!text) return [''];

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const lines = [];
    let current = '';

    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= maxChars || !current) {
        current = next;
      } else {
        lines.push(current);
        current = word;
      }
    });

    if (current) lines.push(current);
    return lines.slice(0, 2);
  }

  const lines = [];
  for (let index = 0; index < text.length; index += maxChars) {
    lines.push(text.slice(index, index + maxChars));
  }
  return lines.slice(0, 2);
};

function ProfitYAxisTick({ x, y, payload }) {
  const lines = wrapChartLabel(payload?.value, 12);
  const lineHeight = 14;
  const baseY = -((lines.length - 1) * lineHeight) / 2;

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={baseY + 4}
        textAnchor="end"
        fill="#102a43"
        fontSize={12}
        fontWeight={600}
      >
        {lines.map((line, index) => (
          <tspan key={`${payload?.value}-${index}`} x={0} dy={index === 0 ? 0 : lineHeight}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function Dashboard() {
  const [accountName, setAccountName] = useState(getInitialAccountName);
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [cashEditing, setCashEditing] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [cashLoading, setCashLoading] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState('');
  const [analyticsRaw, setAnalyticsRaw] = useState({
    allProducts: [],
    transactions: [],
    trends: [],
    benchmark: { name: DEFAULT_BENCHMARKS.retirement.name, series: [] }
  });
  const [benchmarkSelection, setBenchmarkSelection] = useState(null);
  const [benchmarkQuery, setBenchmarkQuery] = useState('');
  const [benchmarkSearchResults, setBenchmarkSearchResults] = useState([]);
  const [benchmarkSearchLoading, setBenchmarkSearchLoading] = useState(false);
  const [exportingReport, setExportingReport] = useState(false);

  const fetchDashboardData = useCallback(async () => {
    try {
      setError('');
      setAnalyticsError('');
      const [summaryResponse, productsResponse, allProductsResponse, trendsResponse, tradeLogsResponse] = await Promise.all([
        portfolioAPI.getSummary(accountName),
        portfolioAPI.getProducts(accountName),
        portfolioAPI.getAllProducts(accountName),
        portfolioAPI.getTrends(accountName, { includeSold: true }),
        tradeLogAPI.getLogs({ accountName })
      ]);
      setSummary(summaryResponse);
      setProducts(productsResponse);
      setAnalyticsRaw((prev) => ({
        allProducts: allProductsResponse,
        transactions: tradeLogsResponse,
        trends: trendsResponse,
        benchmark: prev.benchmark?.code
          ? prev.benchmark
          : { name: DEFAULT_BENCHMARKS[summaryResponse?.account_type]?.name || DEFAULT_BENCHMARKS.retirement.name, series: [] }
      }));
    } catch (err) {
      setError(err.message || '현황을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
      setAnalyticsLoading(false);
    }
  }, [accountName]);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 60000);
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  useEffect(() => {
    setCashAmount(String(summary?.total_cash ?? 0));
  }, [summary?.total_cash, accountName]);

  useEffect(() => {
    if (!summary?.account_type) return;
    const storedSelection = readStoredBenchmarkSelection(accountName, summary.account_type);
    setBenchmarkSelection({
      ...storedSelection,
      accountName
    });
  }, [accountName, summary?.account_type]);

  useEffect(() => {
    if (!summary?.account_type || !benchmarkSelection?.code) return;

    let active = true;
    const loadBenchmarkSeries = async () => {
      setAnalyticsLoading(true);
      setAnalyticsError('');
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
      } catch (benchmarkFetchError) {
        if (!active) return;
        setAnalyticsRaw((prev) => ({
          ...prev,
          benchmark: {
            code: benchmarkSelection.code,
            name: benchmarkSelection.name,
            series: []
          }
        }));
        setAnalyticsError('선택한 benchmark 시계열을 불러오지 못했습니다.');
      } finally {
        if (active) setAnalyticsLoading(false);
      }
    };

    loadBenchmarkSeries();
    return () => {
      active = false;
    };
  }, [summary?.account_type, benchmarkSelection]);

  useEffect(() => {
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
        if (active) {
          setBenchmarkSearchResults(results.slice(0, 8));
        }
      } catch (searchError) {
        if (active) {
          setBenchmarkSearchResults([]);
        }
      } finally {
        if (active) setBenchmarkSearchLoading(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [benchmarkQuery]);

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
    setNotice(`${nextSelection.name} benchmark를 계좌 분석 기준으로 적용했습니다.`);
  }, [accountName]);

  const analyticsResult = useMemo(() => {
    if (!summary) {
      return { report: null, runtimeError: '' };
    }

    try {
      return {
        report: computePortfolioAnalytics(buildAnalyticsInputs({
          accountType: summary?.account_type || 'retirement',
          holdings: analyticsRaw.allProducts,
          products: analyticsRaw.allProducts,
          summary,
          transactions: analyticsRaw.transactions,
          trends: analyticsRaw.trends,
          benchmarkSeries: analyticsRaw.benchmark
        })),
        runtimeError: ''
      };
    } catch (analyticsEngineError) {
      return {
        report: null,
        runtimeError: analyticsEngineError.message || '분석 엔진 계산 중 오류가 발생했습니다.'
      };
    }
  }, [analyticsRaw, summary]);

  const analyticsReport = analyticsResult.report;
  const analyticsRuntimeError = analyticsResult.runtimeError;
  const retirementEligibility = useMemo(() => summarizeRetirementEligibility({
    products,
    accountType: summary?.account_type,
    accountCategory: summary?.account_category,
    cashAmount: summary?.total_cash || 0
  }), [products, summary?.account_category, summary?.account_type, summary?.total_cash]);
  const benchmarkBadge = useMemo(() => (
    benchmarkSelection?.code ? buildDataBadgeDescriptor({
      source: inferSourceKeyFromCode(benchmarkSelection.code),
      asOf: analyticsReport?.meta?.endDate,
      code: benchmarkSelection.code,
      note: benchmarkSelection.name
    }) : null
  ), [analyticsReport?.meta?.endDate, benchmarkSelection]);
  const analyticsDataBadges = useMemo(() => {
    const badges = [
      buildDataBadgeDescriptor({
        source: 'PortfolioLedger',
        freshnessClass: 'internal_ledger',
        asOf: analyticsReport?.meta?.endDate,
        note: '보유 대장/매매일지'
      })
    ];
    if (benchmarkBadge) badges.push(benchmarkBadge);
    return badges;
  }, [analyticsReport?.meta?.endDate, benchmarkBadge]);
  const analyticsFreshnessWarning = useMemo(() => buildFreshnessMixWarning(analyticsDataBadges), [analyticsDataBadges]);

  const exportAccountAnalyticsReport = useCallback(() => {
    if (!analyticsReport) return;
    const exportedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    setExportingReport(true);
    try {
      const html = buildAnalyticsReportHtml({
        report: analyticsReport,
        accountName,
        benchmarkSelection,
        exportedAt
      });
      const filename = buildAnalyticsReportFilename({ accountName, exportedAt });
      downloadAnalyticsReport({ filename, html });
      setNotice('계좌별 분석 리포트를 export했습니다.');
    } catch (exportError) {
      setAnalyticsError(exportError.message || '분석 리포트 export 중 오류가 발생했습니다.');
    } finally {
      setExportingReport(false);
    }
  }, [accountName, analyticsReport, benchmarkSelection]);

  const moveBenchmarkFromSearchResult = useCallback((item) => {
    applyBenchmarkSelection({
      code: item.code,
      name: item.name
    }, 'custom');
  }, [applyBenchmarkSelection]);

  const chooseBenchmarkPreset = useCallback((code) => {
    const selected = benchmarkOptions.find((option) => option.code === code);
    if (!selected) return;
    applyBenchmarkSelection(selected, selected.source || 'preset');
  }, [applyBenchmarkSelection, benchmarkOptions]);

  const changeAccountName = (value) => {
    writeStoredAccountName(value);
    setAccountName(value);
    setSummary(null);
    setProducts([]);
    setAnalyticsRaw({
      allProducts: [],
      transactions: [],
      trends: [],
      benchmark: { name: DEFAULT_BENCHMARKS.retirement.name, series: [] }
    });
    setBenchmarkSelection(null);
    setBenchmarkQuery('');
    setBenchmarkSearchResults([]);
    setNotice('');
    setError('');
    setLoading(true);
    setAnalyticsLoading(true);
    setAnalyticsError('');
  };

  const allocation = useMemo(() => ([
    {
      name: '위험자산',
      value: Number(summary?.asset_allocation?.risk?.percentage || 0),
      amount: Number(summary?.asset_allocation?.risk?.value || 0),
      key: 'risk'
    },
    {
      name: '안전자산',
      value: Number(summary?.asset_allocation?.safe?.percentage || 0),
      amount: Number(summary?.asset_allocation?.safe?.value || 0),
      key: 'safe'
    }
  ]), [summary]);

  const productColorMap = useMemo(() => {
    const map = new Map();
    products.forEach((product, index) => {
      map.set(String(product.id), getProductColor(index));
    });
    return map;
  }, [products]);

  const displayProducts = useMemo(() => {
    const rows = [...products];
    const cash = Number(summary?.total_cash || 0);

    if (cash > 0 && summary?.account_type !== 'brokerage') {
      rows.push({
        id: 'cash',
        product_name: '보유 현금',
        product_code: '현금',
        asset_type: 'safe',
        purchase_date: '-',
        current_value: cash,
        total_purchase_value: null,
        profit_loss: null,
        profit_rate: null,
        is_cash: true
      });
    }

    return rows;
  }, [products, summary]);

  const holdingAllocation = useMemo(() => {
    const positiveRows = displayProducts
      .map((product) => ({
        ...product,
        amount: Number(product.current_value || 0)
      }))
      .filter((product) => product.amount > 0);

    const totalAmount = positiveRows.reduce((sum, product) => sum + product.amount, 0);
    if (!totalAmount) return [];

    return positiveRows
      .map((product) => ({
        key: product.id,
        name: product.product_name,
        amount: product.amount,
        percent: (product.amount / totalAmount) * 100,
        assetType: product.asset_type,
        fill: product.is_cash ? CASH_COLOR : (productColorMap.get(String(product.id)) || getProductColor(0)),
        isCash: Boolean(product.is_cash)
      }))
      .sort((left, right) => right.amount - left.amount);
  }, [displayProducts, productColorMap]);

  const holdingTotalAmount = useMemo(
    () => holdingAllocation.reduce((sum, item) => sum + item.amount, 0),
    [holdingAllocation]
  );

  const sortedDisplayProducts = useMemo(() => {
    const rows = [...displayProducts];
    return rows.sort((left, right) => {
      if (left.is_cash && right.is_cash) return 0;
      if (left.is_cash) return 1;
      if (right.is_cash) return -1;

      const profitGap = Number(right.profit_rate || 0) - Number(left.profit_rate || 0);
      if (profitGap !== 0) return profitGap;

      return Number(right.current_value || 0) - Number(left.current_value || 0);
    });
  }, [displayProducts]);

  const profitData = useMemo(() => (
    products
      .map((product) => ({
        key: product.id,
        name: product.product_name,
        profitRate: Number(product.profit_rate || 0),
        fill: productColorMap.get(String(product.id)) || getProductColor(0)
      }))
      .sort((left, right) => right.profitRate - left.profitRate)
  ), [productColorMap, products]);

  const profitDomain = useMemo(() => {
    if (profitData.length === 0) return [-10, 10];

    const rates = profitData.map((entry) => Number(entry.profitRate || 0));
    const rawMin = Math.min(...rates, 0);
    const rawMax = Math.max(...rates, 0);
    const span = Math.max(rawMax - rawMin, 10);
    const padding = Math.max(span * 0.08, 4);
    const min = Math.floor((rawMin - padding) / 5) * 5;
    const max = Math.ceil((rawMax + padding) / 5) * 5;

    if (min === max) return [min - 5, max + 5];
    return [min, max];
  }, [profitData]);

  const profitChartHeight = Math.max(280, profitData.length * 60);

  const syncPrices = async () => {
    try {
      setSyncing(true);
      setError('');
      setNotice('');
      const result = await portfolioAPI.syncPrices(accountName);
      await fetchDashboardData();
      const failedItems = result.items.filter((item) => !item.success);
      if (failedItems.length > 0) {
        setNotice(
          failedItems
            .map((item) => `${item.product_code}: ${item.reason || '자동 시세를 확인하지 못했습니다.'}`)
            .join(' / ')
        );
      } else {
        setNotice(result.message || '가격 동기화를 마쳤습니다.');
      }
    } catch (err) {
      setError(err.message || '가격 동기화에 실패했습니다.');
    } finally {
      setSyncing(false);
    }
  };

  const openCashEditor = () => {
    setCashAmount(String(summary?.total_cash ?? 0));
    setCashEditing(true);
    setNotice('');
    setError('');
  };

  const cancelCashEditor = () => {
    setCashAmount(String(summary?.total_cash ?? 0));
    setCashEditing(false);
  };

  const saveCash = async () => {
    try {
      setCashLoading(true);
      setError('');
      setNotice('');
      await portfolioAPI.updateCash(cashAmount, accountName);
      await fetchDashboardData();
      setCashEditing(false);
      setNotice('보유 현금을 업데이트했습니다.');
    } catch (err) {
      setError(err.message || '보유 현금 업데이트에 실패했습니다.');
    } finally {
      setCashLoading(false);
    }
  };

  if (loading) return <div className="loading">현황을 불러오는 중...</div>;

  return (
    <main className="dashboard">
      <AccountSelector value={accountName} onChange={changeAccountName} />

      <section className="summary-section">
        <div className="header">
          <div>
            <h1>{accountName} 현황</h1>
            <p>원금, 보유 상품, 현금을 한 번에 보면서 계좌 상태를 빠르게 확인합니다.</p>
          </div>
          <div className="header-actions">
            <button type="button" onClick={syncPrices} className="refresh-btn" disabled={syncing}>
              {syncing ? '동기화 중...' : '가격 동기화'}
            </button>
            <button type="button" onClick={fetchDashboardData} className="refresh-btn">새로고침</button>
          </div>
        </div>

        {error && <div className="error-container">{error}</div>}
        {notice && <div className="notice-container">{notice}</div>}

        <div className="summary-cards">
          <div className="card">
            <h3>현재 원금 합계</h3>
            <p className="amount">{formatCurrency(summary?.total_investment)}</p>
          </div>

          <div
            className={`card cash-card ${cashEditing ? 'editing' : ''}`}
            role="button"
            tabIndex={cashEditing ? -1 : 0}
            onClick={() => { if (!cashEditing) openCashEditor(); }}
            onKeyDown={(event) => {
              if (!cashEditing && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                openCashEditor();
              }
            }}
          >
            <h3>보유 현금</h3>
            {cashEditing ? (
              <div className="cash-card-editor" onClick={(event) => event.stopPropagation()}>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={cashAmount}
                  onChange={(event) => setCashAmount(event.target.value)}
                  aria-label="보유 현금"
                />
                <div className="cash-card-actions">
                  <button type="button" className="cash-card-save" onClick={saveCash} disabled={cashLoading}>
                    {cashLoading ? '저장 중...' : '저장'}
                  </button>
                  <button type="button" className="cash-card-cancel" onClick={cancelCashEditor} disabled={cashLoading}>
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="amount">{formatCurrency(summary?.total_cash)}</p>
                <span className="cash-card-hint">카드를 눌러 수정</span>
              </>
            )}
          </div>

          <div className="card">
            <h3>현재 보유 평가액</h3>
            <p className="amount">{formatCurrency(summary?.total_current_value)}</p>
          </div>

          <div className="card">
            <h3>원금 대비 수익금</h3>
            <p className={`amount ${(summary?.total_profit_loss || 0) >= 0 ? 'profit' : 'loss'}`}>
              {formatCurrency(summary?.total_profit_loss)}
            </p>
          </div>

          <div className="card">
            <h3>원금 대비 수익률</h3>
            <p className={`amount ${(summary?.total_profit_rate || 0) >= 0 ? 'profit' : 'loss'}`}>
              {formatPercent(summary?.total_profit_rate)}
            </p>
          </div>
        </div>
      </section>

      {retirementEligibility && (
        <section className="eligibility-dashboard-panel">
          <div className="eligibility-dashboard-header">
            <div>
              <h2>퇴직연금 적격성 점검</h2>
              <p>{retirementEligibility.accountCategoryLabel} 기준으로 현재 보유 상품을 다시 분류합니다.</p>
            </div>
            <strong>위험자산 {retirementEligibility.riskShare.toFixed(1)}%</strong>
          </div>
          <div className="eligibility-dashboard-grid">
            {retirementEligibility.rules.map((rule) => (
              <article key={rule.label} className={`eligibility-dashboard-card ${rule.passed ? 'pass' : 'fail'}`}>
                <span>{rule.label}</span>
                <strong>{rule.passed ? '적합' : '주의'}</strong>
                <p>{rule.detail}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="charts-section">
        {summary?.account_type !== 'brokerage' && (
          <div className="chart-container chart-wide allocation-wide">
            <h2>자산구분 비중</h2>
            <div className="allocation-summary">
              {allocation.map((entry) => (
                <div className="allocation-legend-item" key={entry.key}>
                  <div className="allocation-box" style={{ borderColor: `${COLORS[entry.key]}33` }}>
                    <div className="allocation-box-top">
                      <span className="allocation-label">
                        <span className="dot" style={{ backgroundColor: COLORS[entry.key] }} />
                        <span className="holding-name">{entry.name}</span>
                      </span>
                      <strong>{entry.value.toFixed(1)}%</strong>
                    </div>
                    <div className="allocation-bar-track">
                      <div
                        className="allocation-bar-fill"
                        style={{ width: `${Math.min(entry.value, 100)}%`, backgroundColor: COLORS[entry.key] }}
                      />
                    </div>
                    <span className="allocation-amount">{formatCurrency(entry.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="chart-container chart-wide">
          <h2>보유종목 비중</h2>
          {holdingAllocation.length === 0 ? (
            <p className="no-data">등록된 보유 상품이 없습니다.</p>
          ) : (
            <>
              <div className="holding-ring-layout">
                <div className="holding-ring-chart">
                  <ResponsiveContainer width="100%" height={320}>
                    <PieChart>
                      <Pie
                        data={holdingAllocation}
                        dataKey="amount"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={82}
                        outerRadius={128}
                        paddingAngle={2}
                        stroke="#ffffff"
                        strokeWidth={2}
                      >
                        {holdingAllocation.map((entry) => (
                          <Cell key={entry.key} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, _name, item) => {
                          const payload = item?.payload || {};
                          return [
                            `${formatCurrency(value)} / ${Number(payload.percent || 0).toFixed(1)}%`,
                            payload.name || '보유 종목'
                          ];
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="holding-ring-center">
                    <span>총 평가액</span>
                    <strong>{formatCompactCurrency(holdingTotalAmount)}</strong>
                  </div>
                </div>

                <div className="holding-allocation-list">
                  {holdingAllocation.map((item) => (
                    <div className="holding-allocation-item" key={item.key}>
                      <span className="dot" style={{ backgroundColor: item.fill }} />
                      <span className="holding-name">{item.name}</span>
                      <span>{assetTypeShortLabel(item.assetType)}</span>
                      <strong>{item.percent.toFixed(1)}%</strong>
                      <small>{formatCurrency(item.amount)}</small>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="chart-container chart-wide">
          <h2>상품별 수익률</h2>
          {profitData.length === 0 ? (
            <p className="no-data">등록된 보유 상품이 없습니다.</p>
          ) : (
            <>
              <div className="profit-chart-mobile">
                {profitData.map((entry) => {
                  const barWidth = Math.min(Math.abs(entry.profitRate), 100);
                  return (
                    <div className="profit-mobile-item" key={entry.key}>
                      <div className="profit-mobile-head">
                        <strong>{entry.name}</strong>
                        <span className={entry.profitRate >= 0 ? 'profit' : 'loss'}>{formatPercent(entry.profitRate)}</span>
                      </div>
                      <div className="profit-mobile-track">
                        <div className="profit-mobile-bar" style={{ width: `${barWidth}%`, backgroundColor: entry.fill }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="profit-chart-desktop">
                <div className="profit-chart-scroll">
                  <div className="profit-chart-inner">
                    <ResponsiveContainer width="100%" height={profitChartHeight}>
                      <BarChart
                        data={profitData}
                        layout="vertical"
                        margin={{ top: 8, right: 44, left: 12, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          type="number"
                          domain={profitDomain}
                          tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                        />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={220}
                          tickLine={false}
                          axisLine={false}
                          tick={<ProfitYAxisTick />}
                        />
                        <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
                        <Bar dataKey="profitRate" radius={[0, 6, 6, 0]}>
                          {profitData.map((entry) => (
                            <Cell key={entry.key} fill={entry.fill} />
                          ))}
                          <LabelList
                            dataKey="profitRate"
                            position="right"
                            formatter={(value) => `${Number(value).toFixed(1)}%`}
                            className="profit-bar-label"
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="products-table">
        <h2>보유 상품</h2>
        {sortedDisplayProducts.length === 0 ? (
          <p className="no-data">등록된 보유 상품이 없습니다.</p>
        ) : (
          <>
            <div className="table-wrapper desktop-products-table">
              <table>
                <thead>
                  <tr>
                    <th>상품명</th>
                    <th>자산 구분</th>
                    <th>매입일</th>
                    <th>구매금액</th>
                    <th>현재가치</th>
                    <th>수익금</th>
                    <th>수익률</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDisplayProducts.map((product) => (
                    <tr key={product.id}>
                      <td>{product.product_name}<span className="code">{product.product_code}</span></td>
                      <td>{assetTypeLabel(product.asset_type)}</td>
                      <td>{product.purchase_date}</td>
                      <td>{product.is_cash ? '-' : formatCurrency(product.total_purchase_value)}</td>
                      <td>{formatCurrency(product.current_value)}</td>
                      <td className={product.is_cash ? '' : ((product.profit_loss || 0) >= 0 ? 'profit' : 'loss')}>
                        {product.is_cash ? '-' : formatCurrency(product.profit_loss)}
                      </td>
                      <td className={product.is_cash ? '' : ((product.profit_rate || 0) >= 0 ? 'profit' : 'loss')}>
                        {product.is_cash ? '-' : formatPercent(product.profit_rate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-product-cards">
              {sortedDisplayProducts.map((product) => (
                <article className="mobile-product-card" key={product.id}>
                  <div className="mobile-product-header">
                    <div>
                      <strong>{product.product_name}</strong>
                      <span className="code">{product.product_code}</span>
                    </div>
                    <span className="mobile-asset-badge">{assetTypeLabel(product.asset_type)}</span>
                  </div>
                  <div className="mobile-product-grid">
                    <div>
                      <span>매입일</span>
                      <strong>{product.purchase_date}</strong>
                    </div>
                    <div>
                      <span>구매금액</span>
                      <strong>{product.is_cash ? '-' : formatCurrency(product.total_purchase_value)}</strong>
                    </div>
                    <div>
                      <span>현재가치</span>
                      <strong>{formatCurrency(product.current_value)}</strong>
                    </div>
                    <div>
                      <span>수익금</span>
                      <strong className={product.is_cash ? '' : ((product.profit_loss || 0) >= 0 ? 'profit' : 'loss')}>
                        {product.is_cash ? '-' : formatCurrency(product.profit_loss)}
                      </strong>
                    </div>
                    <div>
                      <span>수익률</span>
                      <strong className={product.is_cash ? '' : ((product.profit_rate || 0) >= 0 ? 'profit' : 'loss')}>
                        {product.is_cash ? '-' : formatPercent(product.profit_rate)}
                      </strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <AnalyticsDashboard
        report={analyticsReport}
        loading={analyticsLoading}
        error={analyticsError || analyticsRuntimeError || (!analyticsLoading && !analyticsReport ? '분석 엔진 계산 중 오류가 발생했습니다.' : '')}
        benchmarkSelection={benchmarkSelection}
        benchmarkOptions={benchmarkOptions}
        benchmarkQuery={benchmarkQuery}
        benchmarkSearchResults={benchmarkSearchResults}
        benchmarkSearchLoading={benchmarkSearchLoading}
        onChangeBenchmarkQuery={setBenchmarkQuery}
        onSelectBenchmark={moveBenchmarkFromSearchResult}
        onChangeBenchmarkPreset={chooseBenchmarkPreset}
        onExportReport={exportAccountAnalyticsReport}
        exportingReport={exportingReport}
        linkedCandidate={benchmarkSelection?.source === 'screener' ? benchmarkSelection : null}
        dataBadges={analyticsDataBadges}
        freshnessWarning={analyticsFreshnessWarning}
      />
    </main>
  );
}

export default Dashboard;
