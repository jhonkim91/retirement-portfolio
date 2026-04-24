import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI } from '../utils/api';
import '../styles/Login.css';

function Login({ setUser }) {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (event) => {
    setFormData((prev) => ({ ...prev, [event.target.name]: event.target.value }));
    setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isLogin) {
        if (!formData.username || !formData.password) throw new Error('사용자명과 비밀번호를 입력하세요.');
        const response = await authAPI.login(formData.username, formData.password);
        localStorage.setItem('access_token', response.access_token);
        localStorage.setItem('user', JSON.stringify(response.user));
        setUser({ token: response.access_token, ...response.user });
        navigate('/');
      } else {
        if (!formData.username || !formData.email || !formData.password) throw new Error('모든 항목을 입력하세요.');
        if (formData.password !== formData.confirmPassword) throw new Error('비밀번호가 일치하지 않습니다.');
        if (formData.password.length < 6) throw new Error('비밀번호는 6자 이상이어야 합니다.');
        await authAPI.register(formData.username, formData.email, formData.password);
        setIsLogin(true);
        setFormData({ username: formData.username, email: '', password: '', confirmPassword: '' });
        setError('회원가입이 완료되었습니다. 로그인하세요.');
      }
    } catch (err) {
      setError(err.message || '처리 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>퇴직연금 관리대장</h1>
        <p className="subtitle">사용자별로 분리해 보는 개인 퇴직연금 기록</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>사용자명</label>
            <input name="username" value={formData.username} onChange={handleChange} placeholder="사용자명" required />
          </div>
          {!isLogin && (
            <div className="form-group">
              <label>이메일</label>
              <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="name@example.com" required />
            </div>
          )}
          <div className="form-group">
            <label>비밀번호</label>
            <input type="password" name="password" value={formData.password} onChange={handleChange} placeholder="비밀번호" required />
          </div>
          {!isLogin && (
            <div className="form-group">
              <label>비밀번호 확인</label>
              <input type="password" name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} placeholder="비밀번호 확인" required />
            </div>
          )}
          {error && <div className={error.includes('완료') ? 'success-message' : 'error-message'}>{error}</div>}
          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? '처리 중...' : isLogin ? '로그인' : '회원가입'}
          </button>
        </form>
        <div className="toggle-auth">
          <button type="button" className="toggle-btn" onClick={() => { setIsLogin(!isLogin); setError(''); }}>
            {isLogin ? '새 계정 만들기' : '로그인으로 돌아가기'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Login;
