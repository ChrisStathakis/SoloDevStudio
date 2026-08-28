import axios from 'axios';

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';
const ACCESS_KEY = 'solodev_access_token';
const REFRESH_KEY = 'solodev_refresh_token';

// Ensure base ends without trailing slash for axios
function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

export const api = axios.create({
  baseURL: normalizeBase(API_BASE),
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(ACCESS_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void; config: unknown }> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach(({ resolve, reject, config }) => {
    if (error) reject(error);
    else {
      // @ts-ignore
      config.headers = { ...(config.headers || {}), Authorization: `Bearer ${token}` };
      resolve(api(config as any));
    }
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config as any & { _retry?: boolean };
    if (error.response?.status === 401 && !original?._retry && original?.url !== '/auth/refresh/' && original?.url !== '/auth/login/' && original?.url !== '/auth/register/') {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject, config: original });
        });
      }
      original._retry = true;
      isRefreshing = true;
      const refresh = localStorage.getItem(REFRESH_KEY);
      if (!refresh) {
        isRefreshing = false;
        // signal logout
        window.dispatchEvent(new Event('solodev:logout'));
        return Promise.reject(error);
      }
      try {
        const base = normalizeBase(API_BASE);
        const res = await axios.post(`${base}/auth/refresh/`, { refresh });
        const newAccess = res.data?.access;
        const newRefresh = res.data?.refresh;
        if (newAccess) localStorage.setItem(ACCESS_KEY, newAccess);
        if (newRefresh) localStorage.setItem(REFRESH_KEY, newRefresh);
        processQueue(null, newAccess);
        original.headers = { ...(original.headers || {}), Authorization: `Bearer ${newAccess}` };
        return api(original);
      } catch (e) {
        processQueue(e, null);
        localStorage.removeItem(ACCESS_KEY);
        localStorage.removeItem(REFRESH_KEY);
        window.dispatchEvent(new Event('solodev:logout'));
        return Promise.reject(e);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

export const tokenStorage = {
  getAccess: () => localStorage.getItem(ACCESS_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  setTokens: (access: string, refresh: string) => {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
  keys: { access: ACCESS_KEY, refresh: REFRESH_KEY },
};

// Helpers to normalize pagination
export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

// Snake <-> camel mapping helpers for import compat
export function unwrapPaginated<T>(data: T[] | Paginated<T>): T[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'results' in (data as Record<string, unknown>)) {
    return (data as Paginated<T>).results;
  }
  return [];
}

async function tryRefreshAccessToken(): Promise<string | null> {
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) return null;
  try {
    const res = await axios.post(`${normalizeBase(API_BASE)}/auth/refresh/`, { refresh });
    if (res.data?.access) {
      localStorage.setItem(ACCESS_KEY, res.data.access);
      if (res.data?.refresh) localStorage.setItem(REFRESH_KEY, res.data.refresh);
      return res.data.access as string;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * fetch() with the JWT attached; on 401 refreshes the token once and retries.
 * Used for streaming endpoints that axios cannot consume (NDJSON terminal output).
 */
export async function authedFetch(path: string, init: RequestInit = {}, allowRefresh = true): Promise<Response> {
  const base = normalizeBase(API_BASE);
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> || {}) };
  const access = localStorage.getItem(ACCESS_KEY);
  if (access) headers.Authorization = `Bearer ${access}`;
  let res = await fetch(base + path, { ...init, headers });
  if (res.status === 401 && allowRefresh) {
    const newAccess = await tryRefreshAccessToken();
    if (newAccess) {
      headers.Authorization = `Bearer ${newAccess}`;
      res = await fetch(base + path, { ...init, headers });
    }
  }
  return res;
}
