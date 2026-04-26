import React, { useMemo, useState } from 'react';
import { portfolioAPI } from '../utils/api';
import '../styles/StockResearch.css';

const ANALYSIS_MODES = [
  {
    value: 'overview',
    label: '핵심 점검',
    role: '퇴직연금 계좌를 관리하는 보수적인 투자 분석가',
    focus: ['사업 모델과 수익 구조', '최근 주가 위치', '퇴직연금 편입 적합성', '추가 확인이 필요한 리스크']
  },
  {
    value: 'financial',
    label: '재무 분석',
    role: 'CFA 자격을 가진 재무제표 분석 전문가',
    focus: ['매출과 이익 성장률', 'ROE와 영업이익률', '부채비율과 현금흐름', '동종 업계 대비 재무 품질']
  },
  {
    value: 'valuation',
    label: '밸류에이션',
    role: 'PER, PBR, DCF를 함께 보는 밸류에이션 애널리스트',
    focus: ['현재 PER/PBR 수준', '동종 업계 평균 대비 할인/프리미엄', '보수적 적정가 범위', '안전마진']
  },
  {
    value: 'risk',
    label: '리스크',
    role: '퇴직연금 포트폴리오의 손실 방어를 담당하는 리스크 매니저',
    focus: ['최대 낙폭 가능성', '금리/환율/경기 민감도', '기업 고유 리스크', '손절 또는 비중 축소 조건']
  },
  {
    value: 'portfolio',
    label: '비중 판단',
    role: '장기 은퇴자금을 배분하는 포트폴리오 매니저',
    focus: ['기존 보유 종목과의 중복', '위험자산/안전자산 균형', '적정 편입 비중', '분할매수 계획']
  }
];

const formatNumber = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
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

const sameText = (left, right) => String(left || '').trim().toUpperCase() === String(right || '').trim().toUpperCase();
const normalizeText = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');

const getRangeProgress = (quote) => {
  const price = Number(quote?.price);
  const high = Number(quote?.high_52w);
  const low = Number(quote?.low_52w);

  if (![price, high, low].every(Number.isFinite) || high <= low) return null;
  return ((price - low) / (high - low)) * 100;
};

const getRangePositionLabel = (progress) => {
  if (progress === null || progress === undefined) return '52주 밴드 위치를 계산할 수 없습니다.';
  if (progress >= 85) return '52주 고점 부근입니다.';
  if (progress >= 65) return '52주 밴드 상단 구간입니다.';
  if (progress >= 35) return '52주 밴드 중간 구간입니다.';
  if (progress >= 15) return '52주 밴드 하단 구간입니다.';
  return '52주 저점 부근입니다.';
};

const getOneYearTone = (rate) => {
  const value = Number(rate);
  if (!Number.isFinite(value)) return '최근 1년 추세 정보가 부족합니다.';
  if (value >= 25) return '최근 1년 상승폭이 커서 추격 매수 리스크 점검이 필요합니다.';
  if (value >= 10) return '최근 1년 기준으로 우상향 흐름이 이어졌습니다.';
  if (value <= -20) return '최근 1년 낙폭이 커서 반등 근거 확인이 우선입니다.';
  if (value <= -5) return '최근 1년 기준 약세 흐름이 이어졌습니다.';
  return '최근 1년 변동은 중립 구간에 가깝습니다.';
};

