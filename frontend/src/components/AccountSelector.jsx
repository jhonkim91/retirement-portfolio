import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_ACCOUNT_NAME, pickInitialAccountProfile, portfolioAPI } from '../utils/api';

const DEFAULT_PROFILE = {
  account_name: DEFAULT_ACCOUNT_NAME,
  display_name: DEFAULT_ACCOUNT_NAME,
  has_name_issue: false,
  account_type: 'retirement',
  account_category: 'irp',
  account_type_label: '퇴직연금',
  account_category_label: 'IRP',
  is_default: true,
  holding_count: 0,
  total_product_count: 0,
  trade_log_count: 0,
  cash_balance: 0,
  has_data: false,
  is_empty: true
};

const RETIREMENT_ACCOUNT_OPTIONS = [
  { value: 'pension_savings', label: '연금저축' },
  { value: 'irp', label: 'IRP' },
  { value: 'dc', label: 'DC' },
  { value: 'db_reference', label: 'DB 참조' }
];

const countFormatter = new Intl.NumberFormat('ko-KR');
const formatCount = (value) => countFormatter.format(Number(value || 0));

const buildAccountOptionLabel = (account) => {
  const details = [account.account_type_label];
  if (account.account_category_label) details.push(account.account_category_label);
  if (account.is_default) details.push('기본');
  details.push(account.is_empty ? '빈 계좌' : `보유 ${formatCount(account.holding_count)}개`);
  return `${account.display_name || account.account_name} · ${details.join(' · ')}`;
};

