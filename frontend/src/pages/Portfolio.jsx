import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AccountSelector from '../components/AccountSelector';
import DataBadge from '../components/DataBadge';
import {
  ACCOUNT_CATEGORY_LABELS,
  evaluateProductEligibility,
  summarizeRetirementEligibility
} from '../lib/pensionEligibility';
import {
  buildDataBadgeDescriptor,
  buildFreshnessMixWarning
} from '../lib/sourceRegistry';
import useResolvedAccount from '../hooks/useResolvedAccount';
import { portfolioAPI } from '../utils/api';
import '../styles/Portfolio.css';

const emptyProductForm = (today) => ({
  product_name: '',
  product_code: '',
  purchase_price: '',
  quantity: '',
  unit_type: 'share',
  purchase_date: today,
  asset_type: 'risk',
  notes: ''
});

const PERIOD_UNIT_OPTIONS = [
  { value: 'year', label: '년' },
  { value: 'month', label: '개월' },
  { value: 'day', label: '일' }
];
const portfolioPrefillStorageKey = 'portfolio_prefill_product_v1';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toPositiveInteger = (value, fallback = 1) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const parseRecordDate = (value) => {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;
  return new Date(year, month - 1, day);
};

const formatDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getLocalToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const getLocalTodayKey = () => formatDateKey(getLocalToday());

const readPortfolioPrefillDraft = () => {
  try {
    return JSON.parse(localStorage.getItem(portfolioPrefillStorageKey) || 'null');
  } catch (error) {
    return null;
  }
};

const inferDraftUnitType = (draft = {}) => {
  const explicit = String(draft.unit_type || '').toLowerCase();
  if (explicit === 'unit') return 'unit';
  if (explicit === 'share') return 'share';
  const normalizedCode = String(draft.product_code || '').trim().toUpperCase();
  if (normalizedCode.startsWith('K') && normalizedCode.length >= 10) return 'unit';
  return 'share';
};

const buildPortfolioPrefillForm = ({ draft, accountType, fallbackDate }) => {
  const draftUnitType = inferDraftUnitType(draft);
  const parsedQty = Number(draft.quantity);
  const safeQty = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;
  const qtyByAccount = accountType === 'brokerage'
    ? String(Math.max(1, Math.round(safeQty)))
    : String(safeQty);
  const unitByAccount = accountType === 'brokerage' ? 'share' : draftUnitType;
  const assetByAccount = accountType === 'brokerage'
    ? 'risk'
    : String(draft.asset_type || 'risk');

  return {
    product_name: String(draft.product_name || ''),
    product_code: String(draft.product_code || ''),
    purchase_price: draft.purchase_price === null || draft.purchase_price === undefined ? '' : String(draft.purchase_price),
    quantity: qtyByAccount,
    unit_type: unitByAccount,
    purchase_date: String(draft.purchase_date || fallbackDate),
    asset_type: assetByAccount,
    notes: String(draft.notes || '')
  };
};

