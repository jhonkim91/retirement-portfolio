import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { clearStoredAccountName } from '../utils/api';
import '../styles/Navigation.css';

function Navigation({ setUser }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    clearStoredAccountName();
    setUser(null);
    navigate('/login');
  };

  const linkClass = (path) => `nav-link ${location.pathname === path ? 'active' : ''}`;

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-logo">자산관리 대장</Link>
        <div className="nav-menu">
          <Link to="/" className={linkClass('/')}>현황</Link>
          <Link to="/portfolio" className={linkClass('/portfolio')}>상품 추이</Link>
          <Link to="/trade-logs" className={linkClass('/trade-logs')}>매매일지</Link>
          <Link to="/imports" className={linkClass('/imports')}>불러오기</Link>
          <Link to="/stock-research" className={linkClass('/stock-research')}>종목 정보</Link>
          <Link to="/stock-screener" className={linkClass('/stock-screener')}>스크리너</Link>
          <Link to="/about" className={linkClass('/about')}>소개</Link>
          <Link to="/help" className={linkClass('/help')}>도움말</Link>
          <Link to="/privacy-policy" className={linkClass('/privacy-policy')}>개인정보</Link>
          <Link to="/data-deletion" className={linkClass('/data-deletion')}>삭제요청</Link>
          <Link to="/contact" className={linkClass('/contact')}>문의처</Link>
        </div>
        <div className="nav-user">
          <span className="user-name">{user.username}</span>
          <button type="button" onClick={handleLogout} className="logout-btn">로그아웃</button>
        </div>
      </div>
    </nav>
  );
}

export default Navigation;
