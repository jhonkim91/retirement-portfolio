import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AccountSelector from '../components/AccountSelector';
import {
  DEFAULT_ACCOUNT_NAME,
  readStoredAccountName,
  tradeLogAPI,
  writeStoredAccountName
} from '../utils/api';
import '../styles/TradeLog.css';

const getInitialAccountName = () => readStoredAccountName() || DEFAULT_ACCOUNT_NAME;
const journalPrefillStorageKey = 'journal_prefill_draft_v1';

const formatCurrency = (value) => new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0
}).format(Number(value || 0));

const formatQuantity = (value) => Number(value || 0).toLocaleString('ko-KR', {
  maximumFractionDigits: 4
});

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

const unitLabel = (log) => log.unit_label || (log.unit_type === 'unit' ? '좌' : '주');

const defaultJournalForm = {
  thesis: '',
  trigger: '',
  invalidation: '',
  targetHorizon: '1m',
  tags: '',
  confidence: 50,
  screenshotsOrLinks: ''
};

const auditFieldRows = [
  ['trade_date', '거래일'],
  ['trade_type', '구분'],
  ['product_name', '상품명'],
  ['quantity', '수량/좌수'],
  ['unit_type', '단위'],
  ['price', '가격'],
  ['total_amount', '금액'],
  ['asset_type', '자산구분'],
  ['notes', '메모']
];

const pickAuditSnapshot = (event) => {
  const payload = event?.payload || {};
  const before = payload.before || (event?.event_type === 'trade_deleted' ? payload.deleted : null) || null;
  const after = payload.after || (event?.event_type === 'trade_created' ? payload.trade_log : null) || null;
  return { before, after };
};

const normalizeDiffValue = (key, rawValue) => {
  if (rawValue === null || rawValue === undefined || rawValue === '') return '-';
  if (key === 'total_amount' || key === 'price') return formatCurrency(rawValue);
  if (key === 'quantity') return formatQuantity(rawValue);
  if (key === 'unit_type') return rawValue === 'unit' ? '좌' : '주';
  if (key === 'trade_type') return tradeTypeLabel(rawValue);
  if (key === 'asset_type') return assetTypeLabel(rawValue);
  return String(rawValue);
};

const normalizeSymbolText = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');

const toJournalFormFromPrefill = (draft = {}) => ({
  thesis: String(draft.thesis || ''),
  trigger: String(draft.trigger || ''),
  invalidation: String(draft.invalidation || ''),
  targetHorizon: String(draft.targetHorizon || '3m'),
  tags: Array.isArray(draft.tags) ? draft.tags.join(', ') : String(draft.tags || ''),
  confidence: Number.isFinite(Number(draft.confidence)) ? Number(draft.confidence) : 50,
  screenshotsOrLinks: Array.isArray(draft.screenshotsOrLinks)
    ? draft.screenshotsOrLinks.join(', ')
    : String(draft.screenshotsOrLinks || '')
});

const toJournalFormFromSaved = (journal = {}) => ({
  thesis: journal.thesis || '',
  trigger: journal.trigger || '',
  invalidation: journal.invalidation || '',
  targetHorizon: journal.targetHorizon || '1m',
  tags: (journal.tags || []).join(', '),
  confidence: Number(journal.confidence || 50),
  screenshotsOrLinks: (journal.screenshotsOrLinks || []).join(', ')
});

