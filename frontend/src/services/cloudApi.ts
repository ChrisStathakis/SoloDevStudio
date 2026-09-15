import axios, { type AxiosInstance } from 'axios';

const CLOUD_URL_KEY = 'solodev_cloud_url';
const CLOUD_ACCESS_KEY = 'solodev_cloud_access_token';
const CLOUD_REFRESH_KEY = 'solodev_cloud_refresh_token';

export function normalizeCloudBase(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Enter a full server URL, e.g. https://username.pythonanywhere.com');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Server URL must use https:// (http is only allowed for localhost).');
  }
  url.hash = '';
  let pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') pathname = '/api';
  else if (!pathname.endsWith('/api')) pathname += '/api';
  url.pathname = pathname;
  return url.toString().replace(/\/+$/, '');
}

export function getStoredCloudUrl(): string | null {
  try {
    return normalizeCloudBase(localStorage.getItem(CLOUD_URL_KEY));
  } catch {
    return null;
  }
}

export function setStoredCloudUrl(url: string | null): void {
  try {
    if (!url) localStorage.removeItem(CLOUD_URL_KEY);
    else localStorage.setItem(CLOUD_URL_KEY, normalizeCloudBase(url) || '');
  } catch {
    // storage unavailable; Electron setting remains source of truth
  }
}

let cachedBase: string | null | undefined;

export function getCachedCloudBase(): string | null {
  if (cachedBase !== undefined) return cachedBase;
  const envBase = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_CLOUD_API_URL;
  try {
    cachedBase = normalizeCloudBase(getStoredCloudUrl() || envBase || null);
  } catch {
    cachedBase = null;
  }
  return cachedBase;
}

export async function resolveCloudBase(): Promise<string | null> {
  try {
    const settings = await (globalThis as unknown as { solodevDesktop?: { getSettings?: () => Promise<{ cloudApiUrl?: string | null }> } }).solodevDesktop?.getSettings?.();
    const fromDesktop = normalizeCloudBase(settings?.cloudApiUrl || null);
    if (fromDesktop) {
      cachedBase = fromDesktop;
      return fromDesktop;
    }
  } catch {
    // fall through to local fallback
  }
  return getCachedCloudBase();
}

export async function saveCloudUrl(url: string | null): Promise<string | null> {
  const normalized = normalizeCloudBase(url);
  setStoredCloudUrl(normalized);
  cachedBase = normalized;
  try {
    const bridge = (globalThis as unknown as { solodevDesktop?: { setCloudUrl?: (u: string | null) => Promise<{ cloudApiUrl: string | null }> } }).solodevDesktop;
    if (bridge?.setCloudUrl) {
      const res = await bridge.setCloudUrl(normalized);
      cachedBase = normalizeCloudBase(res?.cloudApiUrl || normalized);
    }
  } catch (e) {
    throw e instanceof Error ? e : new Error('Could not save server URL.');
  }
  return cachedBase;
}

export const cloudTokenStorage = {
  getAccess: () => { try { return localStorage.getItem(CLOUD_ACCESS_KEY); } catch { return null; } },
  getRefresh: () => { try { return localStorage.getItem(CLOUD_REFRESH_KEY); } catch { return null; } },
  setTokens: (access: string, refresh: string) => {
    try {
      localStorage.setItem(CLOUD_ACCESS_KEY, access);
      localStorage.setItem(CLOUD_REFRESH_KEY, refresh);
    } catch { /* ignore */ }
  },
  clear: () => { try { localStorage.removeItem(CLOUD_ACCESS_KEY); localStorage.removeItem(CLOUD_REFRESH_KEY); } catch { /* ignore */ } },
};

const clients = new Map<string, AxiosInstance>();

export function getCloudClient(base: string): AxiosInstance {
  const existing = clients.get(base);
  if (existing) return existing;
  const client = axios.create({ baseURL: base, headers: { 'Content-Type': 'application/json' } });
  client.interceptors.request.use((config) => {
    const token = cloudTokenStorage.getAccess();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });
  client.interceptors.response.use(
    (res) => res,
    async (error) => {
      const original = error.config as { _retry?: boolean; headers?: Record<string, string> } | undefined;
      if (error.response?.status === 401 && original && !original._retry) {
        original._retry = true;
        const refresh = cloudTokenStorage.getRefresh();
        if (!refresh) {
          cloudTokenStorage.clear();
          window.dispatchEvent(new Event('solodev:cloud-logout'));
          return Promise.reject(error);
        }
        try {
          const res = await axios.post(`${base}/auth/refresh/`, { refresh });
          if (res.data?.access) {
            cloudTokenStorage.setTokens(res.data.access, res.data?.refresh || refresh);
            original.headers = { ...(original.headers || {}), Authorization: `Bearer ${res.data.access}` };
            return client(original as never);
          }
        } catch (e) {
          cloudTokenStorage.clear();
          window.dispatchEvent(new Event('solodev:cloud-logout'));
          return Promise.reject(e);
        }
      }
      return Promise.reject(error);
    },
  );
  clients.set(base, client);
  return client;
}

export async function requireCloudClient(): Promise<{ base: string; client: AxiosInstance }> {
  const base = await resolveCloudBase();
  if (!base) throw new Error('Set your PythonAnywhere server URL first.');
  return { base, client: getCloudClient(base) };
}

export async function testCloudConnection(base: string): Promise<void> {
  const res = await fetch(`${base.replace(/\/+$/, '')}/health/`);
  if (!res.ok) throw new Error(`Server responded with ${res.status}.`);
}

export type CloudUser = { id: string; username: string; email: string };

export async function cloudLogin(username: string, password: string): Promise<CloudUser> {
  const { client } = await requireCloudClient();
  const res = await client.post('/auth/login/', { username, password });
  cloudTokenStorage.setTokens(res.data.access, res.data.refresh);
  return (await client.get('/auth/me/')).data as CloudUser;
}

export async function cloudRegister(username: string, email: string, password: string): Promise<CloudUser> {
  const { client } = await requireCloudClient();
  const res = await client.post('/auth/register/', { username, email, password });
  cloudTokenStorage.setTokens(res.data.access, res.data.refresh);
  return (res.data.user as CloudUser) || ((await client.get('/auth/me/')).data as CloudUser);
}

export async function fetchCloudUser(): Promise<CloudUser | null> {
  if (!cloudTokenStorage.getAccess()) return null;
  try {
    const { client } = await requireCloudClient();
    return (await client.get('/auth/me/')).data as CloudUser;
  } catch {
    return null;
  }
}

export function cloudLogout(): void {
  cloudTokenStorage.clear();
}
