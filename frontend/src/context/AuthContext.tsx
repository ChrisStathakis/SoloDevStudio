import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, tokenStorage } from '../services/api';

type User = { id: string; username: string; email: string; date_joined?: string };

type AuthContextType = {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LEGACY_KEYS = ['solodev_projects_v1', 'solodev_tasks_v1', 'solodev_ideas_v1', 'solodev_time_entries_v1'];

function clearLegacyFields() {
  for (const k of LEGACY_KEYS) {
    try { localStorage.removeItem(k); } catch {}
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    if (!tokenStorage.getAccess()) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      const res = await api.get('/auth/me/');
      setUser(res.data);
    } catch {
      setUser(null);
      tokenStorage.clear();
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
    const onLogout = () => {
      setUser(null);
      tokenStorage.clear();
    };
    window.addEventListener('solodev:logout', onLogout);
    return () => window.removeEventListener('solodev:logout', onLogout);
  }, [fetchMe]);

  const login = async (username: string, password: string) => {
    const res = await api.post('/auth/login/', { username, password });
    tokenStorage.setTokens(res.data.access, res.data.refresh);
    clearLegacyFields();
    await fetchMe();
  };

  const register = async (username: string, email: string, password: string) => {
    const res = await api.post('/auth/register/', { username, email, password });
    tokenStorage.setTokens(res.data.access, res.data.refresh);
    clearLegacyFields();
    // register returns user too; just fetchMe to normalize
    setUser(res.data.user ?? null);
    if (!res.data.user) await fetchMe();
  };

  const logout = () => {
    tokenStorage.clear();
    setUser(null);
    // keep theme, clear legacy already done on login; also clear on logout for fresh start
    // do not clear theme key solo_theme_mode
  };

  const refreshUser = async () => { await fetchMe(); };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
