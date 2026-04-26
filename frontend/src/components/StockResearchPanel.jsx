import React, { useEffect, useMemo, useState } from 'react';
import { portfolioAPI } from '../utils/api';
import '../styles/StockResearch.css';

const ANALYSIS_MODES = [
  {
    value: 'overview',
    label: '핵심 점검',
    focus: ['사업 구조', '가격 위치', '퇴직연금 적합성', '다음 확인 질문']
  },
  {
    value: 'financial',
    label: '재무 관점',
    focus: ['실적 흐름', '이익 체력', '현금흐름', '재무 안정성']
  },
  {
    value: 'valuation',
    label: '밸류 점검',
    focus: ['고평가 여부', '가격 부담', '동종 비교', '안전마진']
  },
  {
    value: 'risk',
    label: '리스크',
    focus: ['변동성', '실적 민감도', '규제/정책 변수', '손실 관리']
  },
  {
    value: 'portfolio',
    label: '비중 판단',
    focus: ['기존 보유 중복', '위험자산 비중', '분할 매수 기준', '추가 편입 여지']
  }
];

const formatNumber = (value, digits = 2) => {
  if (value === null || value === undefined || value === '') return '-';
  return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits });
};

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

const normalizeText = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');

const sameText = (left, right) => normalizeText(left) === normalizeText(right);

const getRangeProgress = (quote) => {
  const price = Number(quote?.price);
  const high = Number(quote?.high_52w);
  const low = Number(quote?.low_52w);
  if (![price, high, low].every(Number.isFinite) || high <= low) return null;
  return ((price - low) / (high - low)) * 100;
};

const buildQuickSummary = ({ selectedProduct, quote, holding }) => {
  if (!selectedProduct) return null;

  const oneYear = Number(quote?.one_year_return_rate);
  const holdingRate = Number(holding?.profit_rate);
  const rangeProgress = getRangeProgress(quote);

  let summary = `${selectedProduct.name}은 현재 시세와 보유 현황을 함께 보면서 차분히 체크하기 좋은 상태입니다.`;
  if (!quote) {
    summary = '현재가 스냅샷이 아직 없어서, 보유 수익률과 뉴스 흐름을 같이 보는 쪽이 더 유효합니다.';
  } else if (holding && Number.isFinite(holdingRate) && holdingRate >= 8) {
    summary = '보유 수익 구간이어서 추가 매수보다 비중과 차익 관리 기준을 먼저 정하는 편이 좋습니다.';
  } else if (holding && Number.isFinite(holdingRate) && holdingRate < 0) {
    summary = '보유 손실 구간이라 추가 매수보다 반등 근거와 손실 확대 조건을 먼저 확인하는 편이 좋습니다.';
  } else if (Number.isFinite(oneYear) && oneYear >= 20) {
    summary = '최근 1년 상승 폭이 커서 신규 진입은 추격보다 분할 접근이 더 무난합니다.';
  } else if (Number.isFinite(oneYear) && oneYear <= -15) {
    summary = '최근 1년 약세가 깊어 반등 근거 확인이 먼저 필요한 종목입니다.';
  }

  return {
    title: `${selectedProduct.name} 빠른 요약`,
    summary,
    facts: [
      `현재가 ${formatCurrency(quote?.price)} / 기준일 ${quote?.price_date || '미확인'}`,
      `52주 범위 ${formatCurrency(quote?.low_52w)} ~ ${formatCurrency(quote?.high_52w)}`,
      `최근 1년 수익률 ${formatPercent(quote?.one_year_return_rate)}`,
      rangeProgress === null ? '52주 밴드 위치 미계산' : `52주 밴드 위치 ${formatPercent(rangeProgress)}`
    ],
    accountView: holding
      ? [
          `평균 매입가/기준가 ${formatCurrency(holding.purchase_price)}`,
          `현재 대장 기준가 ${formatCurrency(holding.current_price)}`,
          `평가 수익률 ${formatPercent(holding.profit_rate)}`,
          `보유 수량 ${formatNumber(holding.quantity, 0)}${holding.unit_type === 'unit' ? '좌' : '주'}`
        ]
      : ['현재 계좌 보유 종목은 아닙니다. 신규 편입 관점에서 보시면 됩니다.']
  };
};

