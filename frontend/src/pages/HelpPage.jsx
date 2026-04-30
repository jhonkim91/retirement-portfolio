import React from 'react';
import '../styles/InfoPages.css';

function HelpPage() {
  return (
    <main className="info-page">
      <h1>도움말</h1>
      <p className="meta">처음 시작할 때 필요한 최소 가이드를 정리했습니다.</p>
      <section className="info-section">
        <h2>시작 순서</h2>
        <p>1) 통장 선택/생성 → 2) 매매일지 입력 → 3) 현황/추이 확인 → 4) 스크리너 후보를 관심종목으로 관리</p>
      </section>
      <section className="info-section">
        <h2>데이터 갱신</h2>
        <p>장중에는 시세 공급자 지연이 있을 수 있습니다. 화면의 source/asOf 배지를 함께 확인하세요.</p>
      </section>
      <section className="info-section">
        <h2>문의</h2>
        <p>정책/개인정보 문의는 문의처 페이지에서 확인할 수 있습니다.</p>
      </section>
    </main>
  );
}

export default HelpPage;
