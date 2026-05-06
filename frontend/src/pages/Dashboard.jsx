import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import AccountSelector from '../components/AccountSelector';
import DataBadge from '../components/DataBadge';
import useResolvedAccount from '../hooks/useResolvedAccount';
import { buildDataBadgeDescriptor, inferSourceKeyFromCode } from '../lib/sourceRegistry';
import { portfolioAPI } from '../utils/api';
import '../styles/Dashboard.css';

const ASSET_COLORS = {
  risk: '#d94841',
  safe: '#256f68'
};
const HOLDING_COLORS = ['#33658a', '#d94841', '#256f68', '#f6ae2d', '#6a4c93', '#2f4858', '#9f6b2e', '#0081a7'];

const formatCurrency = (value) => new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0
}).format(Number(value || 0));

const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;

const formatDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const renderProfitLabel = ({ x = 0, y = 0, width = 0, height = 0, value = 0 }) => {
  const numericValue = Number(value || 0);
  const positive = numericValue >= 0;
  const labelX = positive ? x + width + 8 : x + width - 8;

  return (
    <text
      x={labelX}
      y={y + (height / 2) + 4}
      fill="#102a43"
      fontSize="12"
      fontWeight="700"
      textAnchor={positive ? 'start' : 'end'}
    >
      {`${numericValue.toFixed(1)}%`}
    </text>
  );
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState('');

  const fetchDashboardData = useCallback(async ({ silent = false } = {}) => {
    if (!accountReady) return;

    try {
      if (!silent) setLoading(true);
      setError('');

      const [summaryResponse, productsResponse] = await Promise.all([
        portfolioAPI.getSummary(accountName),
        portfolioAPI.getProducts(accountName)
      ]);

      setSummary(summaryResponse || null);
      setProducts(Array.isArray(productsResponse) ? productsResponse : []);
      setLastLoadedAt(new Date().toISOString());
    } catch (fetchError) {
      setError(fetchError.message || '현황을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [accountName, accountReady]);

  useEffect(() => {
    if (!accountReady) return undefined;

    fetchDashboardData();
    const interval = setInterval(() => fetchDashboardData({ silent: true }), 60000);
    return () => clearInterval(interval);
  }, [accountReady, fetchDashboardData]);

  const changeAccountName = (value) => {
    persistAccountName(value);
    setSummary(null);
    setProducts([]);
    setNotice('');
    setError('');
    setLoading(true);
    setLastLoadedAt('');
  };

  const syncPrices = async () => {
    try {
      setSyncing(true);
      setError('');
      setNotice('');
      const result = await portfolioAPI.syncPrices(accountName);
      await fetchDashboardData({ silent: true });
      setNotice(result?.message || '가격 동기화를 완료했습니다.');
    } catch (syncError) {
      setError(syncError.message || '가격 동기화에 실패했습니다.');
    } finally {
      setSyncing(false);
    }
  };

  const accountTypeLabel = selectedAccountProfile?.account_type_label || summary?.account_type_label || '계좌';
  const accountCategoryLabel = selectedAccountProfile?.account_category_label || summary?.account_category_label || '';
  const accountContextLabel = [accountName, accountTypeLabel, accountCategoryLabel].filter(Boolean).join(' · ');
  const summaryIntro = summary?.account_type === 'brokerage'
    ? '현재 보유 종목의 평가액과 수익률을 바로 확인하고, 더 깊은 해석은 종목 분석 탭에서 이어갑니다.'
    : '입금 원금 대비 현재 평가 상태를 먼저 확인하고, 심층 분석은 종목 분석 탭에서 이어갑니다.';

  const marketBadge = useMemo(() => buildDataBadgeDescriptor({
    source: inferSourceKeyFromCode(products.find((item) => item?.product_code)?.product_code || ''),
    freshnessClass: 'delayed_20m',
    code: products.find((item) => item?.product_code)?.product_code || '',
    note: '시세 기준'
  }), [products]);

  const ledgerBadge = useMemo(() => buildDataBadgeDescriptor({
    source: 'portfolio_ledger',
    freshnessClass: 'internal_ledger',
    note: '계좌 원장'
  }), []);

  const allocationData = useMemo(() => ([
    {
      key: 'risk',
      name: '위험자산',
      value: Number(summary?.asset_allocation?.risk?.percentage || 0),
      amount: Number(summary?.asset_allocation?.risk?.value || 0)
    },
    {
      key: 'safe',
      name: '안전자산',
      value: Number(summary?.asset_allocation?.safe?.percentage || 0),
      amount: Number(summary?.asset_allocation?.safe?.value || 0)
    }
  ]), [summary]);

  const displayProducts = useMemo(() => {
    const rows = [...products];
    const cash = Number(summary?.total_cash || 0);

    if (cash > 0) {
      rows.push({
        id: 'cash',
        product_name: '보유 현금',
        product_code: 'CASH',
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

  const profitData = useMemo(() => (
    products
      .map((product, index) => ({
        key: product.id,
        name: product.product_name,
        shortName: product.product_name.length > 18 ? `${product.product_name.slice(0, 18)}...` : product.product_name,
        returnRate: Number(product.profit_rate || 0),
        fill: product.asset_type === 'safe'
          ? '#4f8f83'
          : HOLDING_COLORS[index % HOLDING_COLORS.length]
      }))
      .sort((left, right) => right.returnRate - left.returnRate)
  ), [products]);

  const profitChartHeight = Math.max(260, profitData.length * 52);
  const profitDomain = useMemo(() => {
    if (profitData.length === 0) return [-10, 10];

    const values = profitData.map((item) => item.returnRate);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const padding = Math.max(4, (max - min) * 0.12 || 4);
    return [
      Math.floor((min - padding) * 10) / 10,
      Math.ceil((max + padding) * 10) / 10
    ];
  }, [profitData]);

  const hasVisibleHoldings = displayProducts.length > 0;
  const emptyState = !loading && !error && !hasVisibleHoldings;

  const summaryCards = [
    {
      key: 'principal',
      title: '입금 원금',
      value: formatCurrency(summary?.total_investment),
      tone: ''
    },
    {
      key: 'cash',
      title: '보유 현금',
      value: formatCurrency(summary?.total_cash),
      tone: ''
    },
    {
      key: 'current',
      title: '현재 평가액',
      value: formatCurrency(summary?.total_current_value),
      tone: ''
    },
    {
      key: 'profit-loss',
      title: '원금 대비 평가손익',
      value: formatCurrency(summary?.total_profit_loss),
      tone: Number(summary?.total_profit_loss || 0) >= 0 ? 'profit' : 'loss'
    },
    {
      key: 'profit-rate',
      title: '원금 대비 수익률',
      value: formatPercent(summary?.total_profit_rate),
      tone: Number(summary?.total_profit_rate || 0) >= 0 ? 'profit' : 'loss'
    }
  ];

  if (loading) {
    return (
      <main className="dashboard dashboard-overview">
        <AccountSelector value={accountName} onChange={changeAccountName} onAccountsChange={syncAccountProfiles} />
        <section className="overview-loading" aria-label="현황 로딩" role="status" aria-live="polite">
          <h1>현황</h1>
          <div className="overview-skeleton-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <article key={`sk-${index}`} className="overview-skeleton-card" aria-hidden="true" />
            ))}
          </div>
        </section>
      </main>
    );
  }

  if (error && !summary) {
    return (
      <main className="dashboard dashboard-overview">
        <AccountSelector value={accountName} onChange={changeAccountName} onAccountsChange={syncAccountProfiles} />
        <section className="overview-error" role="alert" aria-live="assertive">
          <h1>현황</h1>
          <p>{error}</p>
          <button type="button" onClick={() => fetchDashboardData()}>
            다시 시도
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard dashboard-overview">
      <AccountSelector value={accountName} onChange={changeAccountName} onAccountsChange={syncAccountProfiles} />

      <section className="overview-header">
        <div className="overview-header-copy">
          <p className="overview-eyebrow">{accountContextLabel}</p>
          <h1>현황</h1>
          <p>{summaryIntro}</p>
          <div className="overview-source-row" aria-label="데이터 기준 정보">
            <DataBadge descriptor={ledgerBadge} compact />
            <DataBadge descriptor={marketBadge} compact />
            <span className="overview-last-updated">마지막 조회 {formatDateTime(lastLoadedAt)}</span>
          </div>
        </div>
        <div className="overview-header-actions">
          <button type="button" onClick={syncPrices} disabled={syncing}>
            {syncing ? '가격 동기화 중...' : '가격 동기화'}
          </button>
          <button type="button" onClick={() => fetchDashboardData({ silent: true })}>
            새로고침
          </button>
        </div>
      </section>

      {notice && <div className="overview-notice" role="status">{notice}</div>}
      {error && <div className="overview-error-inline" role="alert">{error}</div>}

      <section className="overview-summary-grid" aria-label="현황 요약">
        {summaryCards.map((card) => (
          <article key={card.key} className="overview-stat-card">
            <h2>{card.title}</h2>
            <strong className={card.tone}>{card.value}</strong>
          </article>
        ))}
      </section>

      {emptyState && (
        <section className="dashboard-empty-state" aria-label="초기 설정 안내">
          <h2>아직 보유 상품이 없습니다</h2>
          <p>매매일지에서 첫 매수 기록을 입력하면 현황 화면이 자동으로 채워집니다.</p>
          <div className="dashboard-empty-actions">
            <button type="button" onClick={() => (window.location.href = '/trade-logs')}>매매일지로 이동</button>
            <button type="button" onClick={() => (window.location.href = '/portfolio')}>상품 추이 보기</button>
          </div>
        </section>
      )}

      <section className="overview-panels">
        <article className="overview-panel" aria-label="위험 안전 자산 비율">
          <div className="overview-panel-head">
            <h2>위험 / 안전 자산 비율</h2>
            <DataBadge descriptor={ledgerBadge} compact />
          </div>
          {allocationData.every((item) => item.amount <= 0) ? (
            <p className="overview-no-data">아직 집계할 자산이 없습니다.</p>
          ) : (
            <>
              <div className="overview-chart-shell">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={allocationData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={58}
                      outerRadius={88}
                      label={({ name, value }) => `${name} ${Number(value).toFixed(1)}%`}
                    >
                      {allocationData.map((entry) => (
                        <Cell key={entry.key} fill={ASSET_COLORS[entry.key]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value, name, item) => [`${Number(value).toFixed(2)}% (${formatCurrency(item.payload.amount)})`, name]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="overview-allocation-list">
                {allocationData.map((item) => (
                  <div key={item.key} className="overview-allocation-row">
                    <span className="swatch" style={{ backgroundColor: ASSET_COLORS[item.key] }} />
                    <span>{item.name}</span>
                    <strong>{formatPercent(item.value)}</strong>
                    <small>{formatCurrency(item.amount)}</small>
                  </div>
                ))}
              </div>
            </>
          )}
        </article>

        <article className="overview-panel overview-performance-panel" aria-label="원금 대비 성과">
          <div className="overview-panel-head">
            <h2>원금 대비 성과</h2>
            <span className={`overview-performance-pill ${Number(summary?.total_profit_rate || 0) >= 0 ? 'profit' : 'loss'}`}>
              {formatPercent(summary?.total_profit_rate)}
            </span>
          </div>
          <div className="overview-performance-hero">
            <span>원금 대비 평가손익</span>
            <strong className={Number(summary?.total_profit_loss || 0) >= 0 ? 'profit' : 'loss'}>
              {formatCurrency(summary?.total_profit_loss)}
            </strong>
            <small>현재 평가액 {formatCurrency(summary?.total_current_value)}</small>
          </div>
          <div className="overview-performance-list">
            <div>
              <span>입금 원금</span>
              <strong>{formatCurrency(summary?.total_investment)}</strong>
            </div>
            <div>
              <span>보유 현금</span>
              <strong>{formatCurrency(summary?.total_cash)}</strong>
            </div>
            <div>
              <span>계좌 유형</span>
              <strong>{[accountTypeLabel, accountCategoryLabel].filter(Boolean).join(' · ') || '-'}</strong>
            </div>
          </div>
          <button
            type="button"
            className="overview-link-button"
            onClick={() => (window.location.href = '/stock-research')}
          >
            종목 분석으로 이어서 보기
          </button>
        </article>

        <article className="overview-panel overview-panel-wide" aria-label="현재 보유 종목 수익률">
          <div className="overview-panel-head">
            <h2>현재 보유 종목 수익률</h2>
            <DataBadge descriptor={marketBadge} compact />
          </div>
          {profitData.length === 0 ? (
            <p className="overview-no-data">보유 중인 종목이 없어서 수익률 차트를 아직 그릴 수 없습니다.</p>
          ) : (
            <div className="overview-chart-shell">
              <ResponsiveContainer width="100%" height={profitChartHeight}>
                <BarChart
                  data={profitData}
                  layout="vertical"
                  margin={{ top: 8, right: 44, left: 4, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <ReferenceLine x={0} stroke="#94a3b8" />
                  <XAxis
                    type="number"
                    domain={profitDomain}
                    tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                  />
                  <YAxis
                    type="category"
                    dataKey="shortName"
                    width={136}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
                  <Bar dataKey="returnRate" radius={[0, 6, 6, 0]}>
                    {profitData.map((entry) => (
                      <Cell key={entry.key} fill={entry.fill} />
                    ))}
                    <LabelList dataKey="returnRate" content={renderProfitLabel} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </article>
      </section>

      <section className="overview-products" aria-label="현재 보유 종목 목록">
        <div className="overview-panel-head">
          <h2>현재 보유 종목</h2>
          <DataBadge descriptor={ledgerBadge} compact />
        </div>
        {!hasVisibleHoldings ? (
          <p className="overview-no-data">등록된 보유 상품이 없습니다.</p>
        ) : (
          <div className="overview-table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>상품명</th>
                  <th>자산 구분</th>
                  <th>매입일</th>
                  <th>매수금액</th>
                  <th>평가액</th>
                  <th>평가손익</th>
                  <th>수익률</th>
                </tr>
              </thead>
              <tbody>
                {displayProducts.map((product) => (
                  <tr key={product.id}>
                    <td>
                      {product.product_name}
                      <span className="overview-code">{product.product_code}</span>
                    </td>
                    <td>{product.asset_type === 'risk' ? '위험자산' : '안전자산'}</td>
                    <td>{product.purchase_date || '-'}</td>
                    <td>{product.is_cash ? '-' : formatCurrency(product.total_purchase_value)}</td>
                    <td>{formatCurrency(product.current_value)}</td>
                    <td className={product.is_cash ? '' : (Number(product.profit_loss || 0) >= 0 ? 'profit' : 'loss')}>
                      {product.is_cash ? '-' : formatCurrency(product.profit_loss)}
                    </td>
                    <td className={product.is_cash ? '' : (Number(product.profit_rate || 0) >= 0 ? 'profit' : 'loss')}>
                      {product.is_cash ? '-' : formatPercent(product.profit_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default Dashboard;
