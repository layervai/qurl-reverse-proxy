import React, { useState, useEffect, useCallback } from 'react';
import { StatusBadge } from '../components/StatusBadge';
import { LinkCard } from '../components/LinkCard';

interface ActiveShareItem {
  id: string;
  name: string;
  filePath: string;
  port: number;
  url: string;
  createdAt: number;
  expiresAt: number | null;
}

export function Dashboard() {
  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [shares, setShares] = useState<ActiveShareItem[]>([]);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await window.qurl.sidecar.status();
      setSidecarRunning(status.running);
    } catch {
      setSidecarRunning(false);
    }
  }, []);

  const refreshShares = useCallback(async () => {
    try {
      const list = await window.qurl.share.list();
      setShares(list);
    } catch {
      // Ignore errors on refresh
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    refreshShares();
    const interval = setInterval(() => {
      refreshStatus();
      refreshShares();
    }, 5000);
    return () => clearInterval(interval);
  }, [refreshStatus, refreshShares]);

  const handleToggleSidecar = useCallback(async () => {
    if (sidecarRunning) {
      await window.qurl.sidecar.stop();
    } else {
      await window.qurl.sidecar.start();
    }
    await refreshStatus();
  }, [sidecarRunning, refreshStatus]);

  const handleRevoke = useCallback(
    async (id: string) => {
      await window.qurl.share.stop(id);
      await refreshShares();
    },
    [refreshShares],
  );

  const connectionStatus = sidecarRunning ? 'connected' : 'disconnected';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: '4px' }}>Dashboard</h1>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>
          Monitor active shares and tunnel status.
        </p>
      </div>

      {/* Tunnel status card */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 'var(--radius-sm)',
              background: sidecarRunning
                ? 'rgba(52, 211, 153, 0.1)'
                : 'rgba(248, 113, 113, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
            }}
          >
            {sidecarRunning ? '\u26A1' : '\u26D4'}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: '2px' }}>
              NHP-FRP Tunnel
            </div>
            <StatusBadge status={connectionStatus} />
          </div>
        </div>
        <button
          onClick={handleToggleSidecar}
          style={{
            background: sidecarRunning ? 'rgba(248, 113, 113, 0.12)' : 'var(--gradient-accent)',
            color: sidecarRunning ? 'var(--color-accent-red)' : '#fff',
            padding: '8px 20px',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 600,
            fontSize: 13,
            transition: 'opacity var(--transition-fast)',
          }}
        >
          {sidecarRunning ? 'Stop Tunnel' : 'Start Tunnel'}
        </button>
      </div>

      {/* Active shares */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '12px',
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Active Shares
          </h2>
          <span
            style={{
              fontSize: 12,
              color: 'var(--color-text-muted)',
              background: 'var(--color-bg-tertiary)',
              padding: '2px 8px',
              borderRadius: '10px',
            }}
          >
            {shares.length}
          </span>
        </div>

        {shares.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '40px 20px',
              color: 'var(--color-text-muted)',
              fontSize: 13,
              background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
            }}
          >
            No active shares. Go to Share to create one.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {shares.map((share) => (
              <LinkCard
                key={share.id}
                id={share.id}
                name={share.name}
                link={`https://q.layerv.ai/${share.id.slice(0, 8)}`}
                createdAt={share.createdAt}
                expiresAt={share.expiresAt}
                onRevoke={handleRevoke}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
