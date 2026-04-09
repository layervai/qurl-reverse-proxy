import { useState, useEffect, useCallback, useRef } from 'react';
import { DropZone } from '../components/DropZone';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.includes(ext);
}

// ---------------------------------------------------------------------------
// Minted Link Modal (shared with Resources — duplicated here for now)
// ---------------------------------------------------------------------------

function CreatedLinkModal({
  link,
  onClose,
  onViewResources,
}: {
  link: string;
  onClose: () => void;
  onViewResources: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="bg-surface-1 rounded-xl border border-glass-border shadow-xl p-6 max-w-lg w-full mx-4 animate-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 mb-4">
          <svg className="w-6 h-6 text-success shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
          <h3 className="text-[15px] font-semibold text-text-primary">QURL Created</h3>
        </div>

        <div className="flex items-start gap-2.5 mb-4 py-2.5 px-3 rounded-lg bg-warning-dim border border-[rgba(245,158,11,0.15)]">
          <svg className="w-4 h-4 text-warning shrink-0 mt-0.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
          </svg>
          <p className="text-[12px] text-warning font-medium leading-relaxed">
            This link is shown only once and cannot be retrieved after you close this dialog. Copy it now.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-surface-0 rounded-lg px-3.5 py-3 mb-5 border border-glass-border">
          <code className="flex-1 font-mono text-[13px] text-accent truncate select-text">
            {link}
          </code>
          <button
            onClick={handleCopy}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-all duration-150 cursor-pointer ${
              copied ? 'bg-success text-white' : 'bg-accent text-white hover:bg-[#0088ee]'
            }`}
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        </div>

        <p className="text-[12px] text-text-muted mb-5 leading-relaxed">
          View and manage this resource in the{' '}
          <button
            onClick={() => { onClose(); onViewResources(); }}
            className="text-accent hover:underline cursor-pointer bg-transparent border-none p-0 font-inherit text-[12px]"
          >
            Resources tab
          </button>
          , where you can mint additional access links to the same target file or URL.
        </p>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-xs font-medium bg-surface-3 text-text-secondary hover:bg-surface-4 cursor-pointer transition-colors duration-150"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

function StatCard({
  icon,
  label,
  value,
  accent,
  sub,
  onClick,
  delay,
}: {
  icon: string;
  label: string;
  value: string | number;
  accent: 'cyan' | 'green' | 'purple';
  sub?: string;
  onClick: () => void;
  delay: number;
}) {
  const colors = {
    cyan: {
      bg: 'bg-accent-dim',
      text: 'text-accent',
      border: 'border-accent-border',
      glow: 'shadow-[0_0_20px_rgba(0,153,255,0.06)]',
    },
    green: {
      bg: 'bg-success-dim',
      text: 'text-success',
      border: 'border-[rgba(16,185,129,0.15)]',
      glow: 'shadow-[0_0_20px_rgba(16,185,129,0.06)]',
    },
    purple: {
      bg: 'bg-[rgba(139,92,246,0.1)]',
      text: 'text-[#a78bfa]',
      border: 'border-[rgba(139,92,246,0.15)]',
      glow: 'shadow-[0_0_20px_rgba(139,92,246,0.06)]',
    },
  };
  const c = colors[accent];

  return (
    <button
      onClick={onClick}
      className={`flex-1 bg-surface-2 rounded-xl p-4 border border-glass-border ${c.glow} hover:border-glass-border-hover cursor-pointer transition-all duration-200 text-left group`}
      style={{ animation: `fadeIn 400ms cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms both` }}
    >
      <div className="flex items-center gap-3 mb-2.5">
        <div className={`w-8 h-8 rounded-lg ${c.bg} flex items-center justify-center`}>
          <svg className={`w-4 h-4 ${c.text}`} viewBox="0 0 24 24" fill="currentColor">
            <path d={icon} />
          </svg>
        </div>
        <span className="text-xs text-text-muted font-medium">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold tracking-tight ${c.text}`}>{value}</span>
        {sub && <span className="text-[11px] text-text-muted">{sub}</span>}
      </div>
      <div className="mt-2 text-[11px] text-text-muted group-hover:text-text-secondary transition-colors">
        View details {'\u2192'}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Home Page
// ---------------------------------------------------------------------------

interface HomeProps {
  navigateTo: (page: PageId) => void;
  isGuest: boolean;
}

export function Home({ navigateTo, isGuest }: HomeProps) {
  // --- Stats ---
  const [tunnelRunning, setTunnelRunning] = useState(false);
  const [resourceCount, setResourceCount] = useState(0);
  const [serviceCount, setServiceCount] = useState(0);

  // --- URL input ---
  const [urlInput, setUrlInput] = useState('');
  const [urlDetect, setUrlDetect] = useState<{ isLocal: boolean; hasRoute: boolean; routeName?: string } | null>(null);
  const [urlDetecting, setUrlDetecting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successLink, setSuccessLink] = useState<string | null>(null);

  // --- Shared options ---
  const [expiresIn, setExpiresIn] = useState('1h');
  const [oneTimeUse, setOneTimeUse] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [ipAllowlist, setIpAllowlist] = useState('');
  const [geoAllowlist, setGeoAllowlist] = useState('');
  const [blockAI, setBlockAI] = useState(false);
  const [sessionDuration, setSessionDuration] = useState('');

  // --- File sharing ---
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // --- Recent resources ---
  const [recentResources, setRecentResources] = useState<QURLInfo[]>([]);

  // --- Tunnel status (debounced) ---
  const stableStatusRef = useRef<boolean | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch stats on mount
  useEffect(() => {
    window.qurl.sidecar.status().then((s) => {
      stableStatusRef.current = s.running;
      setTunnelRunning(s.running);
    }).catch(() => {
      stableStatusRef.current = false;
      setTunnelRunning(false);
    });

    window.qurl.tunnels.list().then((list) => setServiceCount(list.length)).catch(() => {});

    if (!isGuest) {
      window.qurl.qurls.list().then((result) => {
        if (result.success && result.qurls) {
          setResourceCount(result.qurls.filter((r) => r.status === 'active').length);
          setRecentResources(result.qurls.slice(0, 5));
        }
      }).catch(() => {});
    }

    // Poll tunnel status
    const interval = setInterval(async () => {
      try {
        const status = await window.qurl.sidecar.status();
        if (status.running !== stableStatusRef.current) {
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = setTimeout(() => {
            stableStatusRef.current = status.running;
            setTunnelRunning(status.running);
          }, 2000);
        }
      } catch {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          stableStatusRef.current = false;
          setTunnelRunning(false);
        }, 2000);
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [isGuest]);

  // --- URL helpers ---

  const normalizeUrl = useCallback((raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return trimmed;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    if (trimmed.includes('.') && !trimmed.includes(' ')) return 'https://' + trimmed;
    // Check if it looks like localhost:PORT
    if (trimmed.match(/^localhost(:\d+)?/)) return 'http://' + trimmed;
    return trimmed;
  }, []);

  const handleUrlChange = useCallback(async (url: string) => {
    setUrlInput(url);
    setUrlDetect(null);
    setError(null);
    if (!url.trim()) return;
    const trimmed = normalizeUrl(url.trim());
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return;
    setUrlDetecting(true);
    try {
      const result = await window.qurl.share.detectUrl(trimmed);
      if (result.success) setUrlDetect({ isLocal: result.isLocal, hasRoute: result.hasRoute, routeName: result.routeName });
    } catch {} finally { setUrlDetecting(false); }
  }, [normalizeUrl]);

  const handleUrlBlur = useCallback(() => {
    const normalized = normalizeUrl(urlInput);
    if (normalized !== urlInput) {
      setUrlInput(normalized);
      handleUrlChange(normalized);
    }
  }, [urlInput, normalizeUrl, handleUrlChange]);

  const buildOptions = useCallback((): Partial<QURLCreateInput> => {
    const opts: Partial<QURLCreateInput> = { expires_in: expiresIn, one_time_use: oneTimeUse };
    if (sessionDuration) opts.session_duration = sessionDuration;
    const policy: AccessPolicy = {};
    if (ipAllowlist.trim()) policy.ip_allowlist = ipAllowlist.split(',').map(s => s.trim()).filter(Boolean);
    if (geoAllowlist.trim()) policy.geo_allowlist = geoAllowlist.split(',').map(s => s.trim()).filter(Boolean);
    if (blockAI) policy.ai_agent_policy = { block_all: true };
    if (Object.keys(policy).length > 0) opts.access_policy = policy;
    return opts;
  }, [expiresIn, oneTimeUse, sessionDuration, ipAllowlist, geoAllowlist, blockAI]);

  const handleUrlSubmit = useCallback(async () => {
    const trimmed = normalizeUrl(urlInput.trim());
    if (!trimmed) return;
    if (trimmed !== urlInput) setUrlInput(trimmed);
    setIsSharing(true); setError(null); setSuccessLink(null);
    try {
      let result: QURLCreateResult;
      if (urlDetect?.isLocal) {
        // Auto-create tunnel route + QURL for local URLs
        result = await window.qurl.share.urlLocal(trimmed, buildOptions());
      } else {
        result = await window.qurl.share.url(trimmed, buildOptions());
      }
      if (!result.success) { setError(result.error || 'Failed to create QURL'); return; }
      if (result.qurl) {
        setSuccessLink(result.qurl.qurl_link);
        setUrlInput(''); setUrlDetect(null);
      }
    } catch (err) { setError(String(err)); }
    finally { setIsSharing(false); }
  }, [urlInput, urlDetect, buildOptions, normalizeUrl]);

  const handleDrop = useCallback(async (files: File[]) => {
    setIsSharing(true); setError(null); setSuccessLink(null); setImagePreview(null);
    try {
      for (const file of files) {
        const filePath = (file as File & { path?: string }).path;
        if (!filePath) { setError('Could not determine file path'); continue; }
        if (isImageFile(file.name)) {
          try {
            const dataUrl = await window.qurl.dialog.readImagePreview(filePath);
            if (dataUrl) setImagePreview(dataUrl);
          } catch {}
        }
        const result = await window.qurl.share.file(filePath, file.name, buildOptions());
        if (!result.success) { setError(result.error || 'Failed to share file'); continue; }
        if (result.qurl) {
          setSuccessLink(result.qurl.qurl_link);
        }
      }
    } finally { setIsSharing(false); setTimeout(() => setImagePreview(null), 3000); }
  }, [buildOptions]);

  const tunnelStatusLabel = tunnelRunning ? 'Connected' : 'Offline';

  return (
    <div className="flex flex-col gap-5">
      {/* ── Created link modal ── */}
      {successLink && (
        <CreatedLinkModal
          link={successLink}
          onClose={() => setSuccessLink(null)}
          onViewResources={() => navigateTo('resources')}
        />
      )}

      {/* ── Header ── */}
      <div style={{ animation: 'fadeIn 400ms cubic-bezier(0.16, 1, 0.3, 1) both' }}>
        <h1 className="text-xl font-semibold tracking-tight mb-1">Home</h1>
        <p className="text-text-secondary text-[13px]">
          Create secure QURL links and monitor your protected resources.
        </p>
      </div>

      {/* ── Status cards ── */}
      <div className="flex gap-3">
        <StatCard
          icon="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z"
          label="Tunnel"
          value={tunnelStatusLabel}
          accent={tunnelRunning ? 'green' : 'cyan'}
          sub={serviceCount > 0 ? `${serviceCount} service${serviceCount !== 1 ? 's' : ''}` : undefined}
          onClick={() => navigateTo('connections')}
          delay={50}
        />
        <StatCard
          icon="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"
          label="Resources"
          value={isGuest ? '--' : resourceCount}
          accent="purple"
          sub={isGuest ? 'Sign in' : 'protected'}
          onClick={() => navigateTo('resources')}
          delay={120}
        />
      </div>

      {/* ── Quick create section ── */}
      {isGuest ? (
        <div
          className="bg-surface-2 rounded-xl border border-glass-border p-6 text-center"
          style={{ animation: 'fadeIn 400ms cubic-bezier(0.16, 1, 0.3, 1) 200ms both' }}
        >
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#0099FF] to-[#D406B9] flex items-center justify-center mx-auto mb-3 shadow-[0_0_30px_rgba(0,153,255,0.15)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
            </svg>
          </div>
          <p className="text-text-secondary text-[13px] font-medium mb-1">Sign in to create QURL links</p>
          <p className="text-text-muted text-[12px] max-w-[300px] mx-auto">
            Create secure, time-limited links for any URL or file. Guest mode lets you manage tunnel connections.
          </p>
        </div>
      ) : (
        <div
          className="flex flex-col gap-4"
          style={{ animation: 'fadeIn 400ms cubic-bezier(0.16, 1, 0.3, 1) 200ms both' }}
        >
          {/* Section header */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-[#0099FF] to-[#D406B9]" />
              <h2 className="text-sm font-semibold text-text-secondary">Create QURL</h2>
            </div>
            <p className="text-[12px] text-text-muted leading-relaxed pl-3">
              Paste a URL or drop a file to create a secure, time-limited link. Local services or files are tunneled automatically and never exposed to the public internet.
            </p>
          </div>

          {/* URL input */}
          <div className="flex gap-2 items-stretch">
            <div className="flex-1 relative">
              <input
                value={urlInput}
                onChange={(e) => handleUrlChange(e.target.value)}
                onBlur={handleUrlBlur}
                onKeyDown={(e) => { if (e.key === 'Enter' && urlInput.trim()) handleUrlSubmit(); }}
                placeholder="Paste any URL — public or local (e.g., https://localhost:3000)"
                className="w-full h-full py-3 px-4 bg-surface-1 border border-glass-border rounded-xl text-text-primary text-[14px] font-mono placeholder:text-text-muted placeholder:font-sans focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-dim transition-all"
              />
              {urlDetecting && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-text-muted border-t-accent rounded-full animate-spin" />
                </div>
              )}
            </div>
            <button
              onClick={handleUrlSubmit}
              disabled={isSharing || !urlInput.trim()}
              className={[
                'bg-gradient-to-r from-[#0099FF] to-[#D406B9] text-white',
                'py-3 px-6 rounded-xl font-semibold text-sm shrink-0',
                'transition-all duration-200',
                isSharing || !urlInput.trim()
                  ? 'opacity-40 cursor-not-allowed'
                  : 'cursor-pointer hover:shadow-[0_0_20px_rgba(0,153,255,0.25)]',
              ].join(' ')}
            >
              {isSharing ? (
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : 'Create QURL'}
            </button>
          </div>

          {/* URL detection feedback */}
          {urlDetect && urlDetect.isLocal && !urlDetect.hasRoute && (
            <div className="flex items-start gap-2.5 py-2.5 px-3.5 rounded-xl bg-accent-dim border border-accent-border">
              <svg className="w-4 h-4 text-accent shrink-0 mt-0.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
              </svg>
              <div>
                <span className="text-[12px] text-accent font-medium block">
                  Local URL detected — a tunnel will be created automatically
                </span>
                <span className="text-[11px] text-text-muted block mt-0.5">
                  Your service will be securely exposed through QURL so anyone with the link can access it.
                </span>
              </div>
            </div>
          )}
          {urlDetect && urlDetect.isLocal && urlDetect.hasRoute && (
            <div className="flex items-start gap-2.5 py-2.5 px-3.5 rounded-xl bg-[rgba(16,185,129,0.06)] border border-[rgba(16,185,129,0.15)]">
              <svg className="w-4 h-4 text-success shrink-0 mt-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
              <div>
                <span className="text-[12px] text-success font-medium block">Already tunneled via: {urlDetect.routeName}</span>
                <span className="text-[11px] text-text-muted block mt-0.5">This service is reachable through your active tunnel.</span>
              </div>
            </div>
          )}
          {urlDetect && !urlDetect.isLocal && (
            <div className="flex items-center gap-2 py-2 px-3 rounded-xl bg-[rgba(0,153,255,0.04)] border border-[rgba(0,153,255,0.1)]">
              <svg className="w-3.5 h-3.5 text-accent shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" /></svg>
              <span className="text-[11px] text-text-muted">Public URL — proxied through LayerV, no tunnel needed</span>
            </div>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-glass-border" />
            <span className="text-[10px] text-text-muted uppercase tracking-widest">or drop a file</span>
            <div className="flex-1 h-px bg-glass-border" />
          </div>

          {/* File drop zone */}
          <div className="relative">
            <DropZone onDrop={handleDrop} disabled={isSharing} />
            {imagePreview && (
              <div className="absolute top-3 right-3 w-20 h-20 rounded-xl overflow-hidden border-2 border-glass-border-hover shadow-lg animate-in bg-surface-1">
                <img src={imagePreview} className="w-full h-full object-cover" />
              </div>
            )}
          </div>

          {/* Options — applies to both URL and file shares */}
          <div className="flex items-center gap-4 px-0.5 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-text-muted">Expires:</span>
              <select
                value={expiresIn}
                onChange={(e) => setExpiresIn(e.target.value)}
                className="bg-transparent border-none text-[11px] text-text-secondary font-medium p-0 pr-4 cursor-pointer focus:ring-0 focus:outline-none"
              >
                <option value="15m">15 min</option>
                <option value="1h">1 hour</option>
                <option value="6h">6 hours</option>
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
              </select>
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={oneTimeUse}
                onChange={(e) => setOneTimeUse(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-glass-border bg-surface-1 text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-[11px] text-text-muted">One-time use</span>
            </label>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[11px] text-text-muted hover:text-accent transition-colors cursor-pointer ml-auto flex items-center gap-1"
            >
              <svg className={`w-3 h-3 transition-transform duration-150 ${showAdvanced ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="currentColor">
                <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
              </svg>
              {showAdvanced ? 'Hide' : 'Access policy'}
            </button>
          </div>

          {/* Advanced policy */}
          {showAdvanced && (
            <div className="p-4 bg-surface-2 rounded-xl border border-glass-border animate-in flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-medium text-text-muted mb-1 block">Restrict by IP address</label>
                <input
                  value={ipAllowlist}
                  onChange={(e) => setIpAllowlist(e.target.value)}
                  placeholder="e.g., 192.168.1.0/24, 10.0.0.0/8"
                  className="w-full text-[12px]"
                />
                <span className="text-[10px] text-text-muted mt-1 block">Only these IP ranges can access the link</span>
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-muted mb-1 block">Restrict by country</label>
                <input
                  value={geoAllowlist}
                  onChange={(e) => setGeoAllowlist(e.target.value)}
                  placeholder="e.g., US, CA, GB"
                  className="w-full text-[12px]"
                />
                <span className="text-[10px] text-text-muted mt-1 block">Two-letter country codes, comma separated</span>
              </div>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={blockAI}
                    onChange={(e) => setBlockAI(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-glass-border bg-surface-1 text-danger focus:ring-danger focus:ring-offset-0 cursor-pointer"
                  />
                  <span className="text-[11px] text-text-muted">Block AI bots &amp; scrapers</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-text-muted">Session limit:</span>
                  <select
                    value={sessionDuration}
                    onChange={(e) => setSessionDuration(e.target.value)}
                    className="bg-transparent border-none text-[11px] text-text-secondary font-medium p-0 pr-4 cursor-pointer focus:ring-0 focus:outline-none"
                  >
                    <option value="">Default</option>
                    <option value="15m">15 min</option>
                    <option value="1h">1 hour</option>
                    <option value="6h">6 hours</option>
                    <option value="24h">24 hours</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="py-3 px-4 rounded-xl bg-danger-dim border border-danger-border text-danger text-[13px] animate-in flex items-center gap-2.5">
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
              </svg>
              <span className="flex-1">{error}</span>
              <button
                onClick={() => setError(null)}
                className="text-danger/60 hover:text-danger bg-transparent cursor-pointer text-sm shrink-0"
              >
                {'\u2715'}
              </button>
            </div>
          )}

          {/* Sharing indicator */}
          {isSharing && (
            <div className="text-center py-3 text-text-secondary text-[13px]">
              <div className="inline-flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-text-muted border-t-accent rounded-full animate-spin" />
                Creating secure link...
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Recent resources ── */}
      {!isGuest && recentResources.length > 0 && (
        <div style={{ animation: 'fadeIn 400ms cubic-bezier(0.16, 1, 0.3, 1) 350ms both' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-[#0099FF] to-[#D406B9]" />
              <h2 className="text-sm font-semibold text-text-secondary">Recent Resources</h2>
            </div>
            <button
              onClick={() => navigateTo('resources')}
              className="text-[11px] text-text-muted hover:text-accent transition-colors cursor-pointer bg-transparent"
            >
              View all {'\u2192'}
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {recentResources.map((r) => (
              <button
                key={r.resource_id}
                onClick={() => navigateTo('resources')}
                className="bg-surface-2 rounded-xl px-4 py-3 border border-glass-border flex items-center gap-3 hover:border-glass-border-hover transition-colors cursor-pointer text-left w-full"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${r.status === 'active' ? 'bg-success shadow-[0_0_6px_var(--color-success)]' : r.status === 'revoked' ? 'bg-danger' : 'bg-text-muted'}`} />
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span className="text-[13px] font-medium text-text-primary truncate">
                    {r.label || r.target_url}
                  </span>
                  {r.label && (
                    <span className="text-[10px] text-text-muted font-mono truncate">{r.target_url}</span>
                  )}
                </div>
                <span className={`text-[10px] font-medium shrink-0 ${r.status === 'active' ? 'text-success' : r.status === 'revoked' ? 'text-danger' : 'text-text-muted'}`}>
                  {r.status}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
