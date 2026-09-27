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
  const { status } = await cloudRequestJson('GET', '/health/', { base, auth: false });
  if (status < 200 || status >= 300) throw new Error(`Server responded with ${status}.`);
}

export type CloudUser = { id: string; username: string; email: string };

/** HTTP error carrying parsed body; shaped so describeCloudError keeps working. */
export class CloudHttpError extends Error {
  status: number;
  data: unknown;
  response: { status: number; data: unknown };
  constructor(status: number, data: unknown, message?: string) {
    super(message || `Cloud request failed with status ${status}.`);
    this.status = status;
    this.data = data;
    this.response = { status, data };
  }
}

type DesktopCloudBridge = {
  cloudRequest?: (request: { method?: string; url: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; bodyText: string }>;
};

function getDesktopCloudBridge(): DesktopCloudBridge | null {
  try {
    const bridge = (globalThis as unknown as { solodevDesktop?: DesktopCloudBridge }).solodevDesktop;
    return bridge && typeof bridge.cloudRequest === 'function' ? bridge : null;
  } catch {
    return null;
  }
}

function parseJsonBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

interface CloudRequestOptions {
  base?: string;
  /** Attach the stored access token. Defaults to true. */
  auth?: boolean;
  headers?: Record<string, string>;
  body?: unknown;
  /** Allow one refresh-and-retry on 401. Defaults to true. */
  retryOnAuth?: boolean;
}

/**
 * CORS-proof cloud request. Inside Electron it goes through the main process
 * (no Chromium CORS); in the browser it uses fetch directly. Throws
 * CloudHttpError on HTTP errors.
 */
export async function cloudRequestJson(
  method: string,
  path: string,
  options: CloudRequestOptions = {},
): Promise<{ status: number; data: unknown }> {
  const base = options.base || (await resolveCloudBase());
  if (!base) throw new Error('Set your PythonAnywhere server URL first.');
  const url = `${base.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (options.auth !== false) {
    const token = cloudTokenStorage.getAccess();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);

  let status: number;
  let data: unknown;
  const bridge = getDesktopCloudBridge();
  if (bridge?.cloudRequest) {
    const res = await bridge.cloudRequest({ method, url, headers, body });
    status = res.status;
    data = parseJsonBody(res.bodyText || '');
  } else {
    const res = await fetch(url, { method, headers, body });
    const text = await res.text();
    status = res.status;
    data = parseJsonBody(text);
  }

  if (status === 401 && options.auth !== false && options.retryOnAuth !== false && !String(path).startsWith('/auth/refresh')) {
    const refresh = cloudTokenStorage.getRefresh();
    if (refresh) {
      try {
        const refreshRes = await cloudRequestJson('POST', '/auth/refresh/', { base, auth: false, body: { refresh }, retryOnAuth: false });
        const next = (refreshRes.data as { access?: string; refresh?: string }) || {};
        if (next.access) {
          cloudTokenStorage.setTokens(next.access, next.refresh || refresh);
          return cloudRequestJson(method, path, { ...options, base, retryOnAuth: false });
        }
      } catch {
        // fall through to the original 401 below
      }
      cloudTokenStorage.clear();
      try {
        window.dispatchEvent(new Event('solodev:cloud-logout'));
      } catch {
        // non-browser context
      }
    }
  }

  if (status < 200 || status >= 300) {
    const detail = (data as { detail?: string; error?: string } | null);
    const message = (detail && (detail.detail || detail.error)) || `Cloud request failed with status ${status}.`;
    throw new CloudHttpError(status, data, typeof message === 'string' ? message : undefined);
  }
  return { status, data };
}

export async function cloudLogin(username: string, password: string): Promise<CloudUser> {
  const { data } = await cloudRequestJson('POST', '/auth/login/', { auth: false, body: { username, password } });
  const tokens = (data as { access?: string; refresh?: string }) || {};
  if (!tokens.access || !tokens.refresh) throw new CloudHttpError(401, data, 'Cloud login did not return tokens.');
  cloudTokenStorage.setTokens(tokens.access, tokens.refresh);
  const me = await cloudRequestJson('GET', '/auth/me/');
  return me.data as CloudUser;
}

export async function cloudRegister(username: string, email: string, password: string): Promise<CloudUser> {
  const { data } = await cloudRequestJson('POST', '/auth/register/', { auth: false, body: { username, email, password } });
  const payload = (data as { access?: string; refresh?: string; user?: CloudUser }) || {};
  if (payload.access && payload.refresh) {
    cloudTokenStorage.setTokens(payload.access, payload.refresh);
    if (payload.user) return payload.user;
  }
  const me = await cloudRequestJson('GET', '/auth/me/');
  return me.data as CloudUser;
}

export async function fetchCloudUser(): Promise<CloudUser | null> {
  if (!cloudTokenStorage.getAccess()) return null;
  try {
    const { data } = await cloudRequestJson('GET', '/auth/me/');
    return data as CloudUser;
  } catch {
    return null;
  }
}

export function cloudLogout(): void {
  cloudTokenStorage.clear();
}
