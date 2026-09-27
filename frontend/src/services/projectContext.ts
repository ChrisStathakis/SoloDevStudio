import { api } from './api';

export const CONTEXT_SECTIONS = [
  'brief',
  'checklists',
  'tasks',
  'blockers',
  'notes',
  'skills',
  'git',
] as const;

export type ContextSection = (typeof CONTEXT_SECTIONS)[number];

export interface ContextBrief {
  project: string;
  current_stage: string;
  stages: string[];
  sections: string[];
  markdown: string;
  chars: number;
  truncated: boolean;
  max_chars: number;
}

export interface ContextSelection {
  stages: string[];
  sections: ContextSection[];
}

export async function fetchContextBrief(
  projectId: string,
  selection: ContextSelection,
  maxChars = 12000,
): Promise<ContextBrief> {
  const res = await api.get(`/projects/${projectId}/context-brief/`, {
    params: {
      stages: selection.stages.join(','),
      sections: selection.sections.join(','),
      max_chars: maxChars,
    },
  });
  return res.data as ContextBrief;
}

export async function writeContextFile(
  projectId: string,
  selection: ContextSelection,
  maxChars = 12000,
): Promise<ContextBrief & { ok: boolean; context_md: string; context_json: string }> {
  const res = await api.post(`/projects/${projectId}/write-context-file/`, {
    stages: selection.stages.join(','),
    sections: selection.sections.join(','),
    max_chars: maxChars,
  });
  return res.data;
}

export function describeContextError(error: any, fallback: string): string {
  const data = error?.response?.data;
  const detail = data?.error || (typeof data === 'string' ? data : null);
  if (detail) return String(detail);
  if (!error?.response && (error?.message === 'Network Error' || error?.code === 'ERR_NETWORK')) {
    return 'Backend unreachable — restart the app and try again.';
  }
  return error?.message || fallback;
}