const buildModeInsights = ({ mode, quote, holding, rangeProgress }) => {
  const oneYearRate = Number(quote?.one_year_return_rate);
  const holdingRate = Number(holding?.profit_rate);
  const drawdownFromHigh = Number(quote?.high_52w) > 0 && Number(quote?.price) > 0
    ? ((Number(quote.high_52w) - Number(quote.price)) / Number(quote.high_52w)) * 100
    : null;

  if (mode.value === 'financial') {
    return [
      '이 앱에서는 재무제표 수치를 직접 가져오지 않으므로 매출, 이익, 현금흐름은 별도 확인이 필요합니다.',
      Number.isFinite(oneYearRate)
        ? `최근 1년 수익률 ${formatPercent(oneYearRate)}는 시장이 실적 기대를 어떻게 반영했는지 보여주는 보조 신호입니다.`
        : '최근 1년 수익률 데이터가 없어서 가격 반응과 실적 기대를 함께 보기 어렵습니다.',
      '재무 분석 모드에서는 최근 분기 실적 발표와 가이던스 변화, 부채비율, 잉여현금흐름을 우선 확인하는 편이 좋습니다.'
    ];
  }

  if (mode.value === 'valuation') {
    return [
      Number.isFinite(rangeProgress)
        ? `현재 가격은 52주 밴드의 ${formatPercent(rangeProgress)} 지점으로, 절대 저평가 판단보다 가격 위치 점검에 유용합니다.`
        : '52주 밴드 위치를 계산할 수 없어 가격 위치 비교는 제한적입니다.',
      Number.isFinite(oneYearRate)
        ? `최근 1년 수익률 ${formatPercent(oneYearRate)}는 밸류에이션 부담이 커졌는지 확인하는 출발점이 됩니다.`
        : '최근 1년 수익률 데이터가 없어서 밸류에이션 부담을 가격 흐름으로 가늠하기 어렵습니다.',
      'PER, PBR, 배당수익률, 경쟁사 멀티플은 외부 공시와 리서치 자료로 추가 확인해야 합니다.'
    ];
  }

  if (mode.value === 'risk') {
    return [
      Number.isFinite(drawdownFromHigh)
        ? `52주 고점 대비 현재 하락폭은 ${formatPercent(drawdownFromHigh)}입니다. 손실 흡수 여력을 함께 점검하세요.`
        : '52주 고점 대비 하락폭을 계산할 수 없어 가격 리스크 추정이 제한적입니다.',
      holding
        ? `현재 보유 수익률은 ${formatPercent(holdingRate)}이며, 손실 구간이면 추가매수보다 원인 점검이 우선입니다.`
        : '미보유 상태라면 편입 전 변동성, 유동성, 업종 리스크를 먼저 점검하는 편이 좋습니다.',
      '리스크 모드에서는 실적 쇼크 가능성, 금리 민감도, 규제 변화, 환율 영향을 함께 보는 것이 좋습니다.'
    ];
  }

  if (mode.value === 'portfolio') {
    return [
      holding
        ? `이미 계좌에 편입된 종목이며 현재 수익률은 ${formatPercent(holdingRate)}입니다. 비중 확대 전 중복 노출을 확인하세요.`
        : '현재 계좌 미보유 종목이므로 신규 편입 시 기존 위험자산과의 중복도를 먼저 보는 편이 좋습니다.',
      holding
        ? `보유 수량은 ${formatNumber(holding.quantity)}${holding.unit_type === 'unit' ? '좌' : '수'}입니다.`
        : '신규 편입이라면 한 번에 진입하기보다 분할 편입 기준을 먼저 정하는 편이 안정적입니다.',
      '포트폴리오 모드에서는 계좌 내 위험자산/안전자산 비중과 같은 섹터 노출 집중도를 같이 점검하세요.'
    ];
  }

  return [
    getRangePositionLabel(rangeProgress),
    getOneYearTone(quote?.one_year_return_rate),
    holding
      ? `대장 기준 현재 보유 수익률은 ${formatPercent(holding.profit_rate)}입니다.`
      : '현재 계좌에는 같은 종목 보유 내역이 없어 신규 편입 관점으로 해석해야 합니다.'
  ];
};

