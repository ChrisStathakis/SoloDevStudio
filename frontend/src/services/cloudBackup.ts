import { api, tokenStorage } from './api';

export interface CloudBackupMeta {
  exists: boolean;
  name?: string;
  exportedAt?: string | null;
  updatedAt?: string | null;
  sizeBytes?: number;
}

const LAST_PUSH_KEY = 'solodev_last_push_at';
const LAST_SYNC_KEY = 'solodev_last_sync_at';
const LAST_SEEN_REMOTE_KEY = 'solodev_last_seen_remote_at';
const DIRTY_KEY = 'solodev_local_dirty';
const AUTO_PUSH_KEY = 'solodev_auto_push';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable; sync markers are best-effort.
  }
}

export function getLastPushAt(): string | null {
  return read(LAST_PUSH_KEY);
}

export function getLastSyncAt(): string | null {
  return read(LAST_SYNC_KEY);
}

export function getLastSeenRemoteAt(): string | null {
  return read(LAST_SEEN_REMOTE_KEY);
}

export function setLastSeenRemoteAt(iso: string | null): void {
  if (iso) write(LAST_SEEN_REMOTE_KEY, iso);
}

export function isLocalDirty(): boolean {
  return read(DIRTY_KEY) === '1';
}

export function markLocalDirty(): void {
  write(DIRTY_KEY, '1');
}

export function clearLocalDirty(): void {
  try {
    localStorage.removeItem(DIRTY_KEY);
  } catch {
    // ignore
  }
}

export function isAutoPushEnabled(): boolean {
  return read(AUTO_PUSH_KEY) !== '0';
}

export function setAutoPushEnabled(enabled: boolean): void {
  write(AUTO_PUSH_KEY, enabled ? '1' : '0');
}

function markSynced(nowIso?: string): void {
  const now = nowIso || new Date().toISOString();
  write(LAST_PUSH_KEY, now);
  write(LAST_SYNC_KEY, now);
  clearLocalDirty();
}

let dirtyTrackingInstalled = false;

/**
 * Marks the workspace dirty on any successful local mutation so the UI can
 * warn before overwriting a newer cloud backup. Cloud sync + auth calls are
 * excluded. Call once on app start.
 */
export function installCloudDirtyTracking(): void {
  if (dirtyTrackingInstalled) return;
  dirtyTrackingInstalled = true;
  api.interceptors.response.use((res) => {
    try {
      const method = String(res.config?.method || 'get').toLowerCase();
      const url = String(res.config?.url || '');
      const isMutation = method === 'post' || method === 'patch' || method === 'put' || method === 'delete';
      const isSyncCall = url.includes('/cloud-backup/') || url.includes('/auth/');
      if (isMutation && !isSyncCall && res.status >= 200 && res.status < 300) markLocalDirty();
    } catch {
      // never break the response chain
    }
    return res;
  });
}

export async function fetchCloudMeta(): Promise<CloudBackupMeta> {
  const res = await api.get('/cloud-backup/latest/', { params: { meta: 1 } });
  return res.data as CloudBackupMeta;
}

/**
 * Pushes the current workspace to the single cloud slot.
 * Returns the server meta. Caller owns the overwrite confirm.
 */
export async function pushCloudBackup(): Promise<CloudBackupMeta> {
  const exp = await api.get('/export/');
  const res = await api.post('/cloud-backup/push/', exp.data);
  const meta = res.data as CloudBackupMeta;
  if (meta?.exportedAt) {
    markSynced(meta.exportedAt);
    setLastSeenRemoteAt(meta.exportedAt);
  } else {
    markSynced();
  }
  return meta;
}

export interface RestoreResult {
  imported: Record<string, number>;
  exportedAt?: string | null;
}

/**
 * Replaces the local workspace with the stored cloud snapshot.
 * Caller owns the destructive-action confirm, then must refreshData().
 */
export async function restoreCloudBackup(): Promise<RestoreResult> {
  const res = await api.post('/cloud-backup/restore/');
  const exportedAt = (res.data as { exportedAt?: string | null })?.exportedAt || null;
  const now = new Date().toISOString();
  write(LAST_SYNC_KEY, now);
  if (exportedAt) setLastSeenRemoteAt(exportedAt);
  clearLocalDirty();
  return { imported: (res.data as { imported?: Record<string, number> })?.imported || {}, exportedAt };
}

function resolveApiBase(): string {
  const desktopBase = (globalThis as unknown as { solodevDesktop?: { apiBase?: string } }).solodevDesktop?.apiBase;
  const viteBase = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_URL;
  const base = desktopBase || viteBase || '/api';
  return base.replace(/\/+$/, '');
}

/**
 * Best-effort push during page unload (keepalive, no confirm, no UI).
 * Skips when: signed out, auto-push off, nothing dirty, or another device
 * pushed after our last sync (avoids silent overwrite).
 */
export function bestEffortPushOnUnload(): void {
  try {
    if (!isAutoPushEnabled() || !isLocalDirty()) return;
    const access = tokenStorage.getAccess();
    if (!access) return;
    const lastSync = getLastSyncAt();
    const lastSeen = getLastSeenRemoteAt();
    if (lastSeen && lastSync && lastSeen > lastSync) return;
    const base = resolveApiBase();
    const exportUrl = `${base}/export/`;
    const headers: Record<string, string> = { Authorization: `Bearer ${access}` };
    // Synchronous chain is impossible in beforeunload; use keepalive GET then
    // POST. If the export fetch fails the push is skipped silently.
    void fetch(exportUrl, { headers, keepalive: true })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('export failed'))))
      .then((payload) =>
        fetch(`${base}/cloud-backup/push/`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        }),
      )
      .catch(() => undefined);
  } catch {
    // Unload path must never throw.
  }
}

export function formatCloudDate(iso: string | null | undefined): string {
  if (!iso) return 'never';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
