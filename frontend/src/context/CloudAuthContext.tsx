import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  cloudLogin,
  cloudLogout,
  cloudRegister,
  fetchCloudUser,
  getCachedCloudBase,
  resolveCloudBase,
  saveCloudUrl,
  testCloudConnection,
  type CloudUser,
} from '../services/cloudApi';

type CloudAuthContextType = {
  cloudUser: CloudUser | null;
  cloudBase: string | null;
  isLoading: boolean;
  status: string | null;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  saveServerUrl: (url: string | null) => Promise<string | null>;
  testConnection: () => Promise<void>;
};

const CloudAuthContext = createContext<CloudAuthContextType | undefined>(undefined);

export const CloudAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null);
  const [cloudBase, setCloudBase] = useState<string | null>(() => getCachedCloudBase());
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const base = await resolveCloudBase();
      setCloudBase(base);
      if (!base) {
        setCloudUser(null);
        setStatus(null);
        return;
      }
      const user = await fetchCloudUser();
      setCloudUser(user);
      setStatus(user ? null : 'Not signed in to cloud.');
    } catch {
      setCloudUser(null);
      setStatus('Cloud server unreachable.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onLogout = () => setCloudUser(null);
    window.addEventListener('solodev:cloud-logout', onLogout);
    return () => window.removeEventListener('solodev:cloud-logout', onLogout);
  }, [refresh]);

  const login = async (username: string, password: string) => {
    const user = await cloudLogin(username.trim(), password);
    setCloudUser(user);
    setStatus(null);
  };

  const register = async (username: string, email: string, password: string) => {
    const user = await cloudRegister(username.trim(), email.trim(), password);
    setCloudUser(user);
    setStatus(null);
  };

  const logout = () => {
    cloudLogout();
    setCloudUser(null);
  };

  const saveServerUrl = async (url: string | null) => {
    const normalized = await saveCloudUrl(url);
    setCloudBase(normalized);
    setCloudUser(null);
    cloudLogout();
    return normalized;
  };

  const testConnection = async () => {
    const base = await resolveCloudBase();
    if (!base) throw new Error('Set your PythonAnywhere server URL first.');
    await testCloudConnection(base);
  };

  return (
    <CloudAuthContext.Provider value={{ cloudUser, cloudBase, isLoading, status, refresh, login, register, logout, saveServerUrl, testConnection }}>
      {children}
    </CloudAuthContext.Provider>
  );
};

export const useCloudAuth = (): CloudAuthContextType => {
  const ctx = useContext(CloudAuthContext);
  if (!ctx) throw new Error('useCloudAuth must be used within CloudAuthProvider');
  return ctx;
};
