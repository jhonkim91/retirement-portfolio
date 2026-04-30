import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { importAPI, readStoredAccountName } from '../utils/api';
import '../styles/ImportCenter.css';

const formatDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('ko-KR');
};

function ImportCenter() {
  const [accountName] = useState(() => readStoredAccountName());
  const [sourceName, setSourceName] = useState('csv_upload');
  const [file, setFile] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [commitLoading, setCommitLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [applyConflicts, setApplyConflicts] = useState(false);
  const [message, setMessage] = useState('');
  const [importBatches, setImportBatches] = useState([]);
  const [latestReconciliation, setLatestReconciliation] = useState(null);
  const [reconciliationResults, setReconciliationResults] = useState([]);
  const [selectedReconId, setSelectedReconId] = useState(null);
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const [commitResult, setCommitResult] = useState(null);
  const [selectedConflictRows, setSelectedConflictRows] = useState([]);
  const [rowMappingOverrides, setRowMappingOverrides] = useState({});
  const [mappingProducts, setMappingProducts] = useState([]);
  const [dryRunProjection, setDryRunProjection] = useState(null);
  const [dryRunSignature, setDryRunSignature] = useState('');
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunError, setDryRunError] = useState('');
  const [focusedRowIndex, setFocusedRowIndex] = useState(null);
  const [dryRunCalculatedAt, setDryRunCalculatedAt] = useState('');
  const [dryRunNeedsRefresh, setDryRunNeedsRefresh] = useState(false);

  const summary = previewData?.summary || null;
  const conflictRows = useMemo(
    () => (previewData?.rows || []).filter((row) => row.action === 'conflict'),
    [previewData]
  );
  const selectedConflictSet = useMemo(
    () => new Set(selectedConflictRows.map((value) => Number(value))),
    [selectedConflictRows]
  );
  const selectedReconciliation = useMemo(
    () => reconciliationResults.find((item) => item.id === selectedReconId) || reconciliationResults[0] || null,
    [reconciliationResults, selectedReconId]
  );
  const selectedBatch = useMemo(
    () => importBatches.find((item) => item.id === selectedBatchId) || importBatches[0] || null,
    [importBatches, selectedBatchId]
  );
  const mappingProductOptions = useMemo(
    () => (mappingProducts || []).map((product) => ({
      id: Number(product.id),
      label: `${product.product_name || '-'} (${product.product_code || '-'})`,
      status: product.status || '-'
    })),
    [mappingProducts]
  );
  const mappingProductLabelById = useMemo(
    () => new Map(mappingProductOptions.map((item) => [Number(item.id), item.label])),
    [mappingProductOptions]
  );
  const dryRunConflictRowSet = useMemo(
    () => new Set((dryRunProjection?.selected_conflicts || []).map((item) => Number(item.row_index))),
    [dryRunProjection]
  );
  const dryRunFreshness = useMemo(() => {
    if (dryRunLoading) return { tone: 'loading', label: '계산 중' };
    if (dryRunNeedsRefresh) return { tone: 'stale', label: '재확인 필요' };
    if (dryRunSignature) return { tone: 'fresh', label: '최신 dry-run' };
    return { tone: 'idle', label: '대기' };
  }, [dryRunLoading, dryRunNeedsRefresh, dryRunSignature]);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const [batchResponse, latestResponse, reconciliationResponse, productsResponse] = await Promise.all([
        importAPI.getImportBatches(accountName, 20),
        importAPI.getLatestReconciliation(accountName),
        importAPI.getReconciliationResults(accountName, 10),
        importAPI.getMappingProducts(accountName)
      ]);
      setImportBatches(batchResponse?.batches || []);
      const batchRows = batchResponse?.batches || [];
      setSelectedBatchId((previous) => (
        previous && batchRows.some((item) => item.id === previous)
          ? previous
          : batchRows[0]?.id || null
      ));
      setLatestReconciliation(latestResponse?.result || null);
      const rows = reconciliationResponse?.results || [];
      setReconciliationResults(rows);
      setSelectedReconId((previous) => (
        previous && rows.some((item) => item.id === previous)
          ? previous
          : rows[0]?.id || null
      ));
      setMappingProducts(productsResponse || []);
    } catch (error) {
      setMessage(error.message || '최근 가져오기 이력을 불러오지 못했습니다.');
    } finally {
      setHistoryLoading(false);
    }
  }, [accountName]);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    const conflictCandidates = (previewData?.rows || []).filter((row) => row.action === 'conflict');
    setSelectedConflictRows([]);
    setRowMappingOverrides(
      conflictCandidates.reduce((acc, row) => {
        if (row?.mapping_hint?.product_id) {
          acc[String(row.row_index)] = row.mapping_hint.product_id;
        }
        return acc;
      }, {})
    );
    setDryRunProjection(null);
    setDryRunSignature('');
    setDryRunError('');
    setFocusedRowIndex(null);
    setDryRunCalculatedAt('');
    setDryRunNeedsRefresh(false);
  }, [previewData]);

  useEffect(() => {
    const batchId = previewData?.batch_id;
    if (!batchId) {
      setDryRunProjection(null);
      setDryRunError('');
      setDryRunLoading(false);
      setDryRunCalculatedAt('');
      setDryRunNeedsRefresh(false);
      return undefined;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setDryRunLoading(true);
      setDryRunError('');
      try {
        const response = await importAPI.dryRunCommit(batchId, applyConflicts, {
          conflictRowIndexes: selectedConflictRows,
          rowMappingOverrides
        });
        if (active) {
          setDryRunProjection(response?.projection || null);
          setDryRunSignature(response?.projection_signature || '');
          setDryRunCalculatedAt(response?.calculated_at || '');
          setDryRunNeedsRefresh(false);
        }
      } catch (error) {
        if (active) {
          setDryRunProjection(null);
          setDryRunSignature('');
          setDryRunCalculatedAt('');
          setDryRunError(error.message || '커밋 예상 결과를 계산하지 못했습니다.');
        }
      } finally {
        if (active) setDryRunLoading(false);
      }
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [applyConflicts, previewData?.batch_id, rowMappingOverrides, selectedConflictRows]);

  const handlePreview = async () => {
    if (!file) {
      setMessage('CSV 파일을 먼저 선택해 주세요.');
      return;
    }
    setPreviewLoading(true);
    setMessage('');
    try {
      const response = await importAPI.previewCsv({
        file,
        sourceName,
        accountName
      });
      setPreviewData(response);
      setMessage(response?.message || '미리보기를 생성했습니다.');
      await refreshHistory();
    } catch (error) {
      setPreviewData(null);
      setMessage(error.message || '미리보기를 생성하지 못했습니다.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCommit = async () => {
    const batchId = previewData?.batch_id;
    if (!batchId) {
      setMessage('먼저 미리보기를 생성해 주세요.');
      return;
    }
    if (dryRunLoading) {
      setMessage('dry-run 계산이 끝난 뒤 커밋해 주세요.');
      return;
    }
    if (!dryRunSignature) {
      setMessage('최신 dry-run 결과를 확인한 뒤 커밋해 주세요.');
      return;
    }
    setCommitLoading(true);
    setMessage('');
    try {
      const commitOptions = {
        conflictRowIndexes: selectedConflictRows,
        rowMappingOverrides,
        expectedProjectionSignature: dryRunSignature,
        strictProjectionCheck: true
      };
      const response = await importAPI.commitPreview(batchId, applyConflicts, commitOptions);
      setCommitResult(response);
      setMessage(response?.message || '가져오기 커밋을 완료했습니다.');
      if (response?.projection_signature) {
        setDryRunSignature(response.projection_signature);
        setDryRunProjection(response.projection || null);
        setDryRunCalculatedAt(response?.projection_calculated_at || dryRunCalculatedAt);
        setDryRunNeedsRefresh(false);
      }
      await refreshHistory();
    } catch (error) {
      if (error?.status === 409 && error?.payload?.code === 'DRY_RUN_STALE') {
        setMessage('커밋 전에 데이터 조건이 바뀌었습니다. 예상 결과를 갱신했으니 다시 확인 후 커밋해 주세요.');
        setDryRunNeedsRefresh(true);
        if (error?.payload?.projection) {
          setDryRunProjection(error.payload.projection);
        }
        if (error?.payload?.current_projection_signature) {
          setDryRunSignature(error.payload.current_projection_signature);
        }
        if (error?.payload?.current_projection_calculated_at) {
          setDryRunCalculatedAt(error.payload.current_projection_calculated_at);
        }
      } else {
        setMessage(error.message || '가져오기 커밋에 실패했습니다.');
      }
    } finally {
      setCommitLoading(false);
    }
  };

  const statusLabel = useMemo(() => ({
    pending: '대기',
    preview: '미리보기',
    completed: '완료',
    partial: '부분 완료',
    ok: '정상',
    warning: '경고'
  }), []);

  const handleDownloadTemplate = async () => {
    try {
      await importAPI.downloadTemplate();
      setMessage('CSV 템플릿을 내려받았습니다.');
    } catch (error) {
      setMessage(error.message || 'CSV 템플릿 다운로드에 실패했습니다.');
    }
  };

  const toggleConflictSelection = (rowIndex) => {
    setSelectedConflictRows((previous) => {
      const indexValue = Number(rowIndex);
      if (previous.includes(indexValue)) {
        return previous.filter((item) => item !== indexValue);
      }
      return [...previous, indexValue];
    });
  };

  const applySuggestedMapping = (row) => {
    const rowKey = String(row.row_index);
    const suggestedProductId = row?.mapping_hint?.product_id;
    if (!suggestedProductId) return;
    setRowMappingOverrides((previous) => ({
      ...previous,
      [rowKey]: suggestedProductId
    }));
    if (!applyConflicts) {
      setSelectedConflictRows((previous) => {
        const indexValue = Number(row.row_index);
        return previous.includes(indexValue) ? previous : [...previous, indexValue];
      });
    }
  };

  const updateManualMapping = (row, value) => {
    const rowKey = String(row.row_index);
    const numeric = Number(value);
    setRowMappingOverrides((previous) => ({
      ...previous,
      [rowKey]: Number.isFinite(numeric) && numeric > 0 ? numeric : ''
    }));
    if (!applyConflicts && Number.isFinite(numeric) && numeric > 0) {
      setSelectedConflictRows((previous) => {
        const indexValue = Number(row.row_index);
        return previous.includes(indexValue) ? previous : [...previous, indexValue];
      });
    }
  };

  const formatReconciliationDetail = (detail) => {
    if (!detail || typeof detail !== 'object') return '-';
    if (detail.type === 'quantity_mismatch') {
      return `${detail.product_name || '-'} 수량 불일치 (기대 ${detail.expected}, 실제 ${detail.actual})`;
    }
    if (detail.type === 'cost_basis_mismatch') {
      return `${detail.product_name || '-'} 기준가 불일치 (기대 ${detail.expected}, 실제 ${detail.actual})`;
    }
    if (detail.type === 'status_mismatch') {
      return `${detail.product_name || '-'} 상태 불일치 (기대 ${detail.expected}, 실제 ${detail.actual})`;
    }
    if (detail.type === 'orphan_trade_log') {
      return `고아 로그 ${detail.trade_log_id} (${detail.product_name || '-'}, ${detail.trade_type || '-'})`;
    }
    if (detail.type === 'missing_buy_logs') {
      return `${detail.product_name || '-'} 매수 로그 누락`;
    }
    return JSON.stringify(detail);
  };

  const focusConflictRow = (rowIndex) => {
    const normalized = Number(rowIndex);
    if (!Number.isFinite(normalized) || normalized <= 0) return;
    setFocusedRowIndex(normalized);

    const previewRow = document.getElementById(`preview-row-${normalized}`);
    if (previewRow) {
      previewRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const conflictRow = document.getElementById(`conflict-row-${normalized}`);
    if (conflictRow) {
      conflictRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const focusProjectedRow = (rowIndex) => {
    const normalized = Number(rowIndex);
    if (!Number.isFinite(normalized) || normalized <= 0) return;
    setFocusedRowIndex(normalized);
    const projectedRow = document.getElementById(`projected-row-${normalized}`);
    if (projectedRow) {
      projectedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleBatchRowKeyDown = (event, batchId) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelectedBatchId(batchId);
    }
  };

  return (
    <main className="import-center-page">
      <section className="import-center-header">
        <h1>Import Center</h1>
        <p>증권사 CSV를 업로드해서 미리보기 후 커밋하고, 정합성 결과까지 바로 확인합니다.</p>
      </section>

      <section className="import-center-panel">
        <div className="import-form-grid">
          <label>
            <span>대상 통장</span>
            <input value={accountName} disabled />
          </label>
          <label>
            <span>source 이름</span>
            <input value={sourceName} onChange={(event) => setSourceName(event.target.value)} maxLength={64} />
          </label>
          <label className="import-file-field">
            <span>CSV 파일</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
        </div>
        <div className="import-action-row">
          <button type="button" onClick={handlePreview} disabled={previewLoading}>
            {previewLoading ? '미리보기 생성 중...' : '미리보기 생성'}
          </button>
          <button type="button" className="secondary" onClick={handleDownloadTemplate}>
            CSV 템플릿
          </button>
          <label className="import-toggle">
            <input
              type="checkbox"
              checked={applyConflicts}
              onChange={(event) => setApplyConflicts(event.target.checked)}
            />
            충돌 행도 강제 반영
          </label>
          <button
            type="button"
            className="secondary"
            onClick={handleCommit}
            disabled={commitLoading || dryRunLoading || !previewData?.batch_id || !dryRunSignature}
          >
            {commitLoading ? '커밋 중...' : '커밋 실행'}
          </button>
        </div>
        {message && (
          <div className="import-message" role="status" aria-live="polite">
            {message}
          </div>
        )}
        {conflictRows.length > 0 && !applyConflicts && (
          <div className="import-inline-hint" role="status" aria-live="polite">
            충돌 {conflictRows.length}행 중 {selectedConflictRows.length}행 선택됨 (선택 행만 커밋 반영)
          </div>
        )}
      </section>

      {summary && (
        <section className="import-center-panel">
          <h2>미리보기 요약</h2>
          <div className="import-summary-grid">
            <article><span>전체</span><strong>{summary.row_count ?? 0}</strong></article>
            <article><span>신규</span><strong>{summary.new_count ?? 0}</strong></article>
            <article><span>중복</span><strong>{summary.duplicate_count ?? 0}</strong></article>
            <article><span>충돌</span><strong>{summary.conflict_count ?? 0}</strong></article>
            <article><span>무시</span><strong>{summary.ignored_count ?? 0}</strong></article>
            <article><span>이슈</span><strong>{summary.issue_count ?? 0}</strong></article>
          </div>
        </section>
      )}

      {(dryRunProjection || dryRunLoading || dryRunError) && (
        <section className="import-center-panel">
          <div className="import-dryrun-header">
            <h2>커밋 예상 결과 (서버 dry-run)</h2>
            <div className={`import-dryrun-badge ${dryRunFreshness.tone}`}>
              {dryRunFreshness.label}
            </div>
          </div>
          {dryRunCalculatedAt && (
            <p className="import-dryrun-asof">기준시각: {formatDateTime(dryRunCalculatedAt)}</p>
          )}
          {dryRunLoading && <p className="import-empty" role="status" aria-live="polite">예상 반영 결과 계산 중...</p>}
          {dryRunError && (
            <div className="import-message" role="alert" aria-live="assertive">
              {dryRunError}
            </div>
          )}
          {dryRunProjection && (
            <>
              <div className="import-commit-summary">
                <article><span>전체 행</span><strong>{dryRunProjection.total_rows}</strong></article>
                <article><span>예상 반영</span><strong>{dryRunProjection.imported_count}</strong></article>
                <article><span>예상 건너뜀</span><strong>{dryRunProjection.skipped_count}</strong></article>
                <article><span>반영 충돌행</span><strong>{dryRunProjection.selected_conflict_count}</strong></article>
                <article><span>매핑 적용 충돌행</span><strong>{dryRunProjection.mapped_conflict_count}</strong></article>
                <article><span>전체 충돌행</span><strong>{conflictRows.length}</strong></article>
              </div>
              {(dryRunProjection.selected_conflicts || []).length > 0 && (
                <div className="projected-conflict-list">
                  {dryRunProjection.selected_conflicts.map((item) => (
                    <button
                      id={`projected-row-${item.row_index}`}
                      type="button"
                      className={focusedRowIndex === Number(item.row_index) ? 'active' : ''}
                      key={`projected-conflict-${item.row_index}`}
                      onClick={() => focusConflictRow(item.row_index)}
                    >
                      <strong>{item.row_index}행 · {item.product_name} ({item.product_code || '-'})</strong>
                      <span>
                        {item.mapped_product_id
                          ? `매핑: ${mappingProductLabelById.get(item.mapped_product_id) || `상품 ID ${item.mapped_product_id}`}`
                          : '매핑: 자동(미지정)'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {commitResult && (
        <section className="import-center-panel">
          <h2>최근 커밋 결과</h2>
          <div className="import-commit-summary">
            <article><span>Batch</span><strong>{commitResult?.batch?.id || '-'}</strong></article>
            <article><span>상태</span><strong>{statusLabel[commitResult?.batch?.status] || commitResult?.batch?.status || '-'}</strong></article>
            <article><span>반영</span><strong>{commitResult?.batch?.imported_count ?? 0}</strong></article>
            <article><span>건너뜀</span><strong>{commitResult?.batch?.skipped_count ?? 0}</strong></article>
            <article><span>오류</span><strong>{commitResult?.batch?.error_count ?? 0}</strong></article>
            <article><span>정합성</span><strong>{commitResult?.reconciliation?.status || '-'}</strong></article>
          </div>
          {(commitResult?.commit_errors || []).length > 0 && (
            <ul className="import-issue-list">
              {commitResult.commit_errors.map((error, index) => (
                <li key={`commit-error-${index}`}>
                  <strong>{error.row_index || '-'}행</strong>
                  <span>{error.message || '알 수 없는 오류'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {previewData?.rows?.length > 0 && (
        <section className="import-center-panel">
          <h2>미리보기 행 (최대 200)</h2>
          <div className="import-table-scroll">
            <table className="import-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>일자</th>
                  <th>종목</th>
                  <th>코드</th>
                  <th>구분</th>
                    <th>수량</th>
                    <th>단가</th>
                    <th>금액</th>
                    <th>분류</th>
                    <th>상태</th>
                  </tr>
                </thead>
              <tbody>
                {previewData.rows.map((row) => (
                  <tr
                    id={`preview-row-${row.row_index}`}
                    className={focusedRowIndex === Number(row.row_index) ? 'active' : ''}
                    key={`preview-${row.row_index}-${row.product_name}`}
                  >
                    <td>{row.row_index}</td>
                    <td>{row.trade_date || '-'}</td>
                    <td>{row.product_name}</td>
                    <td>{row.product_code || '-'}</td>
                    <td>{row.trade_type}</td>
                    <td>{row.quantity}</td>
                    <td>{row.price}</td>
                    <td>{row.total_amount}</td>
                    <td>{row.action || '-'}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {conflictRows.length > 0 && (
        <section className="import-center-panel">
          <h2>충돌 행 가이드</h2>
          <ul className="import-conflict-list">
            {conflictRows.map((row) => (
              <li
                id={`conflict-row-${row.row_index}`}
                className={focusedRowIndex === Number(row.row_index) ? 'active' : ''}
                key={`conflict-${row.row_index}`}
              >
                <strong>{row.row_index}행 · {row.product_name}</strong>
                <span>
                  같은 종목/구분/일자 로그가 이미 존재합니다.
                  {Array.isArray(row.conflict_with) && row.conflict_with.length > 0
                    ? ` (기존 로그 ID: ${row.conflict_with.join(', ')})`
                    : ''}
                </span>
                {row.mapping_hint && (
                  <small>
                    추천 매핑 상품: #{row.mapping_hint.product_id} {row.mapping_hint.product_name} ({row.mapping_hint.product_code || '-'}) ·
                    {' '}현재 적용: {rowMappingOverrides[String(row.row_index)] || '-'}
                  </small>
                )}
                <div className="import-conflict-actions">
                  {!applyConflicts && (
                    <button
                      type="button"
                      className={selectedConflictSet.has(Number(row.row_index)) ? 'active' : ''}
                      onClick={() => toggleConflictSelection(row.row_index)}
                    >
                      {selectedConflictSet.has(Number(row.row_index)) ? '커밋 대상 해제' : '커밋 대상 선택'}
                    </button>
                  )}
                  {row?.mapping_hint?.product_id && (
                    <button type="button" onClick={() => applySuggestedMapping(row)}>
                      추천 매핑 적용
                    </button>
                  )}
                  {dryRunConflictRowSet.has(Number(row.row_index)) && (
                    <button type="button" onClick={() => focusProjectedRow(row.row_index)}>
                      예상 결과로 이동
                    </button>
                  )}
                </div>
                <div className="import-mapping-row">
                  <label htmlFor={`mapping-${row.row_index}`}>수동 매핑</label>
                  <select
                    id={`mapping-${row.row_index}`}
                    value={rowMappingOverrides[String(row.row_index)] || ''}
                    onChange={(event) => updateManualMapping(row, event.target.value)}
                  >
                    <option value="">자동/미지정</option>
                    {mappingProductOptions.map((option) => (
                      <option key={`mapping-option-${row.row_index}-${option.id}`} value={option.id}>
                        {option.label} · {option.status}
                      </option>
                    ))}
                  </select>
                </div>
                {(row.conflict_with_logs || []).length > 0 && (
                  <div className="import-conflict-log-list">
                    {(row.conflict_with_logs || []).map((log) => (
                      <div key={`conflict-log-${row.row_index}-${log.id}`}>
                        <strong>기존 로그 #{log.id}</strong>
                        <span>{log.trade_date} · {log.trade_type} · {log.quantity} @ {log.price}</span>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {previewData?.issues?.length > 0 && (
        <section className="import-center-panel">
          <h2>이슈 목록</h2>
          <ul className="import-issue-list">
            {previewData.issues.map((issue) => (
              <li key={`issue-${issue.row_index}-${(issue.reasons || []).join('-')}`}>
                <strong>{issue.row_index}행</strong>
                <span>{(issue.reasons || []).join(', ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="import-center-panel">
        <div className="import-history-header">
          <h2>최근 가져오기 이력</h2>
          <button type="button" className="secondary" onClick={refreshHistory} disabled={historyLoading}>
            {historyLoading ? '새로고침 중...' : '새로고침'}
          </button>
        </div>
        {latestReconciliation && (
          <div className="import-recon-card">
            <strong>최근 정합성: {latestReconciliation.status}</strong>
            <span>mismatch {latestReconciliation.mismatch_count}건 · {formatDateTime(latestReconciliation.created_at)}</span>
          </div>
        )}
        <div className="import-table-scroll">
          <table className="import-table">
            <thead>
              <tr>
                <th>Batch ID</th>
                <th>상태</th>
                <th>행수</th>
                <th>반영/건너뜀/오류</th>
                <th>생성시각</th>
              </tr>
            </thead>
            <tbody>
              {importBatches.length === 0 ? (
                <tr>
                  <td colSpan={5}>아직 가져오기 이력이 없습니다.</td>
                </tr>
              ) : (
                importBatches.map((batch) => (
                  <tr
                    key={batch.id}
                    className={batch.id === selectedBatch?.id ? 'active' : ''}
                    onClick={() => setSelectedBatchId(batch.id)}
                    onKeyDown={(event) => handleBatchRowKeyDown(event, batch.id)}
                    tabIndex={0}
                    role="button"
                    aria-label={`Batch ${batch.id} 상세 보기`}
                  >
                    <td>{batch.id}</td>
                    <td>{statusLabel[batch.status] || batch.status}</td>
                    <td>{batch.row_count}</td>
                    <td>{batch.imported_count}/{batch.skipped_count}/{batch.error_count}</td>
                    <td>{formatDateTime(batch.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="import-center-panel">
        <h2>Batch 상세</h2>
        {!selectedBatch ? (
          <p className="import-empty" role="status" aria-live="polite">선택된 배치가 없습니다.</p>
        ) : (
          <div className="batch-detail">
            <p>
              Batch {selectedBatch.id} · 단계 {selectedBatch?.notes?.stage || '-'} ·
              {' '}source {selectedBatch.source_name || '-'}
            </p>
            {selectedBatch?.notes?.summary && (
              <div className="batch-detail-grid">
                <article><span>신규</span><strong>{selectedBatch.notes.summary.new_count ?? 0}</strong></article>
                <article><span>중복</span><strong>{selectedBatch.notes.summary.duplicate_count ?? 0}</strong></article>
                <article><span>충돌</span><strong>{selectedBatch.notes.summary.conflict_count ?? 0}</strong></article>
                <article><span>무시</span><strong>{selectedBatch.notes.summary.ignored_count ?? 0}</strong></article>
              </div>
            )}
            {(selectedBatch?.notes?.commit_errors || []).length > 0 && (
              <>
                <h3>커밋 오류</h3>
                <ul className="import-issue-list">
                  {selectedBatch.notes.commit_errors.map((error, index) => (
                    <li key={`batch-commit-error-${selectedBatch.id}-${index}`}>
                      <strong>{error.row_index || '-'}행</strong>
                      <span>{error.message || '알 수 없는 오류'}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      <section className="import-center-panel">
        <h2>정합성 Drill-down</h2>
        {reconciliationResults.length === 0 ? (
          <p className="import-empty" role="status" aria-live="polite">아직 정합성 결과가 없습니다.</p>
        ) : (
          <div className="reconciliation-drill">
            <div className="reconciliation-list">
              {reconciliationResults.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={item.id === selectedReconciliation?.id ? 'active' : ''}
                  onClick={() => setSelectedReconId(item.id)}
                >
                  <strong>{statusLabel[item.status] || item.status}</strong>
                  <span>mismatch {item.mismatch_count}건</span>
                  <small>{formatDateTime(item.created_at)}</small>
                </button>
              ))}
            </div>
            <div className="reconciliation-detail">
              <h3>결과 상세</h3>
              <p>
                결과 ID {selectedReconciliation?.id} ·
                {' '}batch {selectedReconciliation?.import_batch_id || '-'} ·
                {' '}scope {selectedReconciliation?.scope || '-'}
              </p>
              {selectedReconciliation?.details?.length > 0 ? (
                <ul className="import-issue-list">
                  {selectedReconciliation.details.map((detail, index) => (
                    <li key={`recon-${selectedReconciliation.id}-${index}`}>
                      <strong>{detail.type || 'detail'}</strong>
                      <span>{formatReconciliationDetail(detail)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="import-empty" role="status" aria-live="polite">불일치 항목이 없습니다.</p>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

export default ImportCenter;
