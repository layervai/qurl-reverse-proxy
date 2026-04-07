import { useState, useEffect } from 'react';

interface LoginProps {
  onAuthenticated: (mode: 'account' | 'guest', email?: string, apiKeyHint?: string) => void;
}

export function Login({ onAuthenticated }: LoginProps) {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState('production');

  // API key sign-in state
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyEnv, setKeyEnv] = useState<string | null>(null);
  const [validatingKey, setValidatingKey] = useState(false);

  useEffect(() => {
    // Check if already signed in from a previous session
    window.qurl.auth.status().then((status) => {
      if (status.signedIn) {
        onAuthenticated('account', status.email || undefined, status.apiKeyHint || undefined);
      }
      setEnv(status.environment);
    });
  }, [onAuthenticated]);

  // Derive environment badge from key prefix as the user types
  useEffect(() => {
    if (apiKey.startsWith('lv_live_')) {
      setKeyEnv('production');
    } else if (apiKey.startsWith('lv_test_')) {
      setKeyEnv('staging');
    } else {
      setKeyEnv(null);
    }
  }, [apiKey]);

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

  const handleKeySignIn = async () => {
    setError(null);

    // Client-side prefix validation
    if (!apiKey.startsWith('lv_live_') && !apiKey.startsWith('lv_test_')) {
      setError('Invalid API key prefix. Keys must start with lv_live_ or lv_test_.');
      return;
    }

    setValidatingKey(true);
    try {
      const result = await window.qurl.auth.signInWithKey(apiKey);
      if (result.success) {
        onAuthenticated('account', undefined, result.apiKeyHint);
      } else {
        setError(result.error || 'API key validation failed');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setValidatingKey(false);
    }
  };

  const handleGuest = () => {
    onAuthenticated('guest');
  };

  const busy = signingIn || validatingKey;

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

      {/* 1. Sign in with Browser (OAuth) */}
      <button
        onClick={handleSignIn}
        disabled={busy}
        style={{
          background: 'var(--gradient-accent)',
          color: '#fff',
          padding: '14px 48px',
          borderRadius: 'var(--radius-md)',
          fontWeight: 600,
          fontSize: 15,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.7 : 1,
          transition: 'opacity var(--transition-fast)',
          marginBottom: '12px',
          width: 300,
        }}
        onMouseEnter={(e) => { if (!busy) e.currentTarget.style.opacity = '0.9'; }}
        onMouseLeave={(e) => { if (!busy) e.currentTarget.style.opacity = '1'; }}
      >
        {signingIn ? 'Opening browser...' : 'Sign in with Browser'}
      </button>

      {/* 2. Sign in with API Key (expandable) */}
      <button
        onClick={() => { setShowKeyInput(!showKeyInput); setError(null); }}
        disabled={busy}
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
          marginBottom: '4px',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-bg-tertiary)'; }}
      >
        Sign in with API Key
      </button>

      {showKeyInput && (
        <div style={{
          width: 300,
          marginTop: '8px',
          marginBottom: '8px',
          padding: '16px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          textAlign: 'left',
        }}>
          <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>
            API Key
            {keyEnv && (
              <span style={{
                marginLeft: '8px',
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
                background: keyEnv === 'production' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(234, 179, 8, 0.12)',
                color: keyEnv === 'production' ? '#22c55e' : '#eab308',
              }}>
                {keyEnv === 'production' ? 'Production' : 'Staging'}
              </span>
            )}
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="lv_live_..."
              disabled={validatingKey}
              style={{
                width: '100%',
                padding: '10px 36px 10px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-primary)',
                color: 'var(--color-text-primary)',
                fontSize: 13,
                fontFamily: 'monospace',
                boxSizing: 'border-box',
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' && apiKey) handleKeySignIn(); }}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                color: 'var(--color-text-muted)',
                fontSize: 12,
                cursor: 'pointer',
                padding: '2px 4px',
              }}
              title={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <button
            onClick={handleKeySignIn}
            disabled={!apiKey || validatingKey}
            style={{
              marginTop: '10px',
              width: '100%',
              padding: '10px',
              borderRadius: 'var(--radius-sm)',
              background: apiKey ? 'var(--gradient-accent)' : 'var(--color-bg-tertiary)',
              color: apiKey ? '#fff' : 'var(--color-text-muted)',
              fontWeight: 600,
              fontSize: 13,
              cursor: !apiKey || validatingKey ? 'not-allowed' : 'pointer',
              opacity: validatingKey ? 0.7 : 1,
              transition: 'all var(--transition-fast)',
            }}
          >
            {validatingKey ? 'Validating...' : 'Connect'}
          </button>
          <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: '8px', marginBottom: 0 }}>
            Get your API key from the LayerV portal.
          </p>
        </div>
      )}

      {/* 3. Continue as Guest */}
      <button
        onClick={handleGuest}
        disabled={busy}
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
          marginTop: showKeyInput ? '4px' : '0px',
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
