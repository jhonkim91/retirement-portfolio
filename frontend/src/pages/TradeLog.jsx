import React, { useEffect, useState } from 'react';
import { tradeLogAPI } from '../utils/api';
import '../styles/TradeLog.css';

function TradeLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tradeType, setTradeType] = useState('all');
  const [assetType, setAssetType] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoading(true);
        setError('');
        setLogs(await tradeLogAPI.getLogs({ tradeType, assetType }));
      } catch (err) {
        setError(err.message || '매매일지를 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, [tradeType, assetType]);

  const formatCurrency = (value) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(value || 0);
  const formatQuantity = (value) => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
  const unitLabel = (log) => log.unit_label || (log.unit_type === 'unit' ? '좌' : '수');
  const tradeTypeLabel = (type) => {
    if (type === 'buy') return '매수';
    if (type === 'sell') return '매도';
    if (type === 'deposit') return '입금';
    return type;
  };
  const assetTypeLabel = (type) => {
    if (type === 'risk') return '위험자산';
    if (type === 'safe') return '안전자산';
    if (type === 'cash') return '현금';
    return type;
  };

  return (
    <main className="tradelog-container">
      <div className="page-header"><h1>매매일지</h1><p>상품 매수, 매도 완료, 회사 현금입금이 누적 기록됩니다.</p></div>
      {error && <div className="error-message">{error}</div>}
      <div className="filter-section">
        <select value={tradeType} onChange={(e) => setTradeType(e.target.value)}><option value="all">전체 거래</option><option value="buy">매수</option><option value="sell">매도</option><option value="deposit">입금</option></select>
        <select value={assetType} onChange={(e) => setAssetType(e.target.value)}><option value="all">전체 자산</option><option value="risk">위험자산</option><option value="safe">안전자산</option><option value="cash">현금</option></select>
      </div>
      {loading ? <div className="loading">매매일지를 불러오는 중...</div> : logs.length === 0 ? <p className="no-data">거래 기록이 없습니다.</p> : (
        <div className="table-wrapper">
          <table className="tradelog-table">
            <thead><tr><th>거래일</th><th>상품명</th><th>거래</th><th>자산</th><th>수량</th><th>가격</th><th>금액</th><th>메모</th></tr></thead>
            <tbody>{logs.map((log) => (
              <tr key={log.id}>
                <td>{log.trade_date}</td>
                <td>{log.product_name}</td>
                <td><span className={`trade-type ${log.trade_type}`}>{tradeTypeLabel(log.trade_type)}</span></td>
                <td>{assetTypeLabel(log.asset_type)}</td>
                <td>{log.trade_type === 'deposit' ? '-' : `${formatQuantity(log.quantity)}${unitLabel(log)}`}</td>
                <td>{log.trade_type === 'deposit' ? '-' : formatCurrency(log.price)}</td>
                <td>{formatCurrency(log.total_amount)}</td>
                <td>{log.notes || '-'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}

export default TradeLog;
