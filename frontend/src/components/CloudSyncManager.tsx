import React, { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useCloudAuth } from '../context/CloudAuthContext';
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
  strictUsernamesEqual,
} from '../services/cloudBackup';

const POLL_MS = 5 * 60 * 1000;

/**
 * Headless cloud-sync coordinator, mounted once inside ToastProvider:
 * - installs local-dirty tracking for mutating API calls,
 * - on sign-in checks the configured cloud slot and offers to load it
 *   (strict: only when local and cloud usernames match),
 * - polls backup metadata so quit-time auto-save never silently overwrites
 *   a newer backup from another device,
 * - best-effort auto-push on page unload.
 */
export const CloudSyncManager: React.FC = () => {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { cloudUser, cloudBase } = useCloudAuth();
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
    if (!cloudBase || !cloudUser) return;
    if (!strictUsernamesEqual(user?.username, cloudUser?.username)) return;
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
          description: `Snapshot from ${formatCloudDate(meta.exportedAt)} (${meta.ownerUsername || cloudUser.username}). Load it to sync this device?`,
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
                  await restoreCloudBackup(user?.username || null, cloudUser?.username || null);
                  await refresh();
                  showToast({ title: 'Workspace synced from cloud.', tone: 'success' });
                } catch {
                  showToast({ title: 'Load from cloud failed.', tone: 'error' });
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
  }, [authLoading, isAuthenticated, cloudBase, cloudUser, user?.username]);

  useEffect(() => {
    if (!isAuthenticated || !cloudBase || !cloudUser) return;
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
  }, [isAuthenticated, cloudBase, cloudUser]);

  useEffect(() => {
    if (!isAuthenticated || !cloudBase || !cloudUser) return;
    const localName = user?.username || null;
    const cloudName = cloudUser?.username || null;
    const onUnload = () => bestEffortPushOnUnload(localName, cloudName);
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [isAuthenticated, cloudBase, cloudUser, user?.username]);

  return null;
};
