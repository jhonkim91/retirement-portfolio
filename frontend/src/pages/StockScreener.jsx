import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { writeStoredBenchmarkSelection } from '../lib/analytics/preferences';
import { readStoredAccountName, screenerAPI } from '../utils/api';
import '../styles/StockScreener.css';

const MARKET_OPTIONS = [
  { value: 'KOSPI', label: 'KOSPI' },
  { value: 'KOSDAQ', label: 'KOSDAQ' },
  { value: 'ALL', label: '전체' }
];

const presetStorageKey = 'stock_screener_presets_v1';
const favoriteStorageKey = 'stock_screener_favorites_v1';
const MAX_COMPARE_ITEMS = 4;

const formatCurrency = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0
  }).format(Number(value));
};

const formatCompactCurrency = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(Number(value));
};

const formatPercent = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  return `${Number(value).toFixed(2)}%`;
};

const readLocalList = (storageKey) => {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || '[]');
  } catch (error) {
    return [];
  }
};

function StockScreener() {
  const navigate = useNavigate();
  const [market, setMarket] = useState('KOSPI');
  const [pages, setPages] = useState('2');
  const [limit, setLimit] = useState('18');
  const [rsiMin, setRsiMin] = useState('45');
  const [rsiMax, setRsiMax] = useState('70');
  const [minReturn20d, setMinReturn20d] = useState('-8');
  const [maxReturn20d, setMaxReturn20d] = useState('30');
  const [requireMaCross, setRequireMaCross] = useState(true);
  const [requireBbBreakout, setRequireBbBreakout] = useState(false);
  const [requireMacdPositive, setRequireMacdPositive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [dartLoading, setDartLoading] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [screenSaving, setScreenSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [chartSeries, setChartSeries] = useState([]);
  const [dartProfile, setDartProfile] = useState(null);
  const [compareCodes, setCompareCodes] = useState([]);
  const [compareData, setCompareData] = useState(null);
  const [presetName, setPresetName] = useState('');
  const [screenName, setScreenName] = useState('');
  const [screenNotes, setScreenNotes] = useState('');
  const [savedPresets, setSavedPresets] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [savedScreens, setSavedScreens] = useState([]);

  const loadSavedScreens = useCallback(async () => {
    try {
      const response = await screenerAPI.getScreens();
      setSavedScreens(response?.screens || []);
    } catch (error) {
      setSavedScreens([]);
    }
  }, []);

  useEffect(() => {
    setSavedPresets(readLocalList(presetStorageKey));
    setFavorites(readLocalList(favoriteStorageKey));
    loadSavedScreens();
  }, [loadSavedScreens]);

  const resultRows = scanResult?.results || [];

  const filtersPayload = useMemo(() => ({
    rsi_min: Number(rsiMin || 0),
    rsi_max: Number(rsiMax || 100),
    min_return_20d: Number(minReturn20d || -100),
    max_return_20d: Number(maxReturn20d || 1000),
    require_ma_cross: requireMaCross,
    require_bb_breakout: requireBbBreakout,
    require_macd_positive: requireMacdPositive
  }), [
    maxReturn20d,
    minReturn20d,
    requireBbBreakout,
    requireMaCross,
    requireMacdPositive,
    rsiMax,
    rsiMin
  ]);

  const currentScanPayload = useMemo(() => ({
    market,
    pages: Number(pages || 2),
    limit: Number(limit || 18),
    filters: filtersPayload
  }), [filtersPayload, limit, market, pages]);

  const favoriteCodes = useMemo(
    () => new Set(favorites.map((item) => item.code)),
    [favorites]
  );

  const compareCodeSet = useMemo(
    () => new Set(compareCodes),
    [compareCodes]
  );

  const selectionSummary = useMemo(() => {
    if (!selectedItem) return null;
    return [
      { label: '현재가', value: formatCurrency(selectedItem.price) },
      { label: 'RSI(14)', value: selectedItem.rsi14 === null || selectedItem.rsi14 === undefined ? '-' : Number(selectedItem.rsi14).toFixed(1) },
      { label: '20일 수익률', value: formatPercent(selectedItem.return_20d) },
      { label: '60일 수익률', value: formatPercent(selectedItem.return_60d) },
      { label: 'MACD 히스토그램', value: selectedItem.macd_histogram === null || selectedItem.macd_histogram === undefined ? '-' : Number(selectedItem.macd_histogram).toFixed(2) },
      { label: '볼린저 %B', value: formatPercent(selectedItem.bb_percent) }
    ];
  }, [selectedItem]);

  async function executeScan(payload, options = {}) {
    setLoading(true);
    if (!options.keepMessage) setMessage('');
    try {
      const response = await screenerAPI.scan(payload);
      setScanResult(response);
      const nextSelectedCode = options.selectedCode || compareCodes[0] || response?.results?.[0]?.code;
      const nextSelectedItem = (response?.results || []).find((item) => item.code === nextSelectedCode) || response?.results?.[0] || null;
      if (nextSelectedItem) {
        await loadSelectedItemDetails(nextSelectedItem);
      } else {
        setSelectedItem(null);
        setChartSeries([]);
        setDartProfile(null);
      }
      return response;
    } catch (error) {
      setMessage(error.message || '스크리너 실행에 실패했습니다.');
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function loadSelectedItemDetails(item) {
    if (!item) {
      setSelectedItem(null);
      setChartSeries([]);
      setDartProfile(null);
      return;
    }

    setSelectedItem(item);
    setChartLoading(true);
    setDartLoading(true);
    try {
      const [chartResponse, dartResponse] = await Promise.all([
        screenerAPI.getChart(item.code, 120),
        screenerAPI.getDartProfile(item.code)
      ]);
      setChartSeries(chartResponse?.series || []);
      setDartProfile(dartResponse || null);
    } catch (error) {
      setMessage(error.message || '종목 상세 데이터를 불러오지 못했습니다.');
    } finally {
      setChartLoading(false);
      setDartLoading(false);
    }
  }

  useEffect(() => {
    if (compareCodes.length === 0) {
      setCompareData(null);
      return;
    }

    let active = true;
    const loadCompare = async () => {
      setCompareLoading(true);
      try {
        const response = await screenerAPI.compare(compareCodes);
        if (active) {
          setCompareData(response || null);
        }
      } catch (error) {
        if (active) {
          setCompareData(null);
          setMessage(error.message || '비교 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (active) setCompareLoading(false);
      }
    };

    loadCompare();
    return () => {
      active = false;
    };
  }, [compareCodes]);

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) {
      setMessage('프리셋 이름을 먼저 입력해 주세요.');
      return;
    }
    const nextPresets = [
      {
        name,
        ...currentScanPayload,
        filters: { ...filtersPayload }
      },
      ...savedPresets.filter((item) => item.name !== name)
    ].slice(0, 8);
    setSavedPresets(nextPresets);
    localStorage.setItem(presetStorageKey, JSON.stringify(nextPresets));
    setPresetName('');
    setMessage('스크리너 조건을 프리셋으로 저장했습니다.');
  };

  const applyPreset = (preset) => {
    setMarket(preset.market || 'KOSPI');
    setPages(String(preset.pages || 2));
    setLimit(String(preset.limit || 18));
    setRsiMin(String(preset.filters?.rsi_min ?? 45));
    setRsiMax(String(preset.filters?.rsi_max ?? 70));
    setMinReturn20d(String(preset.filters?.min_return_20d ?? -8));
    setMaxReturn20d(String(preset.filters?.max_return_20d ?? 30));
    setRequireMaCross(Boolean(preset.filters?.require_ma_cross));
    setRequireBbBreakout(Boolean(preset.filters?.require_bb_breakout));
    setRequireMacdPositive(Boolean(preset.filters?.require_macd_positive));
    setMessage(`프리셋 "${preset.name}"을 불러왔습니다.`);
  };

  const removePreset = (name) => {
    const nextPresets = savedPresets.filter((item) => item.name !== name);
    setSavedPresets(nextPresets);
    localStorage.setItem(presetStorageKey, JSON.stringify(nextPresets));
  };

  const toggleFavorite = (item) => {
    const exists = favoriteCodes.has(item.code);
    const nextFavorites = exists
      ? favorites.filter((favorite) => favorite.code !== item.code)
      : [{ code: item.code, name: item.name, exchange: item.exchange, savedAt: new Date().toISOString() }, ...favorites].slice(0, 24);
    setFavorites(nextFavorites);
    localStorage.setItem(favoriteStorageKey, JSON.stringify(nextFavorites));
    setMessage(exists ? '관심종목에서 제거했습니다.' : '관심종목에 담았습니다.');
  };

  const toggleCompare = (item) => {
    const exists = compareCodeSet.has(item.code);
    if (exists) {
      setCompareCodes((prev) => prev.filter((code) => code !== item.code));
      return;
    }
    if (compareCodes.length >= MAX_COMPARE_ITEMS) {
      setMessage(`비교 종목은 최대 ${MAX_COMPARE_ITEMS}개까지 선택할 수 있습니다.`);
      return;
    }
    setCompareCodes((prev) => [...prev, item.code]);
  };

  const clearCompare = () => setCompareCodes([]);

  const moveToResearch = () => {
    if (!selectedItem) return;
    navigate('/stock-research', {
      state: {
        prefillProduct: {
          name: selectedItem.name,
          code: selectedItem.code,
          exchange: selectedItem.exchange,
          type: selectedItem.type || 'stock/ETF',
          source: 'Screener'
        }
      }
    });
  };

  const moveToAnalytics = (item = selectedItem) => {
    if (!item) return;
    const accountName = readStoredAccountName();
    writeStoredBenchmarkSelection(accountName, {
      code: item.code,
      name: item.name,
      source: 'screener'
    });
    navigate('/');
  };

  const saveCurrentScreen = async () => {
    const name = screenName.trim();
    if (!name) {
      setMessage('저장 화면 이름을 입력해 주세요.');
      return;
    }

    setScreenSaving(true);
    try {
      const response = await screenerAPI.saveScreen({
        name,
        market: currentScanPayload.market,
        pages: currentScanPayload.pages,
        limit: currentScanPayload.limit,
        filters: currentScanPayload.filters,
        result_codes: resultRows.map((row) => row.code),
        compare_codes: compareCodes,
        notes: screenNotes.trim()
      });
      setSavedScreens(response?.screens || []);
      setMessage(response?.message || '저장 화면을 추가했습니다.');
    } catch (error) {
      setMessage(error.message || '저장 화면 저장에 실패했습니다.');
    } finally {
      setScreenSaving(false);
    }
  };

  const applySavedScreen = async (screen) => {
    setMarket(screen.market || 'KOSPI');
    setPages(String(screen.pages || 2));
    setLimit(String(screen.limit || 18));
    setRsiMin(String(screen.filters?.rsi_min ?? 45));
    setRsiMax(String(screen.filters?.rsi_max ?? 70));
    setMinReturn20d(String(screen.filters?.min_return_20d ?? -8));
    setMaxReturn20d(String(screen.filters?.max_return_20d ?? 30));
    setRequireMaCross(Boolean(screen.filters?.require_ma_cross));
    setRequireBbBreakout(Boolean(screen.filters?.require_bb_breakout));
    setRequireMacdPositive(Boolean(screen.filters?.require_macd_positive));
    setScreenName(screen.name || '');
    setScreenNotes(screen.notes || '');
    setCompareCodes(screen.compare_codes || []);
    await executeScan({
      market: screen.market || 'KOSPI',
      pages: Number(screen.pages || 2),
      limit: Number(screen.limit || 18),
      filters: screen.filters || {}
    }, {
      selectedCode: (screen.compare_codes || [])[0] || (screen.result_codes || [])[0],
      keepMessage: true
    });
    setMessage(`저장 화면 "${screen.name}"을 불러왔습니다.`);
  };

  const deleteSavedScreen = async (screen) => {
    try {
      await screenerAPI.deleteScreen(screen.id);
      const nextScreens = savedScreens.filter((item) => item.id !== screen.id);
      setSavedScreens(nextScreens);
      setMessage('저장 화면을 삭제했습니다.');
    } catch (error) {
      setMessage(error.message || '저장 화면 삭제에 실패했습니다.');
    }
  };

  const runScan = async (event) => {
    event.preventDefault();
    await executeScan(currentScanPayload);
  };

  const renderDartMetric = (metric) => (
    <div key={metric.key} className="screener-dart-metric">
      <span>{metric.label}</span>
      <strong>{formatCompactCurrency(metric.current)}</strong>
      <small>전기 {formatCompactCurrency(metric.previous)}</small>
    </div>
  );

  return (
    <main className="stock-screener-page">
      <div className="stock-screener-header">
        <h1>주식 스크리너</h1>
        <p>대표 종목군을 빠르게 추려서 차트, 공시, 비교 화면, 저장 화면까지 한 번에 이어봅니다.</p>
      </div>

      <section className="screener-panel">
        <form className="screener-controls" onSubmit={runScan}>
          <div className="screener-market-row">
            {MARKET_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={market === option.value ? 'active' : ''}
                onClick={() => setMarket(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="screener-grid">
            <label>
              <span>스캔 페이지</span>
              <input type="number" min="1" max="5" step="1" value={pages} onChange={(event) => setPages(event.target.value)} />
            </label>
            <label>
              <span>결과 개수</span>
              <input type="number" min="5" max="60" step="1" value={limit} onChange={(event) => setLimit(event.target.value)} />
            </label>
            <label>
              <span>RSI 최소</span>
              <input type="number" min="0" max="100" step="1" value={rsiMin} onChange={(event) => setRsiMin(event.target.value)} />
            </label>
            <label>
              <span>RSI 최대</span>
              <input type="number" min="0" max="100" step="1" value={rsiMax} onChange={(event) => setRsiMax(event.target.value)} />
            </label>
            <label>
              <span>20일 수익률 최소</span>
              <input type="number" step="1" value={minReturn20d} onChange={(event) => setMinReturn20d(event.target.value)} />
            </label>
            <label>
              <span>20일 수익률 최대</span>
              <input type="number" step="1" value={maxReturn20d} onChange={(event) => setMaxReturn20d(event.target.value)} />
            </label>
          </div>

          <div className="screener-toggle-row">
            <label><input type="checkbox" checked={requireMaCross} onChange={(event) => setRequireMaCross(event.target.checked)} /> MA5가 MA20 위</label>
            <label><input type="checkbox" checked={requireBbBreakout} onChange={(event) => setRequireBbBreakout(event.target.checked)} /> 볼린저 상단 돌파</label>
            <label><input type="checkbox" checked={requireMacdPositive} onChange={(event) => setRequireMacdPositive(event.target.checked)} /> MACD 양수</label>
          </div>

          <div className="screener-actions">
            <button type="submit" disabled={loading}>{loading ? '스캔 중...' : '스크리너 실행'}</button>
          </div>
        </form>

        <div className="screener-preset-row">
          <div className="screener-preset-form">
            <input
              type="text"
              maxLength="24"
              placeholder="프리셋 이름"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
            />
            <button type="button" onClick={savePreset}>프리셋 저장</button>
          </div>
          {savedPresets.length > 0 && (
            <div className="screener-preset-list">
              {savedPresets.map((preset) => (
                <div key={preset.name} className="screener-preset-chip">
                  <button type="button" onClick={() => applyPreset(preset)}>{preset.name}</button>
                  <span role="button" tabIndex={0} onClick={() => removePreset(preset.name)} onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      removePreset(preset.name);
                    }
                  }}>×</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="screener-save-row">
          <div className="screener-save-form">
            <input
              type="text"
              maxLength="40"
              placeholder="저장 화면 이름"
              value={screenName}
              onChange={(event) => setScreenName(event.target.value)}
            />
            <input
              type="text"
              maxLength="80"
              placeholder="메모 (선택)"
              value={screenNotes}
              onChange={(event) => setScreenNotes(event.target.value)}
            />
            <button type="button" onClick={saveCurrentScreen} disabled={screenSaving}>
              {screenSaving ? '저장 중...' : '화면 저장'}
            </button>
          </div>
          {savedScreens.length > 0 && (
            <div className="screener-screen-list">
              {savedScreens.map((screen) => (
                <article key={screen.id} className="screener-screen-card">
                  <div>
                    <strong>{screen.name}</strong>
                    <span>{screen.market} · 비교 {screen.compare_codes?.length || 0}개</span>
                  </div>
                  <div className="screener-screen-actions">
                    <button type="button" onClick={() => applySavedScreen(screen)}>불러오기</button>
                    <button type="button" className="secondary" onClick={() => deleteSavedScreen(screen)}>삭제</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {favorites.length > 0 && (
          <section className="screener-favorites">
            <div className="screener-results-header">
              <h2>관심종목</h2>
              <span>{favorites.length}개</span>
            </div>
            <div className="screener-favorite-list">
              {favorites.map((item) => (
                <button key={item.code} type="button" className="screener-favorite-chip" onClick={() => loadSelectedItemDetails(item)}>
                  {item.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {message && <div className="stock-screener-message">{message}</div>}

        {scanResult && (
          <div className="screener-meta">
            <span>{scanResult.coverage_note}</span>
            <strong>스캔 {scanResult.scanned_count}종목 / 조건 통과 {scanResult.result_count}종목</strong>
          </div>
        )}

        <section className="screener-compare-panel">
          <div className="screener-results-header">
            <h2>Compare View</h2>
            <div className="screener-compare-actions">
              <span>{compareCodes.length}/{MAX_COMPARE_ITEMS} 선택</span>
              {compareCodes.length > 0 && (
                <button type="button" onClick={clearCompare}>비교 초기화</button>
              )}
            </div>
          </div>
          {compareCodes.length === 0 ? (
            <p className="screener-empty">결과 카드에서 비교 추가를 누르면 종목을 나란히 비교할 수 있습니다.</p>
          ) : compareLoading ? (
            <p className="screener-empty">비교 데이터를 불러오는 중...</p>
          ) : (
            <div className="screener-compare-grid">
              {(compareData?.items || []).map((item) => (
                <article key={item.code} className="screener-compare-card">
                  <div className="screener-compare-top">
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.code} · {item.exchange}</span>
                    </div>
                    <button type="button" onClick={() => setCompareCodes((prev) => prev.filter((code) => code !== item.code))}>제거</button>
                  </div>
                  <div className="screener-compare-metrics">
                    <div><span>현재가</span><strong>{formatCurrency(item.quote?.price)}</strong></div>
                    <div><span>RSI</span><strong>{item.snapshot?.rsi14 === null || item.snapshot?.rsi14 === undefined ? '-' : Number(item.snapshot.rsi14).toFixed(1)}</strong></div>
                    <div><span>20일</span><strong>{formatPercent(item.snapshot?.return_20d)}</strong></div>
                    <div><span>60일</span><strong>{formatPercent(item.snapshot?.return_60d)}</strong></div>
                  </div>
                  <div className="screener-compare-dart">
                    <h3>Open DART</h3>
                    {!item.dart?.enabled ? (
                      <p>{item.dart?.reason || '공시 정보를 찾지 못했습니다.'}</p>
                    ) : (
                      <>
                        <div className="screener-dart-metric-grid">
                          {(item.dart.metrics || []).slice(0, 4).map(renderDartMetric)}
                        </div>
                        {(item.dart.disclosures || []).slice(0, 3).length > 0 && (
                          <ul className="screener-dart-disclosures">
                            {item.dart.disclosures.slice(0, 3).map((disclosure) => (
                              <li key={`${item.code}-${disclosure.receipt_no}`}>
                                <a href={disclosure.url} target="_blank" rel="noreferrer">{disclosure.report_name}</a>
                                <span>{disclosure.receipt_date}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="screener-workspace">
          <section className="screener-results">
            <div className="screener-results-header">
              <h2>조건 통과 종목</h2>
              <span>{resultRows.length}개</span>
            </div>
            {resultRows.length === 0 ? (
              <p className="screener-empty">조건에 맞는 종목이 아직 없습니다. 범위를 조금 넓혀보면 후보가 더 잘 나옵니다.</p>
            ) : (
              <div className="screener-result-list">
                {resultRows.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    className={`screener-result-card ${selectedItem?.code === item.code ? 'active' : ''}`}
                    onClick={() => loadSelectedItemDetails(item)}
                  >
                    <div className="screener-result-top">
                      <strong>{item.name}</strong>
                      <span>{item.code} · {item.exchange}</span>
                    </div>
                    <div className="screener-result-metrics">
                      <span>현재가 <strong>{formatCurrency(item.price)}</strong></span>
                      <span>RSI <strong>{item.rsi14 === null || item.rsi14 === undefined ? '-' : Number(item.rsi14).toFixed(1)}</strong></span>
                      <span>20일 <strong>{formatPercent(item.return_20d)}</strong></span>
                    </div>
                    <div className="screener-signal-row">
                      {(item.signals || []).length > 0 ? item.signals.map((signal) => (
                        <small key={`${item.code}-${signal}`}>{signal}</small>
                      )) : <small>추가 신호 없음</small>}
                    </div>
                    <div className="screener-card-actions">
                      <span>{favoriteCodes.has(item.code) ? '관심종목' : '후보 종목'}</span>
                      <div className="screener-card-action-buttons">
                        <button
                          type="button"
                          className="secondary"
                          onClick={(event) => {
                            event.stopPropagation();
                            moveToAnalytics(item);
                          }}
                        >
                          분석 엔진
                        </button>
                        <button
                          type="button"
                          className={compareCodeSet.has(item.code) ? 'secondary' : ''}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleCompare(item);
                          }}
                        >
                          {compareCodeSet.has(item.code) ? '비교 해제' : '비교 추가'}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleFavorite(item);
                          }}
                        >
                          {favoriteCodes.has(item.code) ? '관심 해제' : '관심 담기'}
                        </button>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="screener-detail">
            <div className="screener-detail-header">
              <div>
                <h2>{selectedItem ? selectedItem.name : '선택 종목'}</h2>
                <p>{selectedItem ? `${selectedItem.code} · ${selectedItem.exchange}` : '왼쪽에서 종목을 선택하면 차트, 공시, 분석 연결이 열립니다.'}</p>
              </div>
              {selectedItem && (
                <div className="screener-detail-actions">
                  <button type="button" onClick={() => toggleFavorite(selectedItem)}>
                    {favoriteCodes.has(selectedItem.code) ? '관심종목 해제' : '관심종목 담기'}
                  </button>
                  <button type="button" className="secondary" onClick={() => toggleCompare(selectedItem)}>
                    {compareCodeSet.has(selectedItem.code) ? 'Compare 해제' : 'Compare 추가'}
                  </button>
                  <button type="button" className="secondary" onClick={() => moveToAnalytics(selectedItem)}>분석 엔진으로 보기</button>
                  <button type="button" className="secondary" onClick={moveToResearch}>종목 정보로 보기</button>
                </div>
              )}
            </div>

            {selectedItem && selectionSummary && (
              <div className="screener-summary-grid">
                {selectionSummary.map((item) => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            )}

            <div className="screener-chart-shell">
              {chartLoading ? (
                <p className="screener-empty">차트를 불러오는 중...</p>
              ) : chartSeries.length === 0 ? (
                <p className="screener-empty">선택한 종목의 차트 이력이 없습니다.</p>
              ) : (
                <ResponsiveContainer width="100%" height={360}>
                  <LineChart data={chartSeries} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" minTickGap={28} />
                    <YAxis tickFormatter={(value) => Number(value).toLocaleString('ko-KR')} width={82} />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Line type="monotone" dataKey="price" name="종가" stroke="#17324d" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="ma20" name="MA20" stroke="#33658a" strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="upper_bb" name="BB 상단" stroke="#d97706" strokeWidth={1.25} dot={false} strokeDasharray="5 4" />
                    <Line type="monotone" dataKey="lower_bb" name="BB 하단" stroke="#0f766e" strokeWidth={1.25} dot={false} strokeDasharray="5 4" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {selectedItem && (
              <div className="screener-dart-card">
                <div className="screener-dart-head">
                  <h3>Open DART 공시 요약</h3>
                  <span>{dartProfile?.enabled ? dartProfile.source : '공시 확인 필요'}</span>
                </div>
                {dartLoading ? (
                  <p className="screener-empty">공시 정보를 불러오는 중...</p>
                ) : !dartProfile?.enabled ? (
                  <p className="screener-dart-empty">{dartProfile?.reason || '공시 대상 법인을 찾지 못했습니다.'}</p>
                ) : (
                  <>
                    <div className="screener-dart-company">
                      <strong>{dartProfile.company?.corp_name || dartProfile.corp_name}</strong>
                      <span>{dartProfile.company?.ceo_name || '-'} · {dartProfile.company?.corp_cls || '-'}</span>
                      <span>{dartProfile.financials?.business_year || '-'}년 기준</span>
                    </div>
                    <div className="screener-dart-metric-grid">
                      {(dartProfile.metrics || []).length > 0 ? (
                        dartProfile.metrics.map(renderDartMetric)
                      ) : (
                        <p className="screener-dart-empty">핵심 재무지표를 아직 추출하지 못했습니다.</p>
                      )}
                    </div>
                    {(dartProfile.disclosures || []).slice(0, 5).length > 0 && (
                      <ul className="screener-dart-disclosures">
                        {dartProfile.disclosures.slice(0, 5).map((disclosure) => (
                          <li key={disclosure.receipt_no}>
                            <a href={disclosure.url} target="_blank" rel="noreferrer">{disclosure.report_name}</a>
                            <span>{disclosure.receipt_date}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}

            {selectedItem && (
              <div className="screener-note-card">
                <h3>읽는 포인트</h3>
                <ul>
                  <li>스크리너는 빠른 1차 선별입니다. 비교 화면과 공시 요약을 함께 보고 종목을 좁히는 용도로 쓰면 좋습니다.</li>
                  <li>Open DART 숫자는 최신 사업보고서/재무제표 공시 기준이라 장중 가격 데이터보다 느릴 수 있습니다.</li>
                  <li>비교 화면을 저장해 두면 다음 번 스캔에서도 같은 후보군을 바로 복원할 수 있습니다.</li>
                </ul>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

export default StockScreener;
