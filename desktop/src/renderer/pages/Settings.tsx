import { useState, useEffect, useCallback } from 'react';
import { StatusBadge } from '../components/StatusBadge';
import { AccessPolicyForm } from '../components/AccessPolicyForm';

const EXPIRY_OPTIONS = [
  { label: '15 minutes', value: '15m' },
  { label: '1 hour', value: '1h' },
  { label: '6 hours', value: '6h' },
  { label: '24 hours', value: '24h' },
  { label: '7 days', value: '7d' },
  { label: 'No expiry', value: '' },
];

type DefaultsTab = 'url' | 'file';

const DEFAULTS_TABS: { id: DefaultsTab; label: string; desc: string }[] = [
  { id: 'url', label: 'Links', desc: 'All URL-based QURLs — public websites and local/private services. Local URLs are automatically tunneled.' },
  { id: 'file', label: 'Files', desc: 'Local files and images shared from your machine. Files are served through a secure tunnel — the tunnel starts automatically.' },
];

function defaultsToOptions(d: ResourceTypeDefaults): Partial<QURLCreateInput> {
  return {
    expires_in: d.expires_in || '1h',
    one_time_use: d.one_time_use,
    max_sessions: d.max_sessions,
    session_duration: d.session_duration,
    access_policy: d.access_policy,
  };
}

function optionsToDefaults(o: Partial<QURLCreateInput>): ResourceTypeDefaults {
  return {
    expires_in: o.expires_in || '1h',
    one_time_use: o.one_time_use || false,
    max_sessions: o.max_sessions,
    session_duration: o.session_duration,
    access_policy: o.access_policy,
  };
}

