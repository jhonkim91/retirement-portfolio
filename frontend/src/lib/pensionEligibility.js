export const ACCOUNT_CATEGORY_LABELS = {
  taxable: '일반과세',
  pension_savings: '연금저축',
  irp: 'IRP',
  dc: 'DC',
  db_reference: 'DB 참조'
};

export const INSTRUMENT_CLASS_LABELS = {
  principal_protected: '원리금보장형',
  pension_eligible_fund: '연금 적격 펀드',
  pension_eligible_etf: '연금 적격 ETF',
  tdf: 'TDF',
  prohibited_for_pension: '연금 비적격',
  unknown: '판정 보류'
};

const ETF_BRANDS = [
  'KODEX', 'TIGER', 'KOSEF', 'KBSTAR', 'HANARO', 'ARIRANG', 'SOL',
  'ACE', 'PLUS', 'RISE', 'KIWOOM', 'TIMEFOLIO', 'WOORI', 'TREX', 'UNICORN', 'ETF'
];
const BLOCKED_KEYWORDS = ['레버리지', '인버스', '곱버스', '사모', 'ELS', 'DLS', '선물', '원유', '비트코인', '코인'];
const PRINCIPAL_PROTECTED_KEYWORDS = ['원리금', '예금', '정기예금', 'RP', 'MMF', 'CMA'];
const TDF_KEYWORDS = ['TDF', 'TARGET DATE', '타깃데이트'];

const normalizeText = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');

const isKrxCode = (code) => /^[0-9A-Z]{6}$/.test(String(code || '').trim().toUpperCase());
const isFundCode = (code) => /^(K[A-Z0-9]{11}|KR[A-Z0-9]{10})$/.test(String(code || '').trim().toUpperCase());

const hasKeyword = (name, keywords) => keywords.some((keyword) => normalizeText(name).includes(normalizeText(keyword)));
const isEtfLikeName = (name) => ETF_BRANDS.some((keyword) => normalizeText(name).includes(normalizeText(keyword)));

const numeric = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const positionAmount = (product) => {
  const currentValue = numeric(product?.current_value);
  if (currentValue > 0) return currentValue;
  const purchaseValue = numeric(product?.total_purchase_value);
  if (purchaseValue > 0) return purchaseValue;
  return numeric(product?.purchase_price) * numeric(product?.quantity);
};

export const classifyInstrument = (product = {}) => {
  const name = String(product.product_name || product.name || '').trim();
  const code = String(product.product_code || product.code || '').trim().toUpperCase();
  const unitType = String(product.unit_type || product.unitType || '').trim().toLowerCase();
  const assetType = String(product.asset_type || product.assetType || '').trim().toLowerCase();

  if (!name && !code) {
    return {
      classification: 'unknown',
      riskBucket: assetType === 'safe' ? 'safe' : 'risk',
      reasons: ['상품명 또는 코드가 없어 적격성을 아직 판정할 수 없습니다.']
    };
  }

  if (hasKeyword(name, BLOCKED_KEYWORDS)) {
    return {
      classification: 'prohibited_for_pension',
      riskBucket: 'risk',
      reasons: ['레버리지·인버스·사모·파생형 성격으로 보여 연금 계좌 편입 대상에서 제외합니다.']
    };
  }

  if (hasKeyword(name, PRINCIPAL_PROTECTED_KEYWORDS)) {
    return {
      classification: 'principal_protected',
      riskBucket: 'safe',
      reasons: ['원리금보장형 또는 현금성 상품으로 분류했습니다.']
    };
  }

  if (hasKeyword(name, TDF_KEYWORDS)) {
    return {
      classification: 'tdf',
      riskBucket: 'risk',
      reasons: ['타깃데이트펀드(TDF)로 분류했습니다.']
    };
  }

  if (isFundCode(code) || unitType === 'unit') {
    return {
      classification: 'pension_eligible_fund',
      riskBucket: assetType === 'safe' ? 'safe' : 'risk',
      reasons: ['펀드 표준코드 또는 좌수형 상품으로 보여 연금 적격 펀드로 분류했습니다.']
    };
  }

  if (isKrxCode(code) && isEtfLikeName(name)) {
    return {
      classification: 'pension_eligible_etf',
      riskBucket: assetType === 'safe' ? 'safe' : 'risk',
      reasons: ['국내 ETF 명칭 규칙에 맞는 상품으로 보여 연금 적격 ETF로 분류했습니다.']
    };
  }

  if (isKrxCode(code)) {
    return {
      classification: 'prohibited_for_pension',
      riskBucket: 'risk',
      reasons: ['개별 주식 또는 연금 비적격 상장자산으로 판단해 연금 계좌 기본 추천 대상에서 제외합니다.']
    };
  }

  return {
    classification: 'unknown',
    riskBucket: assetType === 'safe' ? 'safe' : 'risk',
    reasons: ['상품 성격을 확정할 근거가 부족해 수동 검토가 필요합니다.']
  };
};

