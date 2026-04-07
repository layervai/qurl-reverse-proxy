import { useState, useEffect, useCallback } from 'react';
import { Login } from './pages/Login';
import { Share } from './pages/Share';
import { Dashboard } from './pages/Dashboard';
import { Resources } from './pages/Resources';
import { Settings } from './pages/Settings';

type Page = 'share' | 'resources' | 'connections' | 'settings';
type AuthMode = 'none' | 'account' | 'guest';

const NAV_ITEMS: { id: Page; label: string; iconPath: string; guestDisabled?: boolean }[] = [
  {
    id: 'share',
    label: 'Share',
    iconPath: 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z',
    guestDisabled: true,
  },
  {
    id: 'resources',
    label: 'Resources',
    iconPath: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z',
    guestDisabled: true,
  },
  {
    id: 'connections',
    label: 'Connections',
    iconPath: 'M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z',
  },
  {
    id: 'settings',
    label: 'Settings',
    iconPath: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41L9.25 5.35C8.66 5.59 8.12 5.92 7.63 6.29L5.24 5.33c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  },
];

function NavIcon({ path, size = 18 }: { path: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
      <path d={path} />
    </svg>
  );
}

function renderPage(page: Page) {
  switch (page) {
    case 'share': return <Share />;
    case 'resources': return <Resources />;
    case 'connections': return <Dashboard />;
    case 'settings': return <Settings />;
  }
}

export function App() {
  const [page, setPage] = useState<Page>('share');
  const [authMode, setAuthMode] = useState<AuthMode>('none');
  const [email, setEmail] = useState<string | null>(null);
  const [apiKeyHint, setApiKeyHint] = useState<string | null>(null);

  useEffect(() => {
    const savedMode = localStorage.getItem('qurl:authMode') as AuthMode | null;
    if (savedMode === 'guest') setAuthMode('guest');
  }, []);

  const handleAuthenticated = useCallback((mode: 'account' | 'guest', userEmail?: string, keyHint?: string) => {
    setAuthMode(mode);
    setEmail(userEmail || null);
    setApiKeyHint(keyHint || null);
    localStorage.setItem('qurl:authMode', mode);
  }, []);

  const handleSignOut = useCallback(async () => {
    if (authMode === 'account') await window.qurl.auth.signOut();
    setAuthMode('none');
    setEmail(null);
    setApiKeyHint(null);
    localStorage.removeItem('qurl:authMode');
  }, [authMode]);

  if (authMode === 'none') return <Login onAuthenticated={handleAuthenticated} />;

  const isGuest = authMode === 'guest';
  const activePage = page;

  return (
    <div className="flex h-full bg-surface-0">
      {/* ── Sidebar ── */}
      <nav
        className="titlebar-drag w-[220px] shrink-0 bg-surface-1 border-r border-glass-border flex flex-col pt-[44px]"
      >
        {/* Brand */}
        <div className="px-5 pt-3 pb-5">
          <div className="flex items-center gap-2.5">
            {/* Shield icon */}
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#0099FF] to-[#D406B9] flex items-center justify-center shadow-[0_0_16px_var(--color-accent-glow)]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-text-inverse">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
              </svg>
            </div>
            <div>
              <div className="text-[17px] font-extrabold tracking-tight text-text-primary font-sans">
                QURL
              </div>
            </div>
          </div>
          <div className="text-[11px] text-text-tertiary mt-2 font-medium tracking-wide">
            {isGuest ? 'Guest Mode' : (email || apiKeyHint || 'Signed In')}
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-glass-border mx-4" />

        {/* Navigation */}
        <div className="titlebar-no-drag px-2.5 py-3 flex-1">
          <div className="flex flex-col gap-0.5">
            {NAV_ITEMS.map((item) => {
              const disabled = isGuest && item.guestDisabled;
              const isActive = item.id === activePage;

              return (
                <button
                  key={item.id}
                  onClick={() => { if (!disabled) setPage(item.id); }}
                  title={disabled ? 'Sign in to access' : ''}
                  className={[
                    'flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[13px] text-left relative',
                    'transition-all duration-150 ease-out',
                    isActive
                      ? 'bg-surface-3 text-accent font-semibold border border-glass-border'
                      : disabled
                        ? 'text-text-tertiary opacity-40 cursor-default border border-transparent'
                        : 'text-text-secondary font-medium border border-transparent hover:bg-surface-2 cursor-pointer',
                  ].join(' ')}
                >
                  {/* Active indicator bar */}
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-sm bg-accent" />
                  )}
                  <NavIcon path={item.iconPath} size={17} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {isGuest && (
            <div className="px-1 py-4">
              <button
                onClick={handleSignOut}
                className="w-full py-2 px-3.5 rounded-md bg-gradient-to-r from-[#0099FF] to-[#D406B9] text-text-inverse text-xs font-bold tracking-wide cursor-pointer shadow-[var(--shadow-glow)] transition-all duration-[250ms] ease-out hover:opacity-90"
              >
                Sign in for full access
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="titlebar-no-drag px-4 py-3 border-t border-glass-border flex items-center justify-between"
        >
          <span className="text-[10px] text-text-tertiary font-mono font-medium tracking-widest">
            v0.1.0
          </span>
          <button
            onClick={handleSignOut}
            className="text-[11px] text-text-tertiary bg-transparent cursor-pointer px-2 py-0.5 rounded-sm font-medium transition-all duration-150 ease-out hover:text-danger hover:bg-danger-dim"
          >
            Sign Out
          </button>
        </div>
      </nav>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-auto px-10 pb-9 pt-14 bg-surface-0">
        {renderPage(page)}
      </main>
    </div>
  );
}