function AccountSelector({ value, onChange, onAccountsChange }) {
  const [accounts, setAccounts] = useState([DEFAULT_PROFILE]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showRenameForm, setShowRenameForm] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountType, setNewAccountType] = useState('retirement');
  const [newAccountCategory, setNewAccountCategory] = useState('irp');
  const [renameAccountName, setRenameAccountName] = useState('');
  const [message, setMessage] = useState('');

  const loadAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await portfolioAPI.getAccounts();
      const nextProfiles = response?.account_profiles?.length ? response.account_profiles : [DEFAULT_PROFILE];
      setAccounts(nextProfiles);
      onAccountsChange?.(nextProfiles);
      setMessage('');
    } catch (error) {
      setAccounts([DEFAULT_PROFILE]);
      onAccountsChange?.([DEFAULT_PROFILE]);
      setMessage(error.message || '통장 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [onAccountsChange]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const accountNames = useMemo(
    () => accounts.map((account) => account.account_name),
    [accounts]
  );

  const selectedAccount = useMemo(
    () => (
      accounts.find((account) => account.account_name === value)
      || pickInitialAccountProfile(accounts, value)
      || accounts[0]
      || DEFAULT_PROFILE
    ),
    [accounts, value]
  );

  const defaultAccountName = useMemo(
    () => accounts.find((account) => account.is_default)?.account_name || accounts[0]?.account_name || DEFAULT_ACCOUNT_NAME,
    [accounts]
  );

  const fallbackAccountName = useMemo(
    () => pickInitialAccountProfile(accounts, value)?.account_name || defaultAccountName,
    [accounts, defaultAccountName, value]
  );

  useEffect(() => {
    if (!loading && accountNames.length > 0 && !accountNames.includes(value)) {
      onChange(fallbackAccountName);
    }
  }, [accountNames, fallbackAccountName, loading, onChange, value]);

  const canSubmit = useMemo(
    () => newAccountName.trim().length > 0 && !saving,
    [newAccountName, saving]
  );

  const canRename = useMemo(
    () => renameAccountName.trim().length > 0 && !renaming,
    [renameAccountName, renaming]
  );

  const closePanels = () => {
    setShowSettings(false);
    setShowCreateForm(false);
    setShowRenameForm(false);
  };

  const submitNewAccount = async (event) => {
    event.preventDefault();
    const accountName = newAccountName.trim();
    if (!accountName) {
      setMessage('통장 이름을 입력하세요.');
      return;
    }

    try {
      setSaving(true);
      const response = await portfolioAPI.addAccount(accountName, newAccountType, newAccountCategory);
      const nextProfiles = response?.account_profiles?.length ? response.account_profiles : [DEFAULT_PROFILE];
      setAccounts(nextProfiles);
      onAccountsChange?.(nextProfiles, response.account_name || accountName);
      setNewAccountName('');
      setNewAccountType('retirement');
      setNewAccountCategory('irp');
      closePanels();
      setMessage(response.message || '통장을 추가했습니다.');
      onChange(response.account_name || accountName);
    } catch (error) {
      setMessage(error.message || '통장 추가에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const openRenameForm = () => {
    if (!selectedAccount) return;
    setRenameAccountName(selectedAccount.account_name);
    setShowCreateForm(false);
    setShowRenameForm((prev) => !prev);
    setMessage('');
  };

  const submitRenameAccount = async (event) => {
    event.preventDefault();
    const nextName = renameAccountName.trim();
    if (!selectedAccount) return;
    if (!nextName) {
      setMessage('새 통장 이름을 입력하세요.');
      return;
    }

    try {
      setRenaming(true);
      const response = await portfolioAPI.renameAccount(selectedAccount.account_name, nextName);
      const nextProfiles = response?.account_profiles?.length ? response.account_profiles : [DEFAULT_PROFILE];
      setAccounts(nextProfiles);
      onAccountsChange?.(nextProfiles, response.account_name || nextName);
      setRenameAccountName('');
      closePanels();
      setMessage(response.message || '통장 이름을 변경했습니다.');
      onChange(response.account_name || nextName);
    } catch (error) {
      setMessage(error.message || '통장 이름 변경에 실패했습니다.');
    } finally {
      setRenaming(false);
    }
  };

  const removeSelectedAccount = async () => {
    if (!selectedAccount || selectedAccount.is_default || deleting) return;
    const ok = window.confirm(`${selectedAccount.display_name || selectedAccount.account_name} 통장과 관련 데이터 전체를 삭제할까요?`);
    if (!ok) return;

    try {
      setDeleting(true);
      const response = await portfolioAPI.deleteAccount(selectedAccount.account_name);
      const nextProfiles = response?.account_profiles?.length ? response.account_profiles : [DEFAULT_PROFILE];
      const nextAccountName = response?.default_account_name
        || pickInitialAccountProfile(nextProfiles)?.account_name
        || nextProfiles.find((account) => account.is_default)?.account_name
        || nextProfiles[0]?.account_name
        || DEFAULT_ACCOUNT_NAME;
      setAccounts(nextProfiles);
      onAccountsChange?.(nextProfiles, nextAccountName);
      closePanels();
      setMessage(response.message || '통장을 삭제했습니다.');
      onChange(nextAccountName);
    } catch (error) {
      setMessage(error.message || '통장 삭제에 실패했습니다.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="account-switcher-wrap">
      <div className="account-switcher">
        <label htmlFor="account-select">통장</label>
        <select
          id="account-select"
          value={accountNames.includes(value) ? value : (selectedAccount?.account_name || DEFAULT_ACCOUNT_NAME)}
          onChange={(event) => onChange(event.target.value)}
          disabled={loading}
        >
          {accounts.map((account) => (
            <option key={account.account_name} value={account.account_name}>
              {buildAccountOptionLabel(account)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="account-settings-button"
          onClick={() => {
            setShowSettings((prev) => !prev);
            if (showSettings) {
              setShowCreateForm(false);
              setShowRenameForm(false);
            }
            setMessage('');
          }}
        >
          설정
        </button>
      </div>

      {showSettings && (
        <div className="account-settings-panel">
          <div className="account-settings-actions">
            <button
              type="button"
              className="account-add-button"
              onClick={() => {
                setShowCreateForm((prev) => !prev);
                setShowRenameForm(false);
                setMessage('');
              }}
            >
              통장 추가
            </button>
            <button
              type="button"
              className="account-rename-button"
              onClick={openRenameForm}
              disabled={renaming}
            >
              {renaming ? '변경 중...' : '이름 변경'}
            </button>
            <button
              type="button"
              className="account-delete-button"
              onClick={removeSelectedAccount}
              disabled={selectedAccount?.is_default || deleting}
              title={selectedAccount?.is_default ? '기본 통장은 삭제할 수 없습니다.' : ''}
            >
              {deleting ? '삭제 중...' : '통장 삭제'}
            </button>
          </div>

          {showCreateForm && (
            <form className="account-create-form" onSubmit={submitNewAccount}>
              <input
                type="text"
                maxLength="80"
                placeholder="예: 주식 통장"
                value={newAccountName}
                onChange={(event) => setNewAccountName(event.target.value)}
              />
              <select
                value={newAccountType}
                onChange={(event) => {
                  const nextType = event.target.value;
                  setNewAccountType(nextType);
                  if (nextType === 'brokerage') {
                    setNewAccountCategory('taxable');
                  } else if (newAccountCategory === 'taxable') {
                    setNewAccountCategory('irp');
                  }
                }}
              >
                <option value="retirement">퇴직연금</option>
                <option value="brokerage">주식 통장</option>
              </select>
              {newAccountType === 'retirement' && (
                <select value={newAccountCategory} onChange={(event) => setNewAccountCategory(event.target.value)}>
                  {RETIREMENT_ACCOUNT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              )}
              <button type="submit" disabled={!canSubmit}>
                {saving ? '추가 중...' : '추가'}
              </button>
            </form>
          )}

          {showRenameForm && (
            <form className="account-rename-form" onSubmit={submitRenameAccount}>
              <input
                type="text"
                maxLength="80"
                placeholder="새 통장 이름"
                value={renameAccountName}
                onChange={(event) => setRenameAccountName(event.target.value)}
              />
              <button type="submit" disabled={!canRename}>
                {renaming ? '변경 중...' : '변경'}
              </button>
            </form>
          )}
        </div>
      )}

      {message && <p className="account-switcher-message">{message}</p>}
    </div>
  );
}

export default AccountSelector;
