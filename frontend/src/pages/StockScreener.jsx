import React, { useEffect, useMemo, useState } from 'react';
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
import { screenerAPI } from '../utils/api';
import '../styles/StockScreener.css';

const MARKET_OPTIONS = [
  { value: 'KOSPI', label: 'KOSPI' },
  { value: 'KOSDAQ', label: 'KOSDAQ' },
  { value: 'ALL', label: '전체' }
];

const formatCurrency = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0
  }).format(Number(value));
};

const formatPercent = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  return `${Number(value).toFixed(2)}%`;
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
  const [message, setMessage] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [chartSeries, setChartSeries] = useState([]);
  const [presetName, setPresetName] = useState('');
  const [savedPresets, setSavedPresets] = useState([]);
  const [favorites, setFavorites] = useState([]);

  const presetStorageKey = 'stock_screener_presets_v1';
  const favoriteStorageKey = 'stock_screener_favorites_v1';

  useEffect(() => {
    try {
      setSavedPresets(JSON.parse(localStorage.getItem(presetStorageKey) || '[]'));
    } catch (error) {
      setSavedPresets([]);
    }
    try {
      setFavorites(JSON.parse(localStorage.getItem(favoriteStorageKey) || '[]'));
    } catch (error) {
      setFavorites([]);
    }
  }, []);

  const resultRows = scanResult?.results || [];

  const selectionSummary = useMemo(() => {
    if (!selectedItem) return null;
    return [
      { label: '현재가', value: formatCurrency(selectedItem.price) },
      { label: 'RSI(14)', value: selectedItem.rsi14 === null || selectedItem.rsi14 === undefined ? '-' : Number(selectedItem.rsi14).toFixed(1) },
      { label: '20일 수익률', value: formatPercent(selectedItem.return_20d) },
      { label: 'MACD 히스토그램', value: selectedItem.macd_histogram === null || selectedItem.macd_histogram === undefined ? '-' : Number(selectedItem.macd_histogram).toFixed(2) }
    ];
  }, [selectedItem]);

  const loadChart = async (item) => {
    setSelectedItem(item);
    setChartSeries([]);
    setChartLoading(true);
    try {
      const response = await screenerAPI.getChart(item.code, 120);
      setChartSeries(response.series || []);
    } catch (error) {
      setMessage(error.message || '차트 이력을 불러오지 못했습니다.');
    } finally {
      setChartLoading(false);
    }
  };

  const currentPresetPayload = useMemo(() => ({
    market,
    pages,
    limit,
    rsiMin,
    rsiMax,
    minReturn20d,
    maxReturn20d,
    requireMaCross,
    requireBbBreakout,
    requireMacdPositive
  }), [
    market,
    pages,
    limit,
    rsiMin,
    rsiMax,
    minReturn20d,
    maxReturn20d,
    requireMaCross,
    requireBbBreakout,
    requireMacdPositive
  ]);

  const favoriteCodes = useMemo(
    () => new Set(favorites.map((item) => item.code)),
    [favorites]
  );

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) {
      setMessage('프리셋 이름을 먼저 입력해 주세요.');
      return;
    }
    const nextPresets = [
      { name, ...currentPresetPayload },
      ...savedPresets.filter((item) => item.name !== name)
    ].slice(0, 8);
    setSavedPresets(nextPresets);
    localStorage.setItem(presetStorageKey, JSON.stringify(nextPresets));
    setPresetName('');
    setMessage('스크리너 조건을 프리셋으로 저장했습니다.');
  };

  const applyPreset = (preset) => {
    setMarket(preset.market || 'KOSPI');
    setPages(String(preset.pages || '2'));
    setLimit(String(preset.limit || '18'));
    setRsiMin(String(preset.rsiMin || '45'));
    setRsiMax(String(preset.rsiMax || '70'));
    setMinReturn20d(String(preset.minReturn20d || '-8'));
    setMaxReturn20d(String(preset.maxReturn20d || '30'));
    setRequireMaCross(Boolean(preset.requireMaCross));
    setRequireBbBreakout(Boolean(preset.requireBbBreakout));
    setRequireMacdPositive(Boolean(preset.requireMacdPositive));
    setMessage(`프리셋 "${preset.name}"을 불러왔습니다.`);
  };

  const removePreset = (presetNameValue) => {
    const nextPresets = savedPresets.filter((item) => item.name !== presetNameValue);
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

  const runScan = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const response = await screenerAPI.scan({
        market,
        pages: Number(pages || 2),
        limit: Number(limit || 18),
        filters: {
          rsi_min: Number(rsiMin || 0),
          rsi_max: Number(rsiMax || 100),
          min_return_20d: Number(minReturn20d || -100),
          max_return_20d: Number(maxReturn20d || 1000),
          require_ma_cross: requireMaCross,
          require_bb_breakout: requireBbBreakout,
          require_macd_positive: requireMacdPositive
        }
      });
      setScanResult(response);
      if ((response.results || []).length > 0) {
        await loadChart(response.results[0]);
      } else {
        setSelectedItem(null);
        setChartSeries([]);
      }
    } catch (error) {
      setMessage(error.message || '스크리너 실행에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="stock-screener-page">
      <div className="stock-screener-header">
        <h1>주식 스크리너</h1>
        <p>대표 종목군에서 기술지표 조건을 조합해 빠르게 후보를 추려보고, 바로 차트 흐름까지 확인합니다.</p>
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

        {favorites.length > 0 && (
          <section className="screener-favorites">
            <div className="screener-results-header">
              <h2>관심종목</h2>
              <span>{favorites.length}개</span>
            </div>
            <div className="screener-favorite-list">
              {favorites.map((item) => (
                <button key={item.code} type="button" className="screener-favorite-chip" onClick={() => loadChart(item)}>
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
            <strong>스캔 {scanResult.scanned_count}종목 / 조건 충족 {scanResult.result_count}종목</strong>
          </div>
        )}

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
                    onClick={() => loadChart(item)}
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
                      <button type="button" onClick={(event) => {
                        event.stopPropagation();
                        toggleFavorite(item);
                      }}>
                        {favoriteCodes.has(item.code) ? '해제' : '담기'}
                      </button>
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
                <p>{selectedItem ? `${selectedItem.code} · ${selectedItem.exchange}` : '왼쪽에서 종목을 선택하면 차트와 지표 요약이 나옵니다.'}</p>
              </div>
              {selectedItem && (
                <div className="screener-detail-actions">
                  <button type="button" onClick={() => toggleFavorite(selectedItem)}>
                    {favoriteCodes.has(selectedItem.code) ? '관심종목 해제' : '관심종목 담기'}
                  </button>
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
              <div className="screener-note-card">
                <h3>읽는 포인트</h3>
                <ul>
                  <li>RSI는 과열 여부보다 지금 위치를 보기 위한 참고치로 쓰는 편이 좋습니다.</li>
                  <li>볼린저 상단 돌파는 강세 신호일 수 있지만, 추격 매수 위험도 같이 커집니다.</li>
                  <li>대표 종목군 스캔이라 전체 시장 완전 탐색보다는 빠른 1차 선별에 가깝습니다.</li>
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