const buildAnalysisReport = ({ selectedProduct, quote, holding, mode }) => {
  if (!selectedProduct) return null;

  const rangeProgress = getRangeProgress(quote);
  const holdingRate = Number(holding?.profit_rate);
  const oneYearRate = Number(quote?.one_year_return_rate);
  const isHolding = Boolean(holding);
  let summary = '현재 가격 위치와 계좌 편입 여부를 함께 보고 추가 확인 항목을 정리하는 단계입니다.';

  if (!quote) {
    summary = '자동 시세 스냅샷이 없어 레포트 신뢰도가 낮습니다. 먼저 가격 데이터부터 확인하세요.';
  } else if (isHolding && Number.isFinite(holdingRate) && holdingRate < 0) {
    summary = `${selectedProduct.name}은 현재 손실 구간입니다. 추가매수보다 손실 원인과 추세 재확인이 우선입니다.`;
  } else if (isHolding && Number.isFinite(holdingRate) && holdingRate >= 0) {
    summary = `${selectedProduct.name}은 현재 수익 구간입니다. 비중 확대보다 유지 조건과 재점검 시점을 먼저 정하는 편이 좋습니다.`;
  } else if (Number.isFinite(oneYearRate) && oneYearRate >= 20) {
    summary = `${selectedProduct.name}은 최근 1년 상승폭이 커서 신규 편입 전 추격 매수 위험을 먼저 점검해야 합니다.`;
  } else if (Number.isFinite(oneYearRate) && oneYearRate <= -15) {
    summary = `${selectedProduct.name}은 최근 1년 약세 구간입니다. 반등 근거 없이 성급하게 편입하기보다는 확인이 더 필요합니다.`;
  }

  const facts = [
    quote
      ? `현재가 ${formatCurrency(quote.price)} / 기준일 ${quote.price_date || '날짜 미확인'}`
      : '현재가 스냅샷 없음',
    quote
      ? `52주 범위 ${formatCurrency(quote.low_52w)} ~ ${formatCurrency(quote.high_52w)}`
      : '52주 고저가 없음',
    quote
      ? `최근 1년 수익률 ${formatPercent(quote.one_year_return_rate)}`
      : '최근 1년 수익률 없음',
    rangeProgress !== null
      ? `52주 밴드 위치 ${formatPercent(rangeProgress)}`
      : '52주 밴드 위치 계산 불가'
  ];

  const accountView = isHolding
    ? [
        `계좌 보유 중: 평균 기준가 ${formatCurrency(holding.purchase_price)}`,
        `현재 대장 기준가 ${formatCurrency(holding.current_price)} / 평가 수익률 ${formatPercent(holding.profit_rate)}`,
        `보유 수량 ${formatNumber(holding.quantity)}${holding.unit_type === 'unit' ? '좌' : '수'}`
      ]
    : [
        '현재 계좌 미보유 종목입니다.',
        '신규 편입 여부는 기존 위험자산과의 중복도, 분할 진입 기준을 함께 보고 판단하는 편이 좋습니다.'
      ];

  const nextChecks = [
    `${mode.label} 기준으로 ${mode.focus.join(', ')} 확인`,
    '네이버 금융, 공시, 증권사 리포트로 최근 실적과 이슈 재확인',
    '편입 시점이라면 분할매수 조건과 재검토 날짜를 먼저 정하기'
  ];

  return {
    title: `${selectedProduct.name} ${mode.label} 레포트`,
    summary,
    facts,
    insights: buildModeInsights({ mode, quote, holding, rangeProgress }),
    accountView,
    nextChecks
  };
};

const buildReportText = (report) => {
  if (!report) return '';

  return [
    report.title,
    '',
    `한 줄 요약: ${report.summary}`,
    '',
    '확인된 데이터',
    ...report.facts.map((item, index) => `${index + 1}. ${item}`),
    '',
    '해석',
    ...report.insights.map((item, index) => `${index + 1}. ${item}`),
    '',
    '대장 기준',
    ...report.accountView.map((item, index) => `${index + 1}. ${item}`),
    '',
    '다음 확인',
    ...report.nextChecks.map((item, index) => `${index + 1}. ${item}`)
  ].join('\n');
};

