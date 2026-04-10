import { useState, useEffect, useCallback } from 'react';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Qurls } from './pages/Resources';
import { Settings } from './pages/Settings';

type Page = 'home' | 'qurls-files' | 'qurls-http' | 'qurls-ssh' | 'settings';
type AuthMode = 'none' | 'account' | 'guest';

function isQurlsPage(page: Page): page is 'qurls-files' | 'qurls-http' | 'qurls-ssh' {
  return page === 'qurls-files' || page === 'qurls-http' || page === 'qurls-ssh';
}

const QURLS_SUBITEMS: { id: Page; label: string; iconPath: string }[] = [
  {
    id: 'qurls-files',
    label: 'Files',
    iconPath: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 2l5 5h-5V4zm-3 9v2H8v-2h2zm6 0v2h-4v-2h4zm-6 4v2H8v-2h2zm6 0v2h-4v-2h4z',
  },
  {
    id: 'qurls-http',
    label: 'HTTP Services',
    iconPath: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
  },
  {
    id: 'qurls-ssh',
    label: 'SSH Services',
    iconPath: 'M20 3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H4V5h16v14zM6 15h4v2H6zm0-4h12v2H6zm0-4h12v2H6z',
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
    case 'qurls-files': return <Qurls mode="files" />;
    case 'qurls-http': return <Qurls mode="http" />;
    case 'qurls-ssh': return <Qurls mode="ssh" />;
    case 'settings': return <Settings />;
  }
}