const addDateUnits = (date, amount, unit) => {
  if (unit === 'year') {
    const targetYear = date.getFullYear() + amount;
    const targetMonth = date.getMonth();
    const targetDay = Math.min(date.getDate(), new Date(targetYear, targetMonth + 1, 0).getDate());
    return new Date(targetYear, targetMonth, targetDay);
  }

  if (unit === 'month') {
    const targetMonth = new Date(date.getFullYear(), date.getMonth() + amount, 1);
    const targetDay = Math.min(date.getDate(), new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate());
    return new Date(targetMonth.getFullYear(), targetMonth.getMonth(), targetDay);
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
};

const differenceInDays = (endDate, startDate) => (
  Math.max(Math.floor((endDate.getTime() - startDate.getTime()) / MS_PER_DAY), 0)
);

const buildTrendTimeline = (startDate, endDate, intervalDays) => {
  if (!startDate || !endDate) return [];
  const pointCount = Math.max(Math.ceil((differenceInDays(endDate, startDate) + 1) / intervalDays), 1);
  return Array.from({ length: pointCount }, (_, index) => (
    addDateUnits(endDate, -index * intervalDays, 'day')
  )).sort((a, b) => a.getTime() - b.getTime());
};

const getPriceReturnRate = (row) => {
  if (row?.price_return_rate !== undefined && row?.price_return_rate !== null) {
    return Number(row.price_return_rate || 0);
  }

  const purchasePrice = Number(row?.purchase_price || 0);
  if (!purchasePrice) return 0;
  return (Number(row?.price || 0) - purchasePrice) / purchasePrice * 100;
};

const findLatestRowOnOrBefore = (rows, targetDate) => {
  const targetTime = targetDate.getTime();
  let latest = null;
  for (const row of rows) {
    const rowDate = parseRecordDate(row.record_date);
    if (!rowDate || rowDate.getTime() > targetTime) break;
    latest = row;
  }
  return latest;
};

const getEarlierDate = (first, second) => (
  first.getTime() <= second.getTime() ? first : second
);

const getMonthsBetween = (startDate, endDate) => {
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (addDateUnits(start, months, 'month').getTime() < end.getTime()) {
    months += 1;
  }
  return Math.max(months, 1);
};

const getSuggestedTrendRange = (startDate, endDate) => {
  const daySpan = Math.max(differenceInDays(endDate, startDate), 1);
  if (daySpan < 45) {
    return { amount: String(daySpan), unit: 'day' };
  }

  const monthSpan = getMonthsBetween(startDate, endDate);
  if (monthSpan < 24) {
    return { amount: String(monthSpan), unit: 'month' };
  }

  return { amount: String(Math.ceil(monthSpan / 12)), unit: 'year' };
};

function Portfolio() {
  const today = getLocalTodayKey();
  const {
    accountName,
    accountReady,
    changeAccountName: persistAccountName,
    selectedAccountProfile,
    syncAccountProfiles
  } = useResolvedAccount();
  const [accountType, setAccountType] = useState('retirement');
  const [accountCategory, setAccountCategory] = useState('irp');
  const [formData, setFormData] = useState(emptyProductForm(today));
  const [depositForm, setDepositForm] = useState({ amount: '', deposit_date: today, notes: '' });
  const [products, setProducts] = useState([]);
  const [trends, setTrends] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [depositLoading, setDepositLoading] = useState(false);
  const [priceInputs, setPriceInputs] = useState({});
  const [sellInputs, setSellInputs] = useState({});
  const [buyInputs, setBuyInputs] = useState({});
  const [editForms, setEditForms] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [activePanel, setActivePanel] = useState({ productId: null, mode: null });
  const [productSearchResults, setProductSearchResults] = useState([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [selectedProductName, setSelectedProductName] = useState('');
  const [selectedTrendProductIds, setSelectedTrendProductIds] = useState([]);
  const [trendRangeAmount, setTrendRangeAmount] = useState('1');
  const [trendRangeUnit, setTrendRangeUnit] = useState('month');
  const [trendIntervalAmount, setTrendIntervalAmount] = useState('1');
  const [incomingPrefillDraft, setIncomingPrefillDraft] = useState(null);
  const prefillAppliedRef = useRef(false);

  const loadData = useCallback(async () => {
    if (!accountReady) return;
    try {
      setLoading(true);
      const [productData, trendData] = await Promise.all([
        portfolioAPI.getProducts(accountName),
        portfolioAPI.getTrends(accountName)
      ]);
      setProducts(Array.isArray(productData) ? productData : []);
      setTrends(Array.isArray(trendData) ? trendData : []);
      setMessage('');
    } catch (error) {
      setMessage(error.message || '포트폴리오 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [accountName, accountReady]);

  useEffect(() => {
    if (!accountReady) return;
    loadData();
  }, [accountReady, loadData]);

  useEffect(() => {
    setAccountType(selectedAccountProfile?.account_type || 'retirement');
    setAccountCategory(selectedAccountProfile?.account_category || 'irp');
  }, [selectedAccountProfile]);

  useEffect(() => {
    const draft = readPortfolioPrefillDraft();
    if (!draft || draft.source !== 'stock_screener') return;
    setIncomingPrefillDraft(draft);
  }, []);

  useEffect(() => {
    if (!incomingPrefillDraft || prefillAppliedRef.current) return;
    const nextForm = buildPortfolioPrefillForm({
      draft: incomingPrefillDraft,
      accountType,
      fallbackDate: getLocalTodayKey()
    });
    setFormData(nextForm);
    setSelectedProductName(nextForm.product_name);
    setShowProductSearch(false);
    const accountLabel = accountType === 'brokerage' ? '증권 통장' : '퇴직 계좌';
    setMessage(`스크리너 후보를 ${accountLabel} 기준 초안으로 불러왔습니다.`);
    prefillAppliedRef.current = true;
    localStorage.removeItem(portfolioPrefillStorageKey);
  }, [accountType, incomingPrefillDraft]);

  useEffect(() => {
    const productIds = products.map((product) => String(product.id));
    setSelectedTrendProductIds((prev) => prev.filter((id) => productIds.includes(id)));
  }, [products]);

  useEffect(() => {
    if (selectedTrendProductIds.length === 0) return;
    const purchaseDates = products
      .filter((product) => selectedTrendProductIds.includes(String(product.id)))
      .map((product) => parseRecordDate(product.purchase_date))
      .filter(Boolean);
    if (purchaseDates.length === 0) return;

    const earliestDate = purchaseDates.reduce((earliest, current) => (current < earliest ? current : earliest), purchaseDates[0]);
    const todayDate = getLocalToday();
    const suggested = getSuggestedTrendRange(earliestDate, todayDate);
    setTrendRangeAmount(suggested.amount);
    setTrendRangeUnit(suggested.unit);
  }, [products, selectedTrendProductIds]);

  const changeAccountName = (value) => {
    persistAccountName(value);
    setMessage('');
    setLoading(true);
    setSelectedTrendProductIds([]);
    setActivePanel({ productId: null, mode: null });
    setEditingId(null);
  };

  useEffect(() => {
    if (accountType !== 'brokerage') return;
    setFormData((prev) => ({ ...prev, unit_type: 'share', asset_type: 'risk' }));
  }, [accountType]);

  useEffect(() => {
    const query = formData.product_name.trim();
    if (query.length < 2 || query === selectedProductName) {
      setProductSearchResults([]);
      setProductSearchLoading(false);
      return undefined;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setProductSearchLoading(true);
      try {
        const results = await portfolioAPI.searchProducts(query);
        if (active) {
          setProductSearchResults(results);
          setShowProductSearch(true);
        }
      } catch (err) {
        if (active) setProductSearchResults([]);
      } finally {
        if (active) setProductSearchLoading(false);
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [formData.product_name, selectedProductName]);

  const selectedTrendProductSet = useMemo(() => new Set(selectedTrendProductIds), [selectedTrendProductIds]);
  const retirementEligibility = useMemo(() => summarizeRetirementEligibility({
    products,
    accountType,
    accountCategory
  }), [accountCategory, accountType, products]);
  const draftEligibility = useMemo(() => {
    if (accountType === 'brokerage') return null;
    if (!formData.product_name && !formData.product_code) return null;
    return evaluateProductEligibility({
      accountType,
      accountCategory,
      product: formData,
      holdings: products
    });
  }, [accountCategory, accountType, formData, products]);
  const filteredTrends = useMemo(
    () => trends.filter((row) => selectedTrendProductSet.has(String(row.product_id))),
    [trends, selectedTrendProductSet]
  );
  const safeTrendRangeAmount = useMemo(() => toPositiveInteger(trendRangeAmount), [trendRangeAmount]);
  const safeTrendIntervalAmount = useMemo(() => toPositiveInteger(trendIntervalAmount, 1), [trendIntervalAmount]);
  const trendDateWindow = useMemo(() => {
    const purchaseDates = products
      .filter((product) => selectedTrendProductSet.has(String(product.id)))
      .map((product) => parseRecordDate(product.purchase_date))
      .filter(Boolean);
    const todayDate = getLocalToday();
    const startDate = purchaseDates.length > 0
      ? purchaseDates.reduce((earliest, date) => (date < earliest ? date : earliest), purchaseDates[0])
      : todayDate;
    const endDate = getEarlierDate(addDateUnits(startDate, safeTrendRangeAmount, trendRangeUnit), todayDate);
    return { startDate, endDate };
  }, [products, selectedTrendProductSet, safeTrendRangeAmount, trendRangeUnit]);
  const windowedTrends = useMemo(() => (
    filteredTrends.filter((row) => {
      const rowDate = parseRecordDate(row.record_date);
      if (!rowDate || !trendDateWindow.startDate || !trendDateWindow.endDate) return false;
      return rowDate >= trendDateWindow.startDate && rowDate <= trendDateWindow.endDate;
    })
  ), [filteredTrends, trendDateWindow]);
  const trendSeries = useMemo(() => {
    const seriesMap = new Map();
    filteredTrends.forEach((row) => {
      if (!seriesMap.has(row.product_id)) {
        seriesMap.set(row.product_id, {
          id: row.product_id,
          key: `product_${row.product_id}`,
          name: row.product_name
        });
      }
    });
    return Array.from(seriesMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredTrends]);

  const chartData = useMemo(() => {
    const rowsByProduct = new Map();
    filteredTrends.forEach((row) => {
      const key = String(row.product_id);
      rowsByProduct.set(key, [...(rowsByProduct.get(key) || []), row]);
    });

    rowsByProduct.forEach((rows, key) => {
      rowsByProduct.set(
        key,
        [...rows].sort((a, b) => a.record_date.localeCompare(b.record_date))
      );
    });

    return buildTrendTimeline(
      trendDateWindow.startDate,
      trendDateWindow.endDate,
      safeTrendIntervalAmount
    ).map((targetDate) => {
      const entry = { date: formatDateKey(targetDate) };
      trendSeries.forEach((series) => {
        const row = findLatestRowOnOrBefore(rowsByProduct.get(String(series.id)) || [], targetDate);
        if (!row) return;
        entry[series.key] = getPriceReturnRate(row);
        entry[`${series.key}__meta`] = row;
      });
      return entry;
    });
  }, [filteredTrends, trendDateWindow, safeTrendIntervalAmount, trendSeries]);
  const chartHasValues = useMemo(() => (
    chartData.some((entry) => trendSeries.some((series) => entry[series.key] !== undefined))
  ), [chartData, trendSeries]);

  const trendRows = useMemo(() => (
    [...windowedTrends].sort((a, b) => {
      const dateOrder = b.record_date.localeCompare(a.record_date);
      if (dateOrder !== 0) return dateOrder;
      return a.product_name.localeCompare(b.product_name);
    })
  ), [windowedTrends]);
  const selectedTrendProducts = useMemo(() => (
    products.filter((product) => selectedTrendProductSet.has(String(product.id)))
  ), [products, selectedTrendProductSet]);
  const trendDataBadges = useMemo(() => {
    const badges = [
      buildDataBadgeDescriptor({
        source: 'portfolio_ledger',
        freshnessClass: 'internal_ledger',
        note: '보유 대장/매입 기준'
      })
    ];

    selectedTrendProducts.forEach((product) => {
      badges.push(buildDataBadgeDescriptor({
        source: product.unit_type === 'unit' ? 'funetf' : 'naver',
        freshnessClass: product.unit_type === 'unit' ? 'end_of_day' : 'delayed_20m',
        code: product.product_code,
        note: product.product_name
      }));
    });

    return badges;
  }, [selectedTrendProducts]);
  const trendFreshnessWarning = useMemo(() => buildFreshnessMixWarning(
    selectedTrendProducts.map((product) => (
      buildDataBadgeDescriptor({
        source: product.unit_type === 'unit' ? 'FunETF' : 'Naver',
        freshnessClass: product.unit_type === 'unit' ? 'end_of_day' : 'delayed_20m',
        code: product.product_code
      })
    ))
  ), [selectedTrendProducts]);
  const colors = ['#33658a', '#d94841', '#256f68', '#f6ae2d', '#7f4f24', '#6a4c93'];
  const formatCurrency = (value) => new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0
  }).format(value || 0);
  const formatQuantity = (value) => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
  const unitLabel = (unitType) => (unitType === 'unit' ? '좌' : '주');
  const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;
  const quantityStep = accountType === 'brokerage' ? '1' : '0.0001';
  const quantityLabel = accountType === 'brokerage' ? '수량(주)' : '수량/좌수';
  const quantityHelpText = accountType === 'brokerage' ? '주식 통장은 주 단위로 관리합니다.' : null;

  const TrendTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="trend-tooltip">
        <strong>{label}</strong>
        {payload.map((item) => {
          const row = item.payload?.[`${item.dataKey}__meta`];
          if (!row) return null;
          return (
            <div className="trend-tooltip-item" key={item.dataKey}>
              <span className="trend-tooltip-name" style={{ color: item.color }}>{item.name}</span>
              <span>기준가 수익률 {formatPercent(getPriceReturnRate(row))}</span>
              <span>기준가 {formatCurrency(row.price)}</span>
              <span>매입 기준가 {formatCurrency(row.purchase_price)}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    if (name === 'product_name') {
      setSelectedProductName('');
      setShowProductSearch(value.trim().length >= 2);
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const selectSearchProduct = (product) => {
    setFormData((prev) => ({
      ...prev,
      product_name: product.name,
      product_code: product.code,
      unit_type: accountType === 'brokerage' ? 'share' : (product.type === 'fund' ? 'unit' : prev.unit_type)
    }));
    setSelectedProductName(product.name);
    setProductSearchResults([]);
    setShowProductSearch(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      await portfolioAPI.addProduct({
        ...formData,
        unit_type: accountType === 'brokerage' ? 'share' : formData.unit_type,
        asset_type: accountType === 'brokerage' ? 'risk' : formData.asset_type
      }, accountName);
      setMessage('상품을 추가하고 매수 내역을 기록했습니다.');
      setFormData(emptyProductForm(today));
      setSelectedProductName('');
      setProductSearchResults([]);
      setShowProductSearch(false);
      await loadData();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const saveDeposit = async (event) => {
    event.preventDefault();
    setDepositLoading(true);
    setMessage('');
    try {
      await portfolioAPI.addCashDeposit(depositForm, accountName);
      setDepositForm({ amount: '', deposit_date: today, notes: '' });
      setMessage('회사 현금입금을 원금과 매매일지에 기록했습니다.');
      await loadData();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setDepositLoading(false);
    }
  };

  const updatePrice = async (productId) => {
    const price = priceInputs[productId];
    if (!price) return;
    try {
      await portfolioAPI.updatePrice(productId, price);
      setPriceInputs((prev) => ({ ...prev, [productId]: '' }));
      setMessage('기준가를 갱신하고 추이에 반영했습니다.');
      setActivePanel({ productId: null, mode: null });
      await loadData();
    } catch (err) {
      setMessage(err.message);
    }
  };

  const deleteProduct = async (product) => {
    const ok = window.confirm(`${product.product_name} 상품을 삭제할까요?\n관련 기준가 이력과 매매일지도 함께 삭제합니다.`);
    if (!ok) return;

    try {
      await portfolioAPI.deleteProduct(product.id);
      setMessage('상품과 관련 기준가 이력, 매매일지를 삭제했습니다.');
      await loadData();
    } catch (err) {
      setMessage(err.message);
    }
  };

  const sellProduct = async (product) => {
    const input = sellInputs[product.id] || {};
    const saleData = {
      sale_date: input.sale_date || today,
      sale_price: input.sale_price || product.current_price,
      notes: input.notes || ''
    };
    if (!saleData.sale_price) {
      setMessage('매도가 또는 기준가를 입력하세요.');
      return;
    }
    const ok = window.confirm(`${product.product_name} 상품을 매도 완료 처리할까요?\n현황과 추이에서는 사라지고 매매일지에 매도 기록만 남습니다.`);
    if (!ok) return;

    try {
      await portfolioAPI.sellProduct(product.id, saleData);
      setSellInputs((prev) => ({ ...prev, [product.id]: { sale_date: today, sale_price: '', notes: '' } }));
      setMessage('매도 완료 처리했습니다. 현황과 추이에서 제외하고 매매일지에 기록했습니다.');
      setActivePanel({ productId: null, mode: null });
      await loadData();
    } catch (err) {
      setMessage(err.message);
    }
  };

  const addBuy = async (product) => {
    const input = buyInputs[product.id] || {};
    if (!input.purchase_price || !input.quantity) {
      setMessage(`추가매수 기준가와 ${accountType === 'brokerage' ? '주 수량' : '수량/좌수'}를 입력하세요.`);
      return;
    }
    try {
      await portfolioAPI.addBuy(product.id, {
        purchase_date: input.purchase_date || today,
        purchase_price: input.purchase_price,
        quantity: input.quantity,
        notes: input.notes || '추가매수'
      });
      setBuyInputs((prev) => ({ ...prev, [product.id]: { purchase_date: today, purchase_price: '', quantity: '', notes: '' } }));
      setMessage('추가매수를 반영하고 매매일지에 기록했습니다.');
      setActivePanel({ productId: null, mode: null });
      await loadData();
    } catch (err) {
      setMessage(err.message);
    }
  };

  const startEdit = (product) => {
    setEditingId(product.id);
    setActivePanel({ productId: product.id, mode: 'edit' });
    setEditForms((prev) => ({
      ...prev,
      [product.id]: {
        product_name: product.product_name,
        product_code: product.product_code,
        purchase_price: product.purchase_price,
        current_price: product.current_price,
        quantity: product.quantity,
        unit_type: accountType === 'brokerage' ? 'share' : (product.unit_type || 'share'),
        purchase_date: product.purchase_date,
        asset_type: accountType === 'brokerage' ? 'risk' : product.asset_type,
        notes: ''
      }
    }));
  };

  const saveEdit = async (product) => {
    try {
      await portfolioAPI.updateProduct(product.id, {
        ...editForms[product.id],
        unit_type: accountType === 'brokerage' ? 'share' : editForms[product.id]?.unit_type,
        asset_type: accountType === 'brokerage' ? 'risk' : editForms[product.id]?.asset_type
      });
      setEditingId(null);
      setActivePanel({ productId: null, mode: null });
      setMessage('상품 정보를 수정했습니다.');
      await loadData();
    } catch (err) {
      setMessage(err.message);
    }
  };

  const openProductPanel = (product, mode) => {
    if (activePanel.productId === product.id && activePanel.mode === mode) {
      setActivePanel({ productId: null, mode: null });
      if (mode === 'edit') setEditingId(null);
      return;
    }
    if (mode === 'edit') {
      startEdit(product);
      return;
    }
    setEditingId(null);
    setActivePanel({ productId: product.id, mode });
  };

  const toggleProductCard = (product) => {
    if (activePanel.productId === product.id) {
      setActivePanel({ productId: null, mode: null });
      setEditingId(null);
      return;
    }
    setEditingId(null);
    setActivePanel({ productId: product.id, mode: 'manage' });
  };

  const toggleTrendProduct = (productId) => {
    const id = String(productId);
    setSelectedTrendProductIds((prev) => (
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    ));
  };

  return (
    <main className="portfolio-container" aria-busy={loading || depositLoading}>
      <AccountSelector value={accountName} onChange={changeAccountName} onAccountsChange={syncAccountProfiles} />
      <section className="portfolio-workspace">
        <aside className="portfolio-left">
          <section className="product-entry-panel">
            <h1>상품 등록</h1>
            <p className="subtitle">
              매입가, {accountType === 'brokerage' ? '주 수량' : '수량/좌수'}, 매입일을 입력하면 현황과 매매일지에 반영합니다.
            </p>
            {message && <div className="message" role="status" aria-live="polite">{message}</div>}
            {retirementEligibility && (
              <div className="retirement-rule-panel">
                <div className="retirement-rule-header">
                  <strong>{ACCOUNT_CATEGORY_LABELS[accountCategory] || '퇴직연금'} 규칙 점검</strong>
                  <span>위험자산 {retirementEligibility.riskShare.toFixed(1)}%</span>
                </div>
                <ul>
                  {retirementEligibility.rules.map((rule) => (
                    <li key={rule.label} className={rule.passed ? 'pass' : 'fail'}>
                      <strong>{rule.label}</strong>
                      <span>{rule.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <form onSubmit={handleSubmit} className="product-form">
            <div className="form-group">
              <label>상품명 또는 코드</label>
              <div className="product-search-field">
                <input
                  name="product_name"
                  value={formData.product_name}
                  onChange={handleChange}
                  onFocus={() => {
                    if (productSearchResults.length > 0) setShowProductSearch(true);
                  }}
                  onBlur={() => setTimeout(() => setShowProductSearch(false), 150)}
                  placeholder="예: K55207BU0715, 0177N0, 파워인덱스"
                  autoComplete="off"
                  required
                />
                {showProductSearch && (productSearchLoading || productSearchResults.length > 0) && (
                  <div className="product-search-list">
                    {productSearchLoading && <div className="product-search-status" role="status" aria-live="polite">검색 중...</div>}
                    {productSearchResults.map((product) => (
                      <button
                        key={product.code}
                        type="button"
                        className="product-search-item"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectSearchProduct(product)}
                      >
                        <strong>{product.name}</strong>
                        <span>{product.code} · {product.exchange} · {product.source}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="form-group">
              <label>상품 코드</label>
              <input name="product_code" value={formData.product_code} onChange={handleChange} placeholder="예: 0177N0, K55207BU0715" required />
              <small className="field-help">ETF는 공개 코드, 펀드는 표준코드로 등록하면 자동 기준가 조회를 시도합니다.</small>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>매입가/기준가</label>
                <input type="number" min="0" step="0.01" name="purchase_price" value={formData.purchase_price} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label>{quantityLabel}</label>
                <input type="number" min="0" step={quantityStep} name="quantity" value={formData.quantity} onChange={handleChange} required />
                {quantityHelpText && <small className="field-help">{quantityHelpText}</small>}
              </div>
            </div>
            <div className={`form-row ${accountType === 'brokerage' ? 'form-row-single' : ''}`}>
              {accountType !== 'brokerage' && (
                <div className="form-group">
                  <label>단위</label>
                  <select name="unit_type" value={formData.unit_type} onChange={handleChange}>
                    <option value="share">주</option>
                    <option value="unit">좌</option>
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>매입일</label>
                <input type="date" name="purchase_date" value={formData.purchase_date} onChange={handleChange} required />
              </div>
            </div>
            <div className={`form-row ${accountType === 'brokerage' ? 'form-row-single' : ''}`}>
              {accountType !== 'brokerage' && (
                <div className="form-group">
                  <label>자산 구분</label>
                  <select name="asset_type" value={formData.asset_type} onChange={handleChange}>
                    <option value="risk">위험자산</option>
                    <option value="safe">안전자산</option>
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>메모</label>
                <input name="notes" value={formData.notes} onChange={handleChange} placeholder="선택 입력" />
              </div>
            </div>
              {draftEligibility && (
                <div className={`eligibility-form-preview ${draftEligibility.status}`}>
                  <div className="eligibility-form-preview-top">
                    <strong>연금 적격성 미리보기</strong>
                    <span>{draftEligibility.label} · {draftEligibility.status === 'allowed' ? '허용' : draftEligibility.status === 'warn' ? '경고' : '차단'}</span>
                  </div>
                  <ul>
                    {draftEligibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                </div>
              )}
              <button type="submit" className="btn-submit" disabled={loading}>{loading ? '추가 중...' : '상품 추가'}</button>
            </form>
          </section>

          {accountType !== 'brokerage' && (
            <form className="deposit-panel" onSubmit={saveDeposit}>
              <div>
                <h3>회사 현금입금</h3>
                <p>입금액을 퇴직금 원금으로 계산하고 매매일지에 기록합니다.</p>
              </div>
              <div className="deposit-actions">
                <input type="date" value={depositForm.deposit_date} onChange={(event) => setDepositForm((prev) => ({ ...prev, deposit_date: event.target.value }))} required />
                <input type="number" min="1" step="1" placeholder="입금액" value={depositForm.amount} onChange={(event) => setDepositForm((prev) => ({ ...prev, amount: event.target.value }))} required />
                <button type="submit" disabled={depositLoading}>{depositLoading ? '기록 중...' : '입금 기록'}</button>
              </div>
              <textarea rows="2" placeholder="메모 선택 입력" value={depositForm.notes} onChange={(event) => setDepositForm((prev) => ({ ...prev, notes: event.target.value }))} />
            </form>
          )}

          <section className="holding-panel">
            <h2>상품 관리</h2>
            <div className="holding-card-list">
              {products.map((product) => {
                const edit = editForms[product.id] || {};
                const buyInput = buyInputs[product.id] || {};
                const sellInput = sellInputs[product.id] || {};
                const expanded = activePanel.productId === product.id;
                const trendChecked = selectedTrendProductSet.has(String(product.id));

                return (
                  <article className={`holding-card ${expanded ? 'expanded' : ''}`} key={product.id}>
                    <div className="holding-card-summary" role="button" tabIndex="0" onClick={() => toggleProductCard(product)} onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleProductCard(product);
                      }
                    }}>
                      <label className="trend-card-check" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={trendChecked}
                          onChange={() => toggleTrendProduct(product.id)}
                        />
                      </label>
                      <span className="holding-title">
                        <strong>{product.product_name}</strong>
                        <small>{product.product_code} · {product.asset_type === 'risk' ? '위험자산' : '안전자산'} · {formatQuantity(product.quantity)}{unitLabel(product.unit_type)}</small>
                      </span>
                      {accountType !== 'brokerage' && (
                        <span className={`holding-eligibility ${evaluateProductEligibility({
                          accountType,
                          accountCategory,
                          product,
                          holdings: products
                        }).status}`}>
                          {evaluateProductEligibility({
                            accountType,
                            accountCategory,
                            product,
                            holdings: products
                          }).label}
                        </span>
                      )}
                      <span className="holding-stat">
                        <small>현재가</small>
                        <strong>{formatCurrency(product.current_price)}</strong>
                      </span>
                      <span className={`holding-stat ${(product.profit_rate || 0) >= 0 ? 'profit-text' : 'loss-text'}`}>
                        <small>수익률</small>
                        <strong>{Number(product.profit_rate || 0).toFixed(2)}%</strong>
                      </span>
                      <span className="holding-stat">
                        <small>평가액</small>
                        <strong>{formatCurrency(product.current_value)}</strong>
                      </span>
                    </div>

                    {expanded && (
                      <div className="holding-card-panel">
                        <div className="card-actions">
                          <button type="button" onClick={() => openProductPanel(product, 'price')}>기준가</button>
                          <button type="button" onClick={() => openProductPanel(product, 'buy')}>추가매수</button>
                          <button type="button" onClick={() => openProductPanel(product, 'sell')}>매도</button>
                          <button type="button" onClick={() => openProductPanel(product, 'edit')}>수정</button>
                          <button type="button" className="delete-btn" onClick={() => deleteProduct(product)}>삭제</button>
                        </div>

                        {activePanel.mode === 'price' && (
                          <div className="action-panel">
                            <div className="panel-heading">
                              <strong>기준가 갱신</strong>
                            </div>
                            <div className="panel-fields price-fields">
                              <input type="number" min="0" step="0.01" placeholder="새 기준가" value={priceInputs[product.id] || ''} onChange={(e) => setPriceInputs((prev) => ({ ...prev, [product.id]: e.target.value }))} />
                              <button type="button" onClick={() => updatePrice(product.id)}>갱신</button>
                            </div>
                          </div>
                        )}

                        {activePanel.mode === 'buy' && (
                          <div className="action-panel">
                            <div className="panel-heading">
                              <strong>추가매수</strong>
                            </div>
                            <div className="panel-fields buy-fields">
                              <input type="date" value={buyInput.purchase_date || today} onChange={(e) => setBuyInputs((prev) => ({ ...prev, [product.id]: { ...(prev[product.id] || {}), purchase_date: e.target.value } }))} />
                              <input type="number" min="0" step="0.01" placeholder="추가 기준가" value={buyInput.purchase_price || ''} onChange={(e) => setBuyInputs((prev) => ({ ...prev, [product.id]: { ...(prev[product.id] || {}), purchase_price: e.target.value } }))} />
                              <input type="number" min="0" step={accountType === 'brokerage' ? '1' : '0.0001'} placeholder={`추가 ${accountType === 'brokerage' ? '주 수량' : unitLabel(product.unit_type)}`} value={buyInput.quantity || ''} onChange={(e) => setBuyInputs((prev) => ({ ...prev, [product.id]: { ...(prev[product.id] || {}), quantity: e.target.value } }))} />
                              <button type="button" onClick={() => addBuy(product)}>추가매수</button>
                            </div>
                          </div>
                        )}

                        {activePanel.mode === 'sell' && (
                          <div className="action-panel">
                            <div className="panel-heading">
                              <strong>매도 처리</strong>
                            </div>
                            <div className="panel-fields sell-fields">
                              <input type="date" value={sellInput.sale_date || today} onChange={(e) => setSellInputs((prev) => ({ ...prev, [product.id]: { ...(prev[product.id] || {}), sale_date: e.target.value } }))} />
                              <input type="number" min="0" step="0.01" placeholder="매도가/기준가" value={sellInput.sale_price || ''} onChange={(e) => setSellInputs((prev) => ({ ...prev, [product.id]: { ...(prev[product.id] || {}), sale_price: e.target.value } }))} />
                              <button type="button" onClick={() => sellProduct(product)}>매도완료</button>
                            </div>
                          </div>
                        )}

                        {editingId === product.id && activePanel.mode === 'edit' && (
                          <div className="action-panel edit-panel">
                            <div className="panel-heading">
                              <strong>상품 정보 수정</strong>
                            </div>
                            <div className="form-row">
                              <input placeholder="상품명" value={edit.product_name || ''} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, product_name: e.target.value } }))} />
                              <input placeholder="상품 코드" value={edit.product_code || ''} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, product_code: e.target.value } }))} />
                            </div>
                            <div className="form-row">
                              <input aria-label="평균 기준가" type="number" min="0" step="0.01" value={edit.purchase_price || ''} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, purchase_price: e.target.value } }))} />
                              <input aria-label="현재 기준가" type="number" min="0" step="0.01" value={edit.current_price || ''} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, current_price: e.target.value } }))} />
                            </div>
                            <div className="form-row">
                              <input aria-label={accountType === 'brokerage' ? '주 수량' : '수량 또는 좌수'} type="number" min="0" step={accountType === 'brokerage' ? '1' : '0.0001'} value={edit.quantity || ''} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, quantity: e.target.value } }))} />
                              <input aria-label="매입일" type="date" value={edit.purchase_date || today} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, purchase_date: e.target.value } }))} />
                            </div>
                            {accountType !== 'brokerage' && (
                              <div className="form-row">
                                <select aria-label="단위" value={edit.unit_type || 'share'} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, unit_type: e.target.value } }))}>
                                  <option value="share">주</option>
                                  <option value="unit">좌</option>
                                </select>
                                <select aria-label="자산 구분" value={edit.asset_type || 'risk'} onChange={(e) => setEditForms((prev) => ({ ...prev, [product.id]: { ...edit, asset_type: e.target.value } }))}>
                                  <option value="risk">위험자산</option>
                                  <option value="safe">안전자산</option>
                                </select>
                              </div>
                            )}
                            <div className="row-actions">
                              <button type="button" onClick={() => saveEdit(product)}>저장</button>
                              <button type="button" onClick={() => {
                                setEditingId(null);
                                setActivePanel({ productId: null, mode: null });
                              }}>취소</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
              {products.length === 0 && <p className="no-data" role="status" aria-live="polite">등록된 보유 상품이 없습니다.</p>}
            </div>
          </section>
        </aside>

        <div className="trend-panel">
          <h2>{accountName} 추이</h2>
          <div className="trend-badges" aria-label="추이 데이터 출처">
            {trendDataBadges.map((badge) => (
              <DataBadge key={`${badge.id}-${badge.note || ''}`} descriptor={badge} compact />
            ))}
          </div>
          <div className="trend-view">
            <div className="trend-controls">
              <label className="trend-control-group">
                <span>기간</span>
                <div className="trend-control-row">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={trendRangeAmount}
                    onChange={(event) => setTrendRangeAmount(event.target.value)}
                    aria-label="추이 기간 값"
                  />
                  <select value={trendRangeUnit} onChange={(event) => setTrendRangeUnit(event.target.value)} aria-label="추이 기간 단위">
                    {PERIOD_UNIT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </label>
              <label className="trend-control-group">
                <span>단위</span>
                <div className="trend-control-row trend-control-row-compact">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={trendIntervalAmount}
                    onChange={(event) => setTrendIntervalAmount(event.target.value)}
                    aria-label="추이 표시 단위 값"
                  />
                  <span className="trend-unit-suffix">일</span>
                </div>
              </label>
            </div>
            {trendFreshnessWarning && (
              <div className="trend-freshness-warning" role="note">{trendFreshnessWarning}</div>
            )}
            <div className="trend-chart">
              {selectedTrendProductIds.length === 0 ? (
                <p className="no-data" role="status" aria-live="polite">비교할 상품을 먼저 선택해 주세요.</p>
              ) : !chartHasValues ? (
                <p className="no-data" role="status" aria-live="polite">선택한 기간에 표시할 추이 데이터가 없습니다.</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData} margin={{ top: 12, right: 16, left: 18, bottom: 18 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickMargin={8} minTickGap={24} />
                    <YAxis
                      width={82}
                      tickFormatter={formatPercent}
                      tickMargin={8}
                      label={{ value: '기준가 수익률', angle: -90, position: 'insideLeft', dx: -4, dy: 52 }}
                    />
                    <Tooltip content={<TrendTooltip />} />
                    <Legend />
                    {trendSeries.map((series, index) => (
                      <Line
                        key={series.key}
                        type="monotone"
                        dataKey={series.key}
                        name={series.name}
                        stroke={colors[index % colors.length]}
                        dot={chartData.length <= 20}
                        connectNulls={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="trend-detail">
            {selectedTrendProducts.length > 0 && (
              <div className="trend-selected-summary">
                <strong>선택한 상품</strong>
                <div className="trend-selection-list">
                  {selectedTrendProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className="trend-selection-chip"
                      onClick={() => toggleTrendProduct(product.id)}
                    >
                      <span>{product.product_name}</span>
                      <small>{product.product_code}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <h3>상품 추이 상세</h3>
            {selectedTrendProductIds.length > 0 && trendRows.length === 0 && <p className="no-data" role="status" aria-live="polite">선택한 상품의 상세 추이 기록이 없습니다.</p>}
            {selectedTrendProductIds.length > 0 && trendRows.length > 0 && (
              <>
                <div className="trend-mobile-list">
                  {trendRows.map((row) => (
                    <article className="trend-mobile-card" key={`mobile-${row.product_id}-${row.record_date}`}>
                      <div className="trend-mobile-top">
                        <div>
                          <strong>{row.product_name}</strong>
                          <span className="trend-code">{row.product_code}</span>
                        </div>
                        <div className="trend-mobile-date">{row.record_date}</div>
                      </div>
                      <div className="trend-mobile-grid">
                        <div>
                          <span>매입가</span>
                          <strong>{formatCurrency(row.purchase_price)}</strong>
                        </div>
                        <div>
                          <span>기준가</span>
                          <strong>{formatCurrency(row.price)}</strong>
                        </div>
                        <div>
                          <span>수량</span>
                          <strong>{formatQuantity(row.quantity)}{row.unit_label || unitLabel(row.unit_type)}</strong>
                        </div>
                        <div>
                          <span>평가액</span>
                          <strong>{formatCurrency(row.evaluation_value)}</strong>
                        </div>
                        <div>
                          <span>손익</span>
                          <strong className={(row.profit_loss || 0) >= 0 ? 'profit-text' : 'loss-text'}>
                            {formatCurrency(row.profit_loss)}
                          </strong>
                        </div>
                        <div>
                          <span>기준가 수익률</span>
                          <strong className={getPriceReturnRate(row) >= 0 ? 'profit-text' : 'loss-text'}>
                            {formatPercent(getPriceReturnRate(row))}
                          </strong>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="trend-table-wrapper">
                <table className="trend-table">
                  <thead>
                    <tr>
                      <th>일자</th>
                      <th>상품명</th>
                      <th>매입가</th>
                      <th>기준가</th>
                      <th>수량</th>
                      <th>매입금액</th>
                      <th>평가액</th>
                      <th>손익</th>
                      <th>기준가 수익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendRows.map((row) => (
                      <tr key={`${row.product_id}-${row.record_date}`}>
                        <td>{row.record_date}</td>
                        <td>{row.product_name}<span className="trend-code">{row.product_code}</span></td>
                        <td>{formatCurrency(row.purchase_price)}</td>
                        <td>{formatCurrency(row.price)}</td>
                        <td>{formatQuantity(row.quantity)}{row.unit_label || unitLabel(row.unit_type)}</td>
                        <td>{formatCurrency(row.purchase_value)}</td>
                        <td>{formatCurrency(row.evaluation_value)}</td>
                        <td className={(row.profit_loss || 0) >= 0 ? 'profit-text' : 'loss-text'}>
                          {formatCurrency(row.profit_loss)}
                        </td>
                        <td className={getPriceReturnRate(row) >= 0 ? 'profit-text' : 'loss-text'}>
                          {formatPercent(getPriceReturnRate(row))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

export default Portfolio;
