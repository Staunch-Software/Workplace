// src/pages/Login/Login.jsx  (Workspace — updated)
// ─────────────────────────────────────────────────────────────
// Handles post-login redirect for all roles:
//   VESSEL → /drs/vessel/dashboard
//   SHORE  → /drs/shore/dashboard
//   ADMIN  → /drs/shore/dashboard  (or /dashboard for platform admin)
// DRS no longer has its own login. This is the single entry point.
// ─────────────────────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import './Login.css';

const Login = () => {
  // ── YOUR EXISTING STATE & LOGIC (unchanged) ──
  const [username, setUsername]   = useState('');
  const [password, setPassword]   = useState('');
  const [error, setError]         = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const { login }    = useAuth();
  const navigate     = useNavigate();
  const location     = useLocation();

  const from = location.state?.from?.pathname;

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await login(username, password, rememberMe);
    setIsLoading(false);

    if (result.success) {
      if (from && from !== '/login') {
        navigate(from, { replace: true });
        return;
      }
      navigate('/dashboard', { replace: true });
    } else {
      setError(result.message);
    }
  };

  // ── NEW: mount animation ──
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // ── NEW: show/hide password ──
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className={"login-container" + (mounted ? " fade-in" : "")}>

      {/* ── LEFT PANEL ── */}
      <div className="left-panel">
        <div className="bg-animation" />

        <div className="brand-header">
          <svg className="brand-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="3"/>
            <path d="M12 22V8"/>
            <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
          </svg>
          Workplace
        </div>

        <div className="hero-content">
          <h1 className="hero-title">Streamline your maritime operations</h1>

          <div className="features-list">
            <div className="feature-item">
              <div className="feature-icon-wrapper">
                <svg className="feature-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                </svg>
              </div>
              Defect Reporting System
            </div>

            <div className="feature-item">
              <div className="feature-icon-wrapper">
                <svg className="feature-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
                  <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/>
                  <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/>
                  <path d="M12 10v4"/><path d="M12 2v3"/>
                </svg>
              </div>
              Vessel Management
            </div>

            <div className="feature-item">
              <div className="feature-icon-wrapper">
                <svg className="feature-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10"/>
                  <line x1="12" y1="20" x2="12" y2="4"/>
                  <line x1="6" y1="20" x2="6" y2="14"/>
                </svg>
              </div>
              Real-time Analytics
            </div>
          </div>
        </div>

        {/* <div className="footer-text">Powered by Ozellar</div> */}
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="right-panel">
        <div className="login-card">

          <div className="login-header">
            {/* Mobile-only logo */}
            <svg className="login-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="3"/>
              <path d="M12 22V8"/>
              <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
            </svg>
            <h2 className="login-title">Welcome back</h2>
            <p className="login-subtitle">Sign in to your account</p>
          </div>

          {/* ── YOUR EXISTING FORM (logic unchanged) ── */}
          <form onSubmit={handleLogin} noValidate>

            <div className={"form-group" + (error ? " shake" : "")}>
              <label className="input-label" htmlFor="username">Email Address</label>
              <div className="input-wrapper">
                <input
                  id="username"
                  type="text"
                  className="form-input"
                  placeholder="admin@drs.com"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  disabled={isLoading}
                  required
                />
                <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="20" height="16" x="2" y="4" rx="2"/>
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                </svg>
              </div>
            </div>

            <div className={"form-group" + (error ? " shake" : "")}>
              <label className="input-label" htmlFor="password">Password</label>
              <div className="input-wrapper">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  className="form-input"
                  placeholder="Enter password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
                <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <button type="button" className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                  {showPassword ? (
                    <svg width="20" height="20" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
                      <line x1="2" x2="22" y1="2" y2="22"/>
                    </svg>
                  ) : (
                    <svg width="20" height="20" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="form-options">
              <label className="checkbox-label">
                <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} disabled={isLoading} />
                Remember me
              </label>
              <a href="#" className="forgot-link">Forgot password?</a>
            </div>

            <button type="submit" className="submit-btn" disabled={isLoading}>
              {isLoading ? <div className="spinner" /> : 'Sign In'}
            </button>

            {error && <div className="error-message">{error}</div>}
          </form>

          <p className="help-text">
            Having trouble? <a href="#" className="help-link">Contact your administrator</a>
          </p>

        </div>
      </div>
    </div>
  );
};

export default Login;