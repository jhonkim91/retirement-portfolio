import React, { useMemo, useState } from 'react';
import { portfolioAPI } from '../utils/api';

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

const formatPercent = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  return `${Number(value).toFixed(2)}%`;
};

const sameText = (left, right) => String(left || '').trim().toUpperCase() === String(right || '').trim().toUpperCase();

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

function StockResearchPanel({ products = [], onUseProduct }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [analysisMode, setAnalysisMode] = useState(ANALYSIS_MODES[0].value);
  const [copied, setCopied] = useState(false);

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

  const searchProducts = async (event) => {
    event.preventDefault();
    const keyword = query.trim();
    setMessage('');
    setCopied(false);
    if (keyword.length < 2) {
      setMessage('종목명이나 코드를 2글자 이상 입력하세요.');
      return;
    }

    setLoading(true);
    try {
      const rows = await portfolioAPI.searchProducts(keyword);
      setResults(rows);
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
      setMessage(err.message || '현재가 스냅샷을 불러오지 못했습니다. 분석 프롬프트에서 웹 검색으로 확인하세요.');
    } finally {
      setQuoteLoading(false);
    }
  };

  const selectProduct = async (product) => {
    setSelectedProduct(product);
    setQuery(product.name);
    setCopied(false);
    await loadQuote(product);
  };

  const copyPrompt = async () => {
    if (!analysisPrompt) return;
    try {
      await navigator.clipboard.writeText(analysisPrompt);
      setCopied(true);
    } catch (err) {
      setMessage('브라우저에서 자동 복사를 허용하지 않았습니다. 프롬프트를 직접 선택해 복사하세요.');
    }
  };

  return (
    <section className="stock-research-panel">
      <div className="stock-research-header">
        <div>
          <h2>종목 정보</h2>
          <p>종목을 찾고, 퇴직연금 대장 기준으로 분석 프롬프트를 만듭니다.</p>
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
              <button type="button" className="stock-use-button" onClick={() => onUseProduct?.(product)}>
                대장 입력
              </button>
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

          <textarea className="analysis-prompt-box" value={analysisPrompt} readOnly rows="12" />
          <div className="analysis-actions">
            <button type="button" onClick={copyPrompt}>{copied ? '복사됨' : '프롬프트 복사'}</button>
          </div>
        </div>
      )}
    </section>
  );
}

export default StockResearchPanel;
