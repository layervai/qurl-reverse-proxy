import { useState, useEffect, useCallback } from 'react';

interface LinkCardProps {
  id: string;
  name: string;
  link: string;
  createdAt: number;
  expiresAt: number | null;
  onRevoke: (id: string) => void;
}

function formatTimeRemaining(expiresAt: number): string {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return 'Expired';

  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function LinkCard({ id, name, link, createdAt, expiresAt, onRevoke }: LinkCardProps) {
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);

  // Update the countdown every minute
  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [link]);

  const handleRevoke = useCallback(() => {
    onRevoke(id);
  }, [id, onRevoke]);

  return (
    <div
      style={{
        background: 'var(--color-bg-secondary)',
        borderRadius: 'var(--radius-md)',
        padding: '16px',
        border: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        transition: 'border-color var(--transition-fast)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-bg-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)';
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ fontSize: 18 }}>{'\uD83D\uDCC4'}</span>
          <span
            style={{
              fontWeight: 600,
              fontSize: 14,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </span>
        </div>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>
          {formatTimeAgo(createdAt)}
        </span>
      </div>

      {/* Link row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'var(--color-bg-input)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 12px',
        }}
      >
        <code
          style={{
            flex: 1,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--color-accent-blue)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {link}
        </code>
        <button
          onClick={handleCopy}
          style={{
            background: copied ? 'var(--color-accent-green)' : 'var(--color-bg-tertiary)',
            color: copied ? '#fff' : 'var(--color-text-primary)',
            padding: '4px 12px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            fontWeight: 500,
            transition: 'all var(--transition-fast)',
            flexShrink: 0,
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Footer row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {expiresAt ? formatTimeRemaining(expiresAt) : 'No expiry set'}
        </span>
        <button
          onClick={handleRevoke}
          style={{
            background: 'transparent',
            color: 'var(--color-accent-red)',
            padding: '4px 10px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            fontWeight: 500,
            transition: 'background var(--transition-fast)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(248, 113, 113, 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          Revoke
        </button>
      </div>
    </div>
  );
}
