'use client';

import { useParams, usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from './api';
import { useDebounced, useStoredState } from './hooks';
import { useToast } from './toast';
import { UploadManager, type ServerSession, type Transfer } from './upload-manager';
import type { FileListResponse, Folder, ShareLink, StorageStats, StoredFile } from './types';

/**
 * One store for the whole drive.
 *
 * A file manager is a single coherent view — the sidebar counts, the table, the
 * storage meter and the transfer dock all describe the same bytes — so they read
 * from one place and every mutation updates it optimistically, then reconciles
 * with what the server actually did.
 */

export type Scope = 'folder' | 'recent' | 'starred' | 'shared' | 'trash' | 'all';
export type SortBy = 'name' | 'size' | 'created' | 'updated';
export type ViewMode = 'list' | 'grid';

const PAGE_SIZE = 60;
/** Kept in step with MAX_UPLOAD_BYTES; the server is still the authority. */
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

interface VaultValue {
  scope: Scope;
  folderId: string | null;
  files: StoredFile[];
  folders: Folder[];
  stats: StorageStats | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  total: number | null;
  hasMore: boolean;

  query: string;
  setQuery: (value: string) => void;
  kinds: string[];
  toggleKind: (kind: string) => void;
  clearKinds: () => void;
  sortBy: SortBy;
  sortDir: 'asc' | 'desc';
  setSort: (by: SortBy, dir?: 'asc' | 'desc') => void;
  view: ViewMode;
  setView: (view: ViewMode) => void;

  selected: string[];
  isSelected: (id: string) => boolean;
  toggleSelect: (id: string, mode?: 'single' | 'toggle' | 'range') => void;
  selectAll: () => void;
  clearSelection: () => void;

  transfers: Transfer[];
  upload: (files: File[], opts?: { folderId?: string | null; visibility?: 'private' | 'public' }) => void;
  cancelTransfer: (id: string) => void;
  retryTransfer: (id: string) => void;
  pauseTransfer: (id: string) => void;
  resumeTransfer: (id: string) => void;
  /** Hand a re-picked file back to a session that survived a reload. */
  attachTransferFile: (id: string, file: File) => boolean;
  dismissTransfer: (id: string) => void;
  clearFinishedTransfers: () => void;

  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  move: (ids: string[], folderId: string | null) => Promise<void>;
  trash: (ids: string[]) => Promise<void>;
  restore: (ids: string[]) => Promise<void>;
  purge: (ids: string[]) => Promise<void>;
  emptyTrash: () => Promise<void>;
  star: (ids: string[], starred: boolean) => Promise<void>;
  setVisibility: (id: string, visibility: 'private' | 'public') => Promise<ShareLink[]>;
  createFolder: (name: string, parentId?: string | null) => Promise<Folder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  trashFolder: (id: string) => Promise<void>;
  moveFolder: (id: string, parentId: string | null) => Promise<void>;
  patchFile: (file: StoredFile) => void;
}

const VaultContext = createContext<VaultValue | null>(null);

const SCOPE_BY_SEGMENT: Record<string, Scope> = {
  recent: 'recent',
  starred: 'starred',
  shared: 'shared',
  trash: 'trash',
};

export function VaultProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const toast = useToast();

  const segment = pathname.split('/')[2] ?? '';
  const scope: Scope = segment === 'folder' ? 'folder' : (SCOPE_BY_SEGMENT[segment] ?? 'folder');
  const folderId = segment === 'folder' ? (params?.id ?? null) : null;
  const isFileView = ['folder', 'recent', 'starred', 'shared', 'trash'].includes(segment) || segment === '';

  const [files, setFiles] = useState<StoredFile[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 220);
  const [kinds, setKinds] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortBy>('created');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [view, setView] = useStoredState<ViewMode>('basalt:view', 'list');

  const [selected, setSelected] = useState<string[]>([]);
  const lastClicked = useRef<string | null>(null);

  const [transfers, setTransfers] = useState<Transfer[]>([]);

  // ── loading ───────────────────────────────────────────────────────────────
  const buildQuery = useCallback(
    (next?: string | null) => {
      const search = new URLSearchParams({
        scope,
        sort: sortBy,
        dir: sortDir,
        limit: String(PAGE_SIZE),
      });
      if (scope === 'folder' && folderId) search.set('folderId', folderId);
      if (debouncedQuery.trim()) search.set('q', debouncedQuery.trim());
      if (kinds.length) search.set('kind', kinds.join(','));
      if (next) search.set('cursor', next);
      return search.toString();
    },
    [scope, folderId, sortBy, sortDir, debouncedQuery, kinds],
  );

  const loadFiles = useCallback(async () => {
    if (!isFileView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<FileListResponse>(`/files?${buildQuery()}`);
      setFiles(data.items);
      setTotal(data.total);
      setCursor(data.nextCursor);
      setSelected((current) => current.filter((id) => data.items.some((f) => f.id === id)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your files.');
    } finally {
      setLoading(false);
    }
  }, [buildQuery, isFileView]);

  const loadFolders = useCallback(async () => {
    try {
      const data = await api.get<{ folders: Folder[] }>('/folders');
      setFolders(data.folders);
    } catch {
      /* the sidebar can survive without the tree for a moment */
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.get<StorageStats>('/files/stats'));
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    void loadFolders();
    void loadStats();
  }, [loadFolders, loadStats]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await api.get<FileListResponse>(`/files?${buildQuery(cursor)}`);
      // Guard against a duplicate page if the user double-triggers the sentinel.
      setFiles((current) => {
        const seen = new Set(current.map((f) => f.id));
        return [...current, ...data.items.filter((f) => !seen.has(f.id))];
      });
      setCursor(data.nextCursor);
    } catch (err) {
      toast.error('Could not load more files', err instanceof ApiError ? err.message : undefined);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, buildQuery, toast]);

  const refresh = useCallback(async () => {
    await Promise.all([loadFiles(), loadFolders(), loadStats()]);
  }, [loadFiles, loadFolders, loadStats]);

  // ── selection ─────────────────────────────────────────────────────────────
  const toggleSelect = useCallback(
    (id: string, mode: 'single' | 'toggle' | 'range' = 'single') => {
      setSelected((current) => {
        if (mode === 'toggle') {
          lastClicked.current = id;
          return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
        }
        if (mode === 'range' && lastClicked.current) {
          const ids = files.map((f) => f.id);
          const from = ids.indexOf(lastClicked.current);
          const to = ids.indexOf(id);
          if (from >= 0 && to >= 0) {
            const [start, end] = from < to ? [from, to] : [to, from];
            const span = ids.slice(start, end + 1);
            return [...new Set([...current, ...span])];
          }
        }
        lastClicked.current = id;
        return current.length === 1 && current[0] === id ? [] : [id];
      });
    },
    [files],
  );

  const selectAll = useCallback(() => setSelected(files.map((f) => f.id)), [files]);
  const clearSelection = useCallback(() => setSelected([]), []);
  const isSelected = useCallback((id: string) => selected.includes(id), [selected]);

  // ── uploads ───────────────────────────────────────────────────────────────
  const managerRef = useRef<UploadManager | null>(null);
  managerRef.current ??= new UploadManager({
    maxBytes: MAX_UPLOAD_BYTES,
    concurrency: 2,
    chunkConcurrency: 3,
    onChange: setTransfers,
    onUploaded: (uploaded, meta) => {
      // A new version replaces a row rather than adding one, so the simplest
      // correct answer is to re-read the view it landed in.
      if (meta.versioned) {
        void loadFiles();
        void loadStats();
        return;
      }
      setFiles((current) => {
        // Only splice in files that belong to the view being looked at.
        const relevant = uploaded.filter(
          (f) => scopeRef.current === 'folder' && f.folderId === (folderRef.current ?? null),
        );
        if (relevant.length === 0) return current;
        const known = new Set(current.map((f) => f.id));
        return [...relevant.filter((f) => !known.has(f.id)), ...current];
      });
      setTotal((current) => (current === null ? current : current + uploaded.length));
      void loadStats();
      void loadFolders();
    },
    onQuotaChanged: () => void loadStats(),
  });

  /**
   * On load, ask the server whether it is still holding any unfinished uploads
   * for this account and offer to finish them. This is the payoff for keeping
   * upload state on the server: closing the tab no longer throws the transfer
   * away.
   */
  useEffect(() => {
    let cancelled = false;
    void api
      .get<{ sessions: ServerSession[] }>('/uploads')
      .then((data) => {
        if (!cancelled && data.sessions.length) managerRef.current!.adopt(data.sessions);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // The manager outlives renders, so it reads the current route through refs.
  const scopeRef = useRef(scope);
  const folderRef = useRef(folderId);
  scopeRef.current = scope;
  folderRef.current = folderId;

  const upload = useCallback(
    (incoming: File[], opts?: { folderId?: string | null; visibility?: 'private' | 'public' }) => {
      if (incoming.length === 0) return;
      managerRef.current!.add(
        incoming,
        opts?.folderId !== undefined ? opts.folderId : folderRef.current,
        opts?.visibility ?? 'private',
      );
    },
    [],
  );

  // ── mutations ─────────────────────────────────────────────────────────────
  const patchFile = useCallback((file: StoredFile) => {
    setFiles((current) => current.map((f) => (f.id === file.id ? file : f)));
  }, []);

  const removeLocal = useCallback((ids: string[]) => {
    const set = new Set(ids);
    setFiles((current) => current.filter((f) => !set.has(f.id)));
    setTotal((current) => (current === null ? current : Math.max(0, current - ids.length)));
    setSelected((current) => current.filter((id) => !set.has(id)));
  }, []);

  const rename = useCallback(
    async (id: string, name: string) => {
      const previous = files.find((f) => f.id === id);
      if (!previous || previous.name === name) return;
      setFiles((current) => current.map((f) => (f.id === id ? { ...f, name } : f)));
      try {
        const { file } = await api.patch<{ file: StoredFile }>(`/files/${id}`, { name });
        patchFile(file);
      } catch (err) {
        setFiles((current) => current.map((f) => (f.id === id ? previous : f)));
        toast.error('Rename failed', err instanceof ApiError ? err.message : undefined);
        throw err;
      }
    },
    [files, patchFile, toast],
  );

  const move = useCallback(
    async (ids: string[], destination: string | null) => {
      const snapshot = files.filter((f) => ids.includes(f.id));
      removeLocal(ids);
      try {
        const res = await api.post<{ files: StoredFile[]; failed: Array<{ id: string; message: string }> }>(
          '/files/actions/move',
          { ids, folderId: destination },
        );
        if (res.failed.length) {
          toast.error(
            `${res.failed.length} of ${ids.length} could not be moved`,
            res.failed[0]?.message,
          );
        }
        const label = destination
          ? (folders.find((f) => f.id === destination)?.name ?? 'folder')
          : 'the root';
        if (res.files.length) toast.success(`Moved ${res.files.length === 1 ? snapshot[0]?.name ?? 'file' : `${res.files.length} files`} to ${label}`);
        await Promise.all([loadFiles(), loadFolders()]);
      } catch (err) {
        setFiles((current) => [...snapshot, ...current]);
        toast.error('Move failed', err instanceof ApiError ? err.message : undefined);
      }
    },
    [files, folders, loadFiles, loadFolders, removeLocal, toast],
  );

  const trash = useCallback(
    async (ids: string[]) => {
      const snapshot = files.filter((f) => ids.includes(f.id));
      removeLocal(ids);
      try {
        await api.post('/files/actions/trash', { ids });
        const name = snapshot.length === 1 ? snapshot[0]?.name : `${snapshot.length} files`;
        toast.undoable(`Moved ${name} to trash`, () => void restoreInternal(ids), 'Kept for 30 days.');
        void loadStats();
      } catch (err) {
        setFiles((current) => [...snapshot, ...current]);
        toast.error('Could not move to trash', err instanceof ApiError ? err.message : undefined);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, removeLocal, toast, loadStats],
  );

  const restoreInternal = useCallback(
    async (ids: string[]) => {
      try {
        await api.post('/files/actions/restore', { ids });
        await refresh();
      } catch (err) {
        toast.error('Restore failed', err instanceof ApiError ? err.message : undefined);
      }
    },
    [refresh, toast],
  );

  const restore = useCallback(
    async (ids: string[]) => {
      removeLocal(ids);
      await restoreInternal(ids);
      toast.success(`Restored ${ids.length === 1 ? 'file' : `${ids.length} files`}`);
    },
    [removeLocal, restoreInternal, toast],
  );

  const purge = useCallback(
    async (ids: string[]) => {
      removeLocal(ids);
      try {
        await api.post('/files/actions/purge', { ids });
        toast.success(`Deleted ${ids.length === 1 ? 'file' : `${ids.length} files`} permanently`);
        void loadStats();
      } catch (err) {
        toast.error('Delete failed', err instanceof ApiError ? err.message : undefined);
        await loadFiles();
      }
    },
    [loadFiles, loadStats, removeLocal, toast],
  );

  const emptyTrash = useCallback(async () => {
    try {
      const { purged } = await api.del<{ purged: number }>('/files/trash');
      setFiles([]);
      setTotal(0);
      toast.success(`Trash emptied — ${purged} ${purged === 1 ? 'file' : 'files'} deleted`);
      await Promise.all([loadStats(), loadFolders()]);
    } catch (err) {
      toast.error('Could not empty the trash', err instanceof ApiError ? err.message : undefined);
    }
  }, [loadFolders, loadStats, toast]);

  const star = useCallback(
    async (ids: string[], starred: boolean) => {
      const before = files;
      setFiles((current) => current.map((f) => (ids.includes(f.id) ? { ...f, starred } : f)));
      try {
        await api.post('/files/actions/star', { ids, starred });
        if (scope === 'starred' && !starred) removeLocal(ids);
      } catch (err) {
        setFiles(before);
        toast.error('Could not update', err instanceof ApiError ? err.message : undefined);
      }
    },
    [files, removeLocal, scope, toast],
  );

  const setVisibility = useCallback(
    async (id: string, visibility: 'private' | 'public') => {
      const { file, shares } = await api.patch<{ file: StoredFile; shares: ShareLink[] }>(`/files/${id}`, {
        visibility,
      });
      patchFile(file);
      void loadStats();
      return shares;
    },
    [loadStats, patchFile],
  );

  const createFolder = useCallback(
    async (name: string, parentId?: string | null) => {
      const { folder } = await api.post<{ folder: Folder }>('/folders', {
        name,
        parentId: parentId ?? folderRef.current,
      });
      setFolders((current) => [...current, folder]);
      void loadStats();
      return folder;
    },
    [loadStats],
  );

  const renameFolder = useCallback(
    async (id: string, name: string) => {
      const { folder } = await api.patch<{ folder: Folder }>(`/folders/${id}`, { name });
      setFolders((current) => current.map((f) => (f.id === id ? { ...f, ...folder } : f)));
    },
    [],
  );

  const trashFolder = useCallback(
    async (id: string) => {
      const folder = folders.find((f) => f.id === id);
      const result = await api.del<{ folders: number; files: number }>(`/folders/${id}`);
      setFolders((current) => current.filter((f) => f.id !== id));
      toast.undoable(
        `Moved “${folder?.name ?? 'folder'}” to trash`,
        () => {
          void api.post(`/folders/${id}/restore`).then(refresh);
        },
        result.files > 0 ? `${result.files} file${result.files === 1 ? '' : 's'} went with it.` : undefined,
      );
      await refresh();
    },
    [folders, refresh, toast],
  );

  const moveFolder = useCallback(
    async (id: string, parentId: string | null) => {
      await api.patch(`/folders/${id}`, { parentId });
      await loadFolders();
    },
    [loadFolders],
  );

  const toggleKind = useCallback((kind: string) => {
    setKinds((current) => (current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind]));
  }, []);

  const setSort = useCallback((by: SortBy, dir?: 'asc' | 'desc') => {
    setSortBy(by);
    setSortDir((current) => dir ?? (by === sortByRef.current ? (current === 'asc' ? 'desc' : 'asc') : by === 'name' ? 'asc' : 'desc'));
    sortByRef.current = by;
  }, []);
  const sortByRef = useRef<SortBy>('created');

  const value = useMemo<VaultValue>(
    () => ({
      scope,
      folderId,
      files,
      folders,
      stats,
      loading,
      loadingMore,
      error,
      total,
      hasMore: Boolean(cursor),
      query,
      setQuery,
      kinds,
      toggleKind,
      clearKinds: () => setKinds([]),
      sortBy,
      sortDir,
      setSort,
      view,
      setView,
      selected,
      isSelected,
      toggleSelect,
      selectAll,
      clearSelection,
      transfers,
      upload,
      cancelTransfer: (id) => managerRef.current!.cancel(id),
      retryTransfer: (id) => managerRef.current!.retry(id),
      pauseTransfer: (id) => managerRef.current!.pause(id),
      resumeTransfer: (id) => managerRef.current!.resume(id),
      attachTransferFile: (id, file) => managerRef.current!.attachFile(id, file),
      dismissTransfer: (id) => managerRef.current!.dismiss(id),
      clearFinishedTransfers: () => managerRef.current!.clearFinished(),
      refresh,
      loadMore,
      rename,
      move,
      trash,
      restore,
      purge,
      emptyTrash,
      star,
      setVisibility,
      createFolder,
      renameFolder,
      trashFolder,
      moveFolder,
      patchFile,
    }),
    [
      scope, folderId, files, folders, stats, loading, loadingMore, error, total, cursor,
      query, kinds, toggleKind, sortBy, sortDir, setSort, view, setView, selected, isSelected,
      toggleSelect, selectAll, clearSelection, transfers, upload, refresh, loadMore, rename,
      move, trash, restore, purge, emptyTrash, star, setVisibility, createFolder, renameFolder,
      trashFolder, moveFolder, patchFile,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultValue {
  const context = useContext(VaultContext);
  if (!context) throw new Error('useVault must be used inside <VaultProvider>');
  return context;
}

/**
 * Overlays are opened with a snapshot of a row, but the store keeps changing
 * underneath them — a visibility toggle, a star, a rename. This resolves the
 * live copy so an open sheet never argues with the list behind it.
 */
export function useLiveFile(file: StoredFile): StoredFile {
  const { files } = useVault();
  return files.find((f) => f.id === file.id) ?? file;
}

/** Direct children of a folder, for the sidebar tree. */
export function childFolders(folders: Folder[], parentId: string | null): Folder[] {
  return folders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
}

/** Root → … → folder, computed client-side from the flat folder list. */
export function folderTrail(folders: Folder[], folderId: string | null): Folder[] {
  const trail: Folder[] = [];
  let current = folderId ? folders.find((f) => f.id === folderId) : undefined;
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    trail.unshift(current);
    current = current.parentId ? folders.find((f) => f.id === current!.parentId) : undefined;
  }
  return trail;
}
