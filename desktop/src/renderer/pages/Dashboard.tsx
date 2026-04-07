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

  const connectionStatus = sidecarRunning ? 'connected' : 'disconnected';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: '4px' }}>Services</h1>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>
          Manage tunnels to your private services.
        </p>
      </div>

      {/* Tunnel control */}
      <div
        style={{
          background: 'var(--color-bg-secondary)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 20px',
          border: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-sm)',
              background: sidecarRunning ? 'rgba(52, 211, 153, 0.1)' : 'rgba(248, 113, 113, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            {sidecarRunning ? '\u26A1' : '\u26D4'}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>QURL Tunnel</div>
            <StatusBadge status={connectionStatus} />
          </div>
        </div>
        <button
          onClick={handleToggleSidecar}
          disabled={tunnelLoading || (!sidecarRunning && tunnels.length === 0)}
          title={!sidecarRunning && tunnels.length === 0 ? 'Add a service first' : ''}
          style={{
            background: sidecarRunning ? 'rgba(248, 113, 113, 0.12)' : 'var(--gradient-accent)',
            color: sidecarRunning ? 'var(--color-accent-red)' : '#fff',
            padding: '8px 20px',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 600,
            fontSize: 13,
            opacity: tunnelLoading || (!sidecarRunning && tunnels.length === 0) ? 0.5 : 1,
            cursor: tunnelLoading || (!sidecarRunning && tunnels.length === 0) ? 'not-allowed' : 'pointer',
          }}
        >
          {tunnelLoading ? '...' : sidecarRunning ? 'Stop' : tunnels.length === 0 ? 'Add a service first' : 'Start'}
        </button>
      </div>

      {tunnelError && (
        <div style={{
          padding: '10px 14px', borderRadius: 'var(--radius-sm)',
          background: 'rgba(248, 113, 113, 0.08)', border: '1px solid rgba(248, 113, 113, 0.2)',
          color: 'var(--color-accent-red)', fontSize: 12,
        }}>
          {tunnelError}
        </div>
      )}

      {/* Services list */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h2 style={{
            fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Configured Services ({tunnels.length})
          </h2>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            style={{
              background: showAddForm ? 'var(--color-bg-tertiary)' : 'var(--gradient-accent)',
              color: showAddForm ? 'var(--color-text-secondary)' : '#fff',
              padding: '6px 16px',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            {showAddForm ? 'Cancel' : '+ Add Service'}
          </button>
        </div>

        {/* Add service form */}
        {showAddForm && (
          <div style={{
            background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)',
            padding: '16px', border: '1px solid var(--color-border)', marginBottom: '12px',
            display: 'flex', flexDirection: 'column', gap: '10px',
          }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 2 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '4px', display: 'block' }}>
                  Target URL
                </label>
                <input
                  value={addTarget}
                  onChange={(e) => setAddTarget(e.target.value)}
                  placeholder="http://localhost:8080"
                  style={{
                    width: '100%', padding: '8px 12px', background: 'var(--color-bg-input)',
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-primary)', fontSize: 13,
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '4px', display: 'block' }}>
                  Name
                </label>
                <input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="My App"
                  style={{
                    width: '100%', padding: '8px 12px', background: 'var(--color-bg-input)',
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-primary)', fontSize: 13,
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddService(); }}
                />
              </div>
            </div>
            {addError && (
              <div style={{ fontSize: 12, color: 'var(--color-accent-red)' }}>{addError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={handleAddService}
                disabled={addLoading || !addTarget || !addName}
                style={{
                  background: 'var(--gradient-accent)', color: '#fff',
                  padding: '8px 20px', borderRadius: 'var(--radius-sm)',
                  fontWeight: 600, fontSize: 13,
                  opacity: addLoading || !addTarget || !addName ? 0.5 : 1,
                }}
              >
                {addLoading ? 'Adding...' : 'Add Service'}
              </button>
            </div>
          </div>
        )}

        {/* Service cards */}
        {tunnels.length === 0 && !showAddForm ? (
          <div style={{
            textAlign: 'center', padding: '40px 20px', color: 'var(--color-text-muted)',
            fontSize: 13, background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
          }}>
            No services configured. Click "+ Add Service" to expose a local service.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {tunnels.map((t) => (
              <div
                key={t.name}
                style={{
                  background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)',
                  padding: '14px 16px', border: '1px solid var(--color-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: sidecarRunning ? 'var(--color-accent-green)' : 'var(--color-text-muted)',
                  }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {t.target}
                      {t.subdomain && <span style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>
                        {'\u2192'} {t.subdomain}
                      </span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: '10px',
                    background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)',
                    textTransform: 'uppercase', fontWeight: 500,
                  }}>
                    {t.type}
                  </span>
                  <button
                    onClick={() => handleRemoveService(t.name)}
                    style={{
                      background: 'transparent', color: 'var(--color-text-muted)',
                      padding: '4px 8px', fontSize: 16, cursor: 'pointer',
                    }}
                    title="Remove service"
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-accent-red)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                  >
                    {'\u2715'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
