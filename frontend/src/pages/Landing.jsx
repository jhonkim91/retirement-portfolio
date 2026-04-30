import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/Landing.css';

const FEATURES = [
  {
    title: '현황과 성과 분석',
    body: '계좌별 원금, 평가액, 수익률, 벤치마크 비교, 드로우다운과 리밸런싱 차이를 한 화면에서 봅니다.'
  },
  {
    title: '퇴직연금 적격성 점검',
    body: 'IRP·DC 기준 위험자산 가이드와 연금 비적격 자산 경고를 함께 보여줘서 연금 계좌와 일반 계좌를 구분해 해석합니다.'
  },
  {
    title: '매매일지와 감사 이력',
    body: '매수·매도·입금 기록을 누적 관리하고, 수정과 삭제 이력도 append-only 이벤트 체인으로 남겨서 추적할 수 있습니다.'
  },
  {
    title: '종목 정보와 스크리너',
    body: '보유 종목 점검, 신규 후보 탐색, benchmark 비교 흐름을 이어서 확인하고 계좌 분석과 연결합니다.'
  }
];

const FAQS = [
  {
    question: '이 앱은 무엇을 관리하나요?',
    answer: '주식 통장과 퇴직연금/IRP 계좌를 함께 관리하면서, 보유 상품·매매일지·추이·분석 엔진·스크리너를 하나의 흐름으로 연결합니다.'
  },
  {
    question: '실시간 시세인가요?',
    answer: '아닙니다. 카드와 차트마다 출처와 기준 시각, 지연 여부를 표시합니다. 거래소 시세, 펀드 기준가, 사용자 입력 대장은 갱신 주기가 서로 다를 수 있습니다.'
  },
  {
    question: '퇴직연금 규칙도 반영되나요?',
    answer: '연금 계좌에서는 적격성 분류, 위험자산 70% 가이드, 연금 비적격 후보 경고를 함께 보여주도록 구성했습니다.'
  }
];

function Landing() {
  return (
    <>
      <a className="skip-link" href="#landing-main">본문으로 건너뛰기</a>
      <main id="landing-main" className="landing-page">
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">주식 · 퇴직연금 · IRP · 매매일지 · 스크리너</p>
            <h1>자산관리 대장</h1>
            <p className="landing-summary">
              주식 통장과 퇴직연금 계좌를 한곳에서 기록하고, 연금 적격성 규칙과 성과 분석 엔진까지 함께 보는 개인 자산 운영 도구입니다.
            </p>
            <div className="landing-actions">
              <Link className="landing-primary" to="/login">로그인하고 시작</Link>
              <a className="landing-secondary" href="#landing-features">기능 구조 보기</a>
            </div>
            <ul className="landing-meta-list">
              <li>데이터 카드마다 출처와 기준 시각을 표시합니다.</li>
              <li>연금 계좌와 일반 계좌를 다른 템플릿으로 해석합니다.</li>
              <li>매매일지 수정/삭제도 감사 이력으로 남깁니다.</li>
            </ul>
          </div>
          <div className="landing-hero-panel" aria-label="핵심 안내">
            <div className="landing-hero-card">
              <strong>현황</strong>
              <span>원금, 평가액, 수익률, benchmark 비교</span>
            </div>
            <div className="landing-hero-card">
              <strong>상품 추이</strong>
              <span>매수 이력 반영 추이와 기준가 수익률</span>
            </div>
            <div className="landing-hero-card">
              <strong>매매일지</strong>
              <span>append-only 감사 이력과 export</span>
            </div>
            <div className="landing-hero-card">
              <strong>종목 정보 / 스크리너</strong>
              <span>연금 적격성, 시세 스냅샷, 후보 탐색</span>
            </div>
          </div>
        </section>

        <section id="landing-features" className="landing-band">
          <div className="landing-section-head">
            <h2>핵심 기능</h2>
            <p>데이터 출처, 계좌 규칙, 성과 해석을 한 흐름으로 연결해 둔 구조입니다.</p>
          </div>
          <div className="landing-feature-grid">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="landing-feature-card">
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-band landing-band-muted">
          <div className="landing-section-head">
            <h2>데이터 안내</h2>
            <p>거래소 시세, 펀드 기준가, 사용자 입력 대장은 갱신 주기와 기준 시각이 서로 다를 수 있습니다.</p>
          </div>
          <div className="landing-info-grid">
            <article>
              <h3>시장 시세</h3>
              <p>국내 ETF/주식 시세는 거래소 기반 지연 시세 또는 일별 종가를 사용합니다.</p>
            </article>
            <article>
              <h3>펀드 기준가</h3>
              <p>펀드는 기준가와 비교 공시 주기를 함께 확인해야 하며, 시세 카드에서 출처와 기준일을 같이 표시합니다.</p>
            </article>
            <article>
              <h3>대장 데이터</h3>
              <p>매매일지와 보유 대장은 사용자 입력을 기준으로 하며, 외부 시세와 섞일 때는 혼합 경고를 보여줍니다.</p>
            </article>
          </div>
        </section>

        <section className="landing-band">
          <div className="landing-section-head">
            <h2>자주 묻는 질문</h2>
          </div>
          <div className="landing-faq-list">
            {FAQS.map((item) => (
              <article key={item.question} className="landing-faq-item">
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-band landing-disclaimer">
          <h2>면책 안내</h2>
          <p>
            이 서비스는 개인 기록과 점검을 돕는 도구이며, 투자 권유나 법적·세무 자문을 대신하지 않습니다.
            계좌 규칙, 공시, 사업자별 연금 제도는 실제 가입 조건과 최신 공시를 함께 확인해 주세요.
          </p>
          <p>
            <Link to="/privacy-policy">개인정보 처리방침</Link> · <Link to="/contact">문의처</Link>
          </p>
        </section>
      </main>
    </>
  );
}

export default Landing;
