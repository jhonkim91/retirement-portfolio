import React, { useEffect, useMemo, useState } from 'react';
import { Line, LineChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { portfolioAPI } from '../utils/api';
import '../styles/Portfolio.css';

function Portfolio() {
  const today = new Date().toISOString().slice(0, 10);
  const [formData, setFormData] = useState({
    product_name: '',
    product_code: '',
    purchase_price: '',
    quantity: '',
    purchase_date: today,
    asset_type: 'risk',
    notes: ''
  });
  const [cashAmount, setCashAmount] = useState('');
  const [products, setProducts] = useState([]);
  const [trends, setTrends] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [cashLoading, setCashLoading] = useState(false);
  const [priceInputs, setPriceInputs] = useState({});
  const [sellInputs, setSellInputs] = useState({});

  const loadData = async () => {
    const [productData, trendData, cashData] = await Promise.all([
      portfolioAPI.getAllProducts(),
      portfolioAPI.getTrends(),
      portfolioAPI.getCash()
    ]);
    setProducts(productData);
    setTrends(trendData);
    setCashAmount(String(cashData.amount || 0));
  };

  useEffect(() => {
    loadData().catch((err) => setMessage(err.message));
  }, []);

  const chartData = useMemo(() => {
    const byDate = {};
    trends.forEach((row) => {
      byDate[row.record_date] = byDate[row.record_date] || { date: row.record_date };
      byDate[row.record_date][row.product_name] = row.price;
    });
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }, [trends]);

  const productNames = [...new Set(trends.map((row) => row.product_name))];
  const colors = ['#33658a', '#d94841', '#256f68', '#f6ae2d', '#7f4f24', '#6a4c93'];
  const formatCurrency = (value) => new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0
  }).format(value || 0);

  const handleChange = (event) => {
    setFormData((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      await portfolioAPI.addProduct(formData);
      setMessage('상품이 추가되었습니다. 매수 내역도 매매일지에 기록됐습니다.');
      setFormData({
        product_name: '',
        product_code: '',
        purchase_price: '',
        quantity: '',
        purchase_date: today,
        asset_type: 'risk',
        notes: ''
      });
      await loadData();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const saveCash = async () => {
    setCashLoading(true);
    setMessage('');
    try {
      await portfolioAPI.updateCash(cashAmount);
      setMessage('현금이 저장되었습니다. 매매일지에는 기록되지 않습니다.');
      await loadData();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setCashLoading(false);
    }
  };

  const updatePrice = async (productId) => {
    const price = priceInputs[productId];
    if (!price) return;
    await portfolioAPI.updatePrice(productId, price);
    setPriceInputs((prev) => ({ ...prev, [productId]: '' }));
    setMessage('기준가가 갱신되고 추이에 반영되었습니다.');
    await loadData();
  };

  const sellProduct = async (product) => {
    const input = sellInputs[product.id] || {};
    if (!input.sale_price || !input.sale_date) {
      setMessage('매도일과 매도가를 입력하세요.');
      return;
    }
    await portfolioAPI.sellProduct(product.id, input);
    setMessage('매도 완료 처리했습니다. 해당 상품은 매도일 이후 추이에서 제외됩니다.');
    await loadData();
  };

  return (
    <main className="portfolio-container">
      <section className="portfolio-grid">
        <div>
          <h1>상품 등록</h1>
          <p className="subtitle">매입가, 수량, 매입일을 입력하면 현황과 매매일지에 자동 반영됩니다.</p>
          {message && <div className="message">{message}</div>}
          <form onSubmit={handleSubmit} className="product-form">
            <div className="form-group">
              <label>상품명</label>
              <input name="product_name" value={formData.product_name} onChange={handleChange} placeholder="예: KODEX 200" required />
            </div>
            <div className="form-group">
              <label>상품 코드</label>
              <input name="product_code" value={formData.product_code} onChange={handleChange} placeholder="예: 069500" required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>매입가</label>
                <input type="number" min="0" step="0.01" name="purchase_price" value={formData.purchase_price} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label>수량</label>
                <input type="number" min="1" name="quantity" value={formData.quantity} onChange={handleChange} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>매입일</label>
                <input type="date" name="purchase_date" value={formData.purchase_date} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label>자산 구분</label>
                <select name="asset_type" value={formData.asset_type} onChange={handleChange}>
                  <option value="risk">위험자산</option>
                  <option value="safe">안전자산</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>메모</label>
              <textarea name="notes" value={formData.notes} onChange={handleChange} rows="3" placeholder="선택 입력" />
            </div>
            <button type="submit" className="btn-submit" disabled={loading}>{loading ? '추가 중...' : '상품 추가'}</button>
          </form>
        </div>

        <div className="trend-panel">
          <h2>퇴직연금 추이</h2>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={(value) => value.toLocaleString()} />
              <Tooltip formatter={(value) => formatCurrency(value)} />
              <Legend />
              {productNames.map((name, index) => (
                <Line key={name} type="monotone" dataKey={name} stroke={colors[index % colors.length]} connectNulls={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="cash-panel">
            <div>
              <h3>현금</h3>
              <p>현금은 현황과 상품/추이 화면에만 표시되며 매매일지와 가격 이력에는 기록되지 않습니다.</p>
            </div>
            <div className="cash-actions">
              <input type="number" min="0" value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} />
              <button type="button" onClick={saveCash} disabled={cashLoading}>{cashLoading ? '저장 중...' : '현금 저장'}</button>
            </div>
          </div>
        </div>
      </section>

      <section className="holding-panel">
        <h2>상품 관리</h2>
        <div className="product-list">
          {products.map((product) => (
            <div className="product-row" key={product.id}>
              <div className="product-main">
                <strong>{product.product_name}</strong>
                <span>{product.product_code} · {product.asset_type === 'risk' ? '위험자산' : '안전자산'} · {product.status === 'holding' ? '보유' : '매도완료'}</span>
              </div>
              <div>{formatCurrency(product.current_price)} / {product.quantity.toLocaleString()}주</div>
              {product.status === 'holding' && (
                <>
                  <div className="inline-actions">
                    <input type="number" placeholder="새 기준가" value={priceInputs[product.id] || ''} onChange={(e) => setPriceInputs((prev) => ({ ...prev, [product.id]: e.target.value }))} />
                    <button type="button" onClick={() => updatePrice(product.id)}>갱신</button>
                  </div>
                  <div className="inline-actions">
                    <input type="date" value={(sellInputs[product.id] || {}).sale_date || today} onChange={(e) => setSellInputs((prev) => ({ ...prev, [product.id]: { ...(prev[product.id] || {}), sale_date: e.target.value } }))} />
                    <input type="number" placeholder="매도가" value={(sellInputs[product.id] || {}).sale_price || ''} onChange={(e) => setSellInputs((prev) => ({ ...prev, [product.id]: { ...(prev[product.id] || {}), sale_price: e.target.value } }))} />
                    <button type="button" onClick={() => sellProduct(product)}>매도완료</button>
                  </div>
                </>
              )}
            </div>
          ))}
          {products.length === 0 && <p className="no-data">등록된 상품이 없습니다.</p>}
        </div>
      </section>
    </main>
  );
}

export default Portfolio;