export function App() {
  const [page, setPage] = useState<Page>('home');
  const [authMode, setAuthMode] = useState<AuthMode>('none');
  const [email, setEmail] = useState<string | null>(null);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [appVersion, setAppVersion] = useState('0.1.0');
  const [qurlsExpanded, setQurlsExpanded] = useState(true);

  useEffect(() => {
    const savedMode = localStorage.getItem('qurl:authMode') as AuthMode | null;
    if (savedMode === 'guest') setAuthMode('guest');
  }, []);

  // Fetch app version + listen for update notifications.
  useEffect(() => {
    window.qurl.app.getVersion().then(setAppVersion).catch(() => {});
    window.qurl.update.check().then(setUpdateStatus).catch(() => {});
    window.qurl.update.onUpdateReady(setUpdateStatus);
    return () => window.qurl.update.removeUpdateListener();
  }, []);

  const handleAuthenticated = useCallback((mode: 'account' | 'guest', userEmail?: string) => {
    setAuthMode(mode);
    setEmail(userEmail || null);
    localStorage.setItem('qurl:authMode', mode);
  }, []);

  const handleSignOut = useCallback(async () => {
    if (authMode === 'account') await window.qurl.auth.signOut();
    setAuthMode('none');
    setEmail(null);
    localStorage.removeItem('qurl:authMode');
  }, [authMode]);

  if (authMode === 'none') return <Login onAuthenticated={handleAuthenticated} />;

  const isGuest = authMode === 'guest';
  const qurlsDisabled = isGuest;
  const qurlsActive = isQurlsPage(page);

  return (
    <div className="flex h-full bg-surface-0">
      {/* ── Sidebar ── */}
      <nav
        className="titlebar-drag w-[220px] shrink-0 bg-surface-1 border-r border-glass-border flex flex-col pt-[44px]"
      >
        {/* Brand */}
        <div className="px-5 pt-3 pb-5">
          <div className="flex items-center gap-2.5">
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
            {isGuest ? 'Guest Mode' : (email || '')}
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-glass-border mx-4" />

        {/* Navigation */}
        <div className="titlebar-no-drag px-2.5 py-3 flex-1">
          <div className="flex flex-col gap-0.5">
            {/* Home */}
            <button
              onClick={() => setPage('home')}
              className={[
                'flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[13px] text-left relative',
                'transition-all duration-150 ease-out',
                page === 'home'
                  ? 'bg-surface-3 text-accent font-semibold border border-glass-border'
                  : 'text-text-secondary font-medium border border-transparent hover:bg-surface-2 cursor-pointer',
              ].join(' ')}
            >
              {page === 'home' && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-sm bg-accent" />
              )}
              <NavIcon path="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" size={17} />
              <span>Home</span>
            </button>

            {/* Qurls section — parent + sub-items */}
            <button
              onClick={() => {
                if (qurlsDisabled) return;
                if (!qurlsExpanded) {
                  setQurlsExpanded(true);
                  setPage('qurls-files');
                } else if (!qurlsActive) {
                  setPage('qurls-files');
                } else {
                  setQurlsExpanded(!qurlsExpanded);
                }
              }}
              title={qurlsDisabled ? 'Sign in to access' : ''}
              className={[
                'flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[13px] text-left relative',
                'transition-all duration-150 ease-out',
                qurlsActive && !qurlsExpanded
                  ? 'bg-surface-3 text-accent font-semibold border border-glass-border'
                  : qurlsDisabled
                    ? 'text-text-tertiary opacity-40 cursor-default border border-transparent'
                    : qurlsActive
                      ? 'text-accent font-semibold border border-transparent hover:bg-surface-2 cursor-pointer'
                      : 'text-text-secondary font-medium border border-transparent hover:bg-surface-2 cursor-pointer',
              ].join(' ')}
            >
              <NavIcon path="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" size={17} />
              <span className="flex-1">Resources</span>
              {!qurlsDisabled && (
                <svg
                  className={`w-3.5 h-3.5 text-text-muted transition-transform duration-200 ${qurlsExpanded ? 'rotate-180' : ''}`}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
                </svg>
              )}
            </button>

            {/* Qurls sub-items */}
            {qurlsExpanded && !qurlsDisabled && (
              <div className="flex flex-col gap-0.5 ml-3 pl-3 border-l border-glass-border">
                {QURLS_SUBITEMS.map((item) => {
                  const isActive = page === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setPage(item.id)}
                      className={[
                        'flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-[12px] text-left relative',
                        'transition-all duration-150 ease-out',
                        isActive
                          ? 'bg-surface-3 text-accent font-semibold border border-glass-border'
                          : 'text-text-secondary font-medium border border-transparent hover:bg-surface-2 cursor-pointer',
                      ].join(' ')}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-3 rounded-r-sm bg-accent" />
                      )}
                      <NavIcon path={item.iconPath} size={14} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Settings */}
            <button
              onClick={() => setPage('settings')}
              className={[
                'flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[13px] text-left relative',
                'transition-all duration-150 ease-out',
                page === 'settings'
                  ? 'bg-surface-3 text-accent font-semibold border border-glass-border'
                  : 'text-text-secondary font-medium border border-transparent hover:bg-surface-2 cursor-pointer',
              ].join(' ')}
            >
              {page === 'settings' && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-sm bg-accent" />
              )}
              <NavIcon path="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41L9.25 5.35C8.66 5.59 8.12 5.92 7.63 6.29L5.24 5.33c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" size={17} />
              <span>Settings</span>
            </button>
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

        {/* ── Update Banner ── */}
        {updateStatus?.tunnelUpdate?.downloaded && (
          <div className="titlebar-no-drag mx-3 mb-2 animate-in">
            <div className="rounded-lg bg-surface-2 border border-glass-border p-3 flex flex-col items-center gap-2">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-tertiary">
                <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m0 0a9 9 0 0 1 9-9m-9 9a9 9 0 0 0 9 9" />
                <path d="M12 3v3m0 12v3" />
              </svg>
              <div className="text-center">
                <div className="text-[12px] font-semibold text-text-primary">
                  Updated to {updateStatus.tunnelUpdate.latest}
                </div>
                <div className="text-[11px] text-text-tertiary">
                  Relaunch to apply
                </div>
              </div>
              <button
                onClick={async () => {
                  setIsUpdating(true);
                  try {
                    const result = await window.qurl.update.applyAndRelaunch();
                    if (result.success) {
                      setUpdateStatus(null);
                    }
                  } catch { /* handled via IPC */ }
                  setIsUpdating(false);
                }}
                disabled={isUpdating}
                className="w-full py-1.5 rounded-md bg-surface-3 border border-glass-border text-[11px] font-medium text-text-secondary cursor-pointer transition-all duration-150 hover:bg-surface-4 hover:border-glass-border-hover disabled:opacity-50 disabled:cursor-default"
              >
                {isUpdating ? 'Restarting...' : 'Relaunch'}
              </button>
            </div>
          </div>
        )}

        {updateStatus?.appUpdate && !updateStatus?.tunnelUpdate?.downloaded && (
          <div className="titlebar-no-drag mx-3 mb-2 animate-in">
            <div className="rounded-lg bg-surface-2 border border-glass-border p-3 flex flex-col items-center gap-2">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-tertiary">
                <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m0 0a9 9 0 0 1 9-9m-9 9a9 9 0 0 0 9 9" />
                <path d="M12 3v3m0 12v3" />
              </svg>
              <div className="text-center">
                <div className="text-[12px] font-semibold text-text-primary">
                  {updateStatus.appUpdate.status === 'downloaded'
                    ? `Updated to ${updateStatus.appUpdate.latest}`
                    : updateStatus.appUpdate.status === 'downloading'
                      ? `Downloading ${updateStatus.appUpdate.latest}...`
                      : `Update ${updateStatus.appUpdate.latest}`}
                </div>
                <div className="text-[11px] text-text-tertiary">
                  {updateStatus.appUpdate.status === 'downloaded'
                    ? 'Relaunch to apply'
                    : updateStatus.appUpdate.status === 'downloading'
                      ? `${updateStatus.appUpdate.downloadProgress ?? 0}%`
                      : 'New version available'}
                </div>
              </div>
              {updateStatus.appUpdate.status === 'downloaded' ? (
                <button
                  onClick={async () => {
                    setIsUpdating(true);
                    try {
                      await window.qurl.update.installAppUpdate();
                    } catch { /* app will quit */ }
                    setIsUpdating(false);
                  }}
                  disabled={isUpdating}
                  className="w-full py-1.5 rounded-md bg-surface-3 border border-glass-border text-[11px] font-medium text-text-secondary cursor-pointer transition-all duration-150 hover:bg-surface-4 hover:border-glass-border-hover disabled:opacity-50 disabled:cursor-default"
                >
                  {isUpdating ? 'Restarting...' : 'Relaunch'}
                </button>
              ) : updateStatus.appUpdate.status === 'downloading' ? (
                <div className="w-full bg-surface-3 rounded-full h-1.5">
                  <div
                    className="bg-accent h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${updateStatus.appUpdate.downloadProgress ?? 0}%` }}
                  />
                </div>
              ) : (
                <button
                  onClick={() => window.qurl.dialog.openExternal(updateStatus!.appUpdate!.releaseUrl)}
                  className="w-full py-1.5 rounded-md bg-surface-3 border border-glass-border text-[11px] font-medium text-text-secondary cursor-pointer transition-all duration-150 hover:bg-surface-4 hover:border-glass-border-hover"
                >
                  Download
                </button>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          className="titlebar-no-drag px-4 py-3 border-t border-glass-border flex items-center justify-between"
        >
          <span className="text-[10px] text-text-tertiary font-mono font-medium tracking-widest">
            v{appVersion}
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
                  {isGuest ? 'Exit guest mode' : (email || '')}
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
