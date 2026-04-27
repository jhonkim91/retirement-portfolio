import { DEFAULT_ACCOUNT_NAME, readStoredAccountName } from '../../utils/api';

const BENCHMARK_STORAGE_KEY = 'analytics_benchmark_selection';

const getStoredUserScope = () => {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user?.id || user?.username || 'default';
  } catch (error) {
    return 'default';
  }
};

const getScopedBenchmarkKey = (accountName) => {
  const scope = getStoredUserScope();
  const normalizedAccountName = accountName || readStoredAccountName() || DEFAULT_ACCOUNT_NAME;
  return `${BENCHMARK_STORAGE_KEY}:${scope}:${normalizedAccountName}`;
};

export const getBenchmarkPresetOptions = (accountType = 'retirement') => {
  const common = [
    { code: '069500', name: 'KODEX 200', source: 'preset' },
    { code: '229200', name: 'KODEX 코스닥150', source: 'preset' },
    { code: '360750', name: 'TIGER 미국S&P500', source: 'preset' }
  ];

  if (accountType === 'brokerage') {
    return [
      ...common,
      { code: '133690', name: 'TIGER 미국나스닥100', source: 'preset' }
    ];
  }

  return [
    ...common,
    { code: '148070', name: 'KOSEF 국고채10년', source: 'preset' }
  ];
};

export const readStoredBenchmarkSelection = (accountName, accountType = 'retirement') => {
  const presets = getBenchmarkPresetOptions(accountType);
  try {
    const raw = localStorage.getItem(getScopedBenchmarkKey(accountName));
    if (!raw) return presets[0];
    const parsed = JSON.parse(raw);
    if (!parsed?.code || !parsed?.name) return presets[0];
    return {
      code: String(parsed.code),
      name: String(parsed.name),
      source: String(parsed.source || 'custom')
    };
  } catch (error) {
    return presets[0];
  }
};

export const writeStoredBenchmarkSelection = (accountName, selection) => {
  const nextSelection = {
    code: String(selection?.code || ''),
    name: String(selection?.name || ''),
    source: String(selection?.source || 'custom')
  };
  localStorage.setItem(getScopedBenchmarkKey(accountName), JSON.stringify(nextSelection));
  return nextSelection;
};
