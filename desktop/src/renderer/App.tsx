import { useState, useEffect, useCallback } from 'react';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Dashboard } from './pages/Dashboard';
import { Resources } from './pages/Resources';
import { Settings } from './pages/Settings';

type Page = 'home' | 'resources' | 'connections' | 'settings';
type AuthMode = 'none' | 'account' | 'guest';

const NAV_ITEMS: { id: Page; label: string; iconPath: string; guestDisabled?: boolean }[] = [
  {
    id: 'home',
    label: 'Home',
    iconPath: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
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

function renderPage(page: Page, navigateTo: (p: Page) => void, isGuest: boolean) {
  switch (page) {
    case 'home': return <Home navigateTo={navigateTo} isGuest={isGuest} />;
    case 'resources': return <Resources />;
    case 'connections': return <Dashboard />;
    case 'settings': return <Settings />;
  }
}

export function App() {
  const [page, setPage] = useState<Page>('home');
  const [authMode, setAuthMode] = useState<AuthMode>('none');
  const [email, setEmail] = useState<string | null>(null);
  const [apiKeyHint, setApiKeyHint] = useState<string | null>(null);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

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
            {/* LayerV logo — matches dock icon */}
            <div className="w-7 h-7 rounded-lg bg-surface-0 border border-glass-border flex items-center justify-center">
              <svg width="15" height="15" viewBox="0 0 32 32" fill="none">
                <path d="M3 4 L15 11 L27 4" stroke="#0099FF" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3 11 L15 18 L27 11" stroke="#2b7de0" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3 18 L15 25 L27 18" stroke="#8b3dd6" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3 25 L15 32 L27 25" stroke="#D406B9" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <div className="text-[17px] font-bold tracking-tight text-text-primary font-sans">
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
                className="w-full py-2 px-3.5 rounded-lg bg-gradient-to-r from-[#0099FF] to-[#D406B9] text-white text-xs font-semibold tracking-wide cursor-pointer transition-all duration-150 hover:shadow-[0_0_20px_rgba(0,153,255,0.25)]"
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
            onClick={() => setShowSignOutConfirm(true)}
            className="flex items-center gap-1.5 text-[11px] text-text-tertiary bg-transparent cursor-pointer px-2 py-1 rounded-lg font-medium transition-all duration-150 ease-out hover:text-danger hover:bg-danger-dim group"
            title="Sign out"
          >
            <svg className="w-3.5 h-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign Out
          </button>
        </div>
      </nav>

      {/* ── Sign Out Confirmation ── */}
      {showSignOutConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
          onClick={() => setShowSignOutConfirm(false)}
        >
          <div
            className="bg-surface-1 rounded-xl border border-glass-border shadow-xl p-6 max-w-sm w-full mx-4 animate-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-danger-dim flex items-center justify-center">
                <svg className="w-5 h-5 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </div>
              <div>
                <h3 className="text-[15px] font-semibold">Sign Out</h3>
                <p className="text-[12px] text-text-muted">
                  {isGuest ? 'Exit guest mode' : (email || apiKeyHint || 'Your account')}
                </p>
              </div>
            </div>
            <p className="text-[13px] text-text-secondary mb-5 leading-relaxed">
              {isGuest
                ? 'You will return to the sign-in screen. Tunnel connections will be stopped.'
                : 'Active tunnel connections will be stopped and you will need to sign in again to create or manage QURLs.'}
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setShowSignOutConfirm(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-surface-3 text-text-secondary hover:bg-surface-4 cursor-pointer transition-colors duration-150"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowSignOutConfirm(false); handleSignOut(); }}
                className="px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all duration-150 bg-danger text-white hover:bg-[#dc2626]"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-auto px-6 pb-6 pt-12 bg-surface-0">
        {renderPage(page, setPage, isGuest)}
      </main>
    </div>
  );
}
