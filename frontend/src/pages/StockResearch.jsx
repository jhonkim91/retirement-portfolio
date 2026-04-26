import React, { useCallback, useEffect, useState } from 'react';
import AccountSelector from '../components/AccountSelector';
import StockResearchPanel from '../components/StockResearchPanel';
import { ACCOUNT_STORAGE_KEY, DEFAULT_ACCOUNT_NAME, portfolioAPI } from '../utils/api';
import '../styles/StockResearch.css';

const getInitialAccountName = () => localStorage.getItem(ACCOUNT_STORAGE_KEY) || DEFAULT_ACCOUNT_NAME;

function StockResearch() {
  const [accountName, setAccountName] = useState(getInitialAccountName);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadProducts = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const rows = await portfolioAPI.getProducts(accountName);
      setProducts(rows);
    } catch (err) {
      setError(err.message || '보유 종목을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [accountName]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const changeAccountName = (value) => {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, value);
    setAccountName(value);
  };

  return (
    <main className="stock-research-page">
      <AccountSelector value={accountName} onChange={changeAccountName} />
      <div className="stock-research-page-header">
        <h1>종목 정보</h1>
        <p>보유 중인 종목 점검이나 새로 살 종목 검토용으로 시세 스냅샷과 계좌 기준 분석 레포트를 확인할 수 있습니다.</p>
      </div>
      {error && <div className="stock-research-message">{error}</div>}
      {loading ? (
        <div className="stock-research-loading">보유 종목을 불러오는 중...</div>
      ) : (
        <StockResearchPanel products={products} />
      )}
    </main>
  );
}

export default StockResearch;
