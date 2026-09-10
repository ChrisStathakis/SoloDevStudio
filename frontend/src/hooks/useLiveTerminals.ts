import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import type { TerminalSessionDto } from '../components/TerminalDrawer';

export interface LiveProjectGroup {
  projectId: string;
  projectTitle: string;
  count: number;
  hasCmd: boolean;
  hasScript: boolean;
}

const POLL_MS = 8000;

/** Dispatched by TerminalDrawer after create/close/stop/restart so the global
 *  pill refreshes instantly instead of waiting for the next poll. */
export const TERMINALS_CHANGED_EVENT = 'solodev:terminals-changed';

export function notifyTerminalsChanged() {
  window.dispatchEvent(new Event(TERMINALS_CHANGED_EVENT));
}

/** Dispatched by the live-consoles pills (header chip + floating pill) when the
 *  user picks a project: navigate there AND expand its terminal drawer, instead
 *  of navigating with the drawer closed. */
export const TERMINAL_OPEN_EVENT = 'solodev:open-terminal';

export function requestTerminalOpen(projectId: string) {
  window.dispatchEvent(new CustomEvent(TERMINAL_OPEN_EVENT, { detail: { projectId } }));
}

export function useLiveTerminals() {
  const { isAuthenticated } = useAuth();
  const [sessions, setSessions] = useState<TerminalSessionDto[]>([]);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setSessions([]);
      return;
    }
    try {
      const res = await api.get<TerminalSessionDto[]>('/terminals/', {
        params: { alive: 'true' },
      });
      const live = (res.data || []).filter(s => s.alive);
      setSessions(live);
    } catch (e) {
      // Keep last known state, but surface the failure so an invisible pill
      // is debuggable instead of silently stale.
      console.warn('[live-terminals] refresh failed', e);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setSessions([]);
      return;
    }
    void refresh();
    const t = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    const onChanged = () => void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener(TERMINALS_CHANGED_EVENT, onChanged);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(TERMINALS_CHANGED_EVENT, onChanged);
    };
  }, [isAuthenticated, refresh]);

  const byProject: LiveProjectGroup[] = (() => {
    const map = new Map<string, LiveProjectGroup>();
    for (const s of sessions) {
      const existing = map.get(s.projectId);
      if (existing) {
        existing.count += 1;
        if (s.mode === 'cmd') existing.hasCmd = true;
        if (s.mode === 'script') existing.hasScript = true;
      } else {
        map.set(s.projectId, {
          projectId: s.projectId,
          projectTitle: s.projectTitle,
          count: 1,
          hasCmd: s.mode === 'cmd',
          hasScript: s.mode === 'script',
        });
      }
    }
    return [...map.values()].sort((a, b) => a.projectTitle.localeCompare(b.projectTitle));
  })();

  return { sessions, byProject, refresh };
}
