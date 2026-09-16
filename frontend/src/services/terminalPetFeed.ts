export type TerminalPetMode = 'cmd' | 'script';

export interface TerminalPetSnapshot {
  sessionId: string;
  projectId: string | null;
  projectTitle: string;
  mode: TerminalPetMode;
  /** Last-known liveness from the drawer (corrected by the live list in App). */
  alive: boolean;
  exitCode: number | null;
  /** ANSI-stripped tail of streamed output, capped (~4000 chars to support expanded view). */
  tailText: string;
  /** True when the stripped tail ends at a CMD prompt (command finished). */
  promptReady: boolean;
  lastOutputAt: number;
  revision: number;
  updatedAt: number;
}

export const TERMINAL_PET_EVENT = 'solodev:terminal-pet';

type Listener = (snapshot: TerminalPetSnapshot | null, all?: Record<string, TerminalPetSnapshot>) => void;

const bySession: Record<string, TerminalPetSnapshot> = {};
let current: TerminalPetSnapshot | null = null;
const listeners = new Set<Listener>();

export function getTerminalPetSnapshot(): TerminalPetSnapshot | null {
  return current;
}

/** All known per-session snapshots, keyed by sessionId. */
export function getPetSnapshots(): Record<string, TerminalPetSnapshot> {
  return { ...bySession };
}

/** Snapshot for one session (drawer stream or watched-tail poller). */
export function getPetSnapshotFor(sessionId: string): TerminalPetSnapshot | null {
  return bySession[sessionId] ?? null;
}

export function subscribeTerminalPetSnapshot(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(detail: TerminalPetSnapshot | null): void {
  const all = { ...bySession };
  listeners.forEach((listener) => {
    try {
      listener(detail, all);
    } catch {
      /* subscriber must never break the stream pump */
    }
  });
  try {
    window.dispatchEvent(new CustomEvent(TERMINAL_PET_EVENT, { detail }));
  } catch {
    /* non-DOM environment */
  }
}

export function publishTerminalPetSnapshot(snapshot: TerminalPetSnapshot): void {
  bySession[snapshot.sessionId] = snapshot;
  if (!current || snapshot.updatedAt >= current.updatedAt) current = snapshot;
  // If the latest session was cleared elsewhere, re-point current at the
  // freshest remaining snapshot so subscribers keep a valid default.
  notify(snapshot);
}

export function clearTerminalPetSnapshot(sessionId?: string): void {
  if (sessionId) {
    delete bySession[sessionId];
    if (current?.sessionId === sessionId) {
      const rest = Object.values(bySession).sort((a, b) => b.updatedAt - a.updatedAt);
      current = rest[0] ?? null;
    }
    notify(current ? bySession[current.sessionId] ?? current : null);
    return;
  }
  for (const key of Object.keys(bySession)) delete bySession[key];
  current = null;
  notify(null);
}

/** Last non-empty lines of stripped output, each truncated for the pet bubble. */
export function extractPetLines(tailText: string, maxLines = 3, maxChars = 90): string[] {
  const lines = tailText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  return lines.slice(-maxLines).map((line) => (line.length > maxChars ? `…${line.slice(-maxChars)}` : line));
}
