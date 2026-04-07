type Status = 'connected' | 'reconnecting' | 'disconnected';

interface StatusBadgeProps {
  status: Status;
}

const STATUS_CONFIG: Record<Status, { dotClass: string; textClass: string; label: string; animate?: boolean }> = {
  connected: { dotClass: 'bg-success shadow-[0_0_6px_var(--color-success)]', textClass: 'text-success', label: 'Connected' },
  reconnecting: { dotClass: 'bg-warning shadow-[0_0_6px_var(--color-warning)] animate-pulse', textClass: 'text-warning', label: 'Reconnecting', animate: true },
  disconnected: { dotClass: 'bg-danger shadow-[0_0_6px_var(--color-danger)]', textClass: 'text-danger', label: 'Disconnected' },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${config.textClass}`}>
      <span className={`w-2 h-2 rounded-full inline-block ${config.dotClass}`} />
      {config.label}
    </span>
  );
}
