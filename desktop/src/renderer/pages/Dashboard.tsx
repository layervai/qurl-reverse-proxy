import { useState, useEffect, useCallback, useRef } from 'react';
import { StatusBadge } from '../components/StatusBadge';

function ConfirmRemoveModal({
  serviceName,
  onConfirm,
  onCancel,
}: {
  serviceName: string;
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
        <h3 className="text-[15px] font-semibold mb-2">Remove Service</h3>
        <p className="text-[13px] text-text-secondary mb-5 leading-relaxed">
          Remove <strong>{serviceName}</strong>? Any local files or services being shared through QURLs for this service will no longer be accessible.
        </p>
        <div className="flex justify-end gap-2.5">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-surface-3 text-text-secondary hover:bg-surface-4 cursor-pointer transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all duration-150 bg-danger text-white hover:bg-[#dc2626]"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [tunnels, setTunnels] = useState<TunnelService[]>([]);
  const [tunnelError, setTunnelError] = useState<string | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [sidecarLogs, setSidecarLogs] = useState<string[]>([]);

  // Debounced status tracking
  const stableStatusRef = useRef<boolean | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Add service form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addTarget, setAddTarget] = useState('http://localhost:');
  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);


  const refreshTunnels = useCallback(async () => {
    try {
      const list = await window.qurl.tunnels.list();
      setTunnels(list);
    } catch {
      // Ignore
    }
  }, []);

  // Debounced sidecar status polling
  useEffect(() => {
    // Immediate first check (no debounce)
    window.qurl.sidecar.status().then((status) => {
      stableStatusRef.current = status.running;
      setSidecarRunning(status.running);
    }).catch(() => {
      stableStatusRef.current = false;
      setSidecarRunning(false);
    });

    refreshTunnels();

    const interval = setInterval(async () => {
      refreshTunnels();
      try {
        const status = await window.qurl.sidecar.status();
        const newStatus = status.running;
        if (newStatus !== stableStatusRef.current) {
          // Detect unexpected disconnect — fetch logs
          if (stableStatusRef.current === true && !newStatus) {
            window.qurl.sidecar.logs().then((result) => {
              if (result.success && result.logs) {
                setSidecarLogs(result.logs.slice(-10));
              }
            }).catch(() => {});
          } else {
            // Tunnel came up — clear old logs
            setSidecarLogs([]);
          }
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = setTimeout(() => {
            stableStatusRef.current = newStatus;
            setSidecarRunning(newStatus);
          }, 2000);
        }
      } catch {
        if (stableStatusRef.current === true) {
          window.qurl.sidecar.logs().then((result) => {
            if (result.success && result.logs) {
              setSidecarLogs(result.logs.slice(-10));
            }
          }).catch(() => {});
        }
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          stableStatusRef.current = false;
          setSidecarRunning(false);
        }, 2000);
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [refreshTunnels]);

  const handleToggleSidecar = useCallback(async () => {
    setTunnelError(null);
    setTunnelLoading(true);
    setSidecarLogs([]);
    try {
      if (sidecarRunning) {
        const result = await window.qurl.sidecar.stop();
        if (!result.success) setTunnelError(result.error || 'Failed to stop');
      } else {
        const result = await window.qurl.sidecar.start();
        if (!result.success) {
          setTunnelError(result.error || 'Failed to start');
          // Fetch logs on start failure
          const logsResult = await window.qurl.sidecar.logs();
          if (logsResult.success && logsResult.logs) {
            setSidecarLogs(logsResult.logs.slice(-10));
          }
        }
      }
    } catch (err) {
      setTunnelError(String(err));
    } finally {
      setTunnelLoading(false);
      // Immediate status update after user action (no debounce)
      try {
        const status = await window.qurl.sidecar.status();
        stableStatusRef.current = status.running;
        setSidecarRunning(status.running);
      } catch {
        stableStatusRef.current = false;
        setSidecarRunning(false);
      }
    }
  }, [sidecarRunning]);

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

  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const handleRemoveService = useCallback(async (name: string) => {
    try {
      await window.qurl.tunnels.remove(name);
      await refreshTunnels();
    } catch {
      // Ignore
    } finally {
      setPendingRemove(null);
    }
  }, [refreshTunnels]);

  const [togglingService, setTogglingService] = useState<string | null>(null);

  const handleToggleService = useCallback(async (name: string, enabled: boolean) => {
    setTogglingService(name);
    setTunnelError(null);
    try {
      const result = await window.qurl.tunnels.toggle(name, enabled);
      if (!result.success) {
        setTunnelError(result.error || 'Failed to toggle service');
      }
      await refreshTunnels();
    } catch (err) {
      setTunnelError(String(err));
    } finally {
      setTogglingService(null);
    }
  }, [refreshTunnels]);

  const connectionStatus = sidecarRunning ? 'connected' : 'disconnected';
  const toggleDisabled = tunnelLoading;

  return (
    <div className="flex flex-col gap-5">
      {/* Remove confirmation modal */}
      {pendingRemove && (
        <ConfirmRemoveModal
          serviceName={pendingRemove}
          onConfirm={() => handleRemoveService(pendingRemove)}
          onCancel={() => setPendingRemove(null)}
        />
      )}

      {/* Page header */}
      <div style={{ animation: 'fadeIn 400ms cubic-bezier(0.16, 1, 0.3, 1) both' }}>
        <h1 className="text-xl font-semibold tracking-tight mb-1">Connections</h1>
        <p className="text-text-secondary text-[13px]">
          Manage tunnels to expose your private services through QURL.
        </p>
      </div>

      {/* Tunnel status card */}
      <div
        style={{ animation: 'fadeIn 400ms cubic-bezier(0.16, 1, 0.3, 1) 60ms both' }}
        className={`
          bg-surface-2 rounded-xl px-5 py-4 border flex items-center justify-between
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
              w-9 h-9 rounded-lg flex items-center justify-center text-lg
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
          title=""
          className={`
            px-5 py-2 rounded-lg font-semibold text-[13px] transition-all duration-150
            ${toggleDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            ${sidecarRunning
              ? 'bg-danger-dim text-danger hover:bg-[rgba(239,68,68,0.25)]'
              : 'bg-gradient-to-r from-accent to-[#D406B9] text-white hover:shadow-[0_0_20px_rgba(0,153,255,0.25)]'
            }
          `}
        >
          {tunnelLoading ? '...' : sidecarRunning ? 'Stop' : 'Start'}
        </button>
      </div>

      {/* Error message */}
      {tunnelError && (
        <div className="py-3 px-4 rounded-xl bg-danger-dim border border-danger-border text-danger text-[13px] flex items-center gap-2.5 animate-in">
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          <span className="flex-1">{tunnelError}</span>
          <button
            onClick={() => setTunnelError(null)}
            className="text-danger/60 hover:text-danger bg-transparent cursor-pointer text-sm shrink-0"
          >
            {'\u2715'}
          </button>
        </div>
      )}

      {/* Tunnel logs (shown on unexpected disconnect or start failure) */}
      {sidecarLogs.length > 0 && (
        <div className="px-3.5 py-2.5 rounded-xl bg-surface-2 border border-glass-border">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted">Tunnel Logs</span>
            <button
              onClick={() => setSidecarLogs([])}
              className="text-text-muted hover:text-text-secondary bg-transparent cursor-pointer text-xs"
            >
              {'\u2715'}
            </button>
          </div>
          <pre className="text-[11px] text-text-secondary font-mono whitespace-pre-wrap max-h-[120px] overflow-auto leading-relaxed">
            {sidecarLogs.join('\n')}
          </pre>
        </div>
      )}

      {/* Services list */}
      <div style={{ animation: 'fadeIn 400ms cubic-bezier(0.16, 1, 0.3, 1) 120ms both' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-secondary">
            Services ({tunnels.length})
          </h2>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className={`
              px-4 py-1.5 rounded-lg font-semibold text-xs transition-all duration-150 cursor-pointer
              ${showAddForm
                ? 'bg-surface-3 text-text-secondary hover:bg-surface-4'
                : 'bg-gradient-to-r from-accent to-[#D406B9] text-white hover:shadow-[0_0_20px_rgba(0,153,255,0.25)]'
              }
            `}
          >
            {showAddForm ? 'Cancel' : '+ Add Service'}
          </button>
        </div>

        {/* Add service form */}
        {showAddForm && (
          <div className="bg-surface-2 rounded-xl p-4 border border-glass-border mb-3 flex flex-col gap-2.5 animate-in">
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
                <span className="text-[10px] text-text-muted mt-1 block">The local address of your running service</span>
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
                  bg-gradient-to-r from-accent to-[#D406B9] text-white
                  px-5 py-2 rounded-lg font-semibold text-[13px] transition-all duration-150
                  ${addLoading || !addTarget || !addName ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:shadow-[0_0_20px_rgba(0,153,255,0.25)]'}
                `}
              >
                {addLoading ? 'Adding...' : 'Add Service'}
              </button>
            </div>
          </div>
        )}

        {/* Service cards */}
        {tunnels.length === 0 && !showAddForm ? (
          <div className="text-center py-12 px-5 bg-surface-2 rounded-xl border border-glass-border">
            <svg className="w-10 h-10 text-text-muted mx-auto mb-3 opacity-40" viewBox="0 0 24 24" fill="currentColor">
              <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
            </svg>
            <p className="text-text-secondary text-[13px] font-medium mb-1">No services configured</p>
            <p className="text-text-muted text-[12px] max-w-[320px] mx-auto">
              Add a service manually, or share a local URL or file from the Home page — services are created automatically.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {tunnels.map((t, idx) => {
              const isToggling = togglingService === t.name;
              const isBuiltIn = t.name === 'qurl-files';
              const displayName = isBuiltIn ? 'File Sharing' : t.name;
              const isActive = t.enabled && sidecarRunning;

              return (
                <div
                  key={t.name}
                  className={`
                    relative rounded-xl overflow-hidden transition-all duration-300
                    ${t.enabled
                      ? 'bg-surface-2 border border-glass-border hover:border-glass-border-hover'
                      : 'bg-surface-2/50 border border-glass-border'
                    }
                  `}
                  style={{ animation: `fadeIn 350ms cubic-bezier(0.16, 1, 0.3, 1) ${idx * 60}ms both` }}
                >
                  {/* Left accent bar */}
                  <div
                    className={`absolute left-0 top-0 bottom-0 w-[3px] transition-colors duration-300 ${
                      isActive ? 'bg-success' : t.enabled ? 'bg-text-muted' : 'bg-transparent'
                    }`}
                  />

                  <div className="pl-5 pr-4 py-4">
                    {/* Main row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Service icon */}
                        <div className={`
                          w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-200
                          ${isBuiltIn
                            ? (t.enabled ? 'bg-accent-dim' : 'bg-surface-3')
                            : (t.enabled ? 'bg-success-dim' : 'bg-surface-3')
                          }
                        `}>
                          {isBuiltIn ? (
                            <svg className={`w-[18px] h-[18px] ${t.enabled ? 'text-accent' : 'text-text-muted'}`} viewBox="0 0 24 24" fill="currentColor">
                              <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                            </svg>
                          ) : (
                            <svg className={`w-[18px] h-[18px] ${t.enabled ? 'text-success' : 'text-text-muted'}`} viewBox="0 0 24 24" fill="currentColor">
                              <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
                            </svg>
                          )}
                        </div>

                        {/* Service info */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`font-semibold text-[14px] ${t.enabled ? 'text-text-primary' : 'text-text-muted'}`}>
                              {displayName}
                            </span>
                            {isBuiltIn && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-accent-dim text-accent font-semibold uppercase tracking-wider">
                                Built-in
                              </span>
                            )}
                          </div>
                          <div className={`text-[12px] font-mono mt-0.5 ${t.enabled ? 'text-text-secondary' : 'text-text-muted'}`}>
                            {isBuiltIn ? (
                              <span className="font-sans">Local files served securely through QURL tunnel</span>
                            ) : (
                              <>
                                {t.target}
                                {t.subdomain && (
                                  <span className="text-text-muted ml-1.5 font-sans">
                                    {'\u2192'} <span className="font-mono">{t.subdomain}</span>
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Controls */}
                      <div className="flex items-center gap-3 shrink-0">
                        {/* Remove (user services only) */}
                        {!isBuiltIn && (
                          <button
                            onClick={() => setPendingRemove(t.name)}
                            className="text-text-muted hover:text-danger bg-transparent cursor-pointer transition-colors duration-150 p-1 rounded-md hover:bg-danger-dim"
                            title="Remove service"
                          >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                            </svg>
                          </button>
                        )}

                        {/* Toggle */}
                        <button
                          onClick={() => !isBuiltIn && handleToggleService(t.name, !t.enabled)}
                          disabled={isToggling || isBuiltIn}
                          title={isBuiltIn ? 'Always on — required for file sharing' : t.enabled ? 'Disable' : 'Enable'}
                          className={`
                            relative w-10 h-[22px] rounded-full shrink-0 transition-colors duration-200
                            ${isBuiltIn ? 'cursor-default' : 'cursor-pointer'}
                            ${t.enabled ? 'bg-success' : 'bg-surface-4'}
                          `}
                        >
                          <span
                            className={`
                              absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-[left] duration-200
                              ${t.enabled ? 'left-[21px]' : 'left-[3px]'}
                            `}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Metadata row */}
                    {t.enabled && (
                      <div className="flex items-center gap-4 text-[11px] text-text-muted mt-2.5 pl-[52px]">
                        {isBuiltIn && (
                          <button
                            onClick={() => {
                              window.qurl.dialog.openExternal(`http://127.0.0.1:${t.localPort}`);
                            }}
                            className="text-accent hover:underline cursor-pointer bg-transparent font-sans text-[11px]"
                          >
                            Browse shared files
                          </button>
                        )}
                        {!isBuiltIn && t.publicUrl && (
                          <button
                            onClick={() => window.qurl.dialog.openExternal(t.publicUrl!)}
                            className="font-mono text-accent hover:underline cursor-pointer bg-transparent text-[11px] truncate"
                          >
                            {t.publicUrl}
                          </button>
                        )}
                        {t.resourceId && (
                          <span className="shrink-0">
                            ID: <span className="font-mono text-text-secondary">{t.resourceId}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
