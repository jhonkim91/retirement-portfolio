import React from 'react';
import '../styles/InfoPages.css';

function AboutPage() {
  return (
    <main className="info-page">
      <h1>서비스 소개</h1>
      <p className="meta">자산관리 대장은 주식/ETF/연금 계좌를 함께 점검하는 운영형 기록 도구입니다.</p>
      <section className="info-section">
        <h2>무엇을 할 수 있나요?</h2>
        <p>현황, 매매일지, 상품추이, 종목정보, 스크리너를 하나의 워크플로우로 연결해 관리할 수 있습니다.</p>
      </section>
      <section className="info-section">
        <h2>누구를 위한 앱인가요?</h2>
        <p>퇴직연금 운용과 일반 증권계좌를 동시에 관리하면서 복기와 점검을 중요하게 보는 개인 투자자를 위한 앱입니다.</p>
      </section>
    </main>
  );
}

export default AboutPage;
