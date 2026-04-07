import { useState, useEffect, useCallback } from 'react';
import { Login } from './pages/Login';
import { Share } from './pages/Share';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';

type Page = 'share' | 'dashboard' | 'settings';
type AuthMode = 'none' | 'account' | 'guest';

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'share', label: 'Share', icon: '\u2B06' },
  { id: 'dashboard', label: 'Services', icon: '\u25A3' },
  { id: 'settings', label: 'Settings', icon: '\u2699' },
];

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        width: '100%',
        padding: '10px 14px',
        borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--color-bg-tertiary)' : 'transparent',
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        fontWeight: active ? 600 : 400,
        fontSize: 13,
        textAlign: 'left',
        transition: 'all var(--transition-fast)',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--color-bg-hover)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{icon}</span>
      {label}
    </button>
  );
}

export function App() {
  const [page, setPage] = useState<Page>('share');
  const [authMode, setAuthMode] = useState<AuthMode>('none');
  const [email, setEmail] = useState<string | null>(null);
  const [apiKeyHint, setApiKeyHint] = useState<string | null>(null);

  useEffect(() => {
    // Check persisted auth mode for guest
    const savedMode = localStorage.getItem('qurl:authMode') as AuthMode | null;
    if (savedMode === 'guest') {
      setAuthMode('guest');
    }
    // Account auth is checked by Login component via auth:status IPC
  }, []);

  const handleAuthenticated = useCallback((mode: 'account' | 'guest', userEmail?: string, keyHint?: string) => {
    setAuthMode(mode);
    setEmail(userEmail || null);
    setApiKeyHint(keyHint || null);
    localStorage.setItem('qurl:authMode', mode);
  }, []);

  const handleSignOut = useCallback(async () => {
    if (authMode === 'account') {
      await window.qurl.auth.signOut();
    }
    setAuthMode('none');
    setEmail(null);
    setApiKeyHint(null);
    localStorage.removeItem('qurl:authMode');
  }, [authMode]);

  if (authMode === 'none') {
    return <Login onAuthenticated={handleAuthenticated} />;
  }

  const isGuest = authMode === 'guest';

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Sidebar */}
      <nav
        className="titlebar-drag"
        style={{
          width: 200,
          flexShrink: 0,
          background: 'var(--color-bg-secondary)',
          borderRight: '1px solid var(--color-border)',
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 44,
        }}
      >
        {/* Brand */}
        <div style={{ padding: '8px 16px 20px', borderBottom: '1px solid var(--color-border)', marginBottom: '12px' }}>
          <div style={{
            fontSize: 18, fontWeight: 700,
            background: 'var(--gradient-accent)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            letterSpacing: '-0.02em',
          }}>
            QURL
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: '2px' }}>
            {isGuest ? 'Guest Mode' : (email || apiKeyHint || 'Signed In')}
          </div>
        </div>

        {/* Navigation */}
        <div className="titlebar-no-drag" style={{ padding: '0 8px', flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {NAV_ITEMS.map((item) => {
              // Disable Share for guests (can't create QURLs without account)
              const disabled = isGuest && item.id === 'share';
              return (
                <div key={item.id} style={{ opacity: disabled ? 0.4 : 1 }} title={disabled ? 'Sign in to share files' : ''}>
                  <NavButton
                    icon={item.icon}
                    label={item.label}
                    active={page === item.id}
                    onClick={() => { if (!disabled) setPage(item.id); }}
                  />
                </div>
              );
            })}
          </div>

          {isGuest && (
            <div className="titlebar-no-drag" style={{ padding: '12px 6px' }}>
              <button
                onClick={handleSignOut}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--gradient-accent)',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Sign in for full access
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="titlebar-no-drag"
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>v0.1.0</span>
          <button
            onClick={handleSignOut}
            style={{
              fontSize: 11, color: 'var(--color-text-muted)', background: 'transparent',
              cursor: 'pointer', padding: '2px 6px', borderRadius: 'var(--radius-sm)',
              transition: 'color var(--transition-fast)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-accent-red)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            Sign Out
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'auto', padding: '32px', paddingTop: 56 }}>
        {page === 'share' && <Share />}
        {page === 'dashboard' && <Dashboard />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  );
}
