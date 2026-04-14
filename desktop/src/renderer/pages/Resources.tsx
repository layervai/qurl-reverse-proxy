import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AccessPolicyForm } from '../components/AccessPolicyForm';
import { DropZone } from '../components/DropZone';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SSH_PREFIX_RE = /^SSH:/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeRemaining(expiresAt: string | null | undefined): string {
  if (!expiresAt) return 'No expiry';
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return 'Expired';
  const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
  const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 365) return `${Math.floor(days / 365)}y+ remaining`;
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type TypeBadge = { label: string; bgClass: string; textClass: string };

function getTypeIndicator(targetUrl: string): TypeBadge {
  if (
    targetUrl.startsWith('file://') ||
    targetUrl.includes('/tmp/') ||
    targetUrl.includes('/uploads/') ||
    targetUrl.includes('/shares/') ||
    /qurl-files\.qurl\.site/.test(targetUrl)
  ) {
    return { label: 'file', bgClass: 'bg-warning-dim', textClass: 'text-warning' };
  }
  if (targetUrl.includes('.qurl.site')) {
    return { label: 'tunneled', bgClass: 'bg-accent-dim', textClass: 'text-accent' };
  }
  const privatePatterns = [
    'http://localhost',
    'https://localhost',
    'http://127.0.0.1',
    'http://0.0.0.0',
    'http://10.',
    'http://192.168.',
    'http://172.16.',
    'http://172.17.',
    'http://172.18.',
    'http://172.19.',
    'http://172.2',
    'http://172.30.',
    'http://172.31.',
  ];
  if (privatePatterns.some((p) => targetUrl.startsWith(p))) {
    return { label: 'private', bgClass: 'bg-[rgba(168,85,247,0.1)]', textClass: 'text-[#a855f7]' };
  }
  return { label: 'public', bgClass: 'bg-success-dim', textClass: 'text-success' };
}

type StatusStyle = { dotClass: string; textClass: string };

function getStatusStyle(status: string): StatusStyle {
  switch (status) {
    case 'active':
      return { dotClass: 'bg-success', textClass: 'text-success' };
    case 'consumed':
      return { dotClass: 'bg-warning', textClass: 'text-warning' };
    case 'expired':
      return { dotClass: 'bg-text-muted', textClass: 'text-text-muted' };
    case 'revoked':
      return { dotClass: 'bg-danger', textClass: 'text-danger' };
    default:
      return { dotClass: 'bg-text-muted', textClass: 'text-text-muted' };
  }
}

type EffectiveState = 'sharing' | 'dormant' | 'revoked';

type EffectiveStyle = { dotClass: string; textClass: string; label: string; borderClass: string; glowClass: string };

function getEffectiveStyle(state: EffectiveState): EffectiveStyle {
  switch (state) {
    case 'sharing':
      return {
        dotClass: 'bg-success',
        textClass: 'text-success',
        label: 'Sharing',
        borderClass: 'border-[rgba(16,185,129,0.12)]',
        glowClass: 'shadow-[0_0_12px_rgba(16,185,129,0.06)]',
      };
    case 'dormant':
      return {
        dotClass: 'bg-warning',
        textClass: 'text-warning',
        label: 'No active links',
        borderClass: 'border-glass-border',
        glowClass: '',
      };
    case 'revoked':
      return {
        dotClass: 'bg-danger',
        textClass: 'text-danger',
        label: 'Revoked',
        borderClass: 'border-glass-border',
        glowClass: '',
      };
  }
}

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

type FilterTab = 'active' | 'no-active-qurls' | 'revoked' | 'all';

const FILTER_TABS: {
  id: FilterTab;
  label: string;
  dotClass: string;
  activeBadgeClass: string;
  emptyTitle: string;
  emptyHint: string;
}[] = [
  {
    id: 'active',
    label: 'Active',
    dotClass: 'bg-success',
    activeBadgeClass: 'bg-success-dim text-success',
    emptyTitle: 'No active resources',
    emptyHint: 'Create a resource above to get started.',
  },
  {
    id: 'no-active-qurls',
    label: 'No Active QURLs',
    dotClass: 'bg-warning',
    activeBadgeClass: 'bg-warning-dim text-warning',
    emptyTitle: 'All resources have active links',
    emptyHint: 'Resources appear here when none of their QURL links are active.',
  },
  {
    id: 'revoked',
    label: 'Revoked',
    dotClass: 'bg-danger',
    activeBadgeClass: 'bg-danger-dim text-danger',
    emptyTitle: 'No revoked resources',
    emptyHint: 'Revoked resources are permanently deactivated and cannot be restored.',
  },
  {
    id: 'all',
    label: 'All',
    dotClass: '',
    activeBadgeClass: 'bg-accent-dim text-accent',
    emptyTitle: 'No resources found',
    emptyHint: 'Create a resource above or share something from the Share page.',
  },
];

// ---------------------------------------------------------------------------
// Confirmation Modal
// ---------------------------------------------------------------------------

