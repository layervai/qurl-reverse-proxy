import { useState, useEffect, useCallback } from 'react';
import { AccessPolicyForm } from '../components/AccessPolicyForm';

function formatTimeRemaining(expiresAt: string | null): string {
  if (!expiresAt) return 'No expiry';
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return 'Expired';

  const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
  const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

type TypeBadge = { label: string; bgClass: string; textClass: string };

function getTypeIndicator(targetUrl: string): TypeBadge {
  if (targetUrl.startsWith('file://') || targetUrl.includes('/tmp/') || targetUrl.includes('/uploads/')) {
    return { label: 'file', bgClass: 'bg-warning-dim', textClass: 'text-warning' };
  }
  if (targetUrl.startsWith('http://localhost') || targetUrl.startsWith('http://127.0.0.1')) {
    return { label: 'private', bgClass: 'bg-accent-dim', textClass: 'text-accent' };
  }
  return { label: 'public', bgClass: 'bg-success-dim', textClass: 'text-success' };
}

type StatusStyle = { dotClass: string; textClass: string };

function getStatusStyle(status: string): StatusStyle {
  switch (status) {
    case 'active':
      return { dotClass: 'bg-success', textClass: 'text-success' };
    case 'expired':
      return { dotClass: 'bg-text-muted', textClass: 'text-text-muted' };
    case 'revoked':
      return { dotClass: 'bg-danger', textClass: 'text-danger' };
    default:
      return { dotClass: 'bg-text-muted', textClass: 'text-text-muted' };
  }
}

export function Resources() {
  const [qurls, setQurls] = useState<QURLInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [createInput, setCreateInput] = useState<Partial<QURLCreateInput>>({
    target_url: '',
    expires_in: '1h',
  });
  const [creating, setCreating] = useState(false);

  // Mint link state
  const [mintingId, setMintingId] = useState<string | null>(null);

  // Copied link state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchQurls = useCallback(async () => {
    try {
      const result = await window.qurl.qurls.list();
      if (result.success && result.qurls) {
        setQurls(result.qurls);
      }
    } catch {
      // Ignore polling errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQurls();
    const interval = setInterval(fetchQurls, 30000);
    return () => clearInterval(interval);
  }, [fetchQurls]);

  const handleCreate = useCallback(async () => {
    if (!createInput.target_url) return;
    setCreating(true);
    setError(null);
    try {
      const result = await window.qurl.qurls.create(createInput as QURLCreateInput);
      if (!result.success) {
        setError(result.error || 'Failed to create QURL');
        return;
      }
      setShowCreate(false);
      setCreateInput({ target_url: '', expires_in: '1h' });
      await fetchQurls();
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  }, [createInput, fetchQurls]);

  const handleRevoke = useCallback(async (resourceId: string) => {
    setError(null);
    try {
      const result = await window.qurl.qurls.revoke(resourceId);
      if (!result.success) {
        setError(result.error || 'Failed to revoke');
        return;
      }
      await fetchQurls();
    } catch (err) {
      setError(String(err));
    }
  }, [fetchQurls]);

  const handleMintLink = useCallback(async (resourceId: string) => {
    setMintingId(resourceId);
    setError(null);
    try {
      const result = await window.qurl.qurls.mintLink(resourceId);
      if (!result.success) {
        setError(result.error || 'Failed to mint new link');
        return;
      }
      await fetchQurls();
    } catch (err) {
      setError(String(err));
    } finally {
      setMintingId(null);
    }
  }, [fetchQurls]);

  const handleCopy = useCallback(async (qurlId: string, link: string) => {
    await navigator.clipboard.writeText(link);
    setCopiedId(qurlId);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-[22px] font-semibold">Protected Resources</h1>
          {!loading && (
            <span className="bg-accent-dim text-accent text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
              {qurls.length}
            </span>
          )}
        </div>
        <p className="text-text-secondary text-[13px]">
          Resources are the URLs, services, and files you protect with QURLs. Create a resource first, then mint time-limited QURL links for it. Each resource can have multiple independent access links with different policies.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="py-2.5 px-3.5 rounded-md bg-danger-dim border border-danger-border text-danger text-xs">
          {error}
        </div>
      )}

      {/* Header bar with create button */}
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-text-secondary uppercase tracking-wide">
          Resources
        </h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className={`py-1.5 px-4 rounded-md font-semibold text-xs transition-all ${
            showCreate
              ? 'bg-surface-3 text-text-secondary hover:bg-surface-4'
              : 'bg-gradient-to-br from-[#0099FF] to-[#D406B9] text-white hover:shadow-[0_0_20px_rgba(0,153,255,0.3)]'
          }`}
        >
          {showCreate ? 'Cancel' : '+ Create QURL'}
        </button>
      </div>

      {/* Collapsible create form */}
      {showCreate && (
        <div className="bg-surface-2 rounded-lg p-4 border border-glass-border flex flex-col gap-3 animate-in">
          {/* Target URL */}
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">
              Target URL
            </label>
            <input
              value={createInput.target_url || ''}
              onChange={(e) => setCreateInput((prev) => ({ ...prev, target_url: e.target.value }))}
              placeholder="https://example.com/resource"
              className="w-full py-2.5 px-3.5 bg-surface-1 border border-glass-border rounded-md text-text-primary text-[13px] font-mono placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-dim"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
            />
          </div>

          {/* Label */}
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">
              Label (optional)
            </label>
            <input
              value={createInput.label || ''}
              onChange={(e) => setCreateInput((prev) => ({ ...prev, label: e.target.value || undefined }))}
              placeholder="My Resource"
              className="w-full py-2 px-3 bg-surface-1 border border-glass-border rounded-md text-text-primary text-[13px] placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-dim"
            />
          </div>

          {/* Access policy */}
          <AccessPolicyForm value={createInput} onChange={setCreateInput} compact />

          {/* Submit */}
          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={creating || !createInput.target_url}
              className={`bg-gradient-to-br from-[#0099FF] to-[#D406B9] text-white py-2 px-5 rounded-md font-semibold text-[13px] transition-opacity ${
                creating || !createInput.target_url
                  ? 'opacity-50 cursor-not-allowed'
                  : 'opacity-100 cursor-pointer hover:shadow-[0_0_20px_rgba(0,153,255,0.3)]'
              }`}
            >
              {creating ? 'Creating...' : 'Create QURL'}
            </button>
          </div>
        </div>
      )}

      {/* Resource list */}
      {loading ? (
        <div className="text-center py-10 text-text-muted text-[13px]">
          Loading resources...
        </div>
      ) : qurls.length === 0 && !showCreate ? (
        <div className="text-center py-10 text-text-muted text-[13px] bg-surface-2 rounded-lg border border-glass-border">
          No resources yet. Click "+ Create QURL" or use the Share page to create your first protected resource.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {qurls.map((q) => {
            const typeInfo = getTypeIndicator(q.target_url);
            const statusStyle = getStatusStyle(q.status);
            const isCopied = copiedId === q.qurl_id;
            const isMinting = mintingId === q.resource_id;

            return (
              <div
                key={q.qurl_id}
                className="bg-surface-2 rounded-lg p-4 border border-glass-border flex flex-col gap-2.5 transition-colors hover:border-glass-border-hover"
              >
                {/* Top row: name + type badge + status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-semibold text-sm truncate">
                      {q.label || q.target_url}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-semibold shrink-0 ${typeInfo.bgClass} ${typeInfo.textClass}`}>
                      {typeInfo.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${statusStyle.textClass}`}>
                      <span className={`w-1.5 h-1.5 rounded-full inline-block ${statusStyle.dotClass}`} />
                      {q.status}
                    </span>
                  </div>
                </div>

                {/* Target URL */}
                <div className="text-xs text-text-secondary font-mono truncate">
                  {q.target_url}
                </div>

                {/* QURL link + copy */}
                <div className="flex items-center gap-2 bg-surface-1 rounded-md py-2 px-3">
                  <code className="flex-1 font-mono text-xs text-accent truncate">
                    {q.qurl_link}
                  </code>
                  <button
                    onClick={() => handleCopy(q.qurl_id, q.qurl_link)}
                    className={`py-1 px-3 rounded-md text-xs font-medium shrink-0 transition-all ${
                      isCopied
                        ? 'bg-success text-white'
                        : 'bg-surface-3 text-text-primary hover:bg-surface-4'
                    }`}
                  >
                    {isCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>

                {/* Footer: expiry + actions */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary">
                    {q.one_time_use && (
                      <span className="text-warning mr-2">
                        One-time use
                      </span>
                    )}
                    {formatTimeRemaining(q.expires_at)}
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleMintLink(q.resource_id)}
                      disabled={isMinting || q.status !== 'active'}
                      className={`bg-transparent text-accent py-1 px-2.5 rounded-md text-xs font-medium transition-colors ${
                        isMinting || q.status !== 'active'
                          ? 'opacity-50 cursor-not-allowed'
                          : 'cursor-pointer hover:bg-accent-dim'
                      }`}
                    >
                      {isMinting ? '...' : 'Mint New Link'}
                    </button>
                    {q.status === 'active' && (
                      <button
                        onClick={() => handleRevoke(q.resource_id)}
                        className="bg-transparent text-danger py-1 px-2.5 rounded-md text-xs font-medium cursor-pointer transition-colors hover:bg-danger-dim"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
