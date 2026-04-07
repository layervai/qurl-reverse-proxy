import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { StatusBadge } from '../components/StatusBadge';

const EXPIRY_OPTIONS = [
  { label: '15 minutes', value: 15 },
  { label: '1 hour', value: 60 },
  { label: '6 hours', value: 360 },
  { label: '24 hours', value: 1440 },
  { label: '7 days', value: 10080 },
  { label: 'No expiry', value: 0 },
];

export function Settings() {
  const [defaultExpiry, setDefaultExpiry] = useState(60);
  const [autoStart, setAutoStart] = useState(false);
  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isSignedIn] = useState(false);

  useEffect(() => {
    const savedExpiry = localStorage.getItem('qurl:defaultExpiry');
    const savedAutoStart = localStorage.getItem('qurl:autoStart');

    if (savedExpiry) setDefaultExpiry(parseInt(savedExpiry, 10));
    if (savedAutoStart) setAutoStart(savedAutoStart === 'true');

    window.qurl.sidecar.status().then((status) => {
      setSidecarRunning(status.running);
    });
  }, []);

  const handleSave = useCallback(() => {
    localStorage.setItem('qurl:defaultExpiry', String(defaultExpiry));
    localStorage.setItem('qurl:autoStart', String(autoStart));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [defaultExpiry, autoStart]);

  const handleSignIn = useCallback(() => {
    // TODO: Open Auth0 browser flow
    // shell.openExternal('https://auth.layerv.ai/authorize?...')
    alert('Browser sign-in coming soon. For now, the app works without authentication.');
  }, []);

  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    background: 'var(--color-bg-input)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-primary)',
    fontSize: 13,
    outline: 'none',
    transition: 'border-color var(--transition-fast)',
  };

  const labelStyle: CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    marginBottom: '6px',
    color: 'var(--color-text-primary)',
  };

  const descriptionStyle: CSSProperties = {
    fontSize: 12,
    color: 'var(--color-text-secondary)',
    marginTop: '4px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: '4px' }}>Settings</h1>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>
          Configure your QURL Desktop preferences.
        </p>
      </div>

      {/* Account */}
      <div
        style={{
          background: 'var(--color-bg-secondary)',
          borderRadius: 'var(--radius-md)',
          padding: '20px',
          border: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: '4px' }}>Account</div>
          <p style={descriptionStyle}>
            {isSignedIn ? 'Signed in. Your shares sync across devices.' : 'Sign in to create shareable QURL links.'}
          </p>
        </div>
        <button
          onClick={handleSignIn}
          style={{
            background: isSignedIn ? 'var(--color-bg-tertiary)' : 'var(--gradient-accent)',
            color: isSignedIn ? 'var(--color-text-secondary)' : '#fff',
            padding: '8px 20px',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {isSignedIn ? 'Signed In' : 'Sign In'}
        </button>
      </div>

      {/* Default expiry */}
      <div>
        <label style={labelStyle}>Default Expiry</label>
        <select
          value={defaultExpiry}
          onChange={(e) => setDefaultExpiry(parseInt(e.target.value, 10))}
          style={{
            ...inputStyle,
            cursor: 'pointer',
            appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%238888aa'%3E%3Cpath d='M2 4l4 4 4-4'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 14px center',
            paddingRight: '36px',
          }}
        >
          {EXPIRY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p style={descriptionStyle}>Default time-to-live for new QURL links.</p>
      </div>

      {/* Auto-start toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--color-bg-secondary)',
          borderRadius: 'var(--radius-md)',
          padding: '16px',
          border: '1px solid var(--color-border)',
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Auto-start Tunnel</div>
          <p style={descriptionStyle}>
            Automatically start the tunnel when the app launches.
          </p>
        </div>
        <button
          onClick={() => setAutoStart(!autoStart)}
          style={{
            width: 44,
            height: 24,
            borderRadius: 12,
            background: autoStart ? 'var(--color-accent-blue)' : 'var(--color-bg-tertiary)',
            position: 'relative',
            transition: 'background var(--transition-normal)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 3,
              left: autoStart ? 23 : 3,
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: '#fff',
              transition: 'left var(--transition-normal)',
              boxShadow: 'var(--shadow-sm)',
            }}
          />
        </button>
      </div>

      {/* Tunnel status */}
      <div
        style={{
          background: 'var(--color-bg-secondary)',
          borderRadius: 'var(--radius-md)',
          padding: '16px',
          border: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: '4px' }}>Tunnel Status</div>
          <StatusBadge status={sidecarRunning ? 'connected' : 'disconnected'} />
        </div>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--color-text-muted)',
          }}
        >
          qurl-frpc
        </span>
      </div>

      {/* Save button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={handleSave}
          style={{
            background: saved ? 'var(--color-accent-green)' : 'var(--gradient-accent)',
            color: '#fff',
            padding: '10px 32px',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 600,
            fontSize: 14,
            transition: 'opacity var(--transition-fast)',
          }}
        >
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
