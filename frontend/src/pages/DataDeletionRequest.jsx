import React, { useEffect, useState } from 'react';
import { privacyAPI } from '../utils/api';
import '../styles/InfoPages.css';

function DataDeletionRequest({ setUser }) {
  const [mode, setMode] = useState('soft');
  const [reason, setReason] = useState('');
  const [requests, setRequests] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [executingId, setExecutingId] = useState(null);

  const loadRequests = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await privacyAPI.listDeletionRequests();
      setRequests(response?.requests || []);
    } catch (e) {
      setError(e.message || '삭제 요청 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  const submitRequest = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      await privacyAPI.createDeletionRequest(mode, reason);
      setReason('');
      setMessage('삭제 요청이 접수되었습니다.');
      await loadRequests();
    } catch (e) {
      setError(e.message || '삭제 요청 접수에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const executeRequest = async (requestId) => {
    const ok = window.confirm('삭제 요청을 즉시 실행할까요? 실행 후 복구할 수 없습니다.');
    if (!ok) return;
    setExecutingId(requestId);
    setError('');
    setMessage('');
    try {
      const response = await privacyAPI.executeDeletionRequest(requestId);
      setMessage(response.message || '삭제 요청이 처리되었습니다.');
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      if (setUser) setUser(null);
      window.location.href = '/login';
    } catch (e) {
      setError(e.message || '삭제 요청 실행에 실패했습니다.');
    } finally {
      setExecutingId(null);
    }
  };

  return (
    <main className="info-page">
      <h1>데이터 삭제 요청</h1>
      <p className="meta">soft delete(익명화) 또는 hard delete(완전 삭제)를 선택할 수 있습니다.</p>
      {message && <div className="notice-container">{message}</div>}
      {error && <div className="error-container">{error}</div>}

      <section className="info-section">
        <h2>새 요청</h2>
        <form className="delete-request-form" onSubmit={submitRequest}>
          <label htmlFor="delete-mode">삭제 방식</label>
          <select id="delete-mode" value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="soft">soft delete (익명화)</option>
            <option value="hard">hard delete (완전 삭제)</option>
          </select>
          <label htmlFor="delete-reason">요청 사유</label>
          <textarea
            id="delete-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            placeholder="요청 사유를 입력하세요."
          />
          <button type="submit" disabled={submitting}>
            {submitting ? '접수 중...' : '삭제 요청 접수'}
          </button>
        </form>
      </section>

      <section className="info-section">
        <h2>요청 내역</h2>
        {loading ? (
          <p>불러오는 중...</p>
        ) : requests.length === 0 ? (
          <p>요청 내역이 없습니다.</p>
        ) : (
          <div className="delete-request-list">
            {requests.map((request) => (
              <article key={request.id} className="delete-request-item">
                <div>
                  <strong>#{request.id} · {request.mode}</strong>
                  <p>상태: {request.status} · 요청일: {String(request.requested_at || '').replace('T', ' ')}</p>
                </div>
                {request.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => executeRequest(request.id)}
                    disabled={executingId === request.id}
                  >
                    {executingId === request.id ? '실행 중...' : '즉시 실행'}
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default DataDeletionRequest;
