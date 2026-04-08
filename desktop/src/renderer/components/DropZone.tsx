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
        border-2 border-dashed rounded-xl px-6 py-8 text-center
        transition-all duration-300 min-h-[130px]
        flex flex-col items-center justify-center gap-2
        ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
        ${isDragging
          ? 'border-accent bg-accent-dim scale-[1.005]'
          : 'border-glass-border bg-surface-2 hover:border-glass-border-hover hover:bg-surface-hover'
        }
      `}
    >
      <div className="flex items-center gap-3">
        <svg
          className={`w-8 h-8 transition-colors duration-200 ${isDragging ? 'text-accent' : 'text-text-muted'}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {isDragging ? (
            <>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </>
          ) : (
            <>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </>
          )}
        </svg>
        <div className="text-left">
          <div
            className={`text-sm font-semibold transition-colors duration-200 ${isDragging ? 'text-accent' : 'text-text-primary'}`}
          >
            {isDragging ? 'Release to share' : 'Drop files here'}
          </div>
          <div className="text-[12px] text-text-muted">
            or click to browse
          </div>
        </div>
      </div>
    </div>
  );
}
