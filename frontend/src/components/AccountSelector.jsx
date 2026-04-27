import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_ACCOUNT_NAME, portfolioAPI } from '../utils/api';

const DEFAULT_PROFILE = {
  account_name: DEFAULT_ACCOUNT_NAME,
  account_type: 'retirement',
  account_type_label: '퇴직연금',
  is_default: true
};

function AccountSelector({ value, onChange }) {
  const [accounts, setAccounts] = useState([DEFAULT_PROFILE]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountType, setNewAccountType] = useState('retirement');
  const [message, setMessage] = useState('');

  const loadAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await portfolioAPI.getAccounts();
      const nextProfiles = response?.account_profiles?.length ? response.account_profiles : [DEFAULT_PROFILE];
      setAccounts(nextProfiles);
      setMessage('');
    } catch (error) {
      setAccounts([DEFAULT_PROFILE]);
      setMessage(error.message || '통장 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const accountNames = useMemo(
    () => accounts.map((account) => account.account_name),
    [accounts]
  );

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.account_name === value) || accounts[0] || DEFAULT_PROFILE,
    [accounts, value]
  );

  useEffect(() => {
    if (!loading && accountNames.length > 0 && !accountNames.includes(value)) {
      onChange(accountNames.includes(DEFAULT_ACCOUNT_NAME) ? DEFAULT_ACCOUNT_NAME : accountNames[0]);
    }
  }, [accountNames, loading, onChange, value]);

  const canSubmit = useMemo(
    () => newAccountName.trim().length > 0 && !saving,
    [newAccountName, saving]
  );

  const submitNewAccount = async (event) => {
    event.preventDefault();
    const accountName = newAccountName.trim();
    if (!accountName) {
      setMessage('통장 이름을 입력하세요.');
      return;
    }

    try {
      setSaving(true);
      const response = await portfolioAPI.addAccount(accountName, newAccountType);
      const nextProfiles = response?.account_profiles?.length ? response.account_profiles : [DEFAULT_PROFILE];
      setAccounts(nextProfiles);
      setNewAccountName('');
      setNewAccountType('retirement');
      setShowCreateForm(false);
      setMessage(response.message || '통장을 추가했습니다.');
      onChange(response.account_name || accountName);
    } catch (error) {
      setMessage(error.message || '통장 추가에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const removeSelectedAccount = async () => {
    if (!selectedAccount || selectedAccount.is_default || deleting) return;
    const ok = window.confirm(`${selectedAccount.account_name} 통장과 관련 데이터 전체를 삭제할까요?`);
    if (!ok) return;

    try {
      setDeleting(true);
      const response = await portfolioAPI.deleteAccount(selectedAccount.account_name);
      const nextProfiles = response?.account_profiles?.length ? response.account_profiles : [DEFAULT_PROFILE];
      setAccounts(nextProfiles);
      setMessage(response.message || '통장을 삭제했습니다.');
      onChange(DEFAULT_ACCOUNT_NAME);
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
          value={accountNames.includes(value) ? value : DEFAULT_ACCOUNT_NAME}
          onChange={(event) => onChange(event.target.value)}
          disabled={loading}
        >
          {accounts.map((account) => (
            <option key={account.account_name} value={account.account_name}>
              {account.account_name} · {account.account_type_label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="account-add-button"
          onClick={() => {
            setShowCreateForm((prev) => !prev);
            setMessage('');
          }}
        >
          통장 추가
        </button>
        <button
          type="button"
          className="account-delete-button"
          onClick={removeSelectedAccount}
          disabled={selectedAccount?.is_default || deleting}
          title={selectedAccount?.is_default ? '기본 퇴직연금 통장은 삭제할 수 없습니다.' : ''}
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
          <select value={newAccountType} onChange={(event) => setNewAccountType(event.target.value)}>
            <option value="retirement">퇴직연금</option>
            <option value="brokerage">주식 통장</option>
          </select>
          <button type="submit" disabled={!canSubmit}>
            {saving ? '추가 중...' : '추가'}
          </button>
        </form>
      )}
      {selectedAccount && (
        <p className="account-switcher-meta">
          현재 알고리즘: {selectedAccount.account_type === 'brokerage'
            ? '주식형, 현재 보유 상품 기준 원금/평가액'
            : '퇴직연금형, 입금 원금 + 보유 현금 포함'}
        </p>
      )}
      {message && <p className="account-switcher-message">{message}</p>}
    </div>
  );
}

export default AccountSelector;
