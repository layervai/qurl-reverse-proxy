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
      className={`
        border-2 border-dashed rounded-xl px-8 py-12 text-center
        transition-all duration-300 min-h-[200px]
        flex flex-col items-center justify-center gap-3
        ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
        ${isDragging
          ? 'border-accent bg-accent-dim'
          : 'border-glass-border bg-surface-2 hover:border-glass-border-hover hover:bg-surface-hover'
        }
      `}
    >
      <div className={`text-5xl leading-none ${isDragging ? 'opacity-90' : 'opacity-60'}`}>
        {isDragging ? '\u2193' : '\u2B06'}
      </div>
      <div
        className={`
          text-base font-medium transition-colors duration-200
          ${isDragging ? 'text-accent' : 'text-text-primary'}
        `}
      >
        {isDragging ? 'Release to share' : 'Drop files here'}
      </div>
      <div className="text-[13px] text-text-secondary">
        or click to browse files and folders
      </div>
    </div>
  );
}