const buildAnalysisPrompt = ({ selectedProduct, quote, holding, mode }) => {
  if (!selectedProduct) return '';

  const today = new Date().toLocaleDateString('ko-KR');
  const quoteLines = quote
    ? [
        `- 현재가: ${formatNumber(quote.price)} (${quote.price_date || '날짜 미확인'})`,
        `- 52주 고가: ${formatNumber(quote.high_52w)}`,
        `- 52주 저가: ${formatNumber(quote.low_52w)}`,
        `- 최근 1년 수익률: ${formatPercent(quote.one_year_return_rate)}`
      ]
    : ['- 현재가 스냅샷: 앱에서 자동 조회하지 못했으므로 반드시 웹 검색으로 확인'];

  const holdingLines = holding
    ? [
        `- 대장 보유 여부: 보유 중`,
        `- 평균 매입가/기준가: ${formatNumber(holding.purchase_price)}`,
        `- 현재 대장 기준가: ${formatNumber(holding.current_price)}`,
        `- 대장 평가손익률: ${formatPercent(holding.profit_rate)}`,
        `- 보유 수량/좌수: ${formatNumber(holding.quantity)}`
      ]
    : ['- 대장 보유 여부: 미보유 또는 코드 불일치'];

  return [
    `오늘 날짜는 ${today}입니다.`,
    `분석 대상은 ${selectedProduct.name} (${selectedProduct.code})입니다.`,
    '',
    'R (Role) - 역할',
    `당신은 ${mode.role}입니다. 투자 권유가 아니라 의사결정에 필요한 사실 확인과 리스크 점검을 돕습니다.`,
    '',
    'I (Instruction) - 지시사항',
    '아래 종목을 분석하되, 모든 수치에는 출처 URL과 조회 시각을 붙여주세요.',
    '출처가 확인되지 않는 수치는 사용하지 말고 "미확인"으로 표시하세요.',
    '',
    '앱에서 가져온 참고 스냅샷:',
    ...quoteLines,
    '',
    '내 퇴직연금 대장 기준:',
    ...holdingLines,
    '',
    `${mode.label} 중점 분석 항목:`,
    ...mode.focus.map((item, index) => `${index + 1}. ${item}`),
    '',
    'C (Context) - 맥락',
    '- 목적: 퇴직연금/IRP 계좌에서 장기적으로 관리 가능한 종목인지 판단',
    '- 관점: 단기 급등보다 손실 방어, 변동성, 장기 복리 가능성 우선',
    '- 필요한 경우 ETF, 펀드, 현금성 자산과 비교',
    '',
    'E (Example) - 출력 형식',
    '1. 한 줄 결론: 편입 검토 / 보류 / 제외 중 하나로 표시',
    '2. 확인된 사실 표: 현재가, 시가총액, 52주 고저가, 주요 재무지표, 출처',
    '3. 투자 포인트 3개와 반대 근거 3개',
    '4. 리스크 체크: 가격 리스크, 실적 리스크, 매크로 리스크, 규제/산업 리스크',
    '5. 대장 반영 제안: 신규 편입 여부, 적정 비중 범위, 분할매수 조건, 재검토 날짜',
    '6. 추가 확인 필요: 확인하지 못한 데이터와 확인 방법',
    '',
    '마지막에는 "확실한 사실", "추정", "추가 확인 필요"를 반드시 분리해서 정리하세요.'
  ].join('\n');
};

