import { useState } from 'react';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveAssetUrl } from '@/lib/contentLinks';

interface FileThumbProps {
  url: string;
  filename: string;
  mimeType: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClass: Record<NonNullable<FileThumbProps['size']>, string> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-16 w-16',
};

/**
 * Shared file thumbnail with a meaningful image-error fallback.
 * Images that fail to load (e.g. stale /uploads URLs) render a labelled
 * document icon instead of a broken-image glyph.
 */
export function FileThumb({ url, filename, mimeType, size = 'md', className }: FileThumbProps): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const isImage = mimeType.startsWith('image/');

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100',
        sizeClass[size],
        className,
      )}
      title={filename}
      aria-label={isImage && !failed ? `Image: ${filename}` : `File: ${filename}`}
    >
      {isImage && !failed ? (
        <img
          src={resolveAssetUrl(url)}
          alt={filename}
          title={filename}
          className={cn('rounded object-cover', sizeClass[size])}
          onError={() => setFailed(true)}
          loading="lazy"
        />
      ) : (
        <span className="flex flex-col items-center px-1 text-center">
          <FileText className="h-5 w-5 text-slate-500" aria-hidden="true" />
          {size === 'lg' && (
            <span className="mt-1 max-w-full truncate text-[10px] text-slate-500">{filename}</span>
          )}
        </span>
      )}
    </div>
  );
}
