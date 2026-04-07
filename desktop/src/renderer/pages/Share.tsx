import { useState, useEffect, useCallback } from 'react';
import { DropZone } from '../components/DropZone';
import { LinkCard } from '../components/LinkCard';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.includes(ext);
}

interface RecentShare {
  id: string;
  name: string;
  link: string;
  type: 'url' | 'file';
  createdAt: number;
  expiresAt: number | null;
}

type ShareMode = 'url' | 'file';

export function Share() {
  const [mode, setMode] = useState<ShareMode>('url');
  const [shares, setShares] = useState<RecentShare[]>([]);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successLink, setSuccessLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // URL mode state
  const [urlInput, setUrlInput] = useState('');
  const [urlDetect, setUrlDetect] = useState<{ isLocal: boolean; hasRoute: boolean; routeName?: string } | null>(null);
  const [urlDetecting, setUrlDetecting] = useState(false);

  // Shared options
  const [expiresIn, setExpiresIn] = useState('1h');
  const [oneTimeUse, setOneTimeUse] = useState(false);

  // Advanced policy (only shown in "More options")
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [ipAllowlist, setIpAllowlist] = useState('');
  const [geoAllowlist, setGeoAllowlist] = useState('');
  const [blockAI, setBlockAI] = useState(false);
  const [sessionDuration, setSessionDuration] = useState('');

  // File mode state
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  useEffect(() => {
    window.qurl.share.list().then((list) => {
      setShares(list.map((s) => ({
        id: s.id, name: s.name, link: s.url, type: 'file' as const,
        createdAt: s.createdAt, expiresAt: s.expiresAt,
      })));
    }).catch(() => {});
  }, []);

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

  // URL detection
  const handleUrlChange = useCallback(async (url: string) => {
    setUrlInput(url);
    setUrlDetect(null);
    setSuccessLink(null);
    setError(null);
    if (!url.trim()) return;
    const trimmed = url.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return;
    setUrlDetecting(true);
    try {
      const result = await window.qurl.share.detectUrl(trimmed);
      if (result.success) setUrlDetect({ isLocal: result.isLocal, hasRoute: result.hasRoute, routeName: result.routeName });
    } catch {} finally { setUrlDetecting(false); }
  }, []);

  const handleUrlSubmit = useCallback(async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setIsSharing(true); setError(null); setSuccessLink(null);
    try {
      const result = await window.qurl.share.url(trimmed, buildOptions());
      if (!result.success) { setError(result.error || 'Failed to create QURL'); return; }
      if (result.qurl) {
        setSuccessLink(result.qurl.qurl_link);
        setShares(prev => [{ id: result.qurl!.qurl_id, name: result.qurl!.label || trimmed, link: result.qurl!.qurl_link, type: 'url', createdAt: Date.now(), expiresAt: result.qurl!.expires_at ? new Date(result.qurl!.expires_at).getTime() : null }, ...prev]);
        setUrlInput(''); setUrlDetect(null);
      }
    } catch (err) { setError(String(err)); }
    finally { setIsSharing(false); }
  }, [urlInput, buildOptions]);

  const handleCopySuccess = useCallback(async () => {
    if (!successLink) return;
    await navigator.clipboard.writeText(successLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [successLink]);

  const handleDrop = useCallback(async (files: File[]) => {
    setIsSharing(true); setError(null); setSuccessLink(null); setImagePreview(null);
    try {
      for (const file of files) {
        const filePath = (file as File & { path?: string }).path;
        if (!filePath) { setError('Could not determine file path'); continue; }
        if (isImageFile(file.name)) { try { setImagePreview(URL.createObjectURL(file)); } catch {} }
        const result = await window.qurl.share.file(filePath, file.name, buildOptions());
        if (!result.success) { setError(result.error || 'Failed to share file'); continue; }
        if (result.qurl) {
          setSuccessLink(result.qurl.qurl_link);
          setShares(prev => [{ id: result.qurl!.qurl_id, name: result.qurl!.label || file.name, link: result.qurl!.qurl_link, type: 'file', createdAt: Date.now(), expiresAt: result.qurl!.expires_at ? new Date(result.qurl!.expires_at).getTime() : null }, ...prev]);
        }
      }
    } finally { setIsSharing(false); setTimeout(() => setImagePreview(null), 3000); }
  }, [buildOptions]);

  const handleRevoke = useCallback(async (id: string) => {
    await window.qurl.share.stop(id);
    setShares(prev => prev.filter(s => s.id !== id));
  }, []);

  return (
    <div className="max-w-[640px]">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight mb-1">Share</h1>
        <p className="text-text-secondary text-[13px]">
          Create secure, time-limited links for URLs and files.
        </p>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 bg-surface-2 rounded-lg p-1 mb-4 w-fit border border-glass-border">
        {([
          { id: 'url' as const, label: 'URL', icon: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z' },
          { id: 'file' as const, label: 'File', icon: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z' },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => { setMode(tab.id); setError(null); setSuccessLink(null); }}
            className={[
              'flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[13px] font-medium transition-all duration-150 cursor-pointer',
              mode === tab.id
                ? 'bg-surface-0 text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary',
            ].join(' ')}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d={tab.icon} /></svg>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Mode description */}
      <p className="text-[12px] text-text-muted mb-4 leading-relaxed">
        {mode === 'url'
          ? 'Paste any URL to create a time-limited, access-controlled QURL link. Public URLs are proxied through LayerV. Private/local URLs require a tunnel connection (set up in Connections).'
          : 'Share files and images from your machine via a secure tunnel. The tunnel auto-starts when you drop a file — recipients access it through a QURL link while your tunnel is running.'}
      </p>

      {/* === URL Mode === */}
      {mode === 'url' && (
        <div className="mb-5">
          <div className="flex gap-2 items-stretch">
            <div className="flex-1 relative">
              <input
                value={urlInput}
                onChange={(e) => handleUrlChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && urlInput.trim()) handleUrlSubmit(); }}
                placeholder="https://..."
                className="w-full h-full py-3 px-4 bg-surface-1 border border-glass-border rounded-lg text-text-primary text-[15px] font-mono placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-dim transition-all"
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
                'bg-gradient-to-br from-[#0099FF] to-[#D406B9] text-white',
                'py-3 px-6 rounded-lg font-semibold text-sm shrink-0',
                'transition-all duration-200',
                isSharing || !urlInput.trim()
                  ? 'opacity-40 cursor-not-allowed'
                  : 'cursor-pointer hover:shadow-[0_0_24px_rgba(0,153,255,0.3)] hover:scale-[1.02] active:scale-[0.98]',
              ].join(' ')}
            >
              {isSharing ? (
                <span className="flex items-center gap-2">
                  <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                </span>
              ) : 'Create QURL'}
            </button>
          </div>

          {/* URL detection feedback */}
          {urlDetect && urlDetect.isLocal && !urlDetect.hasRoute && (
            <div className="flex items-start gap-2.5 mt-3 py-2.5 px-3.5 rounded-lg bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.15)]">
              <svg className="w-4 h-4 text-warning shrink-0 mt-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" /></svg>
              <div>
                <span className="text-[12px] text-warning font-medium block">Tunnel required</span>
                <span className="text-[11px] text-text-muted block mt-0.5">This is a local/private URL. Set up a tunnel in Connections to make it reachable, then share it here.</span>
              </div>
            </div>
          )}
          {urlDetect && urlDetect.isLocal && urlDetect.hasRoute && (
            <div className="flex items-start gap-2.5 mt-3 py-2.5 px-3.5 rounded-lg bg-[rgba(16,185,129,0.06)] border border-[rgba(16,185,129,0.15)]">
              <svg className="w-4 h-4 text-success shrink-0 mt-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
              <div>
                <span className="text-[12px] text-success font-medium block">Tunneled via: {urlDetect.routeName}</span>
                <span className="text-[11px] text-text-muted block mt-0.5">This local service is reachable through your active tunnel. The QURL link will route traffic through it.</span>
              </div>
            </div>
          )}
          {urlDetect && !urlDetect.isLocal && (
            <div className="flex items-center gap-2 mt-3 py-2 px-3 rounded-lg bg-[rgba(0,153,255,0.04)] border border-[rgba(0,153,255,0.1)]">
              <svg className="w-3.5 h-3.5 text-accent shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" /></svg>
              <span className="text-[11px] text-text-muted">Public URL — proxied through LayerV, no tunnel needed</span>
            </div>
          )}
        </div>
      )}

      {/* === File Mode === */}
      {mode === 'file' && (
        <div className="mb-5">
          <div className="relative">
            <DropZone onDrop={handleDrop} disabled={isSharing} />
            {imagePreview && (
              <div className="absolute top-3 right-3 w-16 h-16 rounded-lg overflow-hidden border-2 border-glass-border-hover shadow-lg animate-in">
                <img src={imagePreview} alt="preview" className="w-full h-full object-cover" />
              </div>
            )}
          </div>
          {/* Tunnel status for file sharing */}
          <div className="flex items-center gap-2 mt-2.5 py-2 px-3 rounded-lg bg-surface-2 border border-glass-border">
            <svg className="w-3.5 h-3.5 text-text-muted shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" /></svg>
            <span className="text-[11px] text-text-muted">
              Files are served from your machine through a secure tunnel. The tunnel starts automatically when you share a file and must remain running for recipients to download.
            </span>
          </div>
        </div>
      )}

      {/* Shared options bar */}
      <div className="flex items-center gap-4 mb-4 px-0.5">
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

      {/* Advanced policy (no duplicate expiry/one-time — only network/geo/AI settings) */}
      {showAdvanced && (
        <div className="mb-5 p-4 bg-surface-2 rounded-lg border border-glass-border animate-in flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-medium text-text-muted mb-1 block">IP Allowlist</label>
            <input
              value={ipAllowlist}
              onChange={(e) => setIpAllowlist(e.target.value)}
              placeholder="e.g., 192.168.1.0/24, 10.0.0.0/8"
              className="w-full text-[12px]"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-muted mb-1 block">Geo Allowlist</label>
            <input
              value={geoAllowlist}
              onChange={(e) => setGeoAllowlist(e.target.value)}
              placeholder="e.g., US, CA, GB"
              className="w-full text-[12px]"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={blockAI}
                  onChange={(e) => setBlockAI(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-glass-border bg-surface-1 text-danger focus:ring-danger focus:ring-offset-0 cursor-pointer"
                />
                <span className="text-[11px] text-text-muted">Block AI agents</span>
              </label>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-text-muted">Session:</span>
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

      {/* Success banner */}
      {successLink && (
        <div className="mb-5 p-4 rounded-lg bg-[rgba(16,185,129,0.06)] border border-[rgba(16,185,129,0.15)] animate-in">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-5 h-5 text-success" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            <span className="text-sm font-semibold text-success">QURL created</span>
          </div>
          <div className="flex items-center gap-2 bg-surface-1 rounded-md px-3 py-2">
            <code className="flex-1 font-mono text-[13px] text-accent truncate select-text">{successLink}</code>
            <button
              onClick={handleCopySuccess}
              className={['px-4 py-1.5 rounded-md text-xs font-semibold shrink-0 transition-all duration-150',
                copied ? 'bg-success text-white' : 'bg-accent text-white hover:bg-[#0088ee]'].join(' ')}
            >
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-5 py-3 px-4 rounded-lg bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.15)] text-danger text-[13px] animate-in">
          {error}
        </div>
      )}

      {/* Sharing indicator */}
      {isSharing && (
        <div className="text-center py-6 text-text-secondary text-[13px]">
          <div className="inline-flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-text-muted border-t-accent rounded-full animate-spin" />
            Creating secure link...
          </div>
        </div>
      )}

      {/* Recent shares */}
      {shares.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-semibold text-text-muted uppercase tracking-widest">Recent</h2>
            <span className="text-[11px] text-text-muted">{shares.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {shares.map(share => (
              <LinkCard
                key={share.id}
                id={share.id}
                name={share.name}
                link={share.link}
                createdAt={share.createdAt}
                expiresAt={share.expiresAt}
                onRevoke={handleRevoke}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
