export type TerminalPetMode = 'cmd' | 'script';

export interface TerminalPetSnapshot {
  sessionId: string;
  projectId: string | null;
  projectTitle: string;
  mode: TerminalPetMode;
  /** Last-known liveness from the drawer (corrected by the live list in App). */
  alive: boolean;
  exitCode: number | null;
  /** ANSI-stripped tail of streamed output, capped (~600 chars). */
  tailText: string;
  /** True when the stripped tail ends at a CMD prompt (command finished). */
  promptReady: boolean;
  lastOutputAt: number;
  revision: number;
  updatedAt: number;
}

export const TERMINAL_PET_EVENT = 'solodev:terminal-pet';

type Listener = (snapshot: TerminalPetSnapshot | null) => void;

let current: TerminalPetSnapshot | null = null;
const listeners = new Set<Listener>();

export function getTerminalPetSnapshot(): TerminalPetSnapshot | null {
  return current;
}

export function subscribeTerminalPetSnapshot(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishTerminalPetSnapshot(snapshot: TerminalPetSnapshot): void {
  current = snapshot;
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      /* subscriber must never break the stream pump */
    }
  });
  try {
    window.dispatchEvent(new CustomEvent(TERMINAL_PET_EVENT, { detail: snapshot }));
  } catch {
    /* non-DOM environment */
  }
}

export function clearTerminalPetSnapshot(sessionId?: string): void {
  if (sessionId && current?.sessionId !== sessionId) return;
  current = null;
  listeners.forEach((listener) => {
    try {
      listener(null);
    } catch {
      /* ignore */
    }
  });
  try {
    window.dispatchEvent(new CustomEvent(TERMINAL_PET_EVENT, { detail: null }));
  } catch {
    /* non-DOM environment */
  }
}

/** Last non-empty lines of stripped output, each truncated for the pet bubble. */
export function extractPetLines(tailText: string, maxLines = 3, maxChars = 90): string[] {
  const lines = tailText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  return lines.slice(-maxLines).map((line) => (line.length > maxChars ? `…${line.slice(-maxChars)}` : line));
}
