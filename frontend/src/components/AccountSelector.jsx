import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_ACCOUNT_NAME, portfolioAPI } from '../utils/api';

function AccountSelector({ value, onChange }) {
  const [accounts, setAccounts] = useState([DEFAULT_ACCOUNT_NAME]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [message, setMessage] = useState('');

  const loadAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await portfolioAPI.getAccounts();
      const nextAccounts = response?.accounts?.length ? response.accounts : [DEFAULT_ACCOUNT_NAME];
      setAccounts(nextAccounts);
      setMessage('');
    } catch (error) {
      setAccounts([DEFAULT_ACCOUNT_NAME]);
      setMessage(error.message || '통장 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (!loading && accounts.length > 0 && !accounts.includes(value)) {
      onChange(accounts.includes(DEFAULT_ACCOUNT_NAME) ? DEFAULT_ACCOUNT_NAME : accounts[0]);
    }
  }, [accounts, loading, onChange, value]);

  const canSubmit = useMemo(() => newAccountName.trim().length > 0 && !saving, [newAccountName, saving]);

  const submitNewAccount = async (event) => {
    event.preventDefault();
    const accountName = newAccountName.trim();
    if (!accountName) {
      setMessage('통장 이름을 입력하세요.');
      return;
    }

    try {
      setSaving(true);
      const response = await portfolioAPI.addAccount(accountName);
      const nextAccounts = response?.accounts?.length ? response.accounts : [DEFAULT_ACCOUNT_NAME];
      setAccounts(nextAccounts);
      setNewAccountName('');
      setShowCreateForm(false);
      setMessage(response.message || '통장이 추가되었습니다.');
      onChange(response.account_name || accountName);
    } catch (error) {
      setMessage(error.message || '통장 추가에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="account-switcher-wrap">
      <div className="account-switcher">
        <label htmlFor="account-select">통장</label>
        <select
          id="account-select"
          value={accounts.includes(value) ? value : DEFAULT_ACCOUNT_NAME}
          onChange={(event) => onChange(event.target.value)}
          disabled={loading}
        >
          {accounts.map((accountName) => (
            <option key={accountName} value={accountName}>{accountName}</option>
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
          <button type="submit" disabled={!canSubmit}>
            {saving ? '추가 중..' : '추가'}
          </button>
        </form>
      )}
      {message && <p className="account-switcher-message">{message}</p>}
    </div>
  );
}

export default AccountSelector;
