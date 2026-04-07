import { useState, useCallback, useRef, type DragEvent } from 'react';

interface DropZoneProps {
  onDrop: (files: File[]) => void;
  disabled?: boolean;
}

export function DropZone({ onDrop, disabled = false }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      dragCounter.current++;
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        setIsDragging(true);
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) {
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    [disabled],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;

      if (disabled) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        onDrop(files);
      }
    },
    [onDrop, disabled],
  );

  const handleBrowse = useCallback(async () => {
    if (disabled) return;
    const paths = await window.qurl.dialog.openFile();
    if (paths && paths.length > 0) {
      // Create synthetic File objects with the path info
      const files = paths.map((p) => {
        const name = p.split('/').pop() || p.split('\\').pop() || p;
        const file = new File([], name);
        Object.defineProperty(file, 'path', { value: p });
        return file;
      });
      onDrop(files);
    }
  }, [onDrop, disabled]);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleBrowse}
      style={{
        border: `2px dashed ${isDragging ? 'var(--color-accent-blue)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: '48px 32px',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all var(--transition-normal)',
        background: isDragging
          ? 'rgba(79, 172, 254, 0.06)'
          : 'var(--color-bg-secondary)',
        opacity: disabled ? 0.5 : 1,
        minHeight: 200,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
      }}
    >
      <div style={{ fontSize: 48, lineHeight: 1, opacity: 0.6 }}>
        {isDragging ? '\u2193' : '\u2B06'}
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: isDragging ? 'var(--color-accent-blue)' : 'var(--color-text-primary)',
        }}
      >
        {isDragging ? 'Release to share' : 'Drop files here'}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
        or click to browse files and folders
      </div>
    </div>
  );
}
