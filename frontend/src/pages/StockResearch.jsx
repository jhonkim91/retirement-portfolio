import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import AccountSelector from '../components/AccountSelector';
import StockResearchPanel from '../components/StockResearchPanel';
import {
  DEFAULT_ACCOUNT_NAME,
  portfolioAPI,
  readStoredAccountName,
  writeStoredAccountName
} from '../utils/api';
import '../styles/StockResearch.css';

const getInitialAccountName = () => readStoredAccountName() || DEFAULT_ACCOUNT_NAME;

function StockResearch() {
  const location = useLocation();
  const [accountName, setAccountName] = useState(getInitialAccountName);
  const [products, setProducts] = useState([]);
  const [accountType, setAccountType] = useState('retirement');
  const [accountCategory, setAccountCategory] = useState('irp');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [prefillProduct, setPrefillProduct] = useState(location.state?.prefillProduct || null);

  const loadProducts = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [rows, accountsResponse] = await Promise.all([
        portfolioAPI.getProducts(accountName),
        portfolioAPI.getAccounts()
      ]);
      const matchedProfile = (accountsResponse?.account_profiles || []).find((account) => account.account_name === accountName);
      setProducts(rows);
      setAccountType(matchedProfile?.account_type || 'retirement');
      setAccountCategory(matchedProfile?.account_category || 'irp');
    } catch (err) {
      setError(err.message || '보유 종목을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [accountName]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (location.state?.prefillProduct) {
      setPrefillProduct(location.state.prefillProduct);
    }
  }, [location.state]);

  const changeAccountName = (value) => {
    writeStoredAccountName(value);
    setAccountName(value);
  };

  return (
    <main className="stock-research-page" aria-busy={loading}>
      <AccountSelector value={accountName} onChange={changeAccountName} />
      <div className="stock-research-page-header">
        <h1>종목 정보</h1>
        <p>보유 중인 종목 점검이나 새로 살 종목 검토용으로 시세 스냅샷과 계좌 기준 분석 레포트를 확인할 수 있습니다.</p>
      </div>
      {error && <div className="stock-research-message" role="alert" aria-live="assertive">{error}</div>}
      {loading ? (
        <div className="stock-research-loading" role="status" aria-live="polite">보유 종목을 불러오는 중...</div>
      ) : (
        <StockResearchPanel
          products={products}
          initialProduct={prefillProduct}
          accountType={accountType}
          accountCategory={accountCategory}
        />
      )}
    </main>
  );
}

export default StockResearch;
