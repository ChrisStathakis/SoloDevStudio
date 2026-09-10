import { useCallback, useEffect, useState } from 'react';

export type ConsoleRowId = 'folder' | 'script' | 'port' | 'cmd' | 'pythonEnv' | 'drive';

export const DEFAULT_CONSOLE_ROW_ORDER: ConsoleRowId[] = [
  'folder',
  'script',
  'port',
  'cmd',
  'pythonEnv',
  'drive',
];

export const DEFAULT_CONSOLE_ROW_LABELS: Record<ConsoleRowId, string> = {
  folder: 'Project Folder',
  script: 'Server Script',
  port: 'Port / Args',
  cmd: 'CMD Directory',
  pythonEnv: 'Python Environment',
  drive: 'Drive',
};

const LABEL_MAX_LENGTH = 60;

interface StoredLayout {
  order?: unknown;
  labels?: unknown;
}

const storageKey = (projectId: string) => `solodev:console-rows:${projectId}`;

function sanitizeOrder(raw: unknown): ConsoleRowId[] {
  const ids = Array.isArray(raw) ? raw.filter((v): v is ConsoleRowId => typeof v === 'string' && (DEFAULT_CONSOLE_ROW_ORDER as string[]).includes(v)) : [];
  const seen = new Set<ConsoleRowId>();
  const cleaned = ids.filter(id => (seen.has(id) ? false : (seen.add(id), true)));
  for (const id of DEFAULT_CONSOLE_ROW_ORDER) {
    if (!seen.has(id)) cleaned.push(id);
  }
  return cleaned;
}

function sanitizeLabels(raw: unknown): Record<ConsoleRowId, string> {
  const out = { ...DEFAULT_CONSOLE_ROW_LABELS };
  if (raw && typeof raw === 'object') {
    for (const id of DEFAULT_CONSOLE_ROW_ORDER) {
      const v = (raw as Record<string, unknown>)[id];
      if (typeof v === 'string' && v.trim()) out[id] = v.trim().slice(0, LABEL_MAX_LENGTH);
    }
  }
  return out;
}

function loadStored(projectId: string | null): { order: ConsoleRowId[]; labels: Record<ConsoleRowId, string> } {
  if (!projectId) return { order: [...DEFAULT_CONSOLE_ROW_ORDER], labels: { ...DEFAULT_CONSOLE_ROW_LABELS } };
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return { order: [...DEFAULT_CONSOLE_ROW_ORDER], labels: { ...DEFAULT_CONSOLE_ROW_LABELS } };
    const parsed = JSON.parse(raw) as StoredLayout;
    return { order: sanitizeOrder(parsed.order), labels: sanitizeLabels(parsed.labels) };
  } catch {
    return { order: [...DEFAULT_CONSOLE_ROW_ORDER], labels: { ...DEFAULT_CONSOLE_ROW_LABELS } };
  }
}

export function useConsoleRowLayout(projectId: string | null) {
  const [order, setOrder] = useState<ConsoleRowId[]>(() => loadStored(projectId).order);
  const [labels, setLabels] = useState<Record<ConsoleRowId, string>>(() => loadStored(projectId).labels);

  useEffect(() => {
    const next = loadStored(projectId);
    setOrder(next.order);
    setLabels(next.labels);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    try {
      window.localStorage.setItem(storageKey(projectId), JSON.stringify({ order, labels }));
    } catch {
      /* storage unavailable */
    }
  }, [projectId, order, labels]);

  const move = useCallback((id: ConsoleRowId, dir: 'up' | 'down') => {
    setOrder(prev => {
      const idx = prev.indexOf(id);
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (idx < 0 || swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }, []);

  const moveTo = useCallback((dragId: ConsoleRowId, targetId: ConsoleRowId) => {
    if (dragId === targetId) return;
    setOrder(prev => {
      const from = prev.indexOf(dragId);
      const to = prev.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(next.indexOf(targetId), 0, moved);
      return next;
    });
  }, []);

  const rename = useCallback((id: ConsoleRowId, label: string) => {
    const trimmed = label.trim().slice(0, LABEL_MAX_LENGTH);
    setLabels(prev => ({ ...prev, [id]: trimmed || DEFAULT_CONSOLE_ROW_LABELS[id] }));
  }, []);

  const reset = useCallback(() => {
    setOrder([...DEFAULT_CONSOLE_ROW_ORDER]);
    setLabels({ ...DEFAULT_CONSOLE_ROW_LABELS });
  }, []);

  const displayLabel = useCallback((id: ConsoleRowId) => labels[id] || DEFAULT_CONSOLE_ROW_LABELS[id], [labels]);

  return { order, labels, displayLabel, move, moveTo, rename, reset };
}
