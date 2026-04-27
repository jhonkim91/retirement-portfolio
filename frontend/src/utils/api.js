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
export const readStoredAccountName = () => localStorage.getItem(getScopedAccountStorageKey()) || DEFAULT_ACCOUNT_NAME;
export const writeStoredAccountName = (accountName) => {
  const nextValue = accountName || DEFAULT_ACCOUNT_NAME;
  localStorage.setItem(getScopedAccountStorageKey(), nextValue);
  localStorage.removeItem(ACCOUNT_STORAGE_KEY);
};
export const clearStoredAccountName = () => {
  localStorage.removeItem(getScopedAccountStorageKey());
  localStorage.removeItem(ACCOUNT_STORAGE_KEY);
};

const getToken = () => localStorage.getItem('access_token');
export const accountNameOrDefault = (accountName) => accountName || readStoredAccountName() || DEFAULT_ACCOUNT_NAME;
const accountQuery = (accountName) => `account_name=${encodeURIComponent(accountNameOrDefault(accountName))}`;

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
    throw new Error(data.error || '요청 처리에 실패했습니다.');
  }
  return data;
};

export const authAPI = {
  register: (username, email, password) => apiCall('/auth/register', 'POST', { username, email, password }),
  login: (username, password) => apiCall('/auth/login', 'POST', { username, password })
};

export const portfolioAPI = {
  getAccounts: () => apiCall('/accounts'),
  addAccount: (accountName, accountType = 'retirement') => apiCall('/accounts', 'POST', {
    account_name: accountName,
    account_type: accountType
  }),
  renameAccount: (currentAccountName, nextAccountName) => apiCall(`/accounts/${encodeURIComponent(currentAccountName)}`, 'PUT', {
    account_name: nextAccountName
  }),
  deleteAccount: (accountName) => apiCall(`/accounts/${encodeURIComponent(accountName)}`, 'DELETE'),
  getSummary: (accountName) => apiCall(`/portfolio/summary?${accountQuery(accountName)}`),
  getProducts: (accountName) => apiCall(`/portfolio/products?${accountQuery(accountName)}`),
  getAllProducts: (accountName) => apiCall(`/portfolio/all-products?${accountQuery(accountName)}`),
  getTrends: (accountName) => apiCall(`/portfolio/trends?${accountQuery(accountName)}`),
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
  getPriceHistory: (productId) => apiCall(`/products/${productId}/price-history`)
};

export const tradeLogAPI = {
  getRealizedSummary: (accountName) => apiCall(`/trade-logs/realized-summary?${accountQuery(accountName)}`),
  updateLog: (logId, logData) => apiCall(`/trade-logs/${logId}`, 'PUT', logData),
  getLogs: (filters = {}) => {
    const params = new URLSearchParams();
    params.append('account_name', accountNameOrDefault(filters.accountName));
    if (filters.tradeType && filters.tradeType !== 'all') params.append('trade_type', filters.tradeType);
    if (filters.assetType && filters.assetType !== 'all') params.append('asset_type', filters.assetType);
    const query = params.toString();
    return apiCall(`/trade-logs${query ? `?${query}` : ''}`);
  }
};
