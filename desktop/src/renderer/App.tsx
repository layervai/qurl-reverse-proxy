import { useState } from 'react';
import { Share } from './pages/Share';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';

type Page = 'share' | 'dashboard' | 'settings';

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'share', label: 'Share', icon: '\u2B06' },
  { id: 'dashboard', label: 'Dashboard', icon: '\u25A3' },
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
          paddingTop: 44, // Space for macOS traffic lights
        }}
      >
        {/* Brand */}
        <div
          style={{
            padding: '8px 16px 20px',
            borderBottom: '1px solid var(--color-border)',
            marginBottom: '12px',
          }}
        >
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              background: 'var(--gradient-accent)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '-0.02em',
            }}
          >
            QURL
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: '2px' }}>
            Secure File Sharing
          </div>
        </div>

        {/* Navigation */}
        <div className="titlebar-no-drag" style={{ padding: '0 8px', flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {NAV_ITEMS.map((item) => (
              <NavButton
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={page === item.id}
                onClick={() => setPage(item.id)}
              />
            ))}
          </div>
        </div>

        {/* Version */}
        <div
          style={{
            padding: '12px 16px',
            fontSize: 11,
            color: 'var(--color-text-muted)',
            borderTop: '1px solid var(--color-border)',
          }}
        >
          v0.1.0
        </div>
      </nav>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '32px',
          paddingTop: 56, // Space for titlebar drag area
        }}
      >
        {page === 'share' && <Share />}
        {page === 'dashboard' && <Dashboard />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  );
}
