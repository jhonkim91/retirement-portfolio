const isDevelopment = process.env.NODE_ENV === 'development';
const currentHost = window.location.hostname || 'localhost';
const currentPort = isDevelopment ? 5000 : window.location.port;
const baseUrlPort = currentPort ? `:${currentPort}` : '';
const API_BASE_URL = process.env.REACT_APP_API_URL || `${window.location.protocol}//${currentHost}${baseUrlPort}/api`;

export const DEFAULT_ACCOUNT_NAME = '퇴직연금';
export const ACCOUNT_STORAGE_KEY = 'selected_account_name';

const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}');
  } catch (error) {
    return {};
  }
};

const getAccountStorageScope = () => {
  const user = getStoredUser();
  return user?.id || user?.username || 'default';
};

export const getScopedAccountStorageKey = () => `${ACCOUNT_STORAGE_KEY}:${getAccountStorageScope()}`;
export const readExplicitStoredAccountName = () => (
  localStorage.getItem(getScopedAccountStorageKey())
  || localStorage.getItem(ACCOUNT_STORAGE_KEY)
  || ''
);
export const readStoredAccountName = () => readExplicitStoredAccountName() || DEFAULT_ACCOUNT_NAME;
export const writeStoredAccountName = (accountName) => {
  const nextValue = accountName || DEFAULT_ACCOUNT_NAME;
  localStorage.setItem(getScopedAccountStorageKey(), nextValue);
  localStorage.removeItem(ACCOUNT_STORAGE_KEY);
};
export const clearStoredAccountName = () => {
  localStorage.removeItem(getScopedAccountStorageKey());
  localStorage.removeItem(ACCOUNT_STORAGE_KEY);
};

const normalizeAccountProfiles = (profiles) => (
  Array.isArray(profiles)
    ? profiles.filter((profile) => profile && profile.account_name)
    : []
);

export const findAccountProfile = (profiles, accountName) => (
  normalizeAccountProfiles(profiles).find((profile) => profile.account_name === accountName) || null
);

export const pickInitialAccountProfile = (
  profiles,
  storedAccountName = readExplicitStoredAccountName()
) => {
  const normalizedProfiles = normalizeAccountProfiles(profiles);
  if (normalizedProfiles.length === 0) return null;

  const storedMatch = findAccountProfile(normalizedProfiles, storedAccountName);
  if (storedMatch) return storedMatch;

  const defaultWithData = normalizedProfiles.find((profile) => profile.is_default && profile.has_data);
  if (defaultWithData) return defaultWithData;

  const cleanDataProfile = normalizedProfiles.find((profile) => profile.has_data && !profile.has_name_issue);
  if (cleanDataProfile) return cleanDataProfile;

  const anyDataProfile = normalizedProfiles.find((profile) => profile.has_data);
  if (anyDataProfile) return anyDataProfile;

  const cleanDefaultProfile = normalizedProfiles.find((profile) => profile.is_default && !profile.has_name_issue);
  if (cleanDefaultProfile) return cleanDefaultProfile;

  return normalizedProfiles.find((profile) => profile.is_default)
    || normalizedProfiles.find((profile) => !profile.has_name_issue)
    || normalizedProfiles[0];
};

const getToken = () => localStorage.getItem('access_token');
export const accountNameOrDefault = (accountName) => accountName || readStoredAccountName() || DEFAULT_ACCOUNT_NAME;
const accountQuery = (accountName) => `account_name=${encodeURIComponent(accountNameOrDefault(accountName))}`;

