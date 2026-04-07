type Status = 'connected' | 'reconnecting' | 'disconnected';

interface StatusBadgeProps {
  status: Status;
}

const STATUS_CONFIG: Record<Status, { color: string; label: string }> = {
  connected: { color: 'var(--color-accent-green)', label: 'Connected' },
  reconnecting: { color: 'var(--color-accent-yellow)', label: 'Reconnecting' },
  disconnected: { color: 'var(--color-accent-red)', label: 'Disconnected' },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '12px',
        color: config.color,
        fontWeight: 500,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: config.color,
          boxShadow: `0 0 6px ${config.color}`,
          display: 'inline-block',
          animation: status === 'reconnecting' ? 'pulse 1.5s ease-in-out infinite' : undefined,
        }}
      />
      {config.label}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </span>
  );
}
