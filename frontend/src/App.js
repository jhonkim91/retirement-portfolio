import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './App.css';
import Navigation from './components/Navigation';
import { applyPageMetadata } from './utils/seo';
import Login from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const DataDeletionRequest = lazy(() => import('./pages/DataDeletionRequest'));
const Landing = lazy(() => import('./pages/Landing'));
const ContactInfo = lazy(() => import('./pages/ContactInfo'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const HelpPage = lazy(() => import('./pages/HelpPage'));
const ImportCenter = lazy(() => import('./pages/ImportCenter'));
const Portfolio = lazy(() => import('./pages/Portfolio'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const StockScreener = lazy(() => import('./pages/StockScreener'));
const StockResearch = lazy(() => import('./pages/StockResearch'));
const TradeLog = lazy(() => import('./pages/TradeLog'));

const ROUTE_META = [
  { pattern: /^\/$/, title: '자산관리 대장', description: '오늘의 자산 현황, 이상 징후, 최근 일지를 빠르게 확인하세요.' },
  { pattern: /^\/dashboard$/, title: '운영 대시보드', description: '총자산, 오늘 변동, 편차, 이벤트를 한 화면에서 확인합니다.' },
  { pattern: /^\/portfolio$/, title: '포트폴리오 추이', description: '계좌별 자산 흐름과 상품 추이를 점검합니다.' },
  { pattern: /^\/trade-logs$/, title: '매매일지', description: '거래 기록, 저널, 캘린더 이벤트를 연결해 복기합니다.' },
  { pattern: /^\/imports$/, title: 'Import Center', description: '증권사 CSV를 미리보기 후 커밋하고 정합성 상태를 점검합니다.' },
  { pattern: /^\/stock-research$/, title: '종목 정보', description: '종목 스냅샷과 분석 리포트를 확인합니다.' },
  { pattern: /^\/stock-screener$/, title: '종목 스크리너', description: '저장 가능한 조건식으로 국내주식/ETF/연금 후보를 탐색합니다.' },
  { pattern: /^\/privacy-policy$/, title: '개인정보 처리방침', description: '개인정보 처리, 보관, 권리 행사를 안내합니다.' },
  { pattern: /^\/data-deletion$/, title: '데이터 삭제 요청', description: '계정/데이터 삭제 정책과 요청 절차를 제공합니다.' },
  { pattern: /^\/contact$/, title: '문의처', description: '개인정보/서비스 문의처와 안내를 확인합니다.' },
  { pattern: /^\/about$/, title: '서비스 소개', description: '자산관리 대장의 목적과 제공 기능을 소개합니다.' },
  { pattern: /^\/help$/, title: '도움말', description: '시작 가이드, 자주 묻는 질문, 운영 팁을 안내합니다.' },
  { pattern: /^\/login$/, title: '로그인', description: '자산관리 대장 로그인 화면입니다.', noindex: true }
];

function RouteMetadata() {
  const location = useLocation();
  const pathname = location.pathname || '/';
  const meta = useMemo(
    () => ROUTE_META.find((item) => item.pattern.test(pathname)) || ROUTE_META[0],
    [pathname]
  );

  useEffect(() => {
    applyPageMetadata({
      title: meta.title,
      description: meta.description,
      path: pathname,
      noindex: Boolean(meta.noindex)
    });
  }, [meta, pathname]);

  return null;
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    const savedUser = localStorage.getItem('user');
    if (token) {
      setUser({ token, ...(savedUser ? JSON.parse(savedUser) : {}) });
    }
    setLoading(false);
  }, []);

  if (loading) {
    return <div className="app-loading">불러오는 중...</div>;
  }

  return (
    <Router>
      <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
      <RouteMetadata />
      {user && <Navigation setUser={setUser} />}
      <main id="main-content">
        <Suspense fallback={<div className="app-loading">페이지를 준비하는 중입니다...</div>}>
          <Routes>
            <Route path="/login" element={!user ? <Login setUser={setUser} /> : <Navigate to="/" replace />} />
            <Route path="/" element={user ? <Dashboard /> : <Landing />} />
            <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/login" replace />} />
            <Route path="/portfolio" element={user ? <Portfolio /> : <Navigate to="/login" replace />} />
            <Route path="/trade-logs" element={user ? <TradeLog /> : <Navigate to="/login" replace />} />
            <Route path="/imports" element={user ? <ImportCenter /> : <Navigate to="/login" replace />} />
            <Route path="/stock-research" element={user ? <StockResearch /> : <Navigate to="/login" replace />} />
            <Route path="/stock-screener" element={user ? <StockScreener /> : <Navigate to="/login" replace />} />
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/contact" element={<ContactInfo />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/data-deletion" element={user ? <DataDeletionRequest setUser={setUser} /> : <Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to={user ? '/' : '/'} replace />} />
          </Routes>
        </Suspense>
      </main>
    </Router>
  );
}

export default App;