const buildPromptText = ({ selectedProduct, quote, holding, mode }) => {
  if (!selectedProduct) return '';

  const lines = [
    `분석 대상: ${selectedProduct.name} (${selectedProduct.code})`,
    `분석 모드: ${mode.label}`,
    '',
    '[앱에서 확인한 데이터]',
    `- 현재가: ${formatNumber(quote?.price)} (${quote?.price_date || '날짜 미확인'})`,
    `- 52주 고가: ${formatNumber(quote?.high_52w)}`,
    `- 52주 저가: ${formatNumber(quote?.low_52w)}`,
    `- 최근 1년 수익률: ${formatPercent(quote?.one_year_return_rate)}`,
    ''
  ];

  if (holding) {
    lines.push('[내 계좌 기준]');
    lines.push(`- 평균 매입가/기준가: ${formatNumber(holding.purchase_price)}`);
    lines.push(`- 현재 대장 기준가: ${formatNumber(holding.current_price)}`);
    lines.push(`- 평가 수익률: ${formatPercent(holding.profit_rate)}`);
    lines.push(`- 보유 수량: ${formatNumber(holding.quantity, 0)}${holding.unit_type === 'unit' ? '좌' : '주'}`);
  } else {
    lines.push('[내 계좌 기준]');
    lines.push('- 현재 계좌에는 미보유 종목');
  }

  lines.push('');
  lines.push('[중점 확인]');
  mode.focus.forEach((item, index) => {
    lines.push(`${index + 1}. ${item}`);
  });
  lines.push('');
  lines.push('한국어로 답하고, 투자 권유처럼 단정하지 말고 사실/추정/추가 확인 필요를 구분해 주세요.');

  return lines.join('\n');
};

