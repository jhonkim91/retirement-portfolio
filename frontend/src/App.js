import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import './App.css';
import Navigation from './components/Navigation';
import Dashboard from './pages/Dashboard';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Portfolio from './pages/Portfolio';
import StockScreener from './pages/StockScreener';
import StockResearch from './pages/StockResearch';
import TradeLog from './pages/TradeLog';

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
      {user && <Navigation setUser={setUser} />}
      <div id="main-content">
        <Routes>
          <Route path="/login" element={!user ? <Login setUser={setUser} /> : <Navigate to="/" replace />} />
          <Route path="/" element={user ? <Dashboard /> : <Landing />} />
          <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/login" replace />} />
          <Route path="/portfolio" element={user ? <Portfolio /> : <Navigate to="/login" replace />} />
          <Route path="/trade-logs" element={user ? <TradeLog /> : <Navigate to="/login" replace />} />
          <Route path="/stock-research" element={user ? <StockResearch /> : <Navigate to="/login" replace />} />
          <Route path="/stock-screener" element={user ? <StockScreener /> : <Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to={user ? '/' : '/'} replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
