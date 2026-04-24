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
  const [depositForm, setDepositForm] = useState({
    amount: '',
    deposit_date: today,
    notes: ''
  });
  const [cashAmount, setCashAmount] = useState('');
  const [products, setProducts] = useState([]);
  const [trends, setTrends] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [cashLoading, setCashLoading] = useState(false);
  const [depositLoading, setDepositLoading] = useState(false);
  const [priceInputs, setPriceInputs] = useState({});
  const [sellInputs, setSellInputs] = useState({});
  const [productSearchResults, setProductSearchResults] = useState([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [selectedProductName, setSelectedProductName] = useState('');

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

  useEffect(() => {
    const query = formData.product_name.trim();
    if (query.length < 2 || query === selectedProductName) {
      setProductSearchResults([]);
      setProductSearchLoading(false);
      return undefined;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setProductSearchLoading(true);
      try {
        const results = await portfolioAPI.searchProducts(query);
        if (active) {
          setProductSearchResults(results);
          setShowProductSearch(true);
        }
      } catch (err) {
        if (active) setProductSearchResults([]);
      } finally {
        if (active) setProductSearchLoading(false);
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [formData.product_name, selectedProductName]);

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
    const { name, value } = event.target;
    if (name === 'product_name') {
      setSelectedProductName('');
      setShowProductSearch(value.trim().length >= 2);
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const selectSearchProduct = (product) => {
    setFormData((prev) => ({
      ...prev,
      product_name: product.name,
      product_code: product.code
    }));
    setSelectedProductName(product.name);
    setProductSearchResults([]);
    setShowProductSearch(false);
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
      setSelectedProductName('');
      setProductSearchResults([]);
      setShowProductSearch(false);
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

  const saveDeposit = async (event) => {
    event.preventDefault();
    setDepositLoading(true);
    setMessage('');
    try {
      await portfolioAPI.addCashDeposit(depositForm);
      setDepositForm({ amount: '', deposit_date: today, notes: '' });
      setMessage('회사 현금입금이 원금과 매매일지에 기록되었습니다.');
      await loadData();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setDepositLoading(false);
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

  const deleteProduct = async (product) => {
    const ok = window.confirm(`${product.product_name} 상품을 삭제할까요?\n관련 기준가 이력과 매매일지도 함께 삭제됩니다.`);
    if (!ok) return;

    try {
      await portfolioAPI.deleteProduct(product.id);
      setMessage('상품과 관련 기준가 이력, 매매일지를 삭제했습니다.');
      await loadData();
    } catch (err) {
      setMessage(err.message);
    }
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
              <div className="product-search-field">
                <input
                  name="product_name"
                  value={formData.product_name}
                  onChange={handleChange}
                  onFocus={() => {
                    if (productSearchResults.length > 0) setShowProductSearch(true);
                  }}
                  onBlur={() => setTimeout(() => setShowProductSearch(false), 150)}
                  placeholder="예: KODEX 200, 삼성전자"
                  autoComplete="off"
                  required
                />
                {showProductSearch && (productSearchLoading || productSearchResults.length > 0) && (
                  <div className="product-search-list">
                    {productSearchLoading && <div className="product-search-status">검색 중...</div>}
                    {productSearchResults.map((product) => (
                      <button
                        key={product.code}
                        type="button"
                        className="product-search-item"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectSearchProduct(product)}
                      >
                        <strong>{product.name}</strong>
                        <span>{product.code} · {product.exchange} · {product.source}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="form-group">
              <label>상품 코드</label>
              <input name="product_code" value={formData.product_code} onChange={handleChange} placeholder="예: 069500" required />
              <small className="field-help">상품명 검색 결과를 클릭하면 6자리 공개 코드가 자동 입력됩니다. 퇴직연금/펀드 내부 상품은 새 기준가에서 수동 갱신하세요.</small>
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
              <h3>보유 현금</h3>
              <p>현재 계좌에 남아 있는 현금입니다. 직접 저장한 보유 현금 변경은 매매일지에 기록되지 않습니다.</p>
            </div>
            <div className="cash-actions">
              <input type="number" min="0" value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} />
              <button type="button" onClick={saveCash} disabled={cashLoading}>{cashLoading ? '저장 중...' : '현금 저장'}</button>
            </div>
          </div>
          <form className="deposit-panel" onSubmit={saveDeposit}>
            <div>
              <h3>회사 현금입금</h3>
              <p>입금액은 퇴직금 원금으로 계산되고 매매일지에 남습니다. 보유 현금은 현재 잔액에 맞춰 따로 저장하세요.</p>
            </div>
            <div className="deposit-actions">
              <input
                type="date"
                value={depositForm.deposit_date}
                onChange={(event) => setDepositForm((prev) => ({ ...prev, deposit_date: event.target.value }))}
                required
              />
              <input
                type="number"
                min="1"
                step="1"
                placeholder="입금액"
                value={depositForm.amount}
                onChange={(event) => setDepositForm((prev) => ({ ...prev, amount: event.target.value }))}
                required
              />
              <button type="submit" disabled={depositLoading}>{depositLoading ? '기록 중...' : '입금 기록'}</button>
            </div>
            <textarea
              rows="2"
              placeholder="메모 선택 입력"
              value={depositForm.notes}
              onChange={(event) => setDepositForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
          </form>
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
              <div className="delete-action">
                <button type="button" className="delete-btn" onClick={() => deleteProduct(product)}>삭제</button>
              </div>
            </div>
          ))}
          {products.length === 0 && <p className="no-data">등록된 상품이 없습니다.</p>}
        </div>
      </section>
    </main>
  );
}

export default Portfolio;
