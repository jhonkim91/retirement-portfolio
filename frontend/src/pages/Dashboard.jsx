import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AccountSelector from '../components/AccountSelector';
import { ACCOUNT_STORAGE_KEY, DEFAULT_ACCOUNT_NAME, portfolioAPI } from '../utils/api';
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
const getInitialAccountName = () => localStorage.getItem(ACCOUNT_STORAGE_KEY) || DEFAULT_ACCOUNT_NAME;

const getProductColor = (index) => {
  if (index < PRODUCT_COLOR_PALETTE.length) {
    return PRODUCT_COLOR_PALETTE[index];
  }
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
  const lines = wrapChartLabel(payload?.value, 10);
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

  const fetchDashboardData = useCallback(async () => {
    try {
      setError('');
      const [summaryRes, productsRes] = await Promise.all([
        portfolioAPI.getSummary(accountName),
        portfolioAPI.getProducts(accountName)
      ]);
      setSummary(summaryRes);
      setProducts(productsRes);
    } catch (err) {
      setError(err.message || '현황을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
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

  const changeAccountName = (value) => {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, value);
    setAccountName(value);
    setNotice('');
    setError('');
    setLoading(true);
  };

  const allocation = useMemo(() => ([
    { name: '위험자산', value: summary?.asset_allocation?.risk?.percentage || 0, amount: summary?.asset_allocation?.risk?.value || 0, key: 'risk' },
    { name: '안전자산', value: summary?.asset_allocation?.safe?.percentage || 0, amount: summary?.asset_allocation?.safe?.value || 0, key: 'safe' }
  ]), [summary]);

  const displayProducts = useMemo(() => {
    const rows = [...products];
    const cash = Number(summary?.total_cash || 0);
    if (cash > 0) {
      rows.push({
        id: 'cash',
        product_name: '보유 현금',
        product_code: '현금',
        asset_type: 'safe',
        purchase_date: '-',
        purchase_price: null,
        current_price: null,
        quantity: null,
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
    const productColorMap = new Map();
    products.forEach((product, index) => {
      productColorMap.set(String(product.id), getProductColor(index));
    });

    const total = Number(summary?.total_current_value || 0);
    if (!total) return [];
    return displayProducts
      .filter((product) => Number(product.current_value || 0) > 0)
      .map((product) => ({
        key: product.id,
        name: product.product_name,
        amount: Number(product.current_value || 0),
        value: Number(product.current_value || 0) / total * 100,
        asset_type: product.asset_type,
        fill: product.is_cash ? CASH_COLOR : (productColorMap.get(String(product.id)) || getProductColor(0))
      }));
  }, [displayProducts, products, summary]);

  const profitData = useMemo(() => (
    products
      .map((product, index) => ({
        key: product.id,
        name: product.product_name,
        수익률: Number(product.profit_rate || 0),
        fill: getProductColor(index)
      }))
      .sort((left, right) => right.수익률 - left.수익률)
  ), [products]);
  const profitChartHeight = Math.max(280, profitData.length * 60);

  const formatCurrency = (value) => new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0
  }).format(value || 0);

  const syncPrices = async () => {
    try {
      setSyncing(true);
      setError('');
      setNotice('');
      const result = await portfolioAPI.syncPrices(accountName);
      await fetchDashboardData();
      const failed = result.items.filter((item) => !item.success);
      if (failed.length > 0) {
        setNotice(failed.map((item) => `${item.product_code}: ${item.reason || '수동 기준가 입력이 필요합니다.'}`).join(' / '));
      } else {
        setNotice(result.message || '가격 동기화가 완료되었습니다.');
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
            <p>회사 현금입금 원금 대비 현재 보유 상품과 보유 현금을 기준으로 평가합니다.</p>
          </div>
          <div className="header-actions">
            <button type="button" onClick={syncPrices} className="refresh-btn" disabled={syncing}>
              {syncing ? '가격 동기화 중...' : '가격 동기화'}
            </button>
            <button type="button" onClick={fetchDashboardData} className="refresh-btn">새로고침</button>
          </div>
        </div>
        {error && <div className="error-container">{error}</div>}
        {notice && <div className="notice-container">{notice}</div>}
        <div className="summary-cards">
          <div className="card"><h3>입금 원금</h3><p className="amount">{formatCurrency(summary?.total_investment)}</p></div>
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
                <span className="cash-card-hint">클릭해서 수정</span>
              </>
            )}
          </div>
          <div className="card"><h3>현재 보유 평가액</h3><p className="amount">{formatCurrency(summary?.total_current_value)}</p></div>
          <div className="card"><h3>원금 대비 평가손익</h3><p className={`amount ${(summary?.total_profit_loss || 0) >= 0 ? 'profit' : 'loss'}`}>{formatCurrency(summary?.total_profit_loss)}</p></div>
          <div className="card"><h3>원금 대비 수익률</h3><p className={`amount ${(summary?.total_profit_rate || 0) >= 0 ? 'profit' : 'loss'}`}>{Number(summary?.total_profit_rate || 0).toFixed(2)}%</p></div>
        </div>
      </section>

      <section className="charts-section">
        <div className="chart-container">
          <h2>자산 구분 비중</h2>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={allocation} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={86} label={({ name, value }) => `${name} ${value.toFixed(1)}%`}>
                {allocation.map((entry) => <Cell key={entry.key} fill={COLORS[entry.key]} />)}
              </Pie>
              <Tooltip formatter={(value, name, item) => [`${value.toFixed(2)}% (${formatCurrency(item.payload.amount)})`, name]} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-container">
          <h2>보유종목 비중</h2>
          {holdingAllocation.length === 0 ? <p className="no-data">등록된 보유 상품이 없습니다.</p> : (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={holdingAllocation} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={82} labelLine={false}>
                    {holdingAllocation.map((entry) => <Cell key={entry.key} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip formatter={(value, name, item) => [`${Number(value).toFixed(2)}% (${formatCurrency(item.payload.amount)})`, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="holding-allocation-list">
                {holdingAllocation.map((item) => (
                  <div className="holding-allocation-item" key={item.key}>
                    <span className="dot" style={{ backgroundColor: item.fill }} />
                    <span className="holding-name">{item.name}</span>
                    <span>{item.asset_type === 'risk' ? '위험' : '안전'}</span>
                    <strong>{item.value.toFixed(1)}%</strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="chart-container chart-wide">
          <h2>상품별 수익률</h2>
          {profitData.length === 0 ? <p className="no-data">등록된 보유 상품이 없습니다.</p> : (
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
                    <Bar dataKey="수익률" radius={[0, 6, 6, 0]}>
                      {profitData.map((entry) => (
                        <Cell key={entry.key} fill={entry.fill} />
                      ))}
                      <LabelList
                        dataKey="수익률"
                        position="right"
                        formatter={(value) => `${Number(value).toFixed(1)}%`}
                        className="profit-bar-label"
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="products-table">
        <h2>보유 상품</h2>
        {displayProducts.length === 0 ? <p className="no-data">등록된 보유 상품이 없습니다.</p> : (
          <div className="table-wrapper">
            <table>
              <thead><tr><th>상품명</th><th>자산 구분</th><th>매입일</th><th>구매액</th><th>평가액</th><th>수익금</th><th>수익률</th></tr></thead>
              <tbody>{displayProducts.map((product) => (
                <tr key={product.id}>
                  <td>{product.product_name}<span className="code">{product.product_code}</span></td>
                  <td>{product.asset_type === 'risk' ? '위험자산' : '안전자산'}</td>
                  <td>{product.purchase_date}</td>
                  <td>{product.is_cash ? '-' : formatCurrency(product.total_purchase_value)}</td>
                  <td>{formatCurrency(product.current_value)}</td>
                  <td className={product.is_cash ? '' : ((product.profit_loss || 0) >= 0 ? 'profit' : 'loss')}>{product.is_cash ? '-' : formatCurrency(product.profit_loss)}</td>
                  <td className={product.is_cash ? '' : ((product.profit_rate || 0) >= 0 ? 'profit' : 'loss')}>{product.is_cash ? '-' : `${Number(product.profit_rate || 0).toFixed(2)}%`}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default Dashboard;
