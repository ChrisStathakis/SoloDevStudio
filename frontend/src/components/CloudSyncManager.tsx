import React, { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useToast } from './Toaster';
import {
  fetchCloudMeta,
  restoreCloudBackup,
  bestEffortPushOnUnload,
  installCloudDirtyTracking,
  getLastSyncAt,
  setLastSeenRemoteAt,
  formatCloudDate,
} from '../services/cloudBackup';

const POLL_MS = 5 * 60 * 1000;

/**
 * Headless cloud-sync coordinator, mounted once inside ToastProvider:
 * - installs local-dirty tracking for mutating API calls,
 * - on sign-in checks the PythonAnywhere slot and offers to load it,
 * - polls backup metadata so quit-time auto-save never silently overwrites
 *   a newer backup from another device,
 * - best-effort auto-push on page unload.
 */
export const CloudSyncManager: React.FC = () => {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { refreshData } = useApp();
  const { toast, confirm } = useToast();
  const checkedSessionRef = useRef(false);
  const stateRef = useRef({ refreshData, toast, confirm });
  stateRef.current = { refreshData, toast, confirm };

  useEffect(() => {
    installCloudDirtyTracking();
  }, []);

  useEffect(() => {
    if (authLoading || !isAuthenticated || checkedSessionRef.current) return;
    checkedSessionRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const meta = await fetchCloudMeta();
        if (cancelled || !meta?.exists) return;
        if (meta.exportedAt) setLastSeenRemoteAt(meta.exportedAt);
        const lastSync = getLastSyncAt();
        if (lastSync && meta.exportedAt && meta.exportedAt <= lastSync) return;
        const { toast: showToast, confirm: ask, refreshData: refresh } = stateRef.current;
        showToast({
          title: 'Cloud backup available',
          description: `PythonAnywhere snapshot from ${formatCloudDate(meta.exportedAt)}. Load it to sync this device?`,
          tone: 'info',
          durationMs: 12000,
          action: {
            label: 'Review & load',
            onClick: () => {
              void (async () => {
                const ok = await ask({
                  title: `Replace local workspace with cloud backup from ${formatCloudDate(meta.exportedAt)}?`,
                  description: 'Local changes since your last sync will be lost. This cannot be undone.',
                  confirmLabel: 'Load cloud backup',
                  danger: true,
                });
                if (!ok) return;
                try {
                  await restoreCloudBackup();
                  await refresh();
                  showToast({ title: 'Workspace synced from PythonAnywhere.', tone: 'success' });
                } catch {
                  showToast({ title: 'Load from PythonAnywhere failed.', tone: 'error' });
                }
              })();
            },
          },
        });
      } catch {
        // Offline or unreachable backend: stay on local data, no interruption.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const poll = async () => {
      try {
        const meta = await fetchCloudMeta();
        if (meta?.exists && meta.exportedAt) setLastSeenRemoteAt(meta.exportedAt);
      } catch {
        // polling is best-effort
      }
    };
    const timer = window.setInterval(poll, POLL_MS);
    return () => window.clearInterval(timer);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const onUnload = () => bestEffortPushOnUnload();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [isAuthenticated]);

  return null;
};
