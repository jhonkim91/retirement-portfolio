const API_BASE_URL = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname || 'localhost'}:5000/api`;

const getToken = () => localStorage.getItem('access_token');

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
  getSummary: () => apiCall('/portfolio/summary'),
  getProducts: () => apiCall('/portfolio/products'),
  getAllProducts: () => apiCall('/portfolio/all-products'),
  getTrends: () => apiCall('/portfolio/trends'),
  syncPrices: () => apiCall('/portfolio/sync-prices', 'POST'),
  getCash: () => apiCall('/cash'),
  updateCash: (amount) => apiCall('/cash', 'PUT', { amount }),
  addProduct: (productData) => apiCall('/products', 'POST', productData),
  sellProduct: (productId, saleData) => apiCall(`/products/${productId}/sell`, 'PUT', saleData),
  updatePrice: (productId, price) => apiCall(`/products/${productId}/update-price`, 'PUT', { price }),
  getPriceHistory: (productId) => apiCall(`/products/${productId}/price-history`)
};

export const tradeLogAPI = {
  getLogs: (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.tradeType && filters.tradeType !== 'all') params.append('trade_type', filters.tradeType);
    if (filters.assetType && filters.assetType !== 'all') params.append('asset_type', filters.assetType);
    const query = params.toString();
    return apiCall(`/trade-logs${query ? `?${query}` : ''}`);
  }
};
