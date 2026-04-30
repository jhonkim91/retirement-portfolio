import React, { useEffect, useState } from 'react';
import { privacyAPI } from '../utils/api';
import '../styles/InfoPages.css';

function PrivacyPolicy() {
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await privacyAPI.getPolicy();
        if (active) setPolicy(response);
      } catch (e) {
        if (active) setError(e.message || '개인정보 처리방침을 불러오지 못했습니다.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="info-page">
      <h1>{policy?.title || '개인정보 처리방침'}</h1>
      {policy?.effective_date && <p className="meta">시행일: {policy.effective_date}</p>}
      {error && <div className="error-container">{error}</div>}
      {(policy?.items || []).map((item) => (
        <section key={item.heading} className="info-section">
          <h2>{item.heading}</h2>
          <p>{item.content}</p>
        </section>
      ))}
    </main>
  );
}

export default PrivacyPolicy;
