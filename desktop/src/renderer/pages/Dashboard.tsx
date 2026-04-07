import { useState, useEffect, useCallback } from 'react';
import { StatusBadge } from '../components/StatusBadge';

export function Dashboard() {
  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [tunnels, setTunnels] = useState<TunnelService[]>([]);
  const [tunnelError, setTunnelError] = useState<string | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState(false);

  // Add service form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addTarget, setAddTarget] = useState('http://localhost:');
  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  // Share state per service
  const [sharingService, setSharingService] = useState<string | null>(null);
  const [sharedLinks, setSharedLinks] = useState<Record<string, string>>({});
  const [copiedService, setCopiedService] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await window.qurl.sidecar.status();
      setSidecarRunning(status.running);
    } catch {
      setSidecarRunning(false);
    }
  }, []);

  const refreshTunnels = useCallback(async () => {
    try {
      const list = await window.qurl.tunnels.list();
      setTunnels(list);
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    refreshTunnels();
    const interval = setInterval(() => {
      refreshStatus();
      refreshTunnels();
    }, 5000);
    return () => clearInterval(interval);
  }, [refreshStatus, refreshTunnels]);

  const handleToggleSidecar = useCallback(async () => {
    setTunnelError(null);
    setTunnelLoading(true);
    try {
      if (sidecarRunning) {
        const result = await window.qurl.sidecar.stop();
        if (!result.success) setTunnelError(result.error || 'Failed to stop');
      } else {
        const result = await window.qurl.sidecar.start();
        if (!result.success) setTunnelError(result.error || 'Failed to start');
      }
    } catch (err) {
      setTunnelError(String(err));
    } finally {
      setTunnelLoading(false);
      await refreshStatus();
    }
  }, [sidecarRunning, refreshStatus]);

  const handleAddService = useCallback(async () => {
    if (!addTarget || !addName) return;
    setAddError(null);
    setAddLoading(true);
    try {
      const result = await window.qurl.tunnels.add(addTarget, addName);
      if (!result.success) {
        setAddError(result.error || 'Failed to add service');
      } else {
        setAddTarget('http://localhost:');
        setAddName('');
        setShowAddForm(false);
        await refreshTunnels();
      }
    } catch (err) {
      setAddError(String(err));
    } finally {
      setAddLoading(false);
    }
  }, [addTarget, addName, refreshTunnels]);

  const handleRemoveService = useCallback(async (name: string) => {
    try {
      await window.qurl.tunnels.remove(name);
      await refreshTunnels();
    } catch {
      // Ignore
    }
  }, [refreshTunnels]);

  const handleShareService = useCallback(async (name: string) => {
    setSharingService(name);
    setTunnelError(null);
    try {
      const result = await window.qurl.share.service(name);
      if (!result.success) {
        setTunnelError(result.error || 'Failed to share service');
        return;
      }
      if (result.qurl) {
        setSharedLinks((prev) => ({ ...prev, [name]: result.qurl!.qurl_link }));
      }
    } catch (err) {
      setTunnelError(String(err));
    } finally {
      setSharingService(null);
    }
  }, []);

  const handleCopyServiceLink = useCallback(async (name: string, link: string) => {
    await navigator.clipboard.writeText(link);
    setCopiedService(name);
    setTimeout(() => setCopiedService(null), 2000);
  }, []);

  const connectionStatus = sidecarRunning ? 'connected' : 'disconnected';
  const toggleDisabled = tunnelLoading || (!sidecarRunning && tunnels.length === 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Page header */}
      <div>
        <h1 className="text-[22px] font-semibold mb-1">Connections</h1>
        <p className="text-text-secondary text-[13px]">
          Manage tunnels to your private services.
        </p>
      </div>

      {/* Tunnel status card */}
      <div
        className={`
          bg-surface-2 rounded-lg px-5 py-4 border flex items-center justify-between
          transition-all duration-300
          ${sidecarRunning
            ? 'border-success/20 shadow-[0_0_24px_rgba(16,185,129,0.08)]'
            : 'border-glass-border'
          }
        `}
      >
        <div className="flex items-center gap-3">
          <div
            className={`
              w-9 h-9 rounded-md flex items-center justify-center text-lg
              ${sidecarRunning ? 'bg-success-dim' : 'bg-danger-dim'}
            `}
          >
            {sidecarRunning ? '\u26A1' : '\u26D4'}
          </div>
          <div>
            <div className="font-semibold text-sm">QURL Tunnel</div>
            <StatusBadge status={connectionStatus} />
          </div>
        </div>
        <button
          onClick={handleToggleSidecar}
          disabled={toggleDisabled}
          title={!sidecarRunning && tunnels.length === 0 ? 'Add a service first' : ''}
          className={`
            px-5 py-2 rounded-md font-semibold text-[13px] transition-all duration-150
            ${toggleDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            ${sidecarRunning
              ? 'bg-danger-dim text-danger hover:bg-[rgba(239,68,68,0.25)]'
              : 'bg-gradient-to-br from-accent to-[#D406B9] text-white hover:brightness-110'
            }
          `}
        >
          {tunnelLoading ? '...' : sidecarRunning ? 'Stop' : tunnels.length === 0 ? 'Add a service first' : 'Start'}
        </button>
      </div>

      {/* Error message */}
      {tunnelError && (
        <div className="px-3.5 py-2.5 rounded-md bg-danger-dim border border-danger-border text-danger text-xs">
          {tunnelError}
        </div>
      )}

      {/* Services list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-semibold text-text-secondary uppercase tracking-wide">
            Configured Services ({tunnels.length})
          </h2>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className={`
              px-4 py-1.5 rounded-md font-semibold text-xs transition-all duration-150
              ${showAddForm
                ? 'bg-surface-3 text-text-secondary hover:bg-surface-4'
                : 'bg-gradient-to-br from-accent to-[#D406B9] text-white hover:brightness-110'
              }
            `}
          >
            {showAddForm ? 'Cancel' : '+ Add Service'}
          </button>
        </div>

        {/* Add service form */}
        {showAddForm && (
          <div className="bg-surface-2 rounded-lg p-4 border border-glass-border mb-3 flex flex-col gap-2.5">
            <div className="flex gap-2.5">
              <div className="flex-[2]">
                <label className="text-xs font-medium text-text-secondary mb-1 block">
                  Target URL
                </label>
                <input
                  value={addTarget}
                  onChange={(e) => setAddTarget(e.target.value)}
                  placeholder="http://localhost:8080"
                  className="w-full font-mono"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-text-secondary mb-1 block">
                  Name
                </label>
                <input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="My App"
                  className="w-full"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddService(); }}
                />
              </div>
            </div>
            {addError && (
              <div className="text-xs text-danger">{addError}</div>
            )}
            <div className="flex justify-end">
              <button
                onClick={handleAddService}
                disabled={addLoading || !addTarget || !addName}
                className={`
                  bg-gradient-to-br from-accent to-[#D406B9] text-white
                  px-5 py-2 rounded-md font-semibold text-[13px] transition-opacity duration-150
                  ${addLoading || !addTarget || !addName ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-110'}
                `}
              >
                {addLoading ? 'Adding...' : 'Add Service'}
              </button>
            </div>
          </div>
        )}

        {/* Service cards */}
        {tunnels.length === 0 && !showAddForm ? (
          <div className="text-center py-10 px-5 text-text-muted text-[13px] bg-surface-2 rounded-lg border border-glass-border">
            No services configured. Click &quot;+ Add Service&quot; to expose a local service.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {tunnels.map((t) => {
              const serviceLink = sharedLinks[t.name];
              const isSharing = sharingService === t.name;
              const isCopied = copiedService === t.name;

              return (
                <div
                  key={t.name}
                  className="bg-surface-2 rounded-lg px-4 py-3.5 border border-glass-border flex flex-col gap-2.5 hover:border-glass-border-hover transition-colors duration-150"
                >
                  {/* Top row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          sidecarRunning
                            ? 'bg-success shadow-[0_0_6px_var(--color-success)]'
                            : 'bg-text-muted'
                        }`}
                      />
                      <div>
                        <div className="font-semibold text-sm">{t.name}</div>
                        <div className="text-xs text-text-secondary font-mono">
                          {t.target}
                          {t.subdomain && (
                            <span className="text-text-muted ml-2">
                              {'\u2192'} {t.subdomain}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-3 text-text-muted uppercase font-medium">
                        {t.type}
                      </span>
                      <button
                        onClick={() => handleShareService(t.name)}
                        disabled={isSharing || !sidecarRunning}
                        title={!sidecarRunning ? 'Start the tunnel first' : 'Create a shareable QURL link'}
                        className={`
                          bg-accent-dim text-accent px-3 py-1 rounded-md text-xs font-semibold
                          transition-all duration-150
                          ${isSharing || !sidecarRunning
                            ? 'opacity-50 cursor-not-allowed'
                            : 'cursor-pointer hover:bg-[rgba(0,153,255,0.25)]'
                          }
                        `}
                      >
                        {isSharing ? '...' : 'Share'}
                      </button>
                      <button
                        onClick={() => handleRemoveService(t.name)}
                        className="bg-transparent text-text-muted px-2 py-1 text-base cursor-pointer hover:text-danger transition-colors duration-150"
                        title="Remove service"
                      >
                        {'\u2715'}
                      </button>
                    </div>
                  </div>

                  {/* Resource ID and public URL (if available) */}
                  {(t.resourceId || t.publicUrl) && (
                    <div className="flex gap-4 text-[11px] text-text-muted">
                      {t.resourceId && (
                        <span>
                          Resource: <span className="font-mono text-text-secondary">{t.resourceId}</span>
                        </span>
                      )}
                      {t.publicUrl && (
                        <span>
                          Public: <span className="font-mono text-accent">{t.publicUrl}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Shared QURL link */}
                  {serviceLink && (
                    <div className="flex items-center gap-2 bg-surface-1 rounded-md px-3 py-2">
                      <code className="flex-1 font-mono text-xs text-accent overflow-hidden text-ellipsis whitespace-nowrap">
                        {serviceLink}
                      </code>
                      <button
                        onClick={() => handleCopyServiceLink(t.name, serviceLink)}
                        className={`
                          px-3 py-1 rounded-md text-xs font-medium shrink-0 transition-all duration-150
                          ${isCopied
                            ? 'bg-success text-white'
                            : 'bg-surface-3 text-text-primary hover:bg-surface-4'
                          }
                        `}
                      >
                        {isCopied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
