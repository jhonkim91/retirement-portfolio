const FRESHNESS_POLICIES = {
  realtime: {
    key: 'realtime',
    label: '실시간',
    tone: 'live',
    description: '실시간 또는 거의 실시간에 가까운 시세입니다.'
  },
  delayed_20m: {
    key: 'delayed_20m',
    label: '20분 지연',
    tone: 'delay',
    description: '거래소 시세 기준이며 장중 최대 20분 정도 지연될 수 있습니다.'
  },
  end_of_day: {
    key: 'end_of_day',
    label: '일별 마감',
    tone: 'daily',
    description: '일별 종가 또는 기준가 기준입니다.'
  },
  monthly: {
    key: 'monthly',
    label: '월간 확정',
    tone: 'monthly',
    description: '월간 공시 또는 월말 기준 데이터입니다.'
  },
  annual: {
    key: 'annual',
    label: '연간 공시',
    tone: 'annual',
    description: '연 단위 공시 기반 데이터입니다.'
  },
  filing_event: {
    key: 'filing_event',
    label: '공시 이벤트',
    tone: 'filing',
    description: '공시 제출 시점에 반영되는 이벤트 데이터입니다.'
  },
  internal_ledger: {
    key: 'internal_ledger',
    label: '내부 대장',
    tone: 'ledger',
    description: '사용자 입력 기반 대장 데이터입니다.'
  }
};

const SOURCE_REGISTRY = {
  kis: {
    id: 'kis',
    name: 'KIS',
    category: 'market',
    freshnessClass: 'realtime',
    citationText: 'KIS 실시간 시세'
  },
  kiwoom: {
    id: 'kiwoom',
    name: 'Kiwoom',
    category: 'market',
    freshnessClass: 'realtime',
    citationText: '키움 시세'
  },
  krx: {
    id: 'krx',
    name: 'KRX',
    category: 'market',
    freshnessClass: 'delayed_20m',
    citationText: '거래소 기준 시세'
  },
  manual: {
    id: 'manual',
    name: '수기 입력',
    category: 'ledger',
    freshnessClass: 'end_of_day',
    citationText: '수동 입력 기준'
  },
  naver: {
    id: 'naver',
    name: 'Naver 금융',
    category: 'market',
    freshnessClass: 'delayed_20m',
    citationText: '네이버 금융 시세/종목 검색'
  },
  yahoo: {
    id: 'yahoo',
    name: 'Yahoo Finance',
    category: 'market',
    freshnessClass: 'end_of_day',
    citationText: 'Yahoo Finance 일별 시세'
  },
  funetf: {
    id: 'funetf',
    name: 'FunETF',
    category: 'fund',
    freshnessClass: 'end_of_day',
    citationText: 'FunETF 펀드 기준가'
  },
  holding: {
    id: 'holding',
    name: '보유 대장',
    category: 'ledger',
    freshnessClass: 'internal_ledger',
    citationText: '계좌 보유 데이터'
  },
  portfolio_ledger: {
    id: 'portfolio_ledger',
    name: '자산관리 대장',
    category: 'ledger',
    freshnessClass: 'internal_ledger',
    citationText: '사용자 입력 기반 자산 대장'
  },
  trade_log: {
    id: 'trade_log',
    name: '매매일지',
    category: 'ledger',
    freshnessClass: 'internal_ledger',
    citationText: '매매일지 이벤트 기록'
  },
  screener: {
    id: 'screener',
    name: '스크리너',
    category: 'derived',
    freshnessClass: 'end_of_day',
    citationText: '대표 종목군 스크리닝 결과'
  },
  opendart: {
    id: 'opendart',
    name: 'Open DART',
    category: 'filing',
    freshnessClass: 'filing_event',
    citationText: '전자공시 시스템 원문 공시'
  }
};

const LATENCY_TO_FRESHNESS = {
  realtime: 'realtime',
  delayed: 'delayed_20m',
  eod: 'end_of_day',
  filing: 'filing_event'
};

const normalizeSourceKey = (value) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
);