function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="bg-surface-1 rounded-xl border border-glass-border shadow-xl p-6 max-w-sm w-full mx-4 animate-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-semibold mb-2">{title}</h3>
        <p className="text-[13px] text-text-secondary mb-5 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2.5">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-surface-3 text-text-secondary hover:bg-surface-4 cursor-pointer transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all duration-150 ${
              danger
                ? 'bg-danger text-white hover:bg-[#dc2626]'
                : 'bg-accent text-white hover:bg-[#0088ee]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minted Link Modal
// ---------------------------------------------------------------------------

function MintedLinkModal({
  link,
  onClose,
}: {
  link: string;
  onClose: () => void;
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
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-4">
          <svg className="w-6 h-6 text-success shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
          <h3 className="text-[15px] font-semibold text-text-primary">Qurl Created</h3>
        </div>

        {/* Warning */}
        <div className="flex items-start gap-2.5 mb-4 py-2.5 px-3 rounded-lg bg-warning-dim border border-[rgba(245,158,11,0.15)]">
          <svg className="w-4 h-4 text-warning shrink-0 mt-0.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
          </svg>
          <p className="text-[12px] text-warning font-medium leading-relaxed">
            This link is shown only once and cannot be retrieved after you close this dialog. Copy it now.
          </p>
        </div>

        {/* Link */}
        <div className="flex items-center gap-2 bg-surface-0 rounded-lg px-3.5 py-3 mb-5 border border-glass-border">
          <code className="flex-1 font-mono text-[13px] text-accent truncate select-text">
            {link}
          </code>
          <button
            onClick={handleCopy}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-all duration-150 cursor-pointer ${
              copied
                ? 'bg-success text-white'
                : 'bg-accent text-white hover:bg-[#0088ee]'
            }`}
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        </div>

        {/* Close */}
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
// Chevron icon
// ---------------------------------------------------------------------------

function ChevronIcon({ open, className = '' }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`w-4 h-4 text-text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''} ${className}`}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

function Spinner({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const cls = size === 'md' ? 'w-4 h-4 border-2' : 'w-3.5 h-3.5 border-2';
  return <div className={`${cls} border-text-muted border-t-accent rounded-full animate-spin`} />;
}

// ---------------------------------------------------------------------------
// Filter dropdown (pill-styled, no native select)
// ---------------------------------------------------------------------------

function FilterDropdown({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const isFiltered = value !== options[0]?.value;

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={[
          'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150 cursor-pointer whitespace-nowrap',
          isFiltered
            ? 'bg-surface-0 text-accent shadow-sm'
            : 'text-text-muted hover:text-text-secondary',
        ].join(' ')}
      >
        {selected?.label}
        <svg
          className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-180' : ''} ${isFiltered ? 'text-accent' : 'text-text-muted'}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 bg-surface-1 border border-glass-border rounded-lg shadow-lg py-1 min-w-[120px] z-50 animate-in">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-colors ${
                opt.value === value
                  ? 'text-accent bg-accent-dim'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resources page
// ---------------------------------------------------------------------------

interface QurlsProps {
  mode: 'files' | 'http' | 'ssh';
}

interface ModeMeta {
  title: string;
  subtitle: string;
  newBtn: string;
  createTitle: string;
  emptyTitle: string;
  emptyHint: string;
  typeMatch: string[];
  filterFn?: (r: ResourceDetail) => boolean;
}

const MODE_META: Record<string, ModeMeta> = {
  files: {
    title: 'Files',
    subtitle: 'Manage file resources and their QURL access links.',
    newBtn: '+ New File Resource',
    createTitle: 'New File Resource',
    emptyTitle: 'No file resources yet',
    emptyHint: 'Add a file resource, then mint QURL links to share secure, time-limited access.',
    typeMatch: ['file'],
  },
  http: {
    title: 'HTTP Services',
    subtitle: 'Manage HTTP service resources and their QURL access links.',
    newBtn: '+ New HTTP Resource',
    createTitle: 'New HTTP Service Resource',
    emptyTitle: 'No HTTP service resources yet',
    emptyHint: 'Add an HTTP service resource, then mint QURL links to share secure access.',
    typeMatch: ['tunneled', 'private', 'public'],
    filterFn: (r) => {
      if (SSH_PREFIX_RE.test(r.description ?? '')) return false;
      return MODE_META.http.typeMatch.includes(getTypeIndicator(r.target_url).label);
    },
  },
  ssh: {
    title: 'SSH Services',
    subtitle: 'Manage SSH service resources and their QURL access links.',
    newBtn: '+ New SSH Resource',
    createTitle: 'New SSH Service Resource',
    emptyTitle: 'No SSH service resources yet',
    emptyHint: 'Add an SSH service resource, then mint QURL links to share secure access.',
    typeMatch: [],
    filterFn: (r) => SSH_PREFIX_RE.test(r.description ?? ''),
  },
};

function buildCreateDefaults(mode: string, defaults: QURLDefaults | null): Partial<QURLCreateInput> {
  const d = defaults
    ? mode === 'files' ? defaults.file : mode === 'ssh' ? defaults.ssh : defaults.http
    : null;
  return {
    target_url: '',
    expires_in: d?.expires_in || (mode === 'files' ? '1h' : mode === 'ssh' ? '7d' : '24h'),
    one_time_use: d?.one_time_use ?? (mode === 'files'),
    max_sessions: d?.max_sessions,
    session_duration: d?.session_duration,
    access_policy: d?.access_policy,
  };
}

export function Qurls({ mode }: QurlsProps) {
  const meta = MODE_META[mode];
  // --- Data --- (resources from API, not QURLs)
  const [resources, setResources] = useState<ResourceDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Filter ---
  const [filter, setFilter] = useState<FilterTab>('active');
  const [dateRange, setDateRange] = useState<string>('all');

  // --- Create form ---
  const [showCreate, setShowCreate] = useState(false);
  const [createInput, setCreateInput] = useState<Partial<QURLCreateInput>>({ target_url: '' });
  // SSH-specific state
  const [sshHost, setSshHost] = useState('localhost');
  const [sshPort, setSshPort] = useState('22');
  const [sshName, setSshName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createDescription, setCreateDescription] = useState('');
  const [pendingFile, setPendingFile] = useState<{ path: string; name: string } | null>(null);
  const [qurlDefaults, setQurlDefaults] = useState<QURLDefaults | null>(null);

  // --- Expanded card ---
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resourceDetails, setResourceDetails] = useState<Record<string, ResourceDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  // --- Sessions ---
  const [sessions, setSessions] = useState<Record<string, SessionInfo[]>>({});
  const [showSessions, setShowSessions] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState<string | null>(null);

  // --- Mint link ---
  const [mintingFor, setMintingFor] = useState<string | null>(null);
  const [mintInput, setMintInput] = useState<Partial<QURLCreateInput>>(() => {
    return buildCreateDefaults(mode, null);
  });
  const [showMintAdvanced, setShowMintAdvanced] = useState(false);
  const [mintSubmitting, setMintSubmitting] = useState(false);
  const [mintedLink, setMintedLink] = useState<{ resourceId: string; link: string } | null>(null);

  // --- Confirmation modal ---
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    action: () => Promise<void>;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchResources = useCallback(async () => {
    try {
      const result = await window.qurl.resources.list();
      if (result.success && result.resources) {
        // Filter by mode type
        const filtered = meta.filterFn
          ? result.resources.filter(meta.filterFn)
          : result.resources.filter((r) =>
              meta.typeMatch.includes(getTypeIndicator(r.target_url).label)
            );
        setResources(filtered);

        // Pre-fetch details for expanded resource cards
        const details: Record<string, ResourceDetail> = {};
        for (const r of filtered) {
          details[r.resource_id] = r;
        }
        setResourceDetails((prev) => ({ ...prev, ...details }));
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    fetchResources();
    window.qurl.settings.getDefaults().then((d) => {
      setQurlDefaults(d);
      // Initialize mint form with defaults from settings
      setMintInput(buildCreateDefaults(mode, d));
    }).catch(() => {});
    const interval = setInterval(fetchResources, 30000);
    return () => clearInterval(interval);
  }, [fetchResources, mode]);

  // Re-apply defaults when mode changes or defaults finish loading
  useEffect(() => {
    if (!showCreate) {
      setCreateInput(buildCreateDefaults(mode, qurlDefaults));
    }
  }, [mode, qurlDefaults]);

  const fetchResourceDetail = useCallback(async (resourceId: string) => {
    setLoadingDetail(resourceId);
    try {
      const result = await window.qurl.qurls.get(resourceId);
      if (result.success && result.resource) {
        setResourceDetails((prev) => ({ ...prev, [resourceId]: result.resource! }));
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingDetail(null);
    }
  }, []);

  const fetchSessions = useCallback(async (resourceId: string) => {
    setLoadingSessions(resourceId);
    try {
      const result = await window.qurl.qurls.getSessions(resourceId);
      if (result.success && result.sessions) {
        setSessions((prev) => ({ ...prev, [resourceId]: result.sessions! }));
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingSessions(null);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Filter counts & filtered list
  // ---------------------------------------------------------------------------

  // Resources are already filtered by mode from fetchResources
  const modeResources = resources;

  const counts = useMemo(() => {
    let pool = modeResources;
    if (dateRange !== 'all') {
      const now = Date.now();
      const cutoff =
        dateRange === 'today' ? now - 24 * 60 * 60 * 1000
        : dateRange === '7d' ? now - 7 * 24 * 60 * 60 * 1000
        : now - 30 * 24 * 60 * 60 * 1000;
      pool = pool.filter((r) => new Date(r.created_at).getTime() >= cutoff);
    }
    let active = 0;
    let noActiveQurls = 0;
    let revoked = 0;
    for (const r of pool) {
      if (r.status === 'revoked') {
        revoked++;
      } else {
        active++;
        const hasActiveQurl = (r.qurls || []).some((q) => q.status === 'active');
        if (!hasActiveQurl) noActiveQurls++;
      }
    }
    return { active, 'no-active-qurls': noActiveQurls, revoked, all: pool.length };
  }, [modeResources, dateRange]);

  const filteredResources = useMemo(() => {
    let result: ResourceDetail[];
    if (filter === 'active') {
      result = modeResources.filter((r) => r.status !== 'revoked');
    } else if (filter === 'no-active-qurls') {
      result = modeResources.filter((r) => {
        if (r.status === 'revoked') return false;
        return !(r.qurls || []).some((q) => q.status === 'active');
      });
    } else if (filter === 'revoked') {
      result = modeResources.filter((r) => r.status === 'revoked');
    } else {
      result = [...modeResources];
    }
    if (dateRange !== 'all') {
      const now = Date.now();
      const cutoff =
        dateRange === 'today' ? now - 24 * 60 * 60 * 1000
        : dateRange === '7d' ? now - 7 * 24 * 60 * 60 * 1000
        : now - 30 * 24 * 60 * 60 * 1000;
      result = result.filter((r) => new Date(r.created_at).getTime() >= cutoff);
    }
    return result;
  }, [modeResources, filter, resourceDetails, dateRange]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleToggleExpand = useCallback(
    (resourceId: string) => {
      if (expandedId === resourceId) {
        setExpandedId(null);
        setShowSessions(null);
        setMintingFor(null);
      } else {
        setExpandedId(resourceId);
        setShowSessions(null);
        setMintingFor(null);
        fetchResourceDetail(resourceId);
      }
    },
    [expandedId, fetchResourceDetail],
  );

  // After resource creation, expand it with mint form open
  const focusResource = useCallback((resourceId: string) => {
    setExpandedId(resourceId);
    setMintingFor(resourceId);
    fetchResourceDetail(resourceId);
  }, [fetchResourceDetail]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      let targetUrl: string;

      if (mode === 'ssh') {
        // SSH: create tunnel route, then get public URL for API resource
        const host = sshHost.trim() || 'localhost';
        const port = sshPort.trim() || '22';
        const name = sshName.trim() || `ssh-${host}-${port}`;
        const addResult = await window.qurl.tunnels.add(`${host}:${port}`, name);
        if (!addResult.success) { setError(addResult.error || 'Failed to create tunnel'); return; }
        // The tunnel's public URL will be the resource target
        const tunnels = await window.qurl.tunnels.list();
        const tunnel = tunnels.find((t) => t.name === name);
        targetUrl = tunnel?.publicUrl || `${host}:${port}`;
      } else if (mode === 'files' && pendingFile) {
        // Files: set up local file serving, get public URL
        const setupResult = await window.qurl.share.setupFile(pendingFile.path, pendingFile.name);
        if (!setupResult.success) { setError(setupResult.error || 'Failed to set up file'); return; }
        targetUrl = setupResult.publicUrl!;
      } else if (createInput.target_url) {
        // HTTP: normalize URL, create tunnel for local URLs
        targetUrl = createInput.target_url.trim();
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
          if (targetUrl.match(/^localhost(:\d+)?/)) targetUrl = 'http://' + targetUrl;
          else if (targetUrl.includes('.') && !targetUrl.includes(' ')) targetUrl = 'https://' + targetUrl;
        }
        const detectResult = await window.qurl.share.detectUrl(targetUrl).catch(() => null);
        if (detectResult?.isLocal) {
          // Create tunnel for local URL
          const name = targetUrl.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
          const addResult = await window.qurl.tunnels.add(targetUrl, name);
          if (!addResult.success) { setError(addResult.error || 'Failed to create tunnel'); return; }
          const tunnels = await window.qurl.tunnels.list();
          const tunnel = tunnels.find((t) => t.name === name);
          targetUrl = tunnel?.publicUrl || targetUrl;
        }
      } else {
        return;
      }

      // Create resource on the API (no QURL)
      const description = mode === 'ssh'
        ? `SSH: ${sshName.trim() || `${sshHost.trim() || 'localhost'}:${sshPort.trim() || '22'}`}`
        : createDescription.trim() || undefined;
      const result = await window.qurl.resources.create({ target_url: targetUrl, ...(description ? { description } : {}) });
      if (!result.success) { setError(result.error || 'Failed to create resource'); return; }

      setShowCreate(false);
      setCreateInput({ target_url: '' });
      setCreateDescription('');
      setPendingFile(null);
      if (mode === 'ssh') { setSshHost('localhost'); setSshPort('22'); setSshName(''); }
      await fetchResources();
      if (result.resource?.resource_id) focusResource(result.resource.resource_id);
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  }, [mode, createInput, createDescription, pendingFile, sshHost, sshPort, sshName, fetchResources, focusResource]);

  const handleFileDrop = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;
      const filePath = (file as File & { path?: string }).path;
      if (!filePath) {
        setError('Could not determine file path');
        return;
      }
      setPendingFile({ path: filePath, name: file.name });
      const d = qurlDefaults?.file;
      setCreateInput((p) => ({
        target_url: '',
        expires_in: d?.expires_in || '1h',
        one_time_use: d?.one_time_use ?? true,
        max_sessions: d?.max_sessions,
        session_duration: d?.session_duration,
        access_policy: d?.access_policy || p.access_policy,
        label: p.label || file.name,
      }));
    },
    [qurlDefaults],
  );

  const handleRevokeResource = useCallback(
    (resourceId: string, label: string) => {
      setConfirmAction({
        title: 'Revoke Protected Resource',
        message: `This will permanently revoke "${label}" and all its access links. Active sessions will be terminated. This cannot be undone.`,
        confirmLabel: 'Revoke Resource',
        danger: true,
        action: async () => {
          setError(null);
          try {
            const result = await window.qurl.qurls.revoke(resourceId);
            if (!result.success) {
              setError(result.error || 'Failed to revoke');
              return;
            }
            setExpandedId(null);
            setMintedLink(null);
            await fetchResources();
          } catch (err) {
            setError(String(err));
          }
        },
      });
    },
    [fetchResources],
  );

  const handleRevokeQurl = useCallback(
    (resourceId: string, qurlId: string, label: string) => {
      setConfirmAction({
        title: 'Revoke Access Link',
        message: `Revoke "${label || qurlId}"? Anyone using this link will lose access immediately.`,
        confirmLabel: 'Revoke Link',
        danger: true,
        action: async () => {
          setError(null);
          try {
            const result = await window.qurl.qurls.revokeQurl(resourceId, qurlId);
            if (!result.success) {
              setError(result.error || 'Failed to revoke');
              return;
            }
            await fetchResourceDetail(resourceId);
          } catch (err) {
            setError(String(err));
          }
        },
      });
    },
    [fetchResourceDetail],
  );

  const handleTerminateSession = useCallback(
    (resourceId: string, sessionId: string, ip: string) => {
      setConfirmAction({
        title: 'Terminate Session',
        message: `Terminate the active session from ${ip}? The client will need a new access link to reconnect.`,
        confirmLabel: 'Terminate',
        danger: true,
        action: async () => {
          await window.qurl.qurls.terminateSession(resourceId, sessionId);
          await fetchSessions(resourceId);
        },
      });
    },
    [fetchSessions],
  );

  const handleTerminateAllSessions = useCallback(
    (resourceId: string, count: number) => {
      setConfirmAction({
        title: 'Terminate All Sessions',
        message: `Terminate all ${count} active session${count !== 1 ? 's' : ''} for this resource? All connected clients will be disconnected.`,
        confirmLabel: 'Terminate All',
        danger: true,
        action: async () => {
          await window.qurl.qurls.terminateAllSessions(resourceId);
          await fetchSessions(resourceId);
        },
      });
    },
    [fetchSessions],
  );

  const handleMintSubmit = useCallback(
    async (resourceId: string) => {
      setMintSubmitting(true);
      setError(null);
      try {
        const result = await window.qurl.qurls.mintLink(resourceId, mintInput);
        if (!result.success) {
          setError(result.error || 'Failed to mint link');
          return;
        }
        if (result.qurl?.qurl_link) {
          setMintedLink({ resourceId, link: result.qurl.qurl_link });
        }
        setMintingFor(null);
        setMintInput(buildCreateDefaults(mode, qurlDefaults));
        setShowMintAdvanced(false);
        await fetchResourceDetail(resourceId);
      } catch (err) {
        setError(String(err));
      } finally {
        setMintSubmitting(false);
      }
    },
    [mintInput, fetchResourceDetail],
  );

  const handleConfirm = useCallback(async () => {
    if (!confirmAction) return;
    await confirmAction.action();
    setConfirmAction(null);
  }, [confirmAction]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-5">
      {/* Confirmation modal */}
      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          danger={confirmAction.danger}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* ================================================================== */}
      {/* Page header                                                        */}
      {/* ================================================================== */}
      <div style={{ animation: 'fadeIn 400ms cubic-bezier(0.16, 1, 0.3, 1) both' }}>
        <h1 className="text-xl font-semibold tracking-tight mb-1">{meta.title}</h1>
        <div className="flex items-center justify-between">
          <p className="text-text-secondary text-[13px] leading-relaxed">
            {meta.subtitle}
          </p>
          <button
            onClick={() => {
              if (!showCreate) {
                setCreateInput({ target_url: '' });
              }
              setShowCreate(!showCreate);
              setError(null);
              if (showCreate) setPendingFile(null);
            }}
            className={`py-2 px-4 rounded-lg font-semibold text-[13px] transition-all duration-150 cursor-pointer shrink-0 ${
              showCreate
                ? 'bg-surface-3 text-text-secondary hover:bg-surface-4'
                : 'bg-gradient-to-r from-[#0099FF] to-[#D406B9] text-white hover:shadow-[0_0_20px_rgba(0,153,255,0.25)]'
            }`}
          >
            {showCreate ? 'Cancel' : meta.newBtn}
          </button>
        </div>
      </div>

      {/* ================================================================== */}
      {/* Minted link modal                                                  */}
      {/* ================================================================== */}
      {mintedLink && (
        <MintedLinkModal
          link={mintedLink.link}
          onClose={() => setMintedLink(null)}
        />
      )}

      {/* ================================================================== */}
      {/* Error banner                                                       */}
      {/* ================================================================== */}
      {error && (
        <div className="py-3 px-4 rounded-xl bg-danger-dim border border-danger-border text-danger text-[13px] flex items-center gap-2.5 animate-in">
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

      {/* ================================================================== */}
      {/* Create form                                                        */}
      {/* ================================================================== */}
      {showCreate && (
        <div className="bg-surface-2 rounded-xl p-5 border border-glass-border flex flex-col gap-3 animate-in">
          <h2 className="text-[13px] font-semibold text-text-primary">Create Resource</h2>
          <p className="text-[11px] text-text-muted leading-relaxed -mt-1">
            Once created, you can mint QURL links to share secure, time-limited access to this resource.
          </p>

          {/* Mode-specific source input */}
          {mode === 'files' ? (
            /* ── Files mode ── */
            pendingFile ? (
              <div className="flex items-center gap-3 bg-surface-1 border border-glass-border rounded-lg px-3.5 py-2.5">
                <svg className="w-4 h-4 text-warning shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 2l5 5h-5V4zm-3 9v2H8v-2h2zm6 0v2h-4v-2h4zm-6 4v2H8v-2h2zm6 0v2h-4v-2h4z" />
                </svg>
                <span className="flex-1 text-[13px] text-text-primary font-medium truncate">{pendingFile.name}</span>
                <button
                  onClick={() => { setPendingFile(null); setCreateInput((p) => ({ ...p, label: undefined })); }}
                  className="text-text-muted hover:text-text-secondary text-sm bg-transparent cursor-pointer shrink-0 transition-colors"
                >{'\u2715'}</button>
              </div>
            ) : (
              <DropZone onDrop={handleFileDrop} disabled={creating} />
            )
          ) : mode === 'ssh' ? (
            /* ── SSH mode ── */
            <div className="grid grid-cols-[2fr_1fr_2fr] gap-3">
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">Host</label>
                <input
                  value={sshHost}
                  onChange={(e) => setSshHost(e.target.value)}
                  placeholder="192.168.1.100"
                  className="w-full py-2.5 px-3.5 bg-surface-1 border border-glass-border rounded-lg text-text-primary text-[13px] font-mono placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-dim"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">Port</label>
                <input
                  type="number"
                  value={sshPort}
                  onChange={(e) => setSshPort(e.target.value)}
                  placeholder="22"
                  min={1}
                  max={65535}
                  className="w-full py-2.5 px-3.5 bg-surface-1 border border-glass-border rounded-lg text-text-primary text-[13px] font-mono placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-dim"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">
                  Name <span className="text-text-muted font-normal">(optional)</span>
                </label>
                <input
                  value={sshName}
                  onChange={(e) => setSshName(e.target.value)}
                  placeholder="Production bastion"
                  className="w-full py-2.5 px-3.5 bg-surface-1 border border-glass-border rounded-lg text-text-primary text-[13px] placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-dim"
                />
              </div>
            </div>
          ) : (
            /* ── HTTP mode ── */
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">Service URL</label>
              <input
                value={createInput.target_url || ''}
                onChange={(e) => setCreateInput((p) => ({ ...p, target_url: e.target.value }))}
                placeholder="localhost:8080 or https://staging.internal.co"
                className="w-full py-2.5 px-3.5 bg-surface-1 border border-glass-border rounded-lg text-text-primary text-[13px] font-mono placeholder:text-text-muted placeholder:font-sans focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-dim"
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                autoFocus
              />
            </div>
          )}

          {/* Description (optional, files and HTTP modes) */}
          {mode !== 'ssh' && (
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">
                Description <span className="text-text-muted font-normal">(optional)</span>
              </label>
              <input
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder={mode === 'files' ? 'e.g., Design assets for review' : 'e.g., Staging environment'}
                className="w-full py-2.5 px-3.5 bg-surface-1 border border-glass-border rounded-lg text-text-primary text-[13px] placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-dim"
              />
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              onClick={handleCreate}
              disabled={creating || (mode !== 'ssh' && !createInput.target_url && !pendingFile)}
              className={`bg-gradient-to-r from-[#0099FF] to-[#D406B9] text-white py-2 px-6 rounded-lg font-semibold text-[13px] transition-all duration-150 ${
                creating || (mode !== 'ssh' && !createInput.target_url && !pendingFile)
                  ? 'opacity-40 cursor-not-allowed'
                  : 'opacity-100 cursor-pointer hover:shadow-[0_0_20px_rgba(0,153,255,0.25)]'
              }`}
            >
              {creating ? (
                <span className="flex items-center gap-2">
                  <Spinner />
                  Creating...
                </span>
              ) : (
                'Create Resource'
              )}
            </button>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* Filter tabs                                                        */}
      {/* ================================================================== */}
      {!loading && modeResources.length > 0 && (
        <div className="flex gap-0.5 bg-surface-2 rounded-lg p-1 border border-glass-border flex-wrap w-fit">
          {/* Status tabs */}
          {FILTER_TABS.map((tab) => {
            const count = counts[tab.id];
            const isActive = filter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={[
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150 cursor-pointer whitespace-nowrap',
                  isActive
                    ? 'bg-surface-0 text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-secondary',
                ].join(' ')}
              >
                {tab.dotClass && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 transition-opacity duration-150 ${tab.dotClass} ${
                      isActive ? '' : 'opacity-40'
                    }`}
                  />
                )}
                {tab.label}
                <span
                  className={`text-[10px] font-semibold min-w-[18px] text-center rounded-full px-1 py-px transition-colors duration-150 ${
                    isActive ? tab.activeBadgeClass : 'bg-surface-3 text-text-muted'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}

          {/* Separator */}
          <div className="w-px h-5 bg-glass-border mx-0.5 self-center shrink-0" />

          {/* Date range */}
          <FilterDropdown
            value={dateRange}
            onChange={setDateRange}
            options={[
              { value: 'all', label: 'All time' },
              { value: 'today', label: 'Today' },
              { value: '7d', label: 'Last 7 days' },
              { value: '30d', label: 'Last 30 days' },
            ]}
          />

          {/* Clear */}
          {dateRange !== 'all' && (
            <button
              onClick={() => { setDateRange('all'); }}
              className="flex items-center px-1.5 py-1 rounded-md text-[11px] text-text-muted hover:text-danger bg-transparent cursor-pointer transition-colors"
            >
              {'\u2715'}
            </button>
          )}
        </div>
      )}

      {/* ================================================================== */}
      {/* Resource list                                                      */}
      {/* ================================================================== */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-text-muted text-[13px]">
          <Spinner size="md" />
          <span className="ml-2.5">Loading resources...</span>
        </div>
      ) : modeResources.length === 0 && !showCreate ? (
        <div className="text-center py-12 bg-surface-2 rounded-xl border border-glass-border">
          <svg
            className="w-10 h-10 text-text-muted mx-auto mb-3 opacity-40"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
          </svg>
          <p className="text-text-secondary text-[13px] font-medium mb-1">{meta.emptyTitle}</p>
          <p className="text-text-muted text-[12px]">
            {meta.emptyHint}
          </p>
        </div>
      ) : filteredResources.length === 0 ? (
        (() => {
          const tab = FILTER_TABS.find((t) => t.id === filter)!;
          return (
            <div className="text-center py-10 bg-surface-2 rounded-xl border border-glass-border">
              {tab.dotClass && (
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full mb-2.5 opacity-30 ${tab.dotClass}`}
                />
              )}
              <p className="text-text-secondary text-[13px] font-medium mb-1">
                {tab.emptyTitle}
              </p>
              <p className="text-text-muted text-[12px] max-w-[280px] mx-auto leading-relaxed">
                {tab.emptyHint}
              </p>
            </div>
          );
        })()
      ) : (
        <div className="flex flex-col gap-2">
          {filteredResources.map((q, idx) => {
            const isExpanded = expandedId === q.resource_id;
            const detail = resourceDetails[q.resource_id] || q;
            const isLoadingDetail = loadingDetail === q.resource_id;
            const resourceSessions = sessions[q.resource_id] || [];
            const isMintOpen = mintingFor === q.resource_id;

            // Compute effective state from resource data
            const effectiveState: EffectiveState =
              q.status === 'revoked' ? 'revoked'
              : (q.qurls || []).some((t) => t.status === 'active') ? 'sharing'
              : 'dormant';
            const eStyle = getEffectiveStyle(effectiveState);

            return (
              <div
                key={q.resource_id}
                className={`relative rounded-xl overflow-hidden transition-all duration-200 ${
                  isExpanded
                    ? `bg-surface-2 ${eStyle.borderClass} border shadow-lg`
                    : `bg-surface-2 border ${eStyle.borderClass} hover:border-glass-border-hover ${eStyle.glowClass}`
                } ${effectiveState === 'revoked' ? 'opacity-60' : ''}`}
                style={{ animation: `fadeIn 350ms cubic-bezier(0.16, 1, 0.3, 1) ${idx * 40}ms both` }}
              >
                {/* Left accent bar */}
                <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${
                  effectiveState === 'sharing' ? 'bg-success'
                    : effectiveState === 'dormant' ? 'bg-warning'
                    : effectiveState === 'revoked' ? 'bg-danger'
                    : 'bg-transparent'
                }`} />

                {/* ---- Collapsed card header ---- */}
                <button
                  onClick={() => handleToggleExpand(q.resource_id)}
                  className="w-full pl-5 pr-4 py-3.5 flex items-center gap-3 cursor-pointer bg-transparent text-left group"
                >
                  {/* Status indicator */}
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${eStyle.dotClass} ${
                      effectiveState === 'sharing' ? 'shadow-[0_0_6px_var(--color-success)]' : ''
                    }`}
                  />

                  {/* Name & URL */}
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className={`font-semibold text-[13px] truncate leading-tight ${
                      effectiveState === 'revoked' ? 'text-text-muted' : 'text-text-primary'
                    }`}>
                      {q.description || q.target_url}
                    </span>
                    {q.description && (
                      <span className="text-[11px] text-text-muted font-mono truncate leading-tight">
                        {q.target_url}
                      </span>
                    )}
                  </div>

                  {/* Chevron */}
                  <ChevronIcon open={isExpanded} />
                </button>

                {/* ---- Expanded detail section ---- */}
                {isExpanded && (
                  <div className="border-t border-glass-border animate-in">
                    {/* Resource metadata */}
                    <div className="px-5 pt-4 pb-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span className="text-text-muted">Target</span>
                        <code className="text-text-secondary font-mono text-[11px] bg-surface-1 px-1.5 py-0.5 rounded">
                          {q.target_url}
                        </code>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-text-muted">ID</span>
                        <code className="text-text-secondary font-mono text-[11px] bg-surface-1 px-1.5 py-0.5 rounded">
                          {q.resource_id}
                        </code>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-text-muted">Created</span>
                        <span className="text-text-secondary">
                          {new Date(q.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                      </div>
                    </div>

                    {/* Loading detail spinner */}
                    {isLoadingDetail && (
                      <div className="flex items-center gap-2 text-text-muted text-xs px-5 py-3">
                        <Spinner />
                        Loading details...
                      </div>
                    )}

                    {/* Dormant state banner — shown when resource is active but has no usable links */}
                    {detail && q.status === 'active' && !detail.qurls.some((t) => t.status === 'active') && (
                      <div className="mx-5 mb-3 flex items-start gap-2.5 py-2.5 px-3.5 rounded-lg bg-warning-dim border border-[rgba(245,158,11,0.15)]">
                        <svg className="w-4 h-4 text-warning shrink-0 mt-0.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                        </svg>
                        <div>
                          <span className="text-[12px] text-warning font-medium block">No active access links</span>
                          <span className="text-[11px] text-text-muted block mt-0.5">
                            All links for this resource are expired or revoked. Mint a new link to share it again.
                          </span>
                        </div>
                      </div>
                    )}

                    {/* ---- Access Links section ---- */}
                    {detail && (
                      <div className="px-5 pb-3">
                        <div className="flex items-center justify-between mb-2.5">
                          <h3 className="text-xs font-semibold text-text-secondary">
                            Access Links
                            {detail.qurls.length > 0 && (
                              <span className="ml-1.5 text-text-tertiary font-normal normal-case tracking-normal">
                                ({detail.qurls.length})
                              </span>
                            )}
                          </h3>
                          {q.status === 'active' && !isMintOpen && (
                            <button
                              onClick={() => {
                                const d = resourceDetails[q.resource_id];
                                const firstQurlLabel = d?.qurls[0]?.label;
                                const urlFilename = decodeURIComponent(q.target_url.split('/').pop() || '');
                                const base = q.description || firstQurlLabel || urlFilename || 'Link';
                                const count = d ? d.qurls.length : 0;
                                const label = count > 0 ? `${base} (${count + 1})` : base;
                                setMintingFor(q.resource_id);
                                setMintInput({ ...buildCreateDefaults(mode, qurlDefaults), label });
                                setShowMintAdvanced(false);
                              }}
                              className="text-accent text-[11px] font-semibold bg-transparent cursor-pointer hover:underline flex items-center gap-1"
                            >
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                              </svg>
                              Mint Qurl
                            </button>
                          )}
                        </div>

                        {detail.qurls.length === 0 && !isMintOpen && (
                          <div className="py-4 text-center text-[12px] text-text-muted bg-surface-1 rounded-lg border border-glass-border">
                            No QURL links yet. Mint one to share secure access to this resource.
                          </div>
                        )}

                        {detail.qurls.length > 0 && (
                          <div className="flex flex-col gap-1.5">
                            {detail.qurls.map((token) => {
                              const tokenStatus = getStatusStyle(token.status);
                              return (
                                <div
                                  key={token.qurl_id}
                                  className="bg-surface-1 rounded-lg px-3.5 py-2.5 flex items-center gap-3 group/token"
                                >
                                  {/* Token status dot */}
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${tokenStatus.dotClass}`}
                                  />

                                  {/* Token info */}
                                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span
                                        className={`text-[11px] font-semibold ${tokenStatus.textClass}`}
                                      >
                                        {token.status}
                                      </span>
                                      {token.label && (
                                        <span className="text-[11px] text-text-secondary font-medium">
                                          {token.label}
                                        </span>
                                      )}
                                      {token.one_time_use && (
                                        <span className="text-[10px] text-warning bg-warning-dim px-1.5 py-px rounded-full font-medium">
                                          one-time
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2.5 text-[10px] text-text-muted flex-wrap">
                                      <span>
                                        {token.use_count} use{token.use_count !== 1 ? 's' : ''}
                                      </span>
                                      <span className="text-glass-border">|</span>
                                      <span>{formatTimeRemaining(token.expires_at)}</span>
                                      <span className="text-glass-border">|</span>
                                      <span>created {formatRelativeTime(token.created_at)}</span>
                                      {token.max_sessions > 0 && (
                                        <>
                                          <span className="text-glass-border">|</span>
                                          <span>max {token.max_sessions} sessions</span>
                                        </>
                                      )}
                                    </div>
                                  </div>

                                  {/* Revoke */}
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {token.status === 'active' && (
                                      <button
                                        onClick={() =>
                                          handleRevokeQurl(
                                            q.resource_id,
                                            token.qurl_id,
                                            token.label || token.qurl_id,
                                          )
                                        }
                                        className="text-text-muted text-[11px] font-medium bg-transparent cursor-pointer hover:text-danger hover:bg-danger-dim px-2.5 py-1 rounded-lg transition-colors shrink-0"
                                      >
                                        Revoke
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ---- Mint New Link form ---- */}
                    {isMintOpen && (
                      <div className="mx-5 mb-3 bg-surface-1 rounded-lg p-4 border border-accent-border flex flex-col gap-3 animate-in">
                        <h4 className="text-[13px] font-semibold text-text-primary">
                          Create Qurl
                        </h4>

                        {/* Label (basic field) */}
                        <div>
                          <label className="text-[11px] font-medium text-text-muted mb-1 block">
                            Label <span className="font-normal">(Optional)</span>
                          </label>
                          <input
                            value={mintInput.label || ''}
                            onChange={(e) =>
                              setMintInput((p) => ({
                                ...p,
                                label: e.target.value || undefined,
                              }))
                            }
                            placeholder="e.g. Alice from Acme"
                            className="w-full py-1.5 px-3 bg-surface-2 border border-glass-border rounded-md text-[12px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                          />
                        </div>

                        {/* Basic options */}
                        <div className="flex items-center gap-4 flex-wrap">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-text-muted">Expires:</span>
                            <select
                              value={mintInput.expires_in || '1h'}
                              onChange={(e) =>
                                setMintInput((p) => ({ ...p, expires_in: e.target.value }))
                              }
                              className="bg-transparent border-none text-[11px] text-text-secondary font-medium p-0 pr-4 cursor-pointer focus:ring-0 focus:outline-none"
                            >
                              <option value="15m">15 min</option>
                              <option value="1h">1 hour</option>
                              <option value="6h">6 hours</option>
                              <option value="24h">24 hours</option>
                              <option value="7d">7 days</option>
                              <option value="30d">30 days</option>
                            </select>
                          </div>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={mintInput.one_time_use || false}
                              onChange={(e) =>
                                setMintInput((p) => ({ ...p, one_time_use: e.target.checked }))
                              }
                              className="w-3.5 h-3.5 rounded border-glass-border bg-surface-2 text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer"
                            />
                            <span className="text-[11px] text-text-muted">One-time use</span>
                          </label>
                          <button
                            onClick={() => setShowMintAdvanced(!showMintAdvanced)}
                            className="text-[11px] text-text-muted hover:text-accent transition-colors cursor-pointer ml-auto flex items-center gap-1 bg-transparent"
                          >
                            <svg
                              className={`w-3 h-3 transition-transform duration-150 ${showMintAdvanced ? 'rotate-90' : ''}`}
                              viewBox="0 0 24 24"
                              fill="currentColor"
                            >
                              <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                            </svg>
                            {showMintAdvanced ? 'Hide advanced' : 'Advanced'}
                          </button>
                        </div>

                        {/* Advanced options */}
                        {showMintAdvanced && (
                          <div className="flex flex-col gap-2.5 pt-1 border-t border-glass-border mt-1 animate-in">
                            <div>
                              <label className="text-[11px] font-medium text-text-muted mb-1 block">
                                Max sessions
                              </label>
                              <input
                                type="number"
                                min="0"
                                value={mintInput.max_sessions || ''}
                                onChange={(e) =>
                                  setMintInput((p) => ({
                                    ...p,
                                    max_sessions: parseInt(e.target.value) || undefined,
                                  }))
                                }
                                placeholder="Unlimited"
                                className="w-full py-1.5 px-3 bg-surface-2 border border-glass-border rounded-md text-[12px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                              />
                            </div>
                            <AccessPolicyForm
                              value={mintInput}
                              onChange={setMintInput}
                              compact
                              advancedOnly
                            />
                          </div>
                        )}

                        {/* Mint actions */}
                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            onClick={() => setMintingFor(null)}
                            className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-surface-3 text-text-secondary hover:bg-surface-4 cursor-pointer transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleMintSubmit(q.resource_id)}
                            disabled={mintSubmitting}
                            className={`px-4 py-1.5 rounded-lg text-xs font-semibold text-white cursor-pointer bg-gradient-to-r from-[#0099FF] to-[#D406B9] transition-all duration-150 ${
                              mintSubmitting
                                ? 'opacity-40 cursor-not-allowed'
                                : 'hover:shadow-[0_0_20px_rgba(0,153,255,0.25)]'
                            }`}
                          >
                            {mintSubmitting ? (
                              <span className="flex items-center gap-1.5">
                                <Spinner />
                                Creating...
                              </span>
                            ) : (
                              'Create Qurl'
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ---- Sessions section ---- */}
                    {q.status === 'active' && (
                      <div className="px-5 pb-3">
                        <button
                          onClick={() => {
                            if (showSessions === q.resource_id) {
                              setShowSessions(null);
                            } else {
                              setShowSessions(q.resource_id);
                              fetchSessions(q.resource_id);
                            }
                          }}
                          className="text-[11px] text-text-muted hover:text-text-secondary bg-transparent cursor-pointer flex items-center gap-1.5 font-medium"
                        >
                          <svg
                            className={`w-3 h-3 transition-transform duration-150 ${showSessions === q.resource_id ? 'rotate-90' : ''}`}
                            viewBox="0 0 24 24"
                            fill="currentColor"
                          >
                            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                          </svg>
                          Active Sessions
                          {resourceSessions.length > 0 && (
                            <span className="bg-surface-3 text-text-muted text-[10px] rounded-full px-1.5 py-px font-semibold">
                              {resourceSessions.length}
                            </span>
                          )}
                        </button>

                        {showSessions === q.resource_id && (
                          <div className="mt-2 animate-in">
                            {loadingSessions === q.resource_id ? (
                              <div className="flex items-center gap-2 text-text-muted text-[11px] py-3">
                                <Spinner />
                                Loading sessions...
                              </div>
                            ) : resourceSessions.length === 0 ? (
                              <div className="py-3 text-center text-[11px] text-text-muted bg-surface-1 rounded-lg">
                                No active sessions.
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1.5">
                                {resourceSessions.map((s) => (
                                  <div
                                    key={s.session_id}
                                    className="bg-surface-1 rounded-lg px-3.5 py-2.5 flex items-center justify-between group/session"
                                  >
                                    <div className="flex flex-col gap-0.5 min-w-0">
                                      <div className="flex items-center gap-2.5 text-[11px]">
                                        <span className="font-mono text-text-secondary font-medium">
                                          {s.src_ip}
                                        </span>
                                        <span className="text-text-muted text-[10px] font-mono">
                                          {s.qurl_id.slice(0, 12)}...
                                        </span>
                                      </div>
                                      <span className="text-text-muted text-[10px] truncate max-w-[320px]">
                                        {s.user_agent}
                                      </span>
                                      <span className="text-text-muted text-[10px]">
                                        Last seen {formatRelativeTime(s.last_seen_at)}
                                      </span>
                                    </div>
                                    <button
                                      onClick={() =>
                                        handleTerminateSession(
                                          q.resource_id,
                                          s.session_id,
                                          s.src_ip,
                                        )
                                      }
                                      className="text-text-muted text-[11px] font-medium bg-transparent cursor-pointer hover:text-danger hover:bg-danger-dim px-2.5 py-1 rounded-lg transition-colors shrink-0"
                                    >
                                      Terminate
                                    </button>
                                  </div>
                                ))}
                                {resourceSessions.length > 1 && (
                                  <button
                                    onClick={() =>
                                      handleTerminateAllSessions(
                                        q.resource_id,
                                        resourceSessions.length,
                                      )
                                    }
                                    className="self-start text-danger text-[11px] font-medium bg-transparent cursor-pointer hover:underline mt-1"
                                  >
                                    Terminate all sessions
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ---- Resource danger zone ---- */}
                    {q.status === 'active' && (
                      <div className="mx-5 mb-4 mt-1 pt-3 border-t border-glass-border flex items-center justify-between">
                        <span className="text-[11px] text-text-muted">
                          Revoking kills all access links and active sessions permanently.
                        </span>
                        <button
                          onClick={() =>
                            handleRevokeResource(q.resource_id, q.description || q.target_url)
                          }
                          className="bg-transparent text-danger py-1.5 px-3 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors hover:bg-danger-dim border border-transparent hover:border-danger-border shrink-0"
                        >
                          Revoke Resource
                        </button>
                      </div>
                    )}

                    {/* Revoked resource footer */}
                    {q.status === 'revoked' && (
                      <div className="mx-5 mb-4 mt-1 pt-3 border-t border-glass-border">
                        <div className="flex items-center gap-2 text-[11px] text-text-muted">
                          <svg className="w-3.5 h-3.5 text-danger shrink-0" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm6.31-3.1L7.1 5.69C8.45 4.63 10.15 4 12 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z" />
                          </svg>
                          This resource has been permanently revoked. All access links and sessions are terminated.
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
