import { api, tokenStorage } from './api';
import {
  cloudTokenStorage,
  getCachedCloudBase,
  requireCloudClient,
  resolveCloudBase,
} from './cloudApi';

export interface CloudBackupMeta {
  exists: boolean;
  name?: string;
  exportedAt?: string | null;
  updatedAt?: string | null;
  sizeBytes?: number;
  ownerUsername?: string | null;
}

export class CloudSyncError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
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

/** Exact, case-sensitive username comparison (Django usernames are case-sensitive). */
export function strictUsernamesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return String(a).trim() === String(b).trim();
}

/** Strict gate: local and cloud accounts must be the same username. */
export function assertStrictMatch(localUsername: string | null, cloudUsername: string | null): void {
  if (!localUsername) throw new CloudSyncError('NOT_SIGNED_IN', 'Sign in on this device first.');
  if (!cloudUsername) throw new CloudSyncError('CLOUD_NOT_SIGNED_IN', 'Sign in to the cloud server first.');
  if (!strictUsernamesEqual(localUsername, cloudUsername)) {
    throw new CloudSyncError(
      'USER_MISMATCH',
      `Local account "${localUsername}" does not match cloud account "${cloudUsername}". Sign in as the same username on both sides.`,
    );
  }
}

export function describeCloudError(e: unknown): string {
  const code = (e as { response?: { data?: { code?: string } }; code?: string })?.response?.data?.code
    || (e as CloudSyncError)?.code;
  if (code === 'USER_MISMATCH') return 'Account mismatch: sign in as the same username locally and on the cloud server.';
  if (code === 'NOT_SIGNED_IN') return 'Sign in on this device first.';
  if (code === 'CLOUD_NOT_SIGNED_IN') return 'Sign in to the cloud server first.';
  const msg = e instanceof Error ? e.message : '';
  if (msg && /server URL/i.test(msg)) return msg;
  return 'Save to cloud failed. Check the server URL and your connection.';
}

export async function fetchCloudMeta(): Promise<CloudBackupMeta> {
  const { client } = await requireCloudClient();
  const res = await client.get('/cloud-backup/latest/', { params: { meta: 1 } });
  return res.data as CloudBackupMeta;
}

/**
 * Pushes the local workspace to the remote cloud slot.
 * Export is read locally; the payload is stored remotely under the cloud JWT.
 * Strict: localUsername must equal cloudUsername.
 */
export async function pushCloudBackup(localUsername: string | null, cloudUsername: string | null): Promise<CloudBackupMeta> {
  assertStrictMatch(localUsername, cloudUsername);
  const { client } = await requireCloudClient();
  const exp = await api.get('/export/');
  const payload = { ...exp.data, ownerUsername: localUsername };
  try {
    const res = await client.post('/cloud-backup/push/', payload, {
      headers: localUsername ? { 'X-Local-Username': localUsername } : {},
    });
    const meta = res.data as CloudBackupMeta;
    if (meta?.exportedAt) {
      markSynced(meta.exportedAt);
      setLastSeenRemoteAt(meta.exportedAt);
    } else {
      markSynced();
    }
    return meta;
  } catch (e) {
    throw new CloudSyncError(
      (e as { response?: { data?: { code?: string } } })?.response?.data?.code || 'PUSH_FAILED',
      describeCloudError(e),
    );
  }
}

/**
 * Restores the remote snapshot into the local workspace.
 * Strict: localUsername must equal cloudUsername and the stored backup owner.
 */
export async function restoreCloudBackup(localUsername: string | null, cloudUsername: string | null): Promise<RestoreResult> {
  assertStrictMatch(localUsername, cloudUsername);
  const { client } = await requireCloudClient();
  let meta: CloudBackupMeta;
  try {
    meta = (await client.get('/cloud-backup/latest/')).data as CloudBackupMeta & { payload?: Record<string, unknown> };
  } catch (e) {
    throw new CloudSyncError('FETCH_FAILED', describeCloudError(e));
  }
  const owner = (meta as { ownerUsername?: string })?.ownerUsername;
  if (owner && !strictUsernamesEqual(owner, localUsername)) {
    throw new CloudSyncError('USER_MISMATCH', `Cloud snapshot belongs to "${owner}", not "${localUsername}".`);
  }
  const payload = ((meta as { payload?: unknown }).payload || {}) as Record<string, unknown>;
  try {
    // Replace (not merge): wipe the local workspace first, mirroring the
    // server-side cloud restore which wipes before importing.
    const resetRes = await api.post('/workspace/reset/');
    if (resetRes.data?.success !== true) throw new Error('Local workspace reset was not completed.');
    const importRes = await api.post('/import/', payload);
    const imported = (importRes.data as { imported?: Record<string, number> })?.imported || {};
    const exportedAt = meta?.exportedAt || null;
    const now = new Date().toISOString();
    write(LAST_SYNC_KEY, now);
    if (exportedAt) setLastSeenRemoteAt(exportedAt);
    clearLocalDirty();
    return { imported, exportedAt };
  } catch (e) {
    if (e instanceof CloudSyncError) throw e;
    throw new CloudSyncError('IMPORT_FAILED', e instanceof Error ? e.message : 'Local import failed.');
  }
}

export interface RestoreResult {
  imported: Record<string, number>;
  exportedAt?: string | null;
}

function resolveLocalApiBase(): string {
  const desktopBase = (globalThis as unknown as { solodevDesktop?: { apiBase?: string } }).solodevDesktop?.apiBase;
  const viteBase = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_URL;
  const base = desktopBase || viteBase || '/api';
  return base.replace(/\/+$/, '');
}

/**
 * Best-effort push during page unload (keepalive, no confirm, no UI).
 * Skips when: server URL unset, signed out, auto-push off, nothing dirty,
 * another device pushed after our last sync, or strict username mismatch.
 */
export function bestEffortPushOnUnload(localUsername: string | null, cloudUsername: string | null): void {
  try {
    if (!isAutoPushEnabled() || !isLocalDirty()) return;
    if (!localUsername || !cloudUsername) return;
    if (!strictUsernamesEqual(localUsername, cloudUsername)) return;
    const cloudBase = getCachedCloudBase();
    if (!cloudBase) return;
    const access = cloudTokenStorage.getAccess();
    const localAccess = tokenStorage.getAccess();
    if (!access || !localAccess) return;
    const lastSync = getLastSyncAt();
    const lastSeen = getLastSeenRemoteAt();
    if (lastSeen && lastSync && lastSeen > lastSync) return;
    const localBase = resolveLocalApiBase();
    const localHeaders: Record<string, string> = { Authorization: `Bearer ${localAccess}` };
    const cloudHeaders: Record<string, string> = {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
      'X-Local-Username': localUsername,
    };
    void fetch(`${localBase}/export/`, { headers: localHeaders, keepalive: true })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('export failed'))))
      .then((payload) =>
        fetch(`${cloudBase}/cloud-backup/push/`, {
          method: 'POST',
          headers: cloudHeaders,
          body: JSON.stringify({ ...payload, ownerUsername: localUsername }),
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

export async function getConfiguredCloudBase(): Promise<string | null> {
  return resolveCloudBase();
}