export const inferSourceKeyFromCode = (code) => {
  const normalized = String(code || '').trim().toUpperCase();
  if (/^(K[A-Z0-9]{11}|KR[A-Z0-9]{10})$/.test(normalized)) return 'funetf';
  if (/^[0-9A-Z]{6}$/.test(normalized)) return 'naver';
  return 'yahoo';
};

export const resolveSourceDescriptor = (source, overrides = {}) => {
  const sourceKey = normalizeSourceKey(source);
  const fallbackKey = overrides.code ? inferSourceKeyFromCode(overrides.code) : 'portfolio_ledger';
  const descriptor = SOURCE_REGISTRY[sourceKey] || SOURCE_REGISTRY[fallbackKey] || SOURCE_REGISTRY.portfolio_ledger;
  const freshnessClass = overrides.freshnessClass || descriptor.freshnessClass;
  return {
    ...descriptor,
    freshnessClass,
    delayPolicy: overrides.delayPolicy || FRESHNESS_POLICIES[freshnessClass]?.description || descriptor.delayPolicy || '',
    asOf: overrides.asOf || '',
    note: overrides.note || '',
    citationText: overrides.citationText || descriptor.citationText || ''
  };
};

export const formatAsOfLabel = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.includes('T') ? raw.replace('T', ' ').replace(/:\d{2}\.\d+$/, '') : raw;
};

export const buildDataBadgeDescriptor = ({
  source,
  asOf,
  freshnessClass,
  delayPolicy,
  citationText,
  note,
  code,
  provenance
} = {}) => {
  const mappedFreshnessFromProvenance = provenance
    ? LATENCY_TO_FRESHNESS[provenance.latencyClass]
    : '';
  const resolved = resolveSourceDescriptor(source || provenance?.source, {
    asOf: asOf || (provenance?.asOf || ''),
    freshnessClass: freshnessClass || mappedFreshnessFromProvenance,
    delayPolicy,
    citationText,
    note: note || (provenance?.reconciled ? '정합성 검증 완료' : ''),
    code
  });
  return {
    ...resolved,
    freshness: FRESHNESS_POLICIES[resolved.freshnessClass] || FRESHNESS_POLICIES.end_of_day,
    asOfLabel: formatAsOfLabel(resolved.asOf)
  };
};

export const buildDataBadgeDescriptorFromProvenance = (provenance, extras = {}) => {
  if (!provenance || typeof provenance !== 'object') {
    return buildDataBadgeDescriptor(extras);
  }
  const mappedFreshness = LATENCY_TO_FRESHNESS[provenance.latencyClass] || extras.freshnessClass;
  return buildDataBadgeDescriptor({
    source: provenance.source || extras.source,
    asOf: provenance.asOf || extras.asOf,
    freshnessClass: mappedFreshness,
    note: provenance.reconciled ? '정합성 검증 완료' : extras.note,
    ...extras
  });
};

export const buildFreshnessMixWarning = (items = []) => {
  const descriptors = items
    .map((item) => (item?.freshness ? item : buildDataBadgeDescriptor(item)))
    .filter(Boolean);
  const classes = [...new Set(descriptors.map((item) => item.freshnessClass).filter(Boolean))];
  if (classes.length <= 1) return '';

  if (classes.includes('delayed_20m') && classes.includes('end_of_day')) {
    return '장중 지연 시세와 일별 기준가가 함께 섞여 있어, 같은 시점 비교로 보기에는 무리가 있습니다.';
  }
  if (classes.includes('internal_ledger') && classes.some((item) => item !== 'internal_ledger')) {
    return '사용자 입력 대장과 외부 시세가 함께 표시됩니다. 입력 시점과 외부 기준 시각을 같이 확인하세요.';
  }
  if (classes.includes('monthly') || classes.includes('annual') || classes.includes('filing_event')) {
    return '업데이트 주기가 다른 데이터가 함께 표시됩니다. 카드별 기준 시각과 공시 주기를 같이 확인하세요.';
  }
  return '서로 다른 업데이트 주기의 데이터가 함께 표시되고 있습니다. 출처와 기준 시각을 함께 확인하세요.';
};

export { FRESHNESS_POLICIES, SOURCE_REGISTRY };
