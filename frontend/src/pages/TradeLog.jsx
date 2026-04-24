import React, { useCallback, useEffect, useState } from 'react';
import AccountSelector from '../components/AccountSelector';
import { ACCOUNT_STORAGE_KEY, DEFAULT_ACCOUNT_NAME, tradeLogAPI } from '../utils/api';
import '../styles/TradeLog.css';

const getInitialAccountName = () => localStorage.getItem(ACCOUNT_STORAGE_KEY) || DEFAULT_ACCOUNT_NAME;

function TradeLog() {
  const [accountName, setAccountName] = useState(getInitialAccountName);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tradeType, setTradeType] = useState('all');
  const [assetType, setAssetType] = useState('all');
  const [error, setError] = useState('');
  const [editingLogId, setEditingLogId] = useState(null);
  const [editForms, setEditForms] = useState({});
  const [savingLogId, setSavingLogId] = useState(null);
  const [realizedSummary, setRealizedSummary] = useState({
    total_buy_amount: 0,
    total_sell_amount: 0,
    total_profit_loss: 0,
    total_profit_rate: 0,
    sold_count: 0,
    positions: []
  });

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [logRows, summary] = await Promise.all([
        tradeLogAPI.getLogs({ tradeType, assetType, accountName }),
        tradeLogAPI.getRealizedSummary(accountName)
      ]);
      setLogs(logRows);
      setRealizedSummary(summary);
    } catch (err) {
      setError(err.message || '매매일지를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [tradeType, assetType, accountName]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const formatCurrency = (value) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(value || 0);
  const formatQuantity = (value) => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
  const unitLabel = (log) => log.unit_label || (log.unit_type === 'unit' ? '좌' : '수');
  const realizedByProduct = new Map((realizedSummary.positions || []).map((position) => [position.product_id, position]));
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
  const changeAccountName = (value) => {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, value);
    setAccountName(value);
    setEditingLogId(null);
  };
  const startEdit = (log) => {
    setEditingLogId(log.id);
    setEditForms((prev) => ({
      ...prev,
      [log.id]: {
        product_name: log.product_name,
        trade_date: log.trade_date,
        quantity: log.quantity,
        unit_type: log.unit_type || 'share',
        price: log.price,
        total_amount: log.total_amount,
        asset_type: log.asset_type,
        notes: log.notes || ''
      }
    }));
  };
  const updateEditForm = (logId, field, value) => {
    setEditForms((prev) => ({
      ...prev,
      [logId]: {
        ...(prev[logId] || {}),
        [field]: value
      }
    }));
  };
  const saveEdit = async (log) => {
    try {
      setSavingLogId(log.id);
      setError('');
      await tradeLogAPI.updateLog(log.id, editForms[log.id]);
      setEditingLogId(null);
      await loadLogs();
    } catch (err) {
      setError(err.message || '매매일지 수정에 실패했습니다.');
    } finally {
      setSavingLogId(null);
    }
  };

  return (
    <main className="tradelog-container">
      <AccountSelector value={accountName} onChange={changeAccountName} />
      <div className="page-header"><h1>매매일지</h1><p>상품 매수, 매도 완료, 회사 현금입금이 누적 기록됩니다.</p></div>
      {error && <div className="error-message">{error}</div>}
      <section className="realized-summary">
        <div className="summary-card"><span>매도 완료 상품</span><strong>{realizedSummary.sold_count || 0}개</strong></div>
        <div className="summary-card"><span>매수 원금</span><strong>{formatCurrency(realizedSummary.total_buy_amount)}</strong></div>
        <div className="summary-card"><span>매도 금액</span><strong>{formatCurrency(realizedSummary.total_sell_amount)}</strong></div>
        <div className="summary-card"><span>실현손익</span><strong className={(realizedSummary.total_profit_loss || 0) >= 0 ? 'profit' : 'loss'}>{formatCurrency(realizedSummary.total_profit_loss)}</strong></div>
        <div className="summary-card"><span>누적수익률</span><strong className={(realizedSummary.total_profit_rate || 0) >= 0 ? 'profit' : 'loss'}>{Number(realizedSummary.total_profit_rate || 0).toFixed(2)}%</strong></div>
      </section>
      <div className="filter-section">
        <select value={tradeType} onChange={(e) => setTradeType(e.target.value)}><option value="all">전체 거래</option><option value="buy">매수</option><option value="sell">매도</option><option value="deposit">입금</option></select>
        <select value={assetType} onChange={(e) => setAssetType(e.target.value)}><option value="all">전체 자산</option><option value="risk">위험자산</option><option value="safe">안전자산</option><option value="cash">현금</option></select>
      </div>
      {loading ? <div className="loading">매매일지를 불러오는 중...</div> : logs.length === 0 ? <p className="no-data">거래 기록이 없습니다.</p> : (
        <div className="table-wrapper">
          <table className="tradelog-table">
            <thead><tr><th>거래일</th><th>상품명</th><th>거래</th><th>자산</th><th>수량</th><th>가격</th><th>금액</th><th>실현손익</th><th>메모</th><th>관리</th></tr></thead>
            <tbody>{logs.map((log) => {
              const realized = log.trade_type === 'sell' ? realizedByProduct.get(log.product_id) : null;
              const edit = editForms[log.id] || {};
              return (
                <React.Fragment key={log.id}>
                  <tr>
                    <td>{log.trade_date}</td>
                    <td>{log.product_name}</td>
                    <td><span className={`trade-type ${log.trade_type}`}>{tradeTypeLabel(log.trade_type)}</span></td>
                    <td>{assetTypeLabel(log.asset_type)}</td>
                    <td>{log.trade_type === 'deposit' ? '-' : `${formatQuantity(log.quantity)}${unitLabel(log)}`}</td>
                    <td>{log.trade_type === 'deposit' ? '-' : formatCurrency(log.price)}</td>
                    <td>{formatCurrency(log.total_amount)}</td>
                    <td className={realized ? (realized.profit_loss >= 0 ? 'profit' : 'loss') : ''}>
                      {realized ? `${formatCurrency(realized.profit_loss)} (${Number(realized.profit_rate || 0).toFixed(2)}%)` : '-'}
                    </td>
                    <td>{log.notes || '-'}</td>
                    <td><button type="button" className="log-edit-btn" onClick={() => startEdit(log)}>수정</button></td>
                  </tr>
                  {editingLogId === log.id && (
                    <tr className="log-edit-row">
                      <td colSpan="10">
                        <div className="log-edit-panel">
                          <input value={edit.product_name || ''} onChange={(event) => updateEditForm(log.id, 'product_name', event.target.value)} />
                          <input type="date" value={edit.trade_date || ''} onChange={(event) => updateEditForm(log.id, 'trade_date', event.target.value)} />
                          {log.trade_type === 'deposit' ? (
                            <input type="number" min="0" step="1" value={edit.total_amount || ''} onChange={(event) => updateEditForm(log.id, 'total_amount', event.target.value)} />
                          ) : (
                            <>
                              <input type="number" min="0" step="0.0001" value={edit.quantity || ''} onChange={(event) => updateEditForm(log.id, 'quantity', event.target.value)} />
                              <select value={edit.unit_type || 'share'} onChange={(event) => updateEditForm(log.id, 'unit_type', event.target.value)}>
                                <option value="share">수</option>
                                <option value="unit">좌</option>
                              </select>
                              <input type="number" min="0" step="0.01" value={edit.price || ''} onChange={(event) => updateEditForm(log.id, 'price', event.target.value)} />
                              <select value={edit.asset_type || 'risk'} onChange={(event) => updateEditForm(log.id, 'asset_type', event.target.value)}>
                                <option value="risk">위험자산</option>
                                <option value="safe">안전자산</option>
                              </select>
                            </>
                          )}
                          <input value={edit.notes || ''} onChange={(event) => updateEditForm(log.id, 'notes', event.target.value)} placeholder="메모" />
                          <div className="log-edit-actions">
                            <button type="button" onClick={() => saveEdit(log)} disabled={savingLogId === log.id}>{savingLogId === log.id ? '저장 중...' : '저장'}</button>
                            <button type="button" onClick={() => setEditingLogId(null)}>취소</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}

export default TradeLog;