function TradeLog() {
  const [accountName, setAccountName] = useState(getInitialAccountName);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tradeType, setTradeType] = useState('all');
  const [assetType, setAssetType] = useState('all');
  const [error, setError] = useState('');
  const [auditTrail, setAuditTrail] = useState([]);
  const [expandedAuditEventId, setExpandedAuditEventId] = useState(null);
  const [restoringAuditEventId, setRestoringAuditEventId] = useState(null);
  const [applyingRestoreEventId, setApplyingRestoreEventId] = useState(null);
  const [restoreDraftByEventId, setRestoreDraftByEventId] = useState({});
  const [restoreNotice, setRestoreNotice] = useState('');
  const [auditEventTypeFilter, setAuditEventTypeFilter] = useState('all');
  const [auditChainFilter, setAuditChainFilter] = useState('all');
  const [pendingRestoreAction, setPendingRestoreAction] = useState(null);
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
  const [journals, setJournals] = useState([]);
  const [selectedLogForJournal, setSelectedLogForJournal] = useState(null);
  const [journalForm, setJournalForm] = useState(defaultJournalForm);
  const [editingJournalId, setEditingJournalId] = useState(null);
  const [savingJournal, setSavingJournal] = useState(false);
  const [journalTagFilter, setJournalTagFilter] = useState('');
  const [journalDateFrom, setJournalDateFrom] = useState('');
  const [journalDateTo, setJournalDateTo] = useState('');
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarTypeFilter, setCalendarTypeFilter] = useState('all');
  const [calendarStartDate, setCalendarStartDate] = useState('');
  const [calendarEndDate, setCalendarEndDate] = useState('');
  const [calendarForm, setCalendarForm] = useState({
    event_type: 'custom',
    event_date: '',
    title: '',
    description: '',
    attachedSymbol: ''
  });
  const [pendingJournalPrefill, setPendingJournalPrefill] = useState(null);
  const [journalPrefillNotice, setJournalPrefillNotice] = useState('');
  const journalPrefillAppliedRef = useRef(false);

  useEffect(() => {
    const prefetchedSymbol = localStorage.getItem('journal_prefill_symbol');
    const rawDraft = localStorage.getItem(journalPrefillStorageKey);
    let parsedDraft = null;
    try {
      parsedDraft = rawDraft ? JSON.parse(rawDraft) : null;
    } catch (error) {
      parsedDraft = null;
    }

    const initialSymbol = normalizeSymbolText(prefetchedSymbol || parsedDraft?.symbol);
    if (initialSymbol) {
      setCalendarForm((prev) => ({
        ...prev,
        attachedSymbol: initialSymbol
      }));
    }
    if (parsedDraft && parsedDraft.source === 'stock_screener') {
      const symbol = normalizeSymbolText(parsedDraft.symbol || prefetchedSymbol);
      const draft = {
        ...parsedDraft,
        symbol,
        name: String(parsedDraft.name || '')
      };
      setPendingJournalPrefill(draft);
      setJournalPrefillNotice('스크리너 초안을 가져왔습니다. 연결할 거래를 선택하면 저널 항목이 자동 채워집니다.');
    }

    localStorage.removeItem('journal_prefill_symbol');
    localStorage.removeItem(journalPrefillStorageKey);
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [logRows, summary, auditResponse] = await Promise.all([
        tradeLogAPI.getLogs({ tradeType, assetType, accountName }),
        tradeLogAPI.getRealizedSummary(accountName),
        tradeLogAPI.getAuditTrail(accountName, 60)
      ]);
      setLogs(logRows || []);
      setRealizedSummary(summary || {
        total_buy_amount: 0,
        total_sell_amount: 0,
        total_profit_loss: 0,
        total_profit_rate: 0,
        sold_count: 0,
        positions: []
      });
      setAuditTrail(auditResponse?.events ? auditResponse.events : []);
    } catch (err) {
      setError(err.message || '매매일지를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [tradeType, assetType, accountName]);

  const loadJournals = useCallback(async () => {
    try {
      const response = await tradeLogAPI.getJournals({
        accountName,
        tag: journalTagFilter || undefined,
        dateFrom: journalDateFrom || undefined,
        dateTo: journalDateTo || undefined
      });
      setJournals(response?.journals || []);
    } catch (err) {
      setError(err.message || '거래 저널을 불러오지 못했습니다.');
    }
  }, [accountName, journalTagFilter, journalDateFrom, journalDateTo]);

  const loadCalendarEvents = useCallback(async () => {
    try {
      const response = await tradeLogAPI.getCalendarEvents({
        accountName,
        startDate: calendarStartDate || undefined,
        endDate: calendarEndDate || undefined,
        eventType: calendarTypeFilter
      });
      setCalendarEvents(response?.events || []);
    } catch (err) {
      setError(err.message || '캘린더 이벤트를 불러오지 못했습니다.');
    }
  }, [accountName, calendarStartDate, calendarEndDate, calendarTypeFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    loadJournals();
  }, [loadJournals]);

  useEffect(() => {
    loadCalendarEvents();
  }, [loadCalendarEvents]);

  const filteredAuditTrail = useMemo(() => (
    (auditTrail || []).filter((event) => {
      if (auditEventTypeFilter !== 'all' && event.event_type !== auditEventTypeFilter) return false;
      if (auditChainFilter === 'broken' && event.chain_valid !== false) return false;
      if (auditChainFilter === 'ok' && event.chain_valid !== true) return false;
      return true;
    })
  ), [auditTrail, auditEventTypeFilter, auditChainFilter]);

  const realizedMaps = useMemo(() => {
    const byKey = new Map();
    const bySellId = new Map();
    (realizedSummary.positions || []).forEach((position) => {
      const key = position.position_key || (position.product_id
        ? `id:${position.product_id}`
        : `account:${position.account_name}:name:${position.product_name}`);
      byKey.set(key, position);
      if (position.product_id) byKey.set(String(position.product_id), position);
      if (position.realized_log_id) bySellId.set(Number(position.realized_log_id), position);
    });
    return { byKey, bySellId };
  }, [realizedSummary.positions]);

  const getRealizedPosition = (log) => {
    if (log.trade_type !== 'sell') return null;
    const key = log.position_key || (log.product_id
      ? `id:${log.product_id}`
      : `account:${log.account_name}:name:${log.product_name}`);
    return (
      realizedMaps.bySellId.get(Number(log.id))
      || realizedMaps.byKey.get(key)
      || realizedMaps.byKey.get(String(log.product_id))
      || null
    );
  };

  const changeAccountName = (value) => {
    writeStoredAccountName(value);
    setAccountName(value);
    setEditingLogId(null);
    setSelectedLogForJournal(null);
    setEditingJournalId(null);
    setJournalForm(defaultJournalForm);
    setPendingJournalPrefill(null);
    setJournalPrefillNotice('');
    journalPrefillAppliedRef.current = false;
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

  const applyDraftToEditForm = (draft) => {
    if (!draft || !draft.trade_log_id) {
      setError('복원 초안을 연결할 현재 매매일지를 찾지 못했습니다.');
      return;
    }
    const targetLog = logs.find((item) => Number(item.id) === Number(draft.trade_log_id));
    if (!targetLog) {
      setError('현재 통장에서 해당 매매일지를 찾지 못했습니다. 삭제된 건은 수동 재등록해 주세요.');
      return;
    }
    const parsedQuantity = Number(draft.quantity);
    const parsedPrice = Number(draft.price);
    const parsedTotal = Number(draft.total_amount);
    const nextForm = {
      product_name: draft.product_name || targetLog.product_name,
      trade_date: draft.trade_date || targetLog.trade_date,
      quantity: Number.isFinite(parsedQuantity) ? parsedQuantity : targetLog.quantity,
      unit_type: draft.unit_type || targetLog.unit_type || 'share',
      price: Number.isFinite(parsedPrice) ? parsedPrice : targetLog.price,
      total_amount: Number.isFinite(parsedTotal) ? parsedTotal : targetLog.total_amount,
      asset_type: draft.asset_type || targetLog.asset_type,
      notes: draft.notes || targetLog.notes || ''
    };
    setEditForms((prev) => ({
      ...prev,
      [targetLog.id]: nextForm
    }));
    setEditingLogId(targetLog.id);
    setError('');
    setTimeout(() => {
      const row = document.getElementById(`tradelog-mobile-${targetLog.id}`) || document.getElementById(`tradelog-row-${targetLog.id}`);
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  };

  const createRestoreDraft = async (event) => {
    if (!event?.id) return;
    try {
      setRestoringAuditEventId(event.id);
      setError('');
      setRestoreNotice('');
      const response = await tradeLogAPI.createRestoreDraft(event.id, accountName);
      const draft = response?.draft || null;
      setRestoreDraftByEventId((prev) => ({
        ...prev,
        [event.id]: response
      }));
      setAuditTrail((prev) => [
        ...(response?.appended_event ? [response.appended_event] : []),
        ...prev
      ]);
      if (response?.can_apply_to_existing && draft) {
        applyDraftToEditForm(draft);
      }
    } catch (err) {
      setError(err.message || '복원 초안 생성에 실패했습니다.');
    } finally {
      setRestoringAuditEventId(null);
    }
  };

  const requestRestoreApply = (event, useDraftEventId = false) => {
    if (!event?.id) return;
    setPendingRestoreAction({ event, useDraftEventId });
  };

  const applyRestoreFromEvent = async (event, useDraftEventId = false) => {
    if (!event?.id) return;
    const draftPayload = restoreDraftByEventId[event.id];
    const targetEventId = (
      useDraftEventId && draftPayload?.appended_event?.id
        ? draftPayload.appended_event.id
        : event.id
    );
    try {
      setApplyingRestoreEventId(event.id);
      setError('');
      setRestoreNotice('');
      const response = await tradeLogAPI.applyRestoreDraft(targetEventId, accountName);
      setRestoreNotice(response?.message || '복원 초안을 적용했습니다.');
      await Promise.all([loadLogs(), loadJournals(), loadCalendarEvents()]);
      const restoredId = response?.restored_log?.id;
      if (restoredId) {
        setTimeout(() => {
          const row = document.getElementById(`tradelog-mobile-${restoredId}`) || document.getElementById(`tradelog-row-${restoredId}`);
          if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
      }
    } catch (err) {
      setError(err.message || '복원 적용에 실패했습니다.');
    } finally {
      setApplyingRestoreEventId(null);
      setPendingRestoreAction(null);
    }
  };

  const saveEdit = async (log) => {
    try {
      setSavingLogId(log.id);
      setError('');
      await tradeLogAPI.updateLog(log.id, editForms[log.id]);
      setEditingLogId(null);
      await Promise.all([loadLogs(), loadCalendarEvents()]);
    } catch (err) {
      setError(err.message || '매매일지 수정에 실패했습니다.');
    } finally {
      setSavingLogId(null);
    }
  };

  const deleteLog = async (log) => {
    const ok = window.confirm(`${log.product_name} ${tradeTypeLabel(log.trade_type)} 기록을 삭제할까요?`);
    if (!ok) return;
    try {
      setError('');
      await tradeLogAPI.deleteLog(log.id);
      if (editingLogId === log.id) setEditingLogId(null);
      if (selectedLogForJournal?.id === log.id) {
        setSelectedLogForJournal(null);
        setEditingJournalId(null);
      }
      await Promise.all([loadLogs(), loadJournals(), loadCalendarEvents()]);
    } catch (err) {
      setError(err.message || '매매일지 삭제에 실패했습니다.');
    }
  };

  const applyJournalSelection = useCallback((log, draft = null, options = {}) => {
    if (!log) return;
    const existing = journals.find((row) => Number(row.attachedTradeId) === Number(log.id));
    const hasPrefill = !!draft && !existing;

    setSelectedLogForJournal(log);
    setCalendarForm((prev) => ({
      ...prev,
      attachedSymbol: log.product_code || draft?.symbol || prev.attachedSymbol
    }));

    if (existing) {
      setEditingJournalId(existing.id);
      setJournalForm(toJournalFormFromSaved(existing));
      if (options.fromPrefill) {
        setJournalPrefillNotice('이미 저장된 저널이 있어 기존 내용을 열었습니다.');
      }
    } else {
      setEditingJournalId(null);
      setJournalForm(hasPrefill ? toJournalFormFromPrefill(draft) : defaultJournalForm);
      if (hasPrefill) {
        setJournalPrefillNotice(`"${log.product_name}" 거래에 스크리너 초안을 채웠습니다. 저장 전에 수정해 주세요.`);
      }
    }

    if (options.consumePrefill && draft) {
      journalPrefillAppliedRef.current = true;
      setPendingJournalPrefill(null);
    }
  }, [journals]);

  const selectLogForJournal = (log) => {
    applyJournalSelection(log, pendingJournalPrefill, { consumePrefill: true, fromPrefill: !!pendingJournalPrefill });
  };

  const resetJournalEditor = () => {
    setEditingJournalId(null);
    setSelectedLogForJournal(null);
    setJournalForm(defaultJournalForm);
  };

  useEffect(() => {
    if (!pendingJournalPrefill || journalPrefillAppliedRef.current) return;
    if (!logs || logs.length === 0) return;

    const draftSymbol = normalizeSymbolText(pendingJournalPrefill.symbol);
    const draftName = normalizeSymbolText(pendingJournalPrefill.name);
    const matchedLogs = logs.filter((log) => {
      const code = normalizeSymbolText(log.product_code);
      const name = normalizeSymbolText(log.product_name);
      if (draftSymbol && (code === draftSymbol || name === draftSymbol)) return true;
      if (draftName && name === draftName) return true;
      return false;
    });

    if (matchedLogs.length === 0) {
      setJournalPrefillNotice('해당 종목 거래를 먼저 선택하면 스크리너 초안을 자동 채워줍니다.');
      return;
    }

    const sorted = [...matchedLogs].sort((a, b) => {
      const buyScoreA = a.trade_type === 'buy' ? 1 : 0;
      const buyScoreB = b.trade_type === 'buy' ? 1 : 0;
      if (buyScoreA !== buyScoreB) return buyScoreB - buyScoreA;
      return String(b.trade_date || '').localeCompare(String(a.trade_date || ''));
    });
    applyJournalSelection(sorted[0], pendingJournalPrefill, { consumePrefill: true, fromPrefill: true });
  }, [applyJournalSelection, logs, pendingJournalPrefill]);

  const saveJournal = async () => {
    if (!selectedLogForJournal) return;
    try {
      setSavingJournal(true);
      setError('');
      const payload = {
        thesis: journalForm.thesis,
        trigger: journalForm.trigger,
        invalidation: journalForm.invalidation,
        targetHorizon: journalForm.targetHorizon,
        tags: journalForm.tags.split(',').map((item) => item.trim()).filter(Boolean),
        confidence: Number(journalForm.confidence || 0),
        attachedTradeId: selectedLogForJournal.id,
        attachedSymbol: selectedLogForJournal.product_code || selectedLogForJournal.product_name,
        screenshotsOrLinks: journalForm.screenshotsOrLinks.split(',').map((item) => item.trim()).filter(Boolean),
        entry_date: selectedLogForJournal.trade_date
      };
      if (editingJournalId) {
        await tradeLogAPI.updateJournal(editingJournalId, payload);
      } else {
        await tradeLogAPI.createJournal(payload, accountName);
      }
      await loadJournals();
      resetJournalEditor();
    } catch (err) {
      setError(err.message || '거래 저널 저장에 실패했습니다.');
    } finally {
      setSavingJournal(false);
    }
  };

  const deleteJournal = async (journalId) => {
    const ok = window.confirm('저널을 삭제할까요?');
    if (!ok) return;
    try {
      await tradeLogAPI.deleteJournal(journalId);
      await loadJournals();
      if (editingJournalId === journalId) resetJournalEditor();
    } catch (err) {
      setError(err.message || '저널 삭제에 실패했습니다.');
    }
  };

  const createCalendarEvent = async () => {
    try {
      setError('');
      await tradeLogAPI.createCalendarEvent({
        event_type: calendarForm.event_type,
        event_date: calendarForm.event_date,
        title: calendarForm.title,
        description: calendarForm.description,
        attachedSymbol: calendarForm.attachedSymbol || selectedLogForJournal?.product_code || selectedLogForJournal?.product_name || ''
      }, accountName);
      setCalendarForm({
        event_type: 'custom',
        event_date: '',
        title: '',
        description: '',
        attachedSymbol: ''
      });
      await loadCalendarEvents();
    } catch (err) {
      setError(err.message || '캘린더 이벤트 생성에 실패했습니다.');
    }
  };

  const renderEditPanel = (log) => {
    const edit = editForms[log.id] || {};
    return (
      <div className="log-edit-panel">
        <input
          value={edit.product_name || ''}
          onChange={(event) => updateEditForm(log.id, 'product_name', event.target.value)}
          placeholder="상품명"
        />
        <input
          type="date"
          value={edit.trade_date || ''}
          onChange={(event) => updateEditForm(log.id, 'trade_date', event.target.value)}
        />
        {log.trade_type === 'deposit' ? (
          <input
            type="number"
            min="0"
            step="1"
            value={edit.total_amount || ''}
            onChange={(event) => updateEditForm(log.id, 'total_amount', event.target.value)}
            placeholder="금액"
          />
        ) : (
          <>
            <input
              type="number"
              min="0"
              step="0.0001"
              value={edit.quantity || ''}
              onChange={(event) => updateEditForm(log.id, 'quantity', event.target.value)}
              placeholder="수량"
            />
            <select
              value={edit.unit_type || 'share'}
              onChange={(event) => updateEditForm(log.id, 'unit_type', event.target.value)}
            >
              <option value="share">주</option>
              <option value="unit">좌</option>
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              value={edit.price || ''}
              onChange={(event) => updateEditForm(log.id, 'price', event.target.value)}
              placeholder="가격"
            />
            <select
              value={edit.asset_type || 'risk'}
              onChange={(event) => updateEditForm(log.id, 'asset_type', event.target.value)}
            >
              <option value="risk">위험자산</option>
              <option value="safe">안전자산</option>
            </select>
          </>
        )}
        <input
          value={edit.notes || ''}
          onChange={(event) => updateEditForm(log.id, 'notes', event.target.value)}
          placeholder="메모"
        />
        <div className="log-edit-actions">
          <button type="button" onClick={() => saveEdit(log)} disabled={savingLogId === log.id}>
            {savingLogId === log.id ? '저장 중...' : '저장'}
          </button>
          <button type="button" onClick={() => setEditingLogId(null)}>취소</button>
        </div>
      </div>
    );
  };

  return (
    <main className="tradelog-container">
      <AccountSelector value={accountName} onChange={changeAccountName} />

      <div className="page-header">
        <h1>매매일지</h1>
        <p>거래 기록과 연결형 저널, 캘린더 이벤트를 한 번에 관리합니다.</p>
      </div>

      {error && <div className="error-message" role="alert" aria-live="assertive">{error}</div>}
      {restoreNotice && <div className="success-message" role="status" aria-live="polite">{restoreNotice}</div>}

      <section className="realized-summary">
        <div className="summary-card"><span>매도 완료 상품</span><strong>{realizedSummary.sold_count || 0}개</strong></div>
        <div className="summary-card"><span>매수 원금</span><strong>{formatCurrency(realizedSummary.total_buy_amount)}</strong></div>
        <div className="summary-card"><span>매도 금액</span><strong>{formatCurrency(realizedSummary.total_sell_amount)}</strong></div>
        <div className="summary-card"><span>실현손익</span><strong className={(realizedSummary.total_profit_loss || 0) >= 0 ? 'profit' : 'loss'}>{formatCurrency(realizedSummary.total_profit_loss)}</strong></div>
        <div className="summary-card"><span>실현수익률</span><strong className={(realizedSummary.total_profit_rate || 0) >= 0 ? 'profit' : 'loss'}>{Number(realizedSummary.total_profit_rate || 0).toFixed(2)}%</strong></div>
      </section>

      <section className="filter-section" aria-label="거래 필터">
        <select aria-label="거래 유형 필터" value={tradeType} onChange={(event) => setTradeType(event.target.value)}>
          <option value="all">전체 거래</option>
          <option value="buy">매수</option>
          <option value="sell">매도</option>
          <option value="deposit">입금</option>
        </select>
        <select aria-label="자산 구분 필터" value={assetType} onChange={(event) => setAssetType(event.target.value)}>
          <option value="all">전체 자산</option>
          <option value="risk">위험자산</option>
          <option value="safe">안전자산</option>
          <option value="cash">현금</option>
        </select>
      </section>

      {loading ? (
        <div className="loading" role="status" aria-live="polite">매매일지를 불러오는 중...</div>
      ) : logs.length === 0 ? (
        <p className="no-data" role="status" aria-live="polite">嫄곕옒 湲곕줉???놁뒿?덈떎.</p>
      ) : (
        <>
        <div className="tradelog-mobile-list">
          {logs.map((log) => {
            const realized = getRealizedPosition(log);
            return (
              <article className="tradelog-mobile-card" key={`mobile-${log.id}`} id={`tradelog-mobile-${log.id}`}>
                <div className="tradelog-mobile-top">
                  <div>
                    <strong>{log.product_name}</strong>
                    <span>{log.trade_date}</span>
                  </div>
                  <span className={`trade-type ${log.trade_type}`}>{tradeTypeLabel(log.trade_type)}</span>
                </div>
                <div className="tradelog-mobile-grid">
                  <div>
                    <span>Asset</span>
                    <strong>{assetTypeLabel(log.asset_type)}</strong>
                  </div>
                  <div>
                    <span>Qty</span>
                    <strong>{log.trade_type === 'deposit' ? '-' : `${formatQuantity(log.quantity)}${unitLabel(log)}`}</strong>
                  </div>
                  <div>
                    <span>Price</span>
                    <strong>{log.trade_type === 'deposit' ? '-' : formatCurrency(log.price)}</strong>
                  </div>
                  <div>
                    <span>Amount</span>
                    <strong>{formatCurrency(log.total_amount)}</strong>
                  </div>
                  <div className="tradelog-mobile-wide">
                    <span>P/L</span>
                    <strong className={realized ? (realized.profit_loss >= 0 ? 'profit' : 'loss') : ''}>
                      {realized ? `${formatCurrency(realized.profit_loss)} (${Number(realized.profit_rate || 0).toFixed(2)}%)` : '-'}
                    </strong>
                  </div>
                  <div className="tradelog-mobile-wide">
                    <span>Memo</span>
                    <strong>{log.notes || '-'}</strong>
                  </div>
                </div>
                <div className="tradelog-mobile-actions">
                  <button type="button" className="log-edit-btn tradelog-mobile-edit-btn" onClick={() => startEdit(log)}>Edit</button>
                  <button type="button" className="log-edit-btn tradelog-mobile-edit-btn" onClick={() => selectLogForJournal(log)}>Journal</button>
                  <button type="button" className="log-delete-btn tradelog-mobile-edit-btn" onClick={() => deleteLog(log)}>Delete</button>
                </div>
                {editingLogId === log.id && (
                  <div className="tradelog-mobile-edit-panel">
                    {renderEditPanel(log)}
                  </div>
                )}
              </article>
            );
          })}
        </div>
        <div className="table-wrapper tradelog-table-wrapper">
          <table className="tradelog-table">
            <thead>
              <tr>
                <th>거래일</th>
                <th>상품명</th>
                <th>거래</th>
                <th>자산</th>
                <th>수량</th>
                <th>가격</th>
                <th>금액</th>
                <th>실현손익</th>
                <th>메모</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const realized = getRealizedPosition(log);
                return (
                  <React.Fragment key={log.id}>
                    <tr id={`tradelog-row-${log.id}`}>
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
                      <td>
                        <div className="log-row-actions">
                          <button type="button" className="log-edit-btn" onClick={() => startEdit(log)}>수정</button>
                          <button type="button" className="log-edit-btn" onClick={() => selectLogForJournal(log)}>저널</button>
                          <button type="button" className="log-delete-btn" onClick={() => deleteLog(log)}>삭제</button>
                        </div>
                      </td>
                    </tr>
                    {editingLogId === log.id && (
                      <tr className="log-edit-row">
                        <td colSpan="10">{renderEditPanel(log)}</td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      <section className="journal-panel">
        <div className="journal-header">
          <h2>거래 연결형 저널</h2>
          <div className="journal-filters">
            <input
              placeholder="태그 검색"
              value={journalTagFilter}
              onChange={(event) => setJournalTagFilter(event.target.value)}
            />
            <input type="date" value={journalDateFrom} onChange={(event) => setJournalDateFrom(event.target.value)} />
            <input type="date" value={journalDateTo} onChange={(event) => setJournalDateTo(event.target.value)} />
          </div>
        </div>
        {journalPrefillNotice && <div className="success-message" role="status" aria-live="polite">{journalPrefillNotice}</div>}

        {selectedLogForJournal ? (
          <div className="journal-editor">
            <h3>{selectedLogForJournal.product_name} ({tradeTypeLabel(selectedLogForJournal.trade_type)})</h3>
            <textarea
              rows="2"
              placeholder="thesis: 왜 샀는지/팔았는지"
              value={journalForm.thesis}
              onChange={(event) => setJournalForm((prev) => ({ ...prev, thesis: event.target.value }))}
            />
            <textarea
              rows="2"
              placeholder="trigger: 어떤 신호를 보면 행동할지"
              value={journalForm.trigger}
              onChange={(event) => setJournalForm((prev) => ({ ...prev, trigger: event.target.value }))}
            />
            <textarea
              rows="2"
              placeholder="invalidation: 어떤 조건이면 아이디어가 깨지는지"
              value={journalForm.invalidation}
              onChange={(event) => setJournalForm((prev) => ({ ...prev, invalidation: event.target.value }))}
            />
            <div className="journal-grid">
              <select
                value={journalForm.targetHorizon}
                onChange={(event) => setJournalForm((prev) => ({ ...prev, targetHorizon: event.target.value }))}
              >
                <option value="1w">1주</option>
                <option value="1m">1개월</option>
                <option value="3m">3개월</option>
                <option value="6m">6개월</option>
                <option value="1y">1년</option>
                <option value="3y">3년</option>
                <option value="long_term">장기</option>
              </select>
              <input
                type="number"
                min="0"
                max="100"
                value={journalForm.confidence}
                onChange={(event) => setJournalForm((prev) => ({ ...prev, confidence: event.target.value }))}
                placeholder="confidence"
              />
            </div>
            <input
              placeholder="tags (쉼표 구분)"
              value={journalForm.tags}
              onChange={(event) => setJournalForm((prev) => ({ ...prev, tags: event.target.value }))}
            />
            <input
              placeholder="screenshotsOrLinks (쉼표 구분)"
              value={journalForm.screenshotsOrLinks}
              onChange={(event) => setJournalForm((prev) => ({ ...prev, screenshotsOrLinks: event.target.value }))}
            />
            <div className="journal-actions">
              <button type="button" onClick={saveJournal} disabled={savingJournal || !journalForm.thesis.trim()}>
                {savingJournal ? '저장 중...' : (editingJournalId ? '저널 수정' : '저널 저장')}
              </button>
              <button type="button" onClick={resetJournalEditor}>취소</button>
            </div>
          </div>
        ) : (
          <p className="no-data" role="status" aria-live="polite">거래 행에서 [저널] 버튼을 누르면 해당 거래와 연결된 저널을 기록할 수 있습니다.</p>
        )}

        <div className="journal-list">
          {journals.length === 0 ? (
            <p className="no-data" role="status" aria-live="polite">저널 기록이 없습니다.</p>
          ) : journals.map((journal) => (
            <article key={journal.id} className="journal-item">
              <div className="journal-item-top">
                <strong>{journal.thesis}</strong>
                <span>{journal.entry_date}</span>
              </div>
              <p>trigger: {journal.trigger || '-'}</p>
              <p>invalidation: {journal.invalidation || '-'}</p>
              <p>horizon: {journal.targetHorizon || '-'} / confidence: {Number(journal.confidence || 0).toFixed(0)}%</p>
              <p>tags: {(journal.tags || []).join(', ') || '-'}</p>
              <p>links: {(journal.screenshotsOrLinks || []).join(', ') || '-'}</p>
              <div className="journal-actions">
                <button
                  type="button"
                  onClick={() => {
                    setEditingJournalId(journal.id);
                    setSelectedLogForJournal(logs.find((row) => Number(row.id) === Number(journal.attachedTradeId)) || null);
                    setJournalForm(toJournalFormFromSaved(journal));
                  }}
                >
                  수정
                </button>
                <button type="button" onClick={() => deleteJournal(journal.id)}>삭제</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="calendar-panel">
        <div className="calendar-header">
          <h2>이벤트 캘린더</h2>
          <div className="calendar-filters">
            <select value={calendarTypeFilter} onChange={(event) => setCalendarTypeFilter(event.target.value)}>
              <option value="all">전체</option>
              <option value="earnings">실적 예정</option>
              <option value="dividend_ex">배당락</option>
              <option value="dividend_pay">배당지급</option>
              <option value="disclosure">공시</option>
              <option value="contribution">납입</option>
              <option value="rebalance">리밸런싱</option>
              <option value="custom">커스텀</option>
            </select>
            <input type="date" value={calendarStartDate} onChange={(event) => setCalendarStartDate(event.target.value)} />
            <input type="date" value={calendarEndDate} onChange={(event) => setCalendarEndDate(event.target.value)} />
          </div>
        </div>

        <div className="calendar-create">
          <select
            value={calendarForm.event_type}
            onChange={(event) => setCalendarForm((prev) => ({ ...prev, event_type: event.target.value }))}
          >
            <option value="custom">커스텀</option>
            <option value="earnings">실적 예정</option>
            <option value="dividend_ex">배당락</option>
            <option value="dividend_pay">배당지급</option>
            <option value="disclosure">공시</option>
            <option value="contribution">납입/입금</option>
            <option value="rebalance">리밸런싱</option>
          </select>
          <input
            type="date"
            value={calendarForm.event_date}
            onChange={(event) => setCalendarForm((prev) => ({ ...prev, event_date: event.target.value }))}
          />
          <input
            placeholder="이벤트 제목"
            value={calendarForm.title}
            onChange={(event) => setCalendarForm((prev) => ({ ...prev, title: event.target.value }))}
          />
          <input
            placeholder="심볼(선택)"
            value={calendarForm.attachedSymbol}
            onChange={(event) => setCalendarForm((prev) => ({ ...prev, attachedSymbol: event.target.value }))}
          />
          <input
            placeholder="설명"
            value={calendarForm.description}
            onChange={(event) => setCalendarForm((prev) => ({ ...prev, description: event.target.value }))}
          />
          <button
            type="button"
            onClick={createCalendarEvent}
            disabled={!calendarForm.event_date || !calendarForm.title.trim()}
          >
            이벤트 추가
          </button>
        </div>

        <div className="calendar-list">
          {calendarEvents.length === 0 ? (
            <p className="no-data" role="status" aria-live="polite">조건에 맞는 이벤트가 없습니다.</p>
          ) : calendarEvents.map((event) => (
            <article key={`${event.source}-${event.id}-${event.dedupe_key}`} className="calendar-item">
              <div className="calendar-item-top">
                <strong>{event.title}</strong>
                <span>{event.event_date}</span>
              </div>
              <p>{event.event_type} / {event.source}</p>
              <p>{event.description || '-'}</p>
              <p>symbol: {event.attachedSymbol || '-'} / trade: {event.attachedTradeId || '-'}</p>
              {event.source === 'user' && (
                <div className="journal-actions">
                  <button
                    type="button"
                    onClick={async () => {
                      await tradeLogAPI.deleteCalendarEvent(event.id);
                      await loadCalendarEvents();
                    }}
                  >
                    삭제
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="audit-trail-panel">
        <div className="audit-trail-header">
          <div>
            <h2>감사 이력</h2>
            <p>매매일지 생성/수정/삭제를 append-only 이벤트 체인으로 추적합니다.</p>
          </div>
          <div className="audit-filters">
            <select value={auditEventTypeFilter} onChange={(event) => setAuditEventTypeFilter(event.target.value)}>
              <option value="all">이벤트 전체</option>
              <option value="trade_created">생성</option>
              <option value="trade_updated">수정</option>
              <option value="trade_deleted">삭제</option>
              <option value="trade_restore_draft">복원초안</option>
            </select>
            <select value={auditChainFilter} onChange={(event) => setAuditChainFilter(event.target.value)}>
              <option value="all">체인 전체</option>
              <option value="ok">체인 정상</option>
              <option value="broken">체인 경고</option>
            </select>
          </div>
        </div>
        {filteredAuditTrail.length === 0 ? (
          <p className="no-data" role="status" aria-live="polite">아직 기록된 감사 이력이 없습니다.</p>
        ) : (
          <div className="audit-trail-list">
            {filteredAuditTrail.slice(0, 12).map((event) => {
              const snapshot = event.payload?.after || event.payload?.deleted || event.payload?.trade_log || {};
              const { before, after } = pickAuditSnapshot(event);
              const restoreDraft = restoreDraftByEventId[event.id];
              const hasDiff = !!before || !!after;
              return (
                <article className="audit-trail-item" key={event.id}>
                  <div className="audit-trail-top">
                    <strong>{snapshot.product_name || '매매일지 이벤트'}</strong>
                    <span className={`trade-type ${event.event_type === 'trade_deleted' ? 'sell' : event.event_type === 'trade_updated' ? 'deposit' : 'buy'}`}>
                      {event.event_type_label}
                    </span>
                  </div>
                  <div className="audit-trail-meta">
                    <span>{event.occurred_at?.replace('T', ' ') || '-'}</span>
                    <span>hash {event.hash_short}</span>
                    <span>{event.source_type}</span>
                    <span className={`audit-chain-badge ${event.chain_valid === false ? 'broken' : 'ok'}`}>
                      {event.chain_valid === false ? '체인 경고' : '체인 정상'}
                    </span>
                  </div>
                  {event.chain_valid === false && (
                    <p className="audit-chain-warning">
                      prev_hash 불일치 (예상: {event.chain_expected_prev_hash_short || '-'})
                    </p>
                  )}
                  <p>{snapshot.trade_date || '-'} / {snapshot.trade_type || '-'} / {snapshot.total_amount ? formatCurrency(snapshot.total_amount) : '-'}</p>
                  <div className="audit-trail-actions-row">
                    <button
                      type="button"
                      className="log-edit-btn"
                      onClick={() => setExpandedAuditEventId((prev) => (prev === event.id ? null : event.id))}
                    >
                      {expandedAuditEventId === event.id ? 'diff 닫기' : 'diff 보기'}
                    </button>
                    <button
                      type="button"
                      className="log-edit-btn"
                      onClick={() => createRestoreDraft(event)}
                      disabled={restoringAuditEventId === event.id}
                    >
                      {restoringAuditEventId === event.id ? '복원초안 생성 중...' : '복원 초안'}
                    </button>
                    <button
                      type="button"
                      className="log-edit-btn"
                      onClick={() => requestRestoreApply(event, false)}
                      disabled={applyingRestoreEventId === event.id}
                    >
                      {applyingRestoreEventId === event.id ? '복원 적용 중...' : '복원 적용'}
                    </button>
                    {restoreDraft?.can_apply_to_existing && restoreDraft?.draft && (
                      <button
                        type="button"
                        className="log-edit-btn"
                        onClick={() => applyDraftToEditForm(restoreDraft.draft)}
                      >
                        수정폼 적용
                      </button>
                    )}
                    {restoreDraft?.appended_event?.id && (
                      <button
                        type="button"
                        className="log-edit-btn"
                        onClick={() => requestRestoreApply(event, true)}
                        disabled={applyingRestoreEventId === event.id}
                      >
                        {applyingRestoreEventId === event.id ? '복원 적용 중...' : '초안 기준 적용'}
                      </button>
                    )}
                  </div>
                  {restoreDraft && (
                    <div className="audit-restore-hint">
                      <strong>{restoreDraft.message || '복원 초안을 생성했습니다.'}</strong>
                      <span>
                        mode: {restoreDraft.restore_mode || '-'} / 대상로그: {restoreDraft.target_trade_log_id || '-'}
                      </span>
                    </div>
                  )}
                  {expandedAuditEventId === event.id && (
                    <div className="audit-diff-panel">
                      {!hasDiff ? (
                        <p className="no-data" role="status" aria-live="polite">비교 가능한 before/after 스냅샷이 없습니다.</p>
                      ) : (
                        <div className="audit-diff-grid">
                          {auditFieldRows.map(([field, label]) => {
                            const beforeText = normalizeDiffValue(field, before?.[field]);
                            const afterText = normalizeDiffValue(field, after?.[field]);
                            const changed = beforeText !== afterText;
                            return (
                              <div className={`audit-diff-row ${changed ? 'changed' : ''}`} key={`${event.id}-${field}`}>
                                <span className="audit-diff-label">{label}</span>
                                <span className="audit-diff-before">{beforeText}</span>
                                <span className="audit-diff-arrow">→</span>
                                <span className="audit-diff-after">{afterText}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
      {pendingRestoreAction?.event && (
        <section className="audit-restore-confirm">
          <strong>복원 적용 확인</strong>
          <p>
            {pendingRestoreAction.useDraftEventId ? '복원 초안 기준' : '선택한 이벤트 기준'}으로 매매일지를 반영합니다.
            적용 후에는 감사 이력에 새 이벤트가 추가됩니다.
          </p>
          <div className="audit-restore-confirm-actions">
            <button
              type="button"
              className="log-edit-btn"
              onClick={() => setPendingRestoreAction(null)}
            >
              취소
            </button>
            <button
              type="button"
              className="log-edit-btn"
              onClick={() => applyRestoreFromEvent(pendingRestoreAction.event, pendingRestoreAction.useDraftEventId)}
              disabled={applyingRestoreEventId === pendingRestoreAction.event.id}
            >
              {applyingRestoreEventId === pendingRestoreAction.event.id ? '적용 중...' : '복원 적용 실행'}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

export default TradeLog;
