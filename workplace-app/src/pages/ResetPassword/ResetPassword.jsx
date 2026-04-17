import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../api/axios';

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    setStatus('loading');
    setErrorMsg('');
    try {
      await api.post('/auth/reset-password', { token, new_password: newPassword });
      setStatus('success');
      setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.response?.data?.detail || 'Something went wrong. Please request a new reset link.');
    }
  };

  const containerStyle = {
    minHeight: '100vh', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: '#f1f5f9', padding: '16px',
    fontFamily: "'Inter', sans-serif",
  };
  const cardStyle = {
    background: '#fff', borderRadius: '16px', padding: '40px 36px',
    width: '100%', maxWidth: '420px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.10)',
  };

  if (!token) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ color: '#0f172a', marginBottom: '8px' }}>Invalid Link</h2>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '24px' }}>
            This password reset link is missing or invalid. Please request a new one.
          </p>
          <button onClick={() => navigate('/login')} style={btnStyle}>Back to Login</button>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '50%',
            background: '#dcfce7', color: '#16a34a', fontSize: '1.8rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>✓</div>
          <h2 style={{ color: '#0f172a', marginBottom: '8px' }}>Password Reset!</h2>
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
            Your password has been updated. Redirecting to login...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h2 style={{ color: '#0f172a', fontSize: '1.25rem', fontWeight: 700, marginBottom: '6px' }}>
          Set new password
        </h2>
        <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '28px' }}>
          Choose a strong password for your account.
        </p>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>New password</label>
            <input
              style={inputStyle}
              type="password"
              placeholder="Min. 8 characters"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              disabled={status === 'loading'}
            />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Confirm password</label>
            <input
              style={inputStyle}
              type="password"
              placeholder="Repeat new password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              disabled={status === 'loading'}
            />
          </div>
          {(errorMsg || status === 'error') && (
            <p style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: '12px' }}>{errorMsg}</p>
          )}
          <button style={btnStyle} type="submit" disabled={status === 'loading'}>
            {status === 'loading' ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  );
};

const labelStyle = {
  display: 'block', fontSize: '0.8rem', fontWeight: 600,
  color: '#374151', marginBottom: '6px',
};
const inputStyle = {
  display: 'block', width: '100%', boxSizing: 'border-box',
  padding: '10px 14px', border: '1px solid #e2e8f0',
  borderRadius: '8px', fontSize: '0.875rem', color: '#0f172a',
  background: '#f8fafc', outline: 'none',
};
const btnStyle = {
  display: 'block', width: '100%', padding: '11px',
  border: 'none', borderRadius: '8px',
  background: '#2563eb', color: '#fff',
  fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
};

export default ResetPassword;
