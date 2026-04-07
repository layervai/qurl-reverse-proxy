import { useState, useEffect } from 'react';

interface LoginProps {
  onAuthenticated: (mode: 'account' | 'guest', email?: string) => void;
}

export function Login({ onAuthenticated }: LoginProps) {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState('production');

  useEffect(() => {
    // Check if already signed in from a previous session
    window.qurl.auth.status().then((status) => {
      if (status.signedIn) {
        onAuthenticated('account', status.email || undefined);
      }
      setEnv(status.environment);
    });
  }, [onAuthenticated]);

  const handleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      const result = await window.qurl.auth.signIn();
      if (result.success) {
        onAuthenticated('account', result.email);
      } else {
        setError(result.error || 'Sign-in failed');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSigningIn(false);
    }
  };

  const handleGuest = () => {
    onAuthenticated('guest');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '40px',
        textAlign: 'center',
      }}
    >
      {/* Drag region for macOS titlebar */}
      <div className="titlebar-drag" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 44 }} />

      <div
        style={{
          fontSize: 42,
          fontWeight: 700,
          background: 'var(--gradient-accent)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          letterSpacing: '-0.02em',
          marginBottom: '8px',
        }}
      >
        QURL
      </div>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 15, marginBottom: '40px', maxWidth: 340 }}>
        Share files and services securely with time-limited, encrypted links.
      </p>

      <button
        onClick={handleSignIn}
        disabled={signingIn}
        style={{
          background: 'var(--gradient-accent)',
          color: '#fff',
          padding: '14px 48px',
          borderRadius: 'var(--radius-md)',
          fontWeight: 600,
          fontSize: 15,
          cursor: signingIn ? 'wait' : 'pointer',
          opacity: signingIn ? 0.7 : 1,
          transition: 'opacity var(--transition-fast)',
          marginBottom: '12px',
          width: 300,
        }}
        onMouseEnter={(e) => { if (!signingIn) e.currentTarget.style.opacity = '0.9'; }}
        onMouseLeave={(e) => { if (!signingIn) e.currentTarget.style.opacity = '1'; }}
      >
        {signingIn ? 'Opening browser...' : 'Sign in with Browser'}
      </button>

      <button
        onClick={handleGuest}
        disabled={signingIn}
        style={{
          background: 'var(--color-bg-tertiary)',
          color: 'var(--color-text-secondary)',
          padding: '14px 48px',
          borderRadius: 'var(--radius-md)',
          fontWeight: 500,
          fontSize: 14,
          cursor: 'pointer',
          transition: 'all var(--transition-fast)',
          width: 300,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-bg-tertiary)'; }}
      >
        Continue as Guest
      </button>

      {error && (
        <div style={{
          marginTop: '20px',
          padding: '12px 20px',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(248, 113, 113, 0.08)',
          border: '1px solid rgba(248, 113, 113, 0.2)',
          color: 'var(--color-accent-red)',
          fontSize: 13,
          maxWidth: 400,
          textAlign: 'left',
          whiteSpace: 'pre-wrap',
        }}>
          {error}
        </div>
      )}

      <p style={{ color: 'var(--color-text-muted)', fontSize: 11, marginTop: '32px' }}>
        An account is required to create shareable QURL links.
        <br />
        Guest mode allows local tunnel management only.
      </p>

      <div style={{
        position: 'fixed', bottom: 16, right: 16,
        fontSize: 10, color: 'var(--color-text-muted)',
        background: 'var(--color-bg-tertiary)',
        padding: '3px 8px', borderRadius: 'var(--radius-sm)',
      }}>
        {env}
      </div>
    </div>
  );
}