function StockResearchPanel({ products = [], onUseProduct, useProductLabel = '대장 입력' }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [quote, setQuote] = useState(null);
  const [detailedReport, setDetailedReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [message, setMessage] = useState('');
  const [analysisMode, setAnalysisMode] = useState(ANALYSIS_MODES[0].value);
  const [copiedTarget, setCopiedTarget] = useState('');

  const selectedMode = ANALYSIS_MODES.find((mode) => mode.value === analysisMode) || ANALYSIS_MODES[0];

  const holding = useMemo(() => {
    if (!selectedProduct) return null;
    return products.find((product) => (
      sameText(product.product_code, selectedProduct.code) ||
      sameText(product.product_name, selectedProduct.name)
    )) || null;
  }, [products, selectedProduct]);

  const heldProductCards = useMemo(() => (
    products
      .map((product) => ({
        id: product.id,
        name: product.product_name,
        code: product.product_code,
        assetType: product.asset_type,
        currentPrice: product.current_price,
        purchasePrice: product.purchase_price,
        profitRate: Number(product.profit_rate || 0),
        quantity: product.quantity,
        unitType: product.unit_type || 'share'
      }))
      .sort((left, right) => right.profitRate - left.profitRate)
  ), [products]);

  const quickReport = useMemo(() => buildQuickSummary({
    selectedProduct,
    quote,
    holding
  }), [selectedProduct, quote, holding]);

  const analysisPrompt = useMemo(() => buildPromptText({
    selectedProduct,
    quote,
    holding,
    mode: selectedMode
  }), [selectedProduct, quote, holding, selectedMode]);

  useEffect(() => {
    const keyword = query.trim();
    if (keyword.length < 2) {
      setSearchSuggestions([]);
      setSuggestionLoading(false);
      return undefined;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setSuggestionLoading(true);
      try {
        const rows = await portfolioAPI.searchProducts(keyword);
        if (active) {
          setSearchSuggestions(rows);
          setShowSuggestions(true);
        }
      } catch (error) {
        if (active) {
          setSearchSuggestions([]);
        }
      } finally {
        if (active) {
          setSuggestionLoading(false);
        }
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const loadQuote = async (product) => {
    setQuote(null);
    setQuoteLoading(true);
    try {
      const data = await portfolioAPI.getProductQuote(product.code);
      setQuote(data);
    } catch (error) {
      setMessage('현재가 스냅샷을 잠시 불러오지 못했습니다. 종목명과 보유 현황 중심으로 먼저 보셔도 됩니다.');
    } finally {
      setQuoteLoading(false);
    }
  };

  const selectProduct = async (product) => {
    setSelectedProduct(product);
    setQuery(product.name);
    setResults([]);
    setSearchSuggestions([]);
    setShowSuggestions(false);
    setDetailedReport(null);
    setCopiedTarget('');
    setMessage('');
    await loadQuote(product);
  };

  const searchProducts = async (event) => {
    event.preventDefault();
    const keyword = query.trim();
    setMessage('');
    setCopiedTarget('');

    if (keyword.length < 2) {
      setMessage('종목명 또는 코드를 2글자 이상 입력해 주세요.');
      return;
    }

    setLoading(true);
    try {
      const rows = searchSuggestions.length > 0
        ? searchSuggestions
        : await portfolioAPI.searchProducts(keyword);
      setResults(rows);

      const normalizedKeyword = normalizeText(keyword);
      const exactMatch = rows.find((product) => (
        normalizeText(product.code) === normalizedKeyword ||
        normalizeText(product.name) === normalizedKeyword
      ));

      if (rows.length === 1 || exactMatch) {
        await selectProduct(exactMatch || rows[0]);
      } else if (rows.length === 0) {
        setMessage('검색 결과가 없습니다. 종목 코드나 ETF 이름을 다시 확인해 주세요.');
      }
    } catch (error) {
      setMessage(error.message || '종목 검색에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const generateDetailedReport = async () => {
    if (!selectedProduct) return;

    setReportLoading(true);
    setMessage('');
    try {
      const report = await portfolioAPI.getProductAnalysisReport({
        product: selectedProduct,
        quote,
        holding,
        mode: selectedMode,
        engine: 'crawler'
      });
      setDetailedReport(report);
    } catch (error) {
      setDetailedReport(null);
      setMessage(error.message || '심화 분석 레포트 생성에 실패했습니다.');
    } finally {
      setReportLoading(false);
    }
  };

  const copyText = async (value, target) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedTarget(target);
    } catch (error) {
      setMessage('브라우저에서 자동 복사를 허용하지 않았습니다. 직접 선택해서 복사해 주세요.');
    }
  };

  return (
    <section className="stock-research-panel">
      <div className="stock-research-header">
        <div>
          <h2>종목 정보</h2>
          <p>보유 종목 점검과 신규 후보 탐색을 한 화면에서 바로 볼 수 있게 정리해 두었습니다.</p>
        </div>
      </div>

      <form className="stock-search-form" onSubmit={searchProducts}>
        <div className="stock-search-field">
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setMessage('');
            }}
            onFocus={() => {
              if (searchSuggestions.length > 0) {
                setShowSuggestions(true);
              }
            }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="예: KODEX AI전력핵심설비, 487240, 미국AI전력"
            autoComplete="off"
          />
          {showSuggestions && (suggestionLoading || searchSuggestions.length > 0) && (
            <div className="stock-search-suggestion-list">
              {suggestionLoading && <div className="stock-search-status">검색 중...</div>}
              {searchSuggestions.map((product) => (
                <button
                  key={`${product.code}-${product.source}`}
                  type="button"
                  className="stock-search-suggestion-item"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectProduct(product)}
                >
                  <strong>{product.name}</strong>
                  <span>{product.code} · {product.exchange} · {product.source}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="submit" disabled={loading}>
          {loading ? '검색 중...' : '검색'}
        </button>
      </form>

      {heldProductCards.length > 0 && (
        <section className="held-stock-section">
          <div className="held-stock-header">
            <h3>보유 중인 종목</h3>
            <span>{heldProductCards.length}개</span>
          </div>
          <div className="held-stock-grid">
            {heldProductCards.map((product) => (
              <button
                key={product.id}
                type="button"
                className={`held-stock-card ${selectedProduct?.code === product.code ? 'active' : ''}`}
                onClick={() => selectProduct({
                  name: product.name,
                  code: product.code,
                  exchange: '보유 종목',
                  type: product.unitType === 'unit' ? 'fund' : 'stock',
                  source: 'Holding'
                })}
              >
                <div className="held-stock-top">
                  <strong>{product.name}</strong>
                  <span>{product.code}</span>
                </div>
                <div className="held-stock-meta">
                  <small>{product.assetType === 'risk' ? '위험자산' : '안전자산'}</small>
                  <small>{formatNumber(product.quantity, 0)}{product.unitType === 'unit' ? '좌' : '주'}</small>
                </div>
                <div className="held-stock-stats">
                  <span>현재 {formatCurrency(product.currentPrice)}</span>
                  <span className={product.profitRate >= 0 ? 'profit-text' : 'loss-text'}>
                    {formatPercent(product.profitRate)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {message && <div className="stock-research-message">{message}</div>}

      {results.length > 0 && (
        <div className="stock-result-list">
          {results.map((product) => (
            <article className="stock-result-item" key={`${product.code}-${product.source}`}>
              <button type="button" className="stock-result-main" onClick={() => selectProduct(product)}>
                <strong>{product.name}</strong>
                <span>{product.code} · {product.exchange} · {product.type} · {product.source}</span>
              </button>
              {onUseProduct && (
                <button type="button" className="stock-use-button" onClick={() => onUseProduct(product)}>
                  {useProductLabel}
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {selectedProduct && (
        <div className="stock-analysis-card">
          <div className="stock-analysis-title">
            <div>
              <span>선택 종목</span>
              <strong>{selectedProduct.name}</strong>
              <small>{selectedProduct.code}</small>
            </div>
            {quoteLoading && <em>현재가 확인 중...</em>}
          </div>

          <div className="stock-snapshot-grid">
            <div>
              <span>현재가</span>
              <strong>{formatCurrency(quote?.price)}</strong>
              <small>{quote?.price_date || '날짜 미확인'}</small>
            </div>
            <div>
              <span>52주 고가</span>
              <strong>{formatCurrency(quote?.high_52w)}</strong>
            </div>
            <div>
              <span>52주 저가</span>
              <strong>{formatCurrency(quote?.low_52w)}</strong>
            </div>
            <div>
              <span>1년 수익률</span>
              <strong>{formatPercent(quote?.one_year_return_rate)}</strong>
            </div>
          </div>

          {holding && (
            <div className="stock-holding-note">
              <strong>내 계좌 보유 중</strong>
              <span>
                평균 {formatCurrency(holding.purchase_price)} · 현재 {formatCurrency(holding.current_price)} ·
                {' '}수익률 {formatPercent(holding.profit_rate)}
              </span>
            </div>
          )}

          <div className="analysis-mode-row">
            {ANALYSIS_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                className={analysisMode === mode.value ? 'active' : ''}
                onClick={() => {
                  setAnalysisMode(mode.value);
                  setDetailedReport(null);
                }}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {quickReport && (
            <div className="analysis-report-card">
              <div className="analysis-report-header">
                <div>
                  <span>빠른 요약</span>
                  <strong>{quickReport.title}</strong>
                </div>
                <button
                  type="button"
                  className="analysis-secondary-button"
                  onClick={() => copyText([
                    quickReport.title,
                    '',
                    quickReport.summary,
                    '',
                    ...quickReport.facts.map((item) => `- ${item}`),
                    '',
                    ...quickReport.accountView.map((item) => `- ${item}`)
                  ].join('\n'), 'quick-report')}
                >
                  {copiedTarget === 'quick-report' ? '복사됨' : '요약 복사'}
                </button>
              </div>
              <p className="analysis-report-summary">{quickReport.summary}</p>
              <div className="analysis-report-grid">
                <section className="analysis-report-section">
                  <h3>시장 스냅샷</h3>
                  <ul>
                    {quickReport.facts.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </section>
                <section className="analysis-report-section">
                  <h3>계좌 관점</h3>
                  <ul>
                    {quickReport.accountView.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </section>
              </div>
            </div>
          )}

          <div className="analysis-ai-card">
            <div className="analysis-ai-header">
              <div>
                <span>심화 분석</span>
                <strong>크롤링 기반 레포트</strong>
              </div>
              <button
                type="button"
                className="analysis-primary-button"
                onClick={generateDetailedReport}
                disabled={reportLoading}
              >
                {reportLoading ? '분석 생성 중...' : '심화 분석 생성'}
              </button>
            </div>

            {!detailedReport && (
              <p className="analysis-ai-empty">
                OpenAI API 없이 최근 뉴스 제목, 시세 스냅샷, 보유 현황을 합쳐서 분석 레포트를 만듭니다.
              </p>
            )}

            {detailedReport && (
              <>
                <div className="analysis-ai-meta">
                  <span>{detailedReport.provider_label || '크롤링 분석'}</span>
                  <span>{detailedReport.generated_at || ''}</span>
                </div>

                {detailedReport.sentiment && (
                  <div className="analysis-sentiment-row">
                    <div className="analysis-sentiment-badge">
                      <strong>{detailedReport.sentiment.label}</strong>
                      <span>{detailedReport.sentiment.summary}</span>
                    </div>
                    <div className="analysis-sentiment-stats">
                      <span>긍정 {detailedReport.sentiment.positive_count}</span>
                      <span>중립 {detailedReport.sentiment.neutral_count}</span>
                      <span>부정 {detailedReport.sentiment.negative_count}</span>
                    </div>
                  </div>
                )}

                <div className="analysis-ai-body">
                  <p>{detailedReport.summary}</p>
                </div>

                <div className="analysis-report-grid analysis-detail-grid">
                  <section className="analysis-report-section">
                    <h3>시장 포인트</h3>
                    <ul>
                      {(detailedReport.sections?.market || []).map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </section>
                  <section className="analysis-report-section">
                    <h3>투자 포인트</h3>
                    <ul>
                      {(detailedReport.sections?.investment_points || []).map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </section>
                  <section className="analysis-report-section">
                    <h3>리스크</h3>
                    <ul>
                      {(detailedReport.sections?.risk_points || []).map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </section>
                  <section className="analysis-report-section">
                    <h3>행동 가이드</h3>
                    <ul>
                      {(detailedReport.sections?.action_points || []).map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </section>
                </div>

                {Array.isArray(detailedReport.headlines) && detailedReport.headlines.length > 0 && (
                  <div className="analysis-ai-sources">
                    <h3>최근 기사</h3>
                    <ul className="analysis-news-list">
                      {detailedReport.headlines.map((item) => (
                        <li key={item.url}>
                          <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                          <span>
                            {(item.source || '출처 미확인')}
                            {item.published_at ? ` · ${item.published_at}` : ''}
                            {item.tone ? ` · ${item.tone}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>

          <textarea className="analysis-prompt-box" value={analysisPrompt} readOnly rows="12" />
          <div className="analysis-actions">
            <button type="button" onClick={() => copyText(analysisPrompt, 'prompt')}>
              {copiedTarget === 'prompt' ? '프롬프트 복사됨' : 'ChatGPT용 프롬프트 복사'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default StockResearchPanel;
