import React, { useEffect, useState } from 'react';
import { privacyAPI } from '../utils/api';
import '../styles/InfoPages.css';

function ContactInfo() {
  const [contact, setContact] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await privacyAPI.getContact();
        if (active) setContact(response);
      } catch (e) {
        if (active) setError(e.message || '문의처 정보를 불러오지 못했습니다.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="info-page">
      <h1>문의처</h1>
      {error && <div className="error-container">{error}</div>}
      <section className="info-section">
        <h2>개인정보 보호 담당</h2>
        <p>{contact?.name || '-'}</p>
        <p>{contact?.email || '-'}</p>
      </section>
      <section className="info-section">
        <h2>국외 전송 안내</h2>
        <p>{contact?.country_transfer_notice || '외부 연동 서비스에 대한 국외 전송 여부를 확인하세요.'}</p>
      </section>
    </main>
  );
}

export default ContactInfo;
