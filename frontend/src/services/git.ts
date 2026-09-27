import { api } from './api';

export interface ProjectGitStatus {
  is_repo: boolean;
  has_directory: boolean;
  directory: string;
  branch: string;
  remote: string;
  dirty_count: number;
  has_changes: boolean;
  repo_url: string;
}

export async function getProjectGitStatus(projectId: string): Promise<ProjectGitStatus> {
  const res = await api.get(`/projects/${projectId}/git-status/`);
  return res.data as ProjectGitStatus;
}

export async function cloneProjectRepo(projectId: string): Promise<ProjectGitStatus & { ok: boolean; path: string; output: string }> {
  const res = await api.post(`/projects/${projectId}/git-clone/`);
  return res.data;
}

export async function pullProjectRepo(projectId: string): Promise<ProjectGitStatus & { ok: boolean; output: string }> {
  const res = await api.post(`/projects/${projectId}/git-pull/`);
  return res.data;
}

export async function pushProjectRepo(projectId: string): Promise<ProjectGitStatus & { ok: boolean; output: string }> {
  const res = await api.post(`/projects/${projectId}/git-push/`);
  return res.data;
}

export function describeGitError(error: any, fallback: string): string {
  const data = error?.response?.data;
  const detail = data?.error || data?.detail || (typeof data === 'string' ? data : null);
  if (detail) return String(detail);
  if (!error?.response && (error?.message === 'Network Error' || error?.code === 'ERR_NETWORK')) {
    return 'Backend unreachable — restart the app and try again.';
  }
  return error?.message || fallback;
}
