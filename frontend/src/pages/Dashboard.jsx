import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { portfolioAPI } from '../utils/api';
import '../styles/Dashboard.css';

const COLORS = { risk: '#d94841', safe: '#256f68' };

function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncing, setSyncing] = useState(false);

  const fetchDashboardData = async () => {
    try {
      setError('');
      const [summaryRes, productsRes] = await Promise.all([
        portfolioAPI.getSummary(),
        portfolioAPI.getProducts()
      ]);
      setSummary(summaryRes);
      setProducts(productsRes);
    } catch (err) {
      setError(err.message || '현황을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 60000);
    return () => clearInterval(interval);
  }, []);

  const allocation = useMemo(() => ([
    { name: '위험자산', value: summary?.asset_allocation?.risk?.percentage || 0, amount: summary?.asset_allocation?.risk?.value || 0, key: 'risk' },
    { name: '안전자산+현금', value: summary?.asset_allocation?.safe?.percentage || 0, amount: summary?.asset_allocation?.safe?.value || 0, key: 'safe' }
  ]), [summary]);

  const profitData = products.map((product) => ({
    name: product.product_name.length > 10 ? `${product.product_name.slice(0, 10)}...` : product.product_name,
    수익률: Number(product.profit_rate || 0)
  }));

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
      const result = await portfolioAPI.syncPrices();
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

  if (loading) return <div className="loading">현황을 불러오는 중...</div>;

  return (
    <main className="dashboard">
      <section className="summary-section">
        <div className="header">
          <div>
            <h1>퇴직연금 현황</h1>
            <p>회사 현금입금으로 기록한 원금과 현재 보유 상품, 보유 현금을 기준으로 평가합니다.</p>
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
          <div className="card"><h3>보유 현금</h3><p className="amount">{formatCurrency(summary?.total_cash)}</p></div>
          <div className="card"><h3>현재 평가액</h3><p className="amount">{formatCurrency(summary?.total_current_value)}</p></div>
          <div className="card"><h3>평가손익</h3><p className={`amount ${(summary?.total_profit_loss || 0) >= 0 ? 'profit' : 'loss'}`}>{formatCurrency(summary?.total_profit_loss)}</p></div>
          <div className="card"><h3>원금 대비 수익률</h3><p className={`amount ${(summary?.total_profit_rate || 0) >= 0 ? 'profit' : 'loss'}`}>{Number(summary?.total_profit_rate || 0).toFixed(2)}%</p></div>
        </div>
      </section>

      <section className="charts-section">
        <div className="chart-container">
          <h2>포트폴리오 비중</h2>
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
          <h2>상품별 수익률</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={profitData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={(value) => `${value}%`} />
              <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
              <Bar dataKey="수익률" fill="#33658a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="products-table">
        <h2>보유 상품</h2>
        {products.length === 0 ? <p className="no-data">등록된 보유 상품이 없습니다.</p> : (
          <div className="table-wrapper">
            <table>
              <thead><tr><th>상품명</th><th>자산 구분</th><th>매입일</th><th>매입가</th><th>기준가</th><th>수량</th><th>평가액</th><th>수익률</th></tr></thead>
              <tbody>{products.map((product) => (
                <tr key={product.id}>
                  <td>{product.product_name}<span className="code">{product.product_code}</span></td>
                  <td>{product.asset_type === 'risk' ? '위험자산' : '안전자산'}</td>
                  <td>{product.purchase_date}</td>
                  <td>{formatCurrency(product.purchase_price)}</td>
                  <td>{formatCurrency(product.current_price)}</td>
                  <td>{product.quantity.toLocaleString()}</td>
                  <td>{formatCurrency(product.current_value)}</td>
                  <td className={product.profit_rate >= 0 ? 'profit' : 'loss'}>{product.profit_rate.toFixed(2)}%</td>
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
