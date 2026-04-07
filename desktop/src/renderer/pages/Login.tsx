import { useState, useEffect } from 'react';

interface LoginProps {
  onAuthenticated: (mode: 'account' | 'guest', email?: string, apiKeyHint?: string) => void;
}

export function Login({ onAuthenticated }: LoginProps) {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState('production');

  const [showKeyInput, setShowKeyInput] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyEnv, setKeyEnv] = useState<string | null>(null);
  const [validatingKey, setValidatingKey] = useState(false);

  useEffect(() => {
    window.qurl.auth.status().then((status) => {
      if (status.signedIn) {
        onAuthenticated('account', status.email || undefined, status.apiKeyHint || undefined);
      }
      setEnv(status.environment);
    });
  }, [onAuthenticated]);

  useEffect(() => {
    if (apiKey.startsWith('lv_live_')) setKeyEnv('production');
    else if (apiKey.startsWith('lv_test_')) setKeyEnv('staging');
    else setKeyEnv(null);
  }, [apiKey]);

  const handleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      const result = await window.qurl.auth.signIn();
      if (result.success) onAuthenticated('account', result.email);
      else setError(result.error || 'Sign-in failed');
    } catch (err) {
      setError(String(err));
    } finally {
      setSigningIn(false);
    }
  };

  const handleKeySignIn = async () => {
    setError(null);
    if (!apiKey.startsWith('lv_live_') && !apiKey.startsWith('lv_test_')) {
      setError('API keys must start with lv_live_ or lv_test_');
      return;
    }
    setValidatingKey(true);
    try {
      const result = await window.qurl.auth.signInWithKey(apiKey);
      if (result.success) onAuthenticated('account', undefined, result.apiKeyHint);
      else setError(result.error || 'API key validation failed');
    } catch (err) {
      setError(String(err));
    } finally {
      setValidatingKey(false);
    }
  };

  const busy = signingIn || validatingKey;

  return (
    <div className="flex flex-col items-center justify-center h-full p-10 text-center relative">
      <div className="titlebar-drag fixed top-0 left-0 right-0 h-[44px]" />

      {/* Background glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(0,153,255,0.08)_0%,transparent_70%)] pointer-events-none" />

      {/* Logo */}
      <div className="mb-8 relative">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#0099FF] to-[#D406B9] flex items-center justify-center mx-auto mb-4 shadow-[0_0_40px_rgba(0,153,255,0.2)]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
          </svg>
        </div>
        <h1 className="gradient-text text-4xl font-extrabold tracking-tight">QURL</h1>
        <p className="text-text-secondary text-sm mt-2 max-w-[280px]">
          Secure, time-limited links for URLs, files, and private services.
        </p>
      </div>

      {/* Auth options */}
      <div className="w-[320px] flex flex-col gap-2.5">
        {/* Browser sign-in */}
        <button
          onClick={handleSignIn}
          disabled={busy}
          className={[
            'bg-gradient-to-br from-[#0099FF] to-[#D406B9] text-white',
            'py-3 rounded-lg font-semibold text-sm w-full',
            'transition-all duration-200',
            busy ? 'cursor-wait opacity-60' : 'cursor-pointer hover:shadow-[0_0_24px_rgba(0,153,255,0.3)] hover:scale-[1.01] active:scale-[0.99]',
          ].join(' ')}
        >
          {signingIn ? 'Opening browser...' : 'Sign in with Browser'}
        </button>

        {/* API key toggle */}
        <button
          onClick={() => { setShowKeyInput(!showKeyInput); setError(null); }}
          disabled={busy}
          className="bg-surface-2 text-text-secondary py-3 rounded-lg font-medium text-sm cursor-pointer transition-colors w-full hover:bg-surface-3 border border-glass-border"
        >
          Sign in with API Key
        </button>

        {/* API key form */}
        {showKeyInput && (
          <div className="p-4 rounded-lg bg-surface-2 border border-glass-border text-left animate-in">
            <label className="text-[11px] text-text-muted block mb-1.5 font-medium">
              API Key
              {keyEnv && (
                <span className={[
                  'ml-2 text-[10px] font-semibold py-px px-1.5 rounded',
                  keyEnv === 'production'
                    ? 'bg-[rgba(16,185,129,0.12)] text-success'
                    : 'bg-[rgba(245,158,11,0.12)] text-warning',
                ].join(' ')}>
                  {keyEnv === 'production' ? 'Production' : 'Staging'}
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="lv_live_..."
                disabled={validatingKey}
                className="w-full py-2.5 pl-3 pr-12 rounded-md border border-glass-border bg-surface-0 text-text-primary text-[13px] font-mono"
                onKeyDown={(e) => { if (e.key === 'Enter' && apiKey) handleKeySignIn(); }}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent text-text-muted text-[11px] cursor-pointer py-1 px-1.5 rounded hover:text-text-secondary transition-colors"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <button
              onClick={handleKeySignIn}
              disabled={!apiKey || validatingKey}
              className={[
                'mt-3 w-full py-2.5 rounded-md font-semibold text-[13px] transition-all duration-150',
                apiKey && !validatingKey
                  ? 'bg-accent text-white cursor-pointer hover:bg-[#0088ee]'
                  : 'bg-surface-3 text-text-muted cursor-not-allowed',
              ].join(' ')}
            >
              {validatingKey ? 'Validating...' : 'Connect'}
            </button>
          </div>
        )}

        {/* Divider */}
        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-glass-border" />
          <span className="text-[10px] text-text-muted uppercase tracking-widest">or</span>
          <div className="flex-1 h-px bg-glass-border" />
        </div>

        {/* Guest */}
        <button
          onClick={() => onAuthenticated('guest')}
          disabled={busy}
          className="text-text-muted py-2.5 rounded-lg text-[13px] cursor-pointer transition-colors hover:text-text-secondary bg-transparent"
        >
          Continue as Guest
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-5 py-2.5 px-4 rounded-lg bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.15)] text-danger text-[13px] max-w-[360px] text-left animate-in">
          {error}
        </div>
      )}

      <p className="text-text-muted text-[11px] mt-8 max-w-[280px] leading-relaxed">
        Sign in to create shareable QURL links.
        Guest mode allows local tunnel management only.
      </p>

      {/* Environment badge */}
      <div className="fixed bottom-3 right-3 text-[10px] text-text-muted bg-surface-2 py-0.5 px-2 rounded font-mono border border-glass-border">
        {env}
      </div>
    </div>
  );
}