export const calculateRiskShare = ({ products = [], cashAmount = 0, candidate = null } = {}) => {
  const rows = [...products];
  if (candidate) rows.push(candidate);

  let riskAmount = 0;
  let totalAmount = 0;

  rows.forEach((product) => {
    const amount = positionAmount(product);
    if (amount <= 0) return;
    totalAmount += amount;
    const classification = classifyInstrument(product);
    if ((product.asset_type || product.assetType) === 'risk' || classification.riskBucket === 'risk') {
      riskAmount += amount;
    }
  });

  const normalizedCash = numeric(cashAmount);
  totalAmount += normalizedCash;
  return {
    riskAmount,
    totalAmount,
    riskShare: totalAmount > 0 ? (riskAmount / totalAmount) * 100 : 0
  };
};

export const evaluateProductEligibility = ({
  accountType = 'retirement',
  accountCategory = 'irp',
  product = {},
  holdings = [],
  cashAmount = 0
} = {}) => {
  const normalizedAccountType = String(accountType || 'retirement').toLowerCase();
  const normalizedAccountCategory = normalizedAccountType === 'brokerage'
    ? 'taxable'
    : String(accountCategory || 'irp').toLowerCase();
  const classification = classifyInstrument(product);
  const reasons = [...classification.reasons];
  const { riskShare } = calculateRiskShare({
    products: holdings,
    cashAmount,
    candidate: positionAmount(product) > 0 ? product : null
  });

  if (normalizedAccountType === 'brokerage') {
    return {
      status: 'allowed',
      classification: classification.classification,
      label: INSTRUMENT_CLASS_LABELS[classification.classification],
      reasons,
      riskShare,
      accountCategory: normalizedAccountCategory
    };
  }

  let status = 'allowed';
  if (classification.classification === 'prohibited_for_pension') {
    status = 'blocked';
  } else if (classification.classification === 'unknown') {
    status = 'warn';
  }

  if (status !== 'blocked' && ['irp', 'dc'].includes(normalizedAccountCategory) && classification.riskBucket === 'risk' && riskShare > 70) {
    status = 'warn';
    reasons.push(`현재 위험자산 비중이 ${riskShare.toFixed(1)}%로 IRP/DC 70% 가이드에 근접하거나 초과할 수 있습니다.`);
  }

  if (status === 'allowed' && classification.classification === 'principal_protected') {
    reasons.push('원리금보장형으로 분류돼 연금 계좌의 안전자산 축에 배치하기 좋습니다.');
  }

  return {
    status,
    classification: classification.classification,
    label: INSTRUMENT_CLASS_LABELS[classification.classification],
    reasons,
    riskShare,
    accountCategory: normalizedAccountCategory
  };
};

export const summarizeRetirementEligibility = ({
  products = [],
  accountType = 'retirement',
  accountCategory = 'irp',
  cashAmount = 0
} = {}) => {
  if (String(accountType || 'retirement').toLowerCase() === 'brokerage') {
    return null;
  }

  const entries = products.map((product) => ({
    product,
    ...evaluateProductEligibility({
      accountType,
      accountCategory,
      product,
      holdings: products,
      cashAmount
    })
  }));

  const blocked = entries.filter((item) => item.status === 'blocked');
  const warnings = entries.filter((item) => item.status === 'warn');
  const allowed = entries.filter((item) => item.status === 'allowed');
  const riskSummary = calculateRiskShare({ products, cashAmount });
  const normalizedCategory = String(accountCategory || 'irp').toLowerCase();

  return {
    accountCategory: normalizedCategory,
    accountCategoryLabel: ACCOUNT_CATEGORY_LABELS[normalizedCategory] || '퇴직연금',
    riskShare: riskSummary.riskShare,
    blockedCount: blocked.length,
    warningCount: warnings.length,
    allowedCount: allowed.length,
    entries,
    rules: [
      {
        label: '연금 비적격 상품',
        passed: blocked.length === 0,
        detail: blocked.length === 0 ? '현재 차단 판정 상품이 없습니다.' : `${blocked.length}개 상품이 연금 비적격으로 분류됐습니다.`
      },
      {
        label: '위험자산 70% 가이드',
        passed: !['irp', 'dc'].includes(normalizedCategory) || riskSummary.riskShare <= 70,
        detail: `${riskSummary.riskShare.toFixed(1)}%`
      },
      {
        label: '판정 보류 상품',
        passed: warnings.length === 0,
        detail: warnings.length === 0 ? '판정 보류 상품이 없습니다.' : `${warnings.length}개 상품은 수동 검토가 필요합니다.`
      }
    ]
  };
};
