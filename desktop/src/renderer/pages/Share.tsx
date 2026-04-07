import { useState, useCallback } from 'react';
import { DropZone } from '../components/DropZone';
import { LinkCard } from '../components/LinkCard';

interface RecentShare {
  id: string;
  name: string;
  link: string;
  createdAt: number;
  expiresAt: number | null;
}

export function Share() {
  const [shares, setShares] = useState<RecentShare[]>([]);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDrop = useCallback(async (files: File[]) => {
    setIsSharing(true);
    setError(null);

    try {
      for (const file of files) {
        // Electron augments File objects with a `path` property
        const filePath = (file as File & { path?: string }).path;
        if (!filePath) {
          setError('Could not determine file path');
          continue;
        }

        const result = await window.qurl.share.file(filePath, file.name);
        if (!result.success) {
          setError(result.error || 'Failed to share file');
          continue;
        }

        if (result.share) {
          setShares((prev) => [
            {
              id: result.share!.id,
              name: result.share!.name,
              link: result.share!.qurlLink,
              createdAt: result.share!.createdAt,
              expiresAt: result.share!.expiresAt,
            },
            ...prev,
          ]);
        }
      }
    } finally {
      setIsSharing(false);
    }
  }, []);

  const handleRevoke = useCallback(async (id: string) => {
    await window.qurl.share.stop(id);
    setShares((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: '4px' }}>Share Files</h1>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>
          Drop files to create a secure, time-limited QURL link.
        </p>
      </div>

      <DropZone onDrop={handleDrop} disabled={isSharing} />

      {isSharing && (
        <div
          style={{
            textAlign: 'center',
            padding: '16px',
            color: 'var(--color-text-secondary)',
            fontSize: 13,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          >
            Creating secure link...
          </span>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(248, 113, 113, 0.08)',
            border: '1px solid rgba(248, 113, 113, 0.2)',
            color: 'var(--color-accent-red)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {shares.length > 0 && (
        <div>
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '12px',
            }}
          >
            Recent Shares
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {shares.map((share) => (
              <LinkCard
                key={share.id}
                id={share.id}
                name={share.name}
                link={share.link}
                createdAt={share.createdAt}
                expiresAt={share.expiresAt}
                onRevoke={handleRevoke}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
