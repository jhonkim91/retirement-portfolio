import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import AccountAnalyticsPanel from '../components/AccountAnalyticsPanel';
import AccountSelector from '../components/AccountSelector';
import StockResearchPanel from '../components/StockResearchPanel';
import useResolvedAccount from '../hooks/useResolvedAccount';
import { portfolioAPI } from '../utils/api';
import '../styles/StockResearch.css';

function StockResearch() {
  const location = useLocation();
  const {
    accountName,
    accountReady,
    changeAccountName: persistAccountName,
    selectedAccountProfile,
    syncAccountProfiles
  } = useResolvedAccount();
  const [products, setProducts] = useState([]);
  const [accountType, setAccountType] = useState('retirement');
  const [accountCategory, setAccountCategory] = useState('irp');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [prefillProduct, setPrefillProduct] = useState(location.state?.prefillProduct || null);

  const loadProducts = useCallback(async () => {
    if (!accountReady) return;

    try {
      setLoading(true);
      setError('');
      const rows = await portfolioAPI.getProducts(accountName);
      setProducts(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err.message || '보유 종목을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [accountName, accountReady]);

  useEffect(() => {
    if (!accountReady) return;
    loadProducts();
  }, [accountReady, loadProducts]);

  useEffect(() => {
    setAccountType(selectedAccountProfile?.account_type || 'retirement');
    setAccountCategory(selectedAccountProfile?.account_category || 'irp');
  }, [selectedAccountProfile]);

  useEffect(() => {
    if (location.state?.prefillProduct) {
      setPrefillProduct(location.state.prefillProduct);
    }
  }, [location.state]);

  const changeAccountName = (value) => {
    persistAccountName(value);
    setLoading(true);
  };

  return (
    <main className="stock-research-page" aria-busy={loading}>
      <AccountSelector value={accountName} onChange={changeAccountName} onAccountsChange={syncAccountProfiles} />
      <div className="stock-research-page-header">
        <h1>종목 분석</h1>
        <p>보유 종목 검토와 새 종목 탐색, 계좌 심층 분석까지 이 탭에서 이어서 확인할 수 있습니다.</p>
      </div>
      {error && <div className="stock-research-message" role="alert" aria-live="assertive">{error}</div>}
      {loading ? (
        <div className="stock-research-loading" role="status" aria-live="polite">보유 종목을 불러오는 중...</div>
      ) : (
        <>
          <StockResearchPanel
            products={products}
            initialProduct={prefillProduct}
            accountType={accountType}
            accountCategory={accountCategory}
          />
          <AccountAnalyticsPanel
            accountName={accountName}
            accountReady={accountReady}
            accountType={accountType}
            title="계좌 심층 분석"
            description="현황 화면에서 덜어낸 벤치마크 비교와 누적 수익률 분석은 여기에서 이어서 확인합니다."
          />
        </>
      )}
    </main>
  );
}

export default StockResearch;
