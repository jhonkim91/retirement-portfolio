import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AccountSelector from '../components/AccountSelector';
import { ACCOUNT_STORAGE_KEY, DEFAULT_ACCOUNT_NAME, portfolioAPI } from '../utils/api';
import '../styles/Portfolio.css';

const emptyProductForm = (today) => ({
  product_name: '',
  product_code: '',
  purchase_price: '',
  quantity: '',
  unit_type: 'share',
  purchase_date: today,
  asset_type: 'risk',
  notes: ''
});

const getInitialAccountName = () => localStorage.getItem(ACCOUNT_STORAGE_KEY) || DEFAULT_ACCOUNT_NAME;

function Portfolio() {
  const today = new Date().toISOString().slice(0, 10);
  const [accountName, setAccountName] = useState(getInitialAccountName);
  const [formData, setFormData] = useState(emptyProductForm(today));
  const [depositForm, setDepositForm] = useState({ amount: '', deposit_date: today, notes: '' });
  const [cashAmount, setCashAmount] = useState('');
  const [products, setProducts] = useState([]);
  const [trends, setTrends] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [cashLoading, setCashLoading] = useState(false);
  const [depositLoading, setDepositLoading] = useState(false);
  const [priceInputs, setPriceInputs] = useState({});
  const [sellInputs, setSellInputs] = useState({});
  const [buyInputs, setBuyInputs] = useState({});
  const [editForms, setEditForms] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [activePanel, setActivePanel] = useState({ productId: null, mode: null });
  const [productSearchResults, setProductSearchResults] = useState([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [selectedProductName, setSelectedProductName] = useState('');
  const [selectedTrendProductIds, setSelectedTrendProductIds] = useState([]);

  const loadData = useCallback(async () => {
    const [productData, trendData, cashData] = await Promise.all([
      portfolioAPI.getProducts(accountName),
      portfolioAPI.getTrends(accountName),
      portfolioAPI.getCash(accountName)
    ]);
    setProducts(productData);
    setTrends(trendData);
    setCashAmount(String(cashData.amount || 0));
  }, [accountName]);

  useEffect(() => {
    loadData().catch((err) => setMessage(err.message));
  }, [loadData]);

  useEffect(() => {
    const productIds = products.map((product) => String(product.id));
    setSelectedTrendProductIds((prev) => prev.filter((id) => productIds.includes(id)));
  }, [products]);

  const changeAccountName = (value) => {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, value);
    setAccountName(value);
    setMessage('');
    setSelectedTrendProductIds([]);
    setActivePanel({ productId: null, mode: null });
    setEditingId(null);
  };

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

  const selectedTrendProductSet = useMemo(() => new Set(selectedTrendProductIds), [selectedTrendProductIds]);
  const filteredTrends = useMemo(
    () => trends.filter((row) => selectedTrendProductSet.has(String(row.product_id))),
    [trends, selectedTrendProductSet]
  );

  const chartData = useMemo(() => {
    const byDate = {};
    filteredTrends.forEach((row) => {
      byDate[row.record_date] = byDate[row.record_date] || { date: row.record_date };
      byDate[row.record_date][row.product_name] = row.evaluation_value;
      byDate[row.record_date][`${row.product_name}__meta`] = row;
    });
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredTrends]);

  const productNames = [...new Set(filteredTrends.map((row) => row.product_name))];
  const trendRows = useMemo(() => (
    [...filteredTrends].sort((a, b) => {
      const dateOrder = b.record_date.localeCompare(a.record_date);
      if (dateOrder !== 0) return dateOrder;
      return a.product_name.localeCompare(b.product_name);
    })
  ), [filteredTrends]);
  const colors = ['#33658a', '#d94841', '#256f68', '#f6ae2d', '#7f4f24', '#6a4c93'];
  const formatCurrency = (value) => new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0
  }).format(value || 0);
  const formatQuantity = (value) => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
  const unitLabel = (unitType) => (unitType === 'unit' ? '좌' : '수');
  const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;

  const TrendTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="trend-tooltip">
        <strong>{label}</strong>
        {payload.map((item) => {
          const row = item.payload?.[`${item.name}__meta`];
          if (!row) return null;
          return (
            <div className="trend-tooltip-item" key={item.name}>
              <span className="trend-tooltip-name" style={{ color: item.color }}>{item.name}</span>
              <span>기준가 {formatCurrency(row.price)}</span>
              <span>평가액 {formatCurrency(row.evaluation_value)}</span>
              <span className={(row.profit_rate || 0) >= 0 ? 'profit-text' : 'loss-text'}>수익률 {formatPercent(row.profit_rate)}</span>
            </div>
          );
        })}
      </div>
    );
  };

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
      product_code: product.code,
      unit_type: product.type === 'fund' ? 'unit' : prev.unit_type
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
      await portfolioAPI.addProduct(formData, accountName);
      setMessage('상품을 추가하고 매수 내역을 기록했습니다.');
      setFormData(emptyProductForm(today));
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
      await portfolioAPI.updateCash(cashAmount, accountName);
      setMessage('보유 현금을 저장했습니다. 매매일지에는 기록하지 않습니다.');
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
      await portfolioAPI.addCashDeposit(depositForm, accountName);
      setDepositForm({ amount: '', deposit_date: today, notes: '' });
      setMessage('회사 현금입금을 원금과 매매일지에 기록했습니다.');
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
    try {
      await portfolioAPI.updatePrice(productId, price);
      setPriceInputs((prev) => ({ ...prev, [productId]: '' }));
      setMessage('기준가를 갱신하고 추이에 반영했습니다.');
      setActivePanel({ productId: null, mode: null });
      await loadData();
    } catch (err) {
      setMessage(err.message);
    }
  };

  const deleteProduct = async (product) => {
    const ok = window.confirm(`${product.product_name} 상품을 삭제할까요?\n관련 기준가 이력과 매매일지도 함께 삭제합니다.`);
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
    const saleData = {
      sale_date: input.sale_date || today,
      sale_price: input.sale_price || product.current_price,
      notes: input.notes || ''
    };
    if (!saleData.sale_price) {
      setMessage('매도가 또는 기준가를 입력하세요.');
      return;
    }
    const ok = window.confirm(`${product.product_name} 상품을 매도 완료 처리할까요?\n현황과 추이에서는 사라지고 매매일지에 매도 기록만 남습니다.`);
    if (!ok) return;

    try {
      await portfolioAPI.sellProduct(product.id, saleData);
      setSellInputs((prev) => ({ ...prev, [product.id]: { sale_date: today, sale_price: '', notes: '' } }));
      setMessage('매도 완료 처리했습니다. 현황과 추이에서 제외하고 매매일지에 기록했습니다.');
      setActivePanel({ productId: null, mode: null });
      await loadData();
    } catch (err) {
      setMessage(err.message);
    }
  };

  const addBuy = async (product) => {
    const input = buyInputs[product.id] || {};
    if (!input.purchase_price || !input.quantity) {
      setMessage('추가매수 기준가와 수량/좌수를 입력하세요.');
      return;
    }
    try {
      await portfolioAPI.addBuy(product.id, {
        purchase_date: input.purchase_date || today,
        purchase_price: input.purchase_price,
        quantity: input.quantity,
        notes: input.notes || '추가매수'
      });
      setBuyInputs((prev) => ({ ...prev, [product.id]: { purchase_date: today, purchase_price: '', quantity: '', notes: '' } }));
      setMessage('추가매수를 반영하고 매매일지에 기록했습니다.');
      setActivePanel({ productId: null, mode: null });
      await loadData();
    } catch (err) {
      setMessage(err.message);
    }
  };

  const startEdit = (product) => {
    setEditingId(product.id);
    setActivePanel({ productId: product.id, mode: 'edit' });
    setEditForms((prev) => ({
      ...prev,
      [product.id]: {
        product_name: product.product_name,
        product_code: product.product_code,
        purchase_price: product.purchase_price,
        current_price: product.current_price,
        quantity: product.quantity,
        unit_type: product.unit_type || 'share',
        purchase_date: product.purchase_date,
        asset_type: product.asset_type,
        notes: ''
      }
    }));
  };

  const saveEdit = async (product) => {
    try {
      await portfolioAPI.updateProduct(product.id, editForms[product.id]);
      setEditingId(null);
      setActivePanel({ productId: null, mode: null });
      setMessage('상품 정보를 수정했습니다.');
      await loadData();
    } catch (err) {
      setMessage(err.message);
    }
  };

  const openProductPanel = (product, mode) => {
    if (activePanel.productId === product.id && activePanel.mode === mode) {
      setActivePanel({ productId: null, mode: null });
      if (mode === 'edit') setEditingId(null);
      return;
    }
    if (mode === 'edit') {
      startEdit(product);
      return;
    }
    setEditingId(null);
    setActivePanel({ productId: product.id, mode });
  };

  const toggleProductCard = (product) => {
    if (activePanel.productId === product.id) {
      setActivePanel({ productId: null, mode: null });
      setEditingId(null);
      return;
    }
    setEditingId(null);
    setActivePanel({ productId: product.id, mode: 'manage' });
  };

  const toggleTrendProduct = (productId) => {
    const id = String(productId);
    setSelectedTrendProductIds((prev) => (
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    ));
  };

  return (
    <main className="portfolio-container">
      <AccountSelector value={accountName} onChange={changeAccountName} />
      <section className="portfolio-workspace">
        <aside className="portfolio-left">
          <h1>상품 등록</h1>
          <p className="subtitle">매입가, 수량/좌수, 매입일을 입력하면 현황과 매매일지에 반영합니다.</p>
          {message && <div className="message">{message}</div>}
          <form onSubmit={handleSubmit} className="product-form">
            <div className="form-group">
              <label>상품명 또는 코드</label>
              <div className="product-search-field">
                <input
                  name="product_name"
                  value={formData.product_name}
                  onChange={handleChange}
                  onFocus={() => {
                    if (productSearchResults.length > 0) setShowProductSearch(true);
                  }}
                  onBlur={() => setTimeout(() => setShowProductSearch(false), 150)}
                  placeholder="예: K55207BU0715, 0177N0, 파워인덱스"
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
              <input name="product_code" value={formData.product_code} onChange={handleChange} placeholder="예: 0177N0, K55207BU0715" required />
              <small className="field-help">ETF는 공개 코드, 펀드는 표준코드로 등록하면 자동 기준가 조회를 시도합니다.</small>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>매입가/기준가</label>
                <input type="number" min="0" step="0.01" name="purchase_price" value={formData.purchase_price} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label>수량/좌수</label>
                <input type="number" min="0" step="0.0001" name="quantity" value={formData.quantity} onChange={handleChange} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>단위</label>
                <select name="unit_type" value={formData.unit_type} onChange={handleChange}>
                  <option value="share">수</option>
                  <option value="unit">좌</option>
                </select>
              </div>
              <div className="form-group">
                <label>매입일</label>
                <input type="date" name="purchase_date" value={formData.purchase_date} onChange={handleChange} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>자산 구분</label>
                <select name="asset_type" value={formData.asset_type} onChange={handleChange}>
                  <option value="risk">위험자산</option>
                  <option value="safe">안전자산</option>
                </select>
              </div>
              <div className="form-group">
                <label>메모</label>
                <input name="notes" value={formData.notes} onChange={handleChange} placeholder="선택 입력" />
              </div>
            </div>
            <button type="submit" className="btn-submit" disabled={loading}>{loading ? '추가 중...' : '상품 추가'}</button>
          </form>

          <div className="cash-panel">
            <div>
              <h3>보유 현금</h3>
              <p>현재 계좌에 남아 있는 현금입니다. 매매일지에는 기록하지 않습니다.</p>
            </div>
            <div className="cash-actions">
              <input type="number" min="0" value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} />
              <button type="button" onClick={saveCash} disabled={cashLoading}>{cashLoading ? '저장 중...' : '현금 저장'}</button>
            </div>
          </div>
          <form className="deposit-panel" onSubmit={saveDeposit}>
            <div>
              <h3>회사 현금입금</h3>
              <p>입금액을 퇴직금 원금으로 계산하고 매매일지에 기록합니다.</p>
            </div>
            <div className="deposit-actions">
              <input type="date" value={depositForm.deposit_date} onChange={(event) => setDepositForm((prev) => ({ ...prev, deposit_date: event.target.value }))} required />
              <input type="number" min="1" step="1" placeholder="입금액" value={depositForm.amount} onChange={(event) => setDepositForm((prev) => ({ ...prev, amount: event.target.value }))} required />
              <button type="submit" disabled={depositLoading}>{depositLoading ? '기록 중...' : '입금 기록'}</button>
            </div>
            <textarea rows="2" placeholder="메모 선택 입력" value={depositForm.notes} onChange={(event) => setDepositForm((prev) => ({ ...prev, notes: event.target.value }))} />
          </form>

          <section className="holding-panel">
            <h2>상품 관리</h2>
            <div className="holding-card-list">
              {products.map((product) => {
                const edit = editForms[product.id] || {};
                const buyInput = buyInputs[product.id] || {};
                const sellInput = sellInputs[product.id] || {};
                const expanded = activePanel.productId === product.id;
                const trendChecked = selectedTrendProductSet.has(String(product.id));

                return (
                  <article className={`holding-card ${expanded ? 'expanded' : ''}`} key={product.id}>
                    <div className="holding-card-summary" role="button" tabIndex="0" onClick={() => toggleProductCard(product)} onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleProductCard(product);
                      }
                    }}>
                      <label className="trend-card-check" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={trendChecked}
                          onChange={() => toggleTrendProduct(product.id)}
                        />
                      </label>
                      <span className="holding-title">
                        <strong>{product.product_name}</strong>
                        <small>{product.product_code} · {product.asset_type === 'risk' ? '위험자산' : '안전자산'} · {formatQuantity(product.quantity)}{unitLabel(product.unit_type)}</small>
                      </span>
                      <span className="holding-stat">
                        <small>현재가</small>
                        <strong>{formatCurrency(product.current_price)}</strong>
                      </span>
                      <span className={`holding-stat ${(product.profit_rate || 0) >= 0 ? 'profit-text' : 'loss-text'}`}>
                        <small>수익률</small>
                        <strong>{Number(product.profit_rate || 0).toFixed(2)}%</strong>
                      </span>
                      <span className="holding-stat">
                        <small>평가액</small>
                        <strong>{formatCurrency(product.current_value)}</strong>
                      </span>
                    </div>

                    {expanded && (
                      <div className="holding-card-panel">
                        <div className="card-actions">
                          <button type="button" onClick={() => openProductPanel(product, 'price')}>기준가</button>
                          <button type="button" onClick={() => openProductPanel(product, 'buy')}>추가매수</button>
                          <button type="button" onClick={() => openProductPanel(product, 'sell')}>매도</button>
                          <button type="button" onClick={() => openProductPanel(product, 'edit')}>수정</button>
                          <button type="button" className="delete-btn" onClick={() => deleteProduct(product)}>삭제</button>
                        </div>

                        {activePanel.mode === 'price' && (
                          <div className="action-panel">
                            <div className="panel-heading">
                              <strong>기준가 갱신</strong>
                            </div>
                            <div className="panel-fields price-fields">
                              <input type="number" min="0" step="0.01" placeholder="새 기준가" value={priceInputs[product.id] || ''} onChange={(e) => setPriceInputs((prev) => ({ ...prev, [product.id]: e.target.value }))} />
                              <button type="button" onClick={() => updatePrice(product.id)}>갱신</button>
                            </div>
                          </div>
                        )}

                        {activePanel.mode === 'buy' && (
                          <div className="action-panel">
                            <div className="panel-heading">
                              <strong>추가매수</strong>
                            </div>
                            <div className="panel-fields buy-fields">
                              <input type="date" value={buyInput.purchase_date || today} onChange={(e) => setBuyInputs((prev) => ({ ...prev, [product.id]: { ...(prev[product.id] || {}), purchase_date: e.target.value } }))} />
                              <input type="number" min="0" step="0.01" placeholder="추가 기준가" value={buyInput.purchase_price || ''} onChange={(e) => setBuyInputs((prev) => ({ ...prev, [product.id]: { ...(prev[product.id] || {}), purchase_price: e.target.value } }))} />
                              <input type="number" min="0" step="0.0001" placeholder={`추가 ${unitLabel(product.unit_type)}`} value={buyInput.quantity || ''} onChange={(e) => setBuyInputs((prev) => ({ ...prev, [product.id]: { ...(prev[product.id] || {}), quantity: e.target.value } }))} />
                              <button type="button" onClick={() => addBuy(product)}>추가매수</button>
                            </div>
                          </div>
                        )}

                        {activePanel.mode === 'sell' && (
                          <div className="action-panel">
                            <div className="panel-heading">
                              <strong>매도 처리</strong>
                            </div>
                            <div className="panel-fields sell-fields">
                              <input type="date" value={sellInput.sale_date || today} onChange={(e) => setSellInputs((prev) => ({ ...prev, [product.id]: { ...(prev[product.id] || {}), sale_date: e.target.value } }))} />
                              <input type="number" min="0" step="0.01" placeholder="매도가/기준가" value={sellInput.sale_price || ''} onChange={(e) => setSellInputs((prev) => ({ ...prev, [product.id]: { ...(prev[product.id] || {}), sale_price: e.target.value } }))} />
                              <button type="button" onClick={() => sellProduct(product)}>매도완료</button>
                            </div>
                          </div>
                        )}

                        {editingId === product.id && activePanel.mode === 'edit' && (
                          <div className="action-panel edit-panel">
                            <div className="panel-heading">
                              <strong>상품 정보 수정</strong>
                            </div>
                            <div className="form-row">
                              <input placeholder="상품명" value={edit.product_name || ''} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, product_name: e.target.value } }))} />
                              <input placeholder="상품 코드" value={edit.product_code || ''} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, product_code: e.target.value } }))} />
                            </div>
                            <div className="form-row">
                              <input aria-label="평균 기준가" type="number" min="0" step="0.01" value={edit.purchase_price || ''} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, purchase_price: e.target.value } }))} />
                              <input aria-label="현재 기준가" type="number" min="0" step="0.01" value={edit.current_price || ''} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, current_price: e.target.value } }))} />
                            </div>
                            <div className="form-row">
                              <input aria-label="수량 또는 좌수" type="number" min="0" step="0.0001" value={edit.quantity || ''} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, quantity: e.target.value } }))} />
                              <input aria-label="매입일" type="date" value={edit.purchase_date || today} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, purchase_date: e.target.value } }))} />
                            </div>
                            <div className="form-row">
                              <select aria-label="단위" value={edit.unit_type || 'share'} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, unit_type: e.target.value } }))}>
                                <option value="share">수</option>
                                <option value="unit">좌</option>
                              </select>
                              <select aria-label="자산 구분" value={edit.asset_type || 'risk'} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, asset_type: e.target.value } }))}>
                                <option value="risk">위험자산</option>
                                <option value="safe">안전자산</option>
                              </select>
                            </div>
                            <div className="row-actions">
                              <button type="button" onClick={() => saveEdit(product)}>저장</button>
                              <button type="button" onClick={() => {
                                setEditingId(null);
                                setActivePanel({ productId: null, mode: null });
                              }}>취소</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
              {products.length === 0 && <p className="no-data">등록된 보유 상품이 없습니다.</p>}
            </div>
          </section>
        </aside>

        <div className="trend-panel">
          <h2>{accountName} 추이</h2>
          <div className="trend-view">
            <div className="trend-chart">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis tickFormatter={(value) => value.toLocaleString()} />
                  <Tooltip content={<TrendTooltip />} />
                  <Legend />
                  {productNames.map((name, index) => (
                    <Line key={name} type="monotone" dataKey={name} stroke={colors[index % colors.length]} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="trend-detail">
            <h3>상품 추이 상세</h3>
            {selectedTrendProductIds.length > 0 && trendRows.length === 0 && <p className="no-data">선택한 상품의 추이 데이터가 없습니다.</p>}
            {selectedTrendProductIds.length > 0 && trendRows.length > 0 && (
              <div className="trend-table-wrapper">
                <table className="trend-table">
                  <thead>
                    <tr>
                      <th>일자</th>
                      <th>상품명</th>
                      <th>매입가</th>
                      <th>기준가</th>
                      <th>수량</th>
                      <th>매입금액</th>
                      <th>평가액</th>
                      <th>손익</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendRows.map((row) => (
                      <tr key={`${row.product_id}-${row.record_date}`}>
                        <td>{row.record_date}</td>
                        <td>{row.product_name}<span className="trend-code">{row.product_code}</span></td>
                        <td>{formatCurrency(row.purchase_price)}</td>
                        <td>{formatCurrency(row.price)}</td>
                        <td>{formatQuantity(row.quantity)}{row.unit_label || unitLabel(row.unit_type)}</td>
                        <td>{formatCurrency(row.purchase_value)}</td>
                        <td>{formatCurrency(row.evaluation_value)}</td>
                        <td className={(row.profit_loss || 0) >= 0 ? 'profit-text' : 'loss-text'}>
                          {formatCurrency(row.profit_loss)} ({Number(row.profit_rate || 0).toFixed(2)}%)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

export default Portfolio;