const downloadApiFile = async (endpoint, fallbackFilename) => {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${endpoint}`, { headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || '파일 다운로드에 실패했습니다.');
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get('Content-Disposition') || '';
  const matched = contentDisposition.match(/filename="?([^";]+)"?/i);
  const filename = matched?.[1] || fallbackFilename;
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(objectUrl);
};

const apiCall = async (endpoint, method = 'GET', body = null) => {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && endpoint !== '/auth/login') {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    clearStoredAccountName();
    window.location.href = '/login';
  }
  if (!response.ok) {
    const error = new Error(data.error || '요청 처리에 실패했습니다.');
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
};
export const __internal = { apiCall };

const multipartApiCall = async (endpoint, formData) => {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: formData
  });

  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    clearStoredAccountName();
    window.location.href = '/login';
  }
  if (!response.ok) {
    const error = new Error(data.error || '요청 처리에 실패했습니다.');
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
};

export const authAPI = {
  register: (username, email, password) => apiCall('/auth/register', 'POST', { username, email, password }),
  login: (username, password) => apiCall('/auth/login', 'POST', { username, password })
};

export const portfolioAPI = {
  getAccounts: () => apiCall('/accounts'),
  addAccount: (accountName, accountType = 'retirement', accountCategory = '') => apiCall('/accounts', 'POST', {
    account_name: accountName,
    account_type: accountType,
    account_category: accountCategory
  }),
  renameAccount: (currentAccountName, nextAccountName) => apiCall(`/accounts/${encodeURIComponent(currentAccountName)}`, 'PUT', {
    account_name: nextAccountName
  }),
  deleteAccount: (accountName) => apiCall(`/accounts/${encodeURIComponent(accountName)}`, 'DELETE'),
  getSummary: (accountName) => apiCall(`/portfolio/summary?${accountQuery(accountName)}`),
  getProducts: (accountName) => apiCall(`/portfolio/products?${accountQuery(accountName)}`),
  getAllProducts: (accountName) => apiCall(`/portfolio/all-products?${accountQuery(accountName)}`),
  getTrends: (accountName, options = {}) => {
    const params = new URLSearchParams();
    params.append('account_name', accountNameOrDefault(accountName));
    if (options.includeSold) params.append('include_sold', '1');
    return apiCall(`/portfolio/trends?${params.toString()}`);
  },
  getDomainModel: (accountName, scope = 'account') => {
    const params = new URLSearchParams();
    params.append('scope', scope === 'all' ? 'all' : 'account');
    params.append('account_name', accountNameOrDefault(accountName));
    return apiCall(`/portfolio/domain-model?${params.toString()}`);
  },
  syncPrices: (accountName) => apiCall(`/portfolio/sync-prices?${accountQuery(accountName)}`, 'POST'),
  searchProducts: (query) => apiCall(`/products/search?q=${encodeURIComponent(query)}`),
  getProductQuote: (code) => apiCall(`/products/quote?code=${encodeURIComponent(code)}`),
  getProductAnalysisReport: (payload) => apiCall('/products/analysis-report', 'POST', payload),
  getCash: (accountName) => apiCall(`/cash?${accountQuery(accountName)}`),
  updateCash: (amount, accountName) => apiCall('/cash', 'PUT', { amount, account_name: accountNameOrDefault(accountName) }),
  addCashDeposit: (depositData, accountName) => apiCall('/cash/deposits', 'POST', { ...depositData, account_name: accountNameOrDefault(accountName) }),
  addProduct: (productData, accountName) => apiCall('/products', 'POST', { ...productData, account_name: accountNameOrDefault(accountName) }),
  updateProduct: (productId, productData) => apiCall(`/products/${productId}`, 'PUT', productData),
  addBuy: (productId, buyData) => apiCall(`/products/${productId}/buy`, 'POST', buyData),
  deleteProduct: (productId) => apiCall(`/products/${productId}/delete`, 'POST'),
  sellProduct: (productId, saleData) => apiCall(`/products/${productId}/sell`, 'PUT', saleData),
  updatePrice: (productId, price) => apiCall(`/products/${productId}/update-price`, 'PUT', { price }),
  getPriceHistory: (productId) => apiCall(`/products/${productId}/price-history`),
  getBenchmarkChart: (code, days = 320) => apiCall(`/screener/chart?code=${encodeURIComponent(code)}&days=${encodeURIComponent(days)}`)
};

export const resolveInitialAccountSelection = async () => {
  const response = await portfolioAPI.getAccounts();
  const accountProfiles = normalizeAccountProfiles(response?.account_profiles);
  const selectedAccountProfile = pickInitialAccountProfile(accountProfiles);
  const accountName = selectedAccountProfile?.account_name
    || response?.default_account_name
    || response?.accounts?.[0]
    || DEFAULT_ACCOUNT_NAME;
  writeStoredAccountName(accountName);
  return {
    accountName,
    accountProfiles,
    selectedAccountProfile: selectedAccountProfile || findAccountProfile(accountProfiles, accountName)
  };
};

export const tradeLogAPI = {
  getRealizedSummary: (accountName) => apiCall(`/trade-logs/realized-summary?${accountQuery(accountName)}`),
  updateLog: (logId, logData) => apiCall(`/trade-logs/${logId}`, 'PUT', logData),
  deleteLog: (logId) => apiCall(`/trade-logs/${logId}`, 'DELETE'),
  getAuditTrail: (accountName, limit = 80) => apiCall(`/trade-logs/audit?${accountQuery(accountName)}&limit=${encodeURIComponent(limit)}`),
  createRestoreDraft: (eventId, accountName) => apiCall(
    `/trade-logs/audit/${encodeURIComponent(eventId)}/restore-draft?${accountQuery(accountName)}`,
    'POST',
    {}
  ),
  applyRestoreDraft: (eventId, accountName) => apiCall(
    `/trade-logs/audit/${encodeURIComponent(eventId)}/restore-apply?${accountQuery(accountName)}`,
    'POST',
    {}
  ),
  getAuditTrailForLog: (logId) => apiCall(`/trade-logs/${logId}/audit`),
  downloadAuditTrail: (accountName, format = 'json') => downloadApiFile(
    `/trade-logs/audit/export?${accountQuery(accountName)}&format=${encodeURIComponent(format)}`,
    `${accountNameOrDefault(accountName)}-trade-audit.${format}`
  ),
  getLogs: (filters = {}) => {
    const params = new URLSearchParams();
    params.append('account_name', accountNameOrDefault(filters.accountName));
    if (filters.tradeType && filters.tradeType !== 'all') params.append('trade_type', filters.tradeType);
    if (filters.assetType && filters.assetType !== 'all') params.append('asset_type', filters.assetType);
    const query = params.toString();
    return apiCall(`/trade-logs${query ? `?${query}` : ''}`);
  },
  getJournals: (filters = {}) => {
    const params = new URLSearchParams();
    params.append('account_name', accountNameOrDefault(filters.accountName));
    if (filters.attachedTradeId) params.append('attached_trade_id', String(filters.attachedTradeId));
    if (filters.tag) params.append('tag', String(filters.tag));
    if (filters.q) params.append('q', String(filters.q));
    if (filters.dateFrom) params.append('date_from', String(filters.dateFrom));
    if (filters.dateTo) params.append('date_to', String(filters.dateTo));
    return apiCall(`/trade-journals?${params.toString()}`);
  },
  createJournal: (payload, accountName) => apiCall('/trade-journals', 'POST', {
    ...payload,
    account_name: accountNameOrDefault(accountName)
  }),
  updateJournal: (journalId, payload) => apiCall(`/trade-journals/${journalId}`, 'PUT', payload),
  deleteJournal: (journalId) => apiCall(`/trade-journals/${journalId}`, 'DELETE'),
  getCalendarEvents: (filters = {}) => {
    const params = new URLSearchParams();
    params.append('account_name', accountNameOrDefault(filters.accountName));
    if (filters.startDate) params.append('start_date', String(filters.startDate));
    if (filters.endDate) params.append('end_date', String(filters.endDate));
    if (filters.eventType && filters.eventType !== 'all') params.append('event_type', String(filters.eventType));
    if (filters.symbol) params.append('symbol', String(filters.symbol));
    return apiCall(`/calendar/events?${params.toString()}`);
  },
  createCalendarEvent: (payload, accountName) => apiCall('/calendar/events', 'POST', {
    ...payload,
    account_name: accountNameOrDefault(accountName)
  }),
  updateCalendarEvent: (eventId, payload) => apiCall(`/calendar/events/${eventId}`, 'PUT', payload),
  deleteCalendarEvent: (eventId) => apiCall(`/calendar/events/${eventId}`, 'DELETE')
};

export const screenerAPI = {
  scan: (payload) => apiCall('/screener/scan', 'POST', payload),
  getChart: (code, days = 120) => apiCall(`/screener/chart?code=${encodeURIComponent(code)}&days=${encodeURIComponent(days)}`),
  compare: (codes) => apiCall('/screener/compare', 'POST', { codes }),
  getScreens: () => apiCall('/screener/screens'),
  saveScreen: (payload) => apiCall('/screener/screens', 'POST', payload),
  deleteScreen: (screenId) => apiCall(`/screener/screens/${screenId}`, 'DELETE'),
  getDartProfile: (code) => apiCall(`/products/dart-profile?code=${encodeURIComponent(code)}`),
  getWatchItems: (accountName) => apiCall(`/screener/watch-items?${accountQuery(accountName)}`),
  addWatchItem: (payload, accountName) => apiCall('/screener/watch-items', 'POST', {
    ...payload,
    account_name: accountNameOrDefault(accountName)
  }),
  deleteWatchItem: (symbol, accountName) => apiCall(`/screener/watch-items/${encodeURIComponent(symbol)}?${accountQuery(accountName)}`, 'DELETE')
};

export const importAPI = {
  previewCsv: ({ file, sourceName = 'csv_upload', accountName }) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('source_name', sourceName);
    formData.append('account_name', accountNameOrDefault(accountName));
    return multipartApiCall('/imports/preview', formData);
  },
  commitPreview: (batchId, applyConflicts = false, options = {}) => apiCall('/imports/commit', 'POST', {
    batch_id: batchId,
    apply_conflicts: applyConflicts,
    conflict_row_indexes: options.conflictRowIndexes || [],
    row_mapping_overrides: options.rowMappingOverrides || {},
    expected_projection_signature: options.expectedProjectionSignature || '',
    strict_projection_check: options.strictProjectionCheck === true
  }),
  dryRunCommit: (batchId, applyConflicts = false, options = {}) => apiCall('/imports/dry-run', 'POST', {
    batch_id: batchId,
    apply_conflicts: applyConflicts,
    conflict_row_indexes: options.conflictRowIndexes || [],
    row_mapping_overrides: options.rowMappingOverrides || {}
  }),
  getImportBatches: (accountName, limit = 60) => apiCall(`/import-batches?${accountQuery(accountName)}&limit=${encodeURIComponent(limit)}`),
  getTradeSnapshots: (accountName, limit = 80) => apiCall(`/trade-snapshots?${accountQuery(accountName)}&limit=${encodeURIComponent(limit)}`),
  getReconciliationResults: (accountName, limit = 60) => apiCall(`/trade-logs/reconciliation?${accountQuery(accountName)}&limit=${encodeURIComponent(limit)}`),
  getLatestReconciliation: (accountName) => apiCall(`/reconciliation/latest?${accountQuery(accountName)}`),
  getMappingProducts: (accountName) => apiCall(`/portfolio/all-products?${accountQuery(accountName)}`),
  downloadTemplate: () => downloadApiFile('/imports/template', 'import-template.csv')
};

export const privacyAPI = {
  getPolicy: () => apiCall('/privacy/policy'),
  getContact: () => apiCall('/privacy/contact'),
  listDeletionRequests: () => apiCall('/privacy/deletion-requests'),
  createDeletionRequest: (mode, reason) => apiCall('/privacy/deletion-requests', 'POST', { mode, reason }),
  executeDeletionRequest: (requestId) => apiCall(`/privacy/deletion-requests/${requestId}/execute`, 'POST'),
  listSecurityAuditLogs: (limit = 120) => apiCall(`/security/audit-logs?limit=${encodeURIComponent(limit)}`)
};
