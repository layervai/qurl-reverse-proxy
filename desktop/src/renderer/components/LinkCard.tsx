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
    <div className="bg-surface-2 rounded-xl p-4 border border-glass-border flex flex-col gap-2.5 transition-colors hover:border-glass-border-hover">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 text-text-tertiary shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
          </svg>
          <span className="font-semibold text-sm truncate">{name}</span>
        </div>
        <span className="text-xs text-text-muted shrink-0">{formatTimeAgo(createdAt)}</span>
      </div>

      {/* Link */}
      <div className="flex items-center gap-2 bg-surface-1 rounded-lg px-3 py-2">
        <code className="flex-1 font-mono text-xs text-accent truncate">{link}</code>
        <button
          onClick={handleCopy}
          className={`px-3 py-1 rounded-lg text-xs font-medium shrink-0 transition-all duration-150 ${
            copied
              ? 'bg-success text-white'
              : 'bg-surface-3 text-text-primary hover:bg-surface-4'
          }`}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">
          {expiresAt ? formatTimeRemaining(expiresAt) : 'No expiry set'}
        </span>
        <button
          onClick={handleRevoke}
          className="bg-transparent text-danger px-2.5 py-1 rounded-md text-xs font-medium transition-colors hover:bg-danger-dim"
        >
          Revoke
        </button>
      </div>
    </div>
  );
}