export function Settings() {
  const [autoStart, setAutoStart] = useState(false);
  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);

  // QURL defaults
  const [defaultsTab, setDefaultsTab] = useState<DefaultsTab>('url');
  const [defaults, setDefaults] = useState<QURLDefaults>({
    url: { expires_in: '24h', one_time_use: false },
    file: { expires_in: '1h', one_time_use: true },
    service: { expires_in: '7d', one_time_use: false },
  });

  useEffect(() => {
    window.qurl.sidecar.status().then((status) => {
      setSidecarRunning(status.running);
    });

    window.qurl.auth.status().then((status) => {
      setIsSignedIn(status.signedIn);
    });

    window.qurl.settings.getDefaults().then((d) => {
      setDefaults(d);
      setAutoStart(d.autoStartTunnel || false);
    }).catch(() => {
      // Use initial defaults
    });
  }, []);

  const handleToggleAutoStart = useCallback(async (enabled: boolean) => {
    setAutoStart(enabled);
    try {
      await window.qurl.settings.setDefaults({ autoStartTunnel: enabled });
    } catch { /* best effort */ }
  }, []);

  const handleSignIn = useCallback(() => {
    window.qurl.auth.signIn().then((result) => {
      if (result.success) setIsSignedIn(true);
    });
  }, []);

  const handleDefaultsChange = useCallback(
    (tab: DefaultsTab, value: Partial<QURLCreateInput>) => {
      setDefaults((prev) => {
        const updated = { ...prev, [tab]: optionsToDefaults(value) };
        // Auto-save
        window.qurl.settings.setDefaults(updated).catch(() => {});
        return updated;
      });
    },
    [],
  );

  const currentDefaults = defaults[defaultsTab];

  return (
    <div className="flex flex-col gap-5">
      {/* Page header */}
      <div style={{ animation: 'fadeIn 400ms cubic-bezier(0.16, 1, 0.3, 1) both' }}>
        <h1 className="text-xl font-semibold tracking-tight mb-1">Settings</h1>
        <p className="text-text-secondary text-[13px]">
          Configure your QURL Desktop preferences.
        </p>
      </div>

      {/* Account */}
      <div style={{ animation: 'fadeIn 400ms cubic-bezier(0.16, 1, 0.3, 1) 60ms both' }} className="bg-surface-2 rounded-xl p-5 border border-glass-border flex items-center justify-between">
        <div>
          <div className="font-semibold text-sm mb-1">Account</div>
          <p className="text-xs text-text-secondary mt-1">
            {isSignedIn ? 'Signed in. Your shares sync across devices.' : 'Sign in to create shareable QURL links.'}
          </p>
        </div>
        <button
          onClick={handleSignIn}
          className={`
            px-5 py-2 rounded-lg font-semibold text-[13px] transition-all duration-150
            ${isSignedIn
              ? 'bg-surface-3 text-text-secondary cursor-default'
              : 'bg-gradient-to-r from-accent to-[#D406B9] text-white cursor-pointer hover:shadow-[0_0_20px_rgba(0,153,255,0.25)]'
            }
          `}
        >
          {isSignedIn ? 'Signed In' : 'Sign In'}
        </button>
      </div>

      {/* QURL Defaults */}
      <div style={{ animation: 'fadeIn 400ms cubic-bezier(0.16, 1, 0.3, 1) 120ms both' }}>
        <div className="font-semibold text-sm mb-3">QURL Defaults</div>
        <p className="text-xs text-text-secondary mb-3.5">
          Default settings applied when creating new QURLs by type.
        </p>

        {/* Tabs — now consistent with Share/Resources tabs */}
        <div className="flex gap-0.5 bg-surface-2 rounded-lg p-1 mb-3.5 w-fit border border-glass-border">
          {DEFAULTS_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setDefaultsTab(tab.id)}
              className={`
                px-3.5 py-1.5 rounded-md text-[13px] font-medium cursor-pointer transition-all duration-150
                ${defaultsTab === tab.id
                  ? 'bg-surface-0 text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Type description */}
        <p className="text-[12px] text-text-muted mb-3.5 leading-relaxed">
          {DEFAULTS_TABS.find(t => t.id === defaultsTab)?.desc}
        </p>

        {/* Tab content */}
        <div className="bg-surface-2 rounded-xl p-4 border border-glass-border">
          {/* Default expiry dropdown */}
          <div className="mb-3">
            <label className="text-xs font-medium text-text-secondary mb-1 block">
              Default Expiry
            </label>
            <select
              value={currentDefaults.expires_in || ''}
              onChange={(e) => {
                handleDefaultsChange(defaultsTab, {
                  ...defaultsToOptions(currentDefaults),
                  expires_in: e.target.value || undefined,
                });
              }}
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* One-time-use toggle — standardized size */}
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => {
                handleDefaultsChange(defaultsTab, {
                  ...defaultsToOptions(currentDefaults),
                  one_time_use: !currentDefaults.one_time_use,
                });
              }}
              className={`
                relative w-10 h-[22px] rounded-full shrink-0 transition-colors duration-200
                ${currentDefaults.one_time_use ? 'bg-accent' : 'bg-surface-3'}
              `}
            >
              <span
                className={`
                  absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-[left] duration-200
                  ${currentDefaults.one_time_use ? 'left-[21px]' : 'left-[3px]'}
                `}
              />
            </button>
            <span className="text-xs text-text-secondary">
              One-time use by default
            </span>
          </div>

          {/* Access policy form in compact mode */}
          <div className="mt-1">
            <AccessPolicyForm
              value={defaultsToOptions(currentDefaults)}
              onChange={(value) => handleDefaultsChange(defaultsTab, value)}
              compact
              advancedOnly
            />
          </div>
        </div>
      </div>

      {/* Auto-start toggle — standardized */}
      <div className="flex items-center justify-between bg-surface-2 rounded-xl p-4 border border-glass-border">
        <div>
          <div className="font-semibold text-[13px]">Auto-start Tunnel</div>
          <p className="text-xs text-text-secondary mt-1">
            Automatically start the tunnel when the app launches.
          </p>
        </div>
        <button
          onClick={() => handleToggleAutoStart(!autoStart)}
          className={`
            relative w-10 h-[22px] rounded-full shrink-0 transition-colors duration-200
            ${autoStart ? 'bg-accent' : 'bg-surface-3'}
          `}
        >
          <span
            className={`
              absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-[left] duration-200
              ${autoStart ? 'left-[21px]' : 'left-[3px]'}
            `}
          />
        </button>
      </div>

      {/* Tunnel status */}
      <div className="flex items-center justify-between bg-surface-2 rounded-xl p-4 border border-glass-border">
        <div>
          <div className="font-semibold text-[13px] mb-1">Tunnel Status</div>
          <StatusBadge status={sidecarRunning ? 'connected' : 'disconnected'} />
        </div>
        <span className="font-mono text-xs text-text-muted">
          qurl-frpc
        </span>
      </div>

    </div>
  );
}
