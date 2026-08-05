import { useState, type CSSProperties, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';

export function Login() {
  const { signInWithPassword, signUpWithPassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location })?.from?.pathname ?? '/';

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result =
      mode === 'signin'
        ? await signInWithPassword(email, password)
        : await signUpWithPassword(email, password);
    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    if (mode === 'signup') {
      // Supabase Auth may require email confirmation before a session exists.
      setConfirmSent(true);
      return;
    }
    navigate(from, { replace: true });
  }

  return (
    <div
      style={{
        maxWidth: 360,
        margin: '80px auto',
        padding: '0 24px',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 24 }}>
        <b style={{ color: 'var(--navy)' }}>Blue</b>Prep
      </div>
      <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>
        {mode === 'signin' ? 'Sign in' : 'Create an account'}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: '0 0 24px' }}>
        {mode === 'signin' ? 'Welcome back.' : 'Start tracking your practice.'}
      </p>

      {confirmSent ? (
        <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          Check <b>{email}</b> for a confirmation link, then sign in.
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, margin: '14px 0 6px' }}>
            Password
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
          </label>

          {error && (
            <p style={{ color: 'var(--red)', fontSize: 12.5, margin: '10px 0 0' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              width: '100%',
              marginTop: 20,
              padding: '11px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--navy)',
              color: '#fff',
              fontWeight: 700,
              fontSize: 14,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
          </button>
        </form>
      )}

      <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', marginTop: 18, textAlign: 'center' }}>
        {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
            setConfirmSent(false);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--navy)',
            fontWeight: 700,
            cursor: 'pointer',
            padding: 0,
            font: 'inherit',
          }}
        >
          {mode === 'signin' ? 'Sign up' : 'Sign in'}
        </button>
      </p>
    </div>
  );
}

const inputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: '9px 10px',
  fontSize: 14,
  borderRadius: 7,
  border: '1.5px solid var(--line)',
  background: 'var(--bg)',
  color: 'var(--ink)',
  fontWeight: 400,
};
