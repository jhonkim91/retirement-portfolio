import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import '../styles/Navigation.css';

function Navigation({ setUser }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    setUser(null);
    navigate('/login');
  };

  const linkClass = (path) => `nav-link ${location.pathname === path ? 'active' : ''}`;

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-logo">퇴직연금 관리대장</Link>
        <div className="nav-menu">
          <Link to="/" className={linkClass('/')}>현황</Link>
          <Link to="/portfolio" className={linkClass('/portfolio')}>상품/추이</Link>
          <Link to="/trade-logs" className={linkClass('/trade-logs')}>매매일지</Link>
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
