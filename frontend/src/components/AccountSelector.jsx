import React from 'react';
import { ACCOUNT_OPTIONS } from '../utils/api';

function AccountSelector({ value, onChange }) {
  return (
    <div className="account-switcher">
      <label htmlFor="account-select">통장</label>
      <select id="account-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {ACCOUNT_OPTIONS.map((accountName) => (
          <option key={accountName} value={accountName}>{accountName}</option>
        ))}
      </select>
    </div>
  );
}

export default AccountSelector;
