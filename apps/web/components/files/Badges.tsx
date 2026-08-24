import { IconGlobe, IconLock, IconWarn } from '@/components/ui/icons';
import type { StoredFile } from '@/lib/types';

/**
 * The three things about a file that are worth interrupting a scan for: it is
 * reachable from outside the account, it has more than one link, or its bytes
 * disagreed with its name when it arrived.
 */
export function Badges({ file, shareLocked }: { file: StoredFile; shareLocked?: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {file.visibility === 'public' ? (
        <span
          title={`Public — anyone with the link can download this${file.shareCount > 1 ? ` (${file.shareCount} links)` : ''}`}
          className="flex items-center gap-0.5"
          style={{ color: 'var(--accent)' }}
        >
          <IconGlobe size={12} />
          {file.shareCount > 1 ? <span className="meta" style={{ color: 'var(--accent)' }}>{file.shareCount}</span> : null}
        </span>
      ) : null}
      {shareLocked ? (
        <span title="Protected by a password" style={{ color: 'var(--color-clay)' }}>
          <IconLock size={12} />
        </span>
      ) : null}
      {file.mimeMismatch ? (
        <span
          title={`Contents look like ${file.mimeType}, not what the extension claims. Always served as a download.`}
          style={{ color: 'var(--color-clay)' }}
        >
          <IconWarn size={12} />
        </span>
      ) : null}
    </span>
  );
}