function StockResearchPanel({ products = [], onUseProduct, useProductLabel = '대장 입력' }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [analysisMode, setAnalysisMode] = useState(ANALYSIS_MODES[0].value);
  const [copiedTarget, setCopiedTarget] = useState('');

  const selectedMode = ANALYSIS_MODES.find((mode) => mode.value === analysisMode) || ANALYSIS_MODES[0];
  const holding = useMemo(() => {
    if (!selectedProduct) return null;
    return products.find((product) => (
      sameText(product.product_code, selectedProduct.code) || sameText(product.product_name, selectedProduct.name)
    ));
  }, [products, selectedProduct]);

  const analysisPrompt = useMemo(() => buildAnalysisPrompt({
    selectedProduct,
    quote,
    holding,
    mode: selectedMode
  }), [selectedProduct, quote, holding, selectedMode]);
  const analysisReport = useMemo(() => buildAnalysisReport({
    selectedProduct,
    quote,
    holding,
    mode: selectedMode
  }), [selectedProduct, quote, holding, selectedMode]);

  const searchProducts = async (event) => {
    event.preventDefault();
    const keyword = query.trim();
    setMessage('');
    setCopiedTarget('');
    if (keyword.length < 2) {
      setMessage('종목명이나 코드를 2글자 이상 입력하세요.');
      return;
    }

    setLoading(true);
    try {
      const rows = await portfolioAPI.searchProducts(keyword);
      setResults(rows);
      const normalizedKeyword = normalizeText(keyword);
      const exactMatch = rows.find((product) => (
        normalizeText(product.code) === normalizedKeyword || normalizeText(product.name) === normalizedKeyword
      ));

      if (rows.length === 1 || exactMatch) {
        await selectProduct(exactMatch || rows[0]);
      }

      if (rows.length === 0) {
        setMessage('검색 결과가 없습니다. 표준 코드나 다른 이름으로 다시 검색해보세요.');
      }
    } catch (err) {
      setMessage(err.message || '종목 검색에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const loadQuote = async (product) => {
    setQuote(null);
    setQuoteLoading(true);
    try {
      const data = await portfolioAPI.getProductQuote(product.code);
      setQuote(data);
    } catch (err) {
      setMessage('현재가 스냅샷을 잠시 불러오지 못했습니다. 종목 정보와 보유 현황 기준으로 레포트를 먼저 확인하세요.');
    } finally {
      setQuoteLoading(false);
    }
  };

  const selectProduct = async (product) => {
    setMessage('');
    setSelectedProduct(product);
    setQuery(product.name);
    setCopiedTarget('');
    await loadQuote(product);
  };

  const copyText = async (value, target) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedTarget(target);
    } catch (err) {
      setMessage('브라우저에서 자동 복사를 허용하지 않았습니다. 직접 선택해 복사하세요.');
    }
  };

  return (
    <section className="stock-research-panel">
      <div className="stock-research-header">
        <div>
          <h2>종목 정보</h2>
          <p>종목을 검색하면 시세 스냅샷과 계좌 기준 분석 레포트를 바로 확인할 수 있습니다.</p>
        </div>
      </div>

      <form className="stock-search-form" onSubmit={searchProducts}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="예: 삼성전자, KODEX 200, 069500"
        />
        <button type="submit" disabled={loading}>{loading ? '검색 중' : '검색'}</button>
      </form>

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
            {quoteLoading && <em>현재가 확인 중</em>}
          </div>

          <div className="stock-snapshot-grid">
            <div>
              <span>현재가</span>
              <strong>{formatNumber(quote?.price)}</strong>
              <small>{quote?.price_date || '날짜 미확인'}</small>
            </div>
            <div>
              <span>52주 고가</span>
              <strong>{formatNumber(quote?.high_52w)}</strong>
            </div>
            <div>
              <span>52주 저가</span>
              <strong>{formatNumber(quote?.low_52w)}</strong>
            </div>
            <div>
              <span>1년 수익률</span>
              <strong>{formatPercent(quote?.one_year_return_rate)}</strong>
            </div>
          </div>

          {holding && (
            <div className="stock-holding-note">
              <strong>대장 보유 중</strong>
              <span>평균 {formatNumber(holding.purchase_price)} · 현재 {formatNumber(holding.current_price)} · 수익률 {formatPercent(holding.profit_rate)}</span>
            </div>
          )}

          <div className="analysis-mode-row">
            {ANALYSIS_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                className={analysisMode === mode.value ? 'active' : ''}
                onClick={() => setAnalysisMode(mode.value)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {analysisReport && (
            <div className="analysis-report-card">
              <div className="analysis-report-header">
                <div>
                  <span>분석 레포트</span>
                  <strong>{analysisReport.title}</strong>
                </div>
                <button type="button" className="analysis-secondary-button" onClick={() => copyText(buildReportText(analysisReport), 'report')}>
                  {copiedTarget === 'report' ? '레포트 복사됨' : '레포트 복사'}
                </button>
              </div>
              <p className="analysis-report-summary">{analysisReport.summary}</p>
              <div className="analysis-report-grid">
                <section className="analysis-report-section">
                  <h3>확인된 데이터</h3>
                  <ul>
                    {analysisReport.facts.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </section>
                <section className="analysis-report-section">
                  <h3>해석</h3>
                  <ul>
                    {analysisReport.insights.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </section>
                <section className="analysis-report-section">
                  <h3>대장 기준</h3>
                  <ul>
                    {analysisReport.accountView.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </section>
                <section className="analysis-report-section">
                  <h3>다음 확인</h3>
                  <ul>
                    {analysisReport.nextChecks.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </section>
              </div>
            </div>
          )}

          <textarea className="analysis-prompt-box" value={analysisPrompt} readOnly rows="12" />
          <div className="analysis-actions">
            <button type="button" onClick={() => copyText(analysisPrompt, 'prompt')}>
              {copiedTarget === 'prompt' ? '프롬프트 복사됨' : '프롬프트 복사'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default StockResearchPanel;
