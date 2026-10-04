import React, { useCallback, useEffect, useState } from 'react';
import { Check, Download, Github, Pencil, Upload, X } from 'lucide-react';
import type { Project } from '../types';
import { useApp } from '../context/AppContext';
import { useToast } from './Toaster';
import {
  cloneProjectRepo,
  describeGitError,
  getProjectGitStatus,
  pullProjectRepo,
  pushProjectRepo,
  type ProjectGitStatus,
} from '../services/git';

const headerBtn =
  'flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-2 border border-line text-content text-xs font-bold hover:bg-surface-3 hover:border-line-strong transition-colors disabled:opacity-50';

const isGithubUrl = (value: string) =>
  /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+?(\.git)?\/?$/i.test(value.trim()) ||
  /^git@github\.com:[^/\s]+\/[^/\s]+?(\.git)?$/i.test(value.trim());

export const ProjectGitButtons: React.FC<{ project: Project }> = ({ project }) => {
  const { updateProject, refreshData } = useApp();
  const { toast } = useToast();
  const [status, setStatus] = useState<ProjectGitStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [busy, setBusy] = useState<null | 'clone' | 'pull' | 'push'>(null);
  const [isEditingRepo, setIsEditingRepo] = useState(false);
  const [repoDraft, setRepoDraft] = useState('');
  const [isSavingRepo, setIsSavingRepo] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [showCommitBox, setShowCommitBox] = useState(false);
  const [commitDraft, setCommitDraft] = useState('');

  const fetchStatus = useCallback(async () => {
    setIsChecking(true);
    try {
      const next = await getProjectGitStatus(project.id);
      setStatus(next);
    } catch {
      setStatus(null);
    } finally {
      setIsChecking(false);
    }
  }, [project.id]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus, project.directoryPath, project.cmdDirectory]);

  const runAction = async (kind: 'clone' | 'pull' | 'push') => {
    if (busy) return;
    setBusy(kind);
    try {
      if (kind === 'clone') await cloneProjectRepo(project.id);
      else if (kind === 'pull') await pullProjectRepo(project.id);
      else {
        const result = await pushProjectRepo(project.id, status?.has_changes ? commitDraft : undefined);
        toast({
          title: result?.committed ? 'Committed & pushed to GitHub.' : 'Pushed to GitHub.',
          tone: 'success',
        });
        setShowCommitBox(false);
        setCommitDraft('');
        await refreshData();
        await fetchStatus();
        return;
      }
      toast({
        title: kind === 'clone' ? 'Repository cloned.' : 'Pulled latest changes.',
        tone: 'success',
      });
      await refreshData();
      await fetchStatus();
    } catch (error: any) {
      toast({ title: describeGitError(error, `Unable to ${kind}.`), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handlePushClick = () => {
    if (status?.has_changes && !showCommitBox) {
      setShowCommitBox(true);
      return;
    }
    void runAction('push');
  };

  const openRepoEdit = () => {
    setRepoDraft(project.repoUrl || '');
    setRepoError(null);
    setIsEditingRepo(true);
  };

  const saveRepo = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const value = repoDraft.trim();
    if (!value) {
      setRepoError('Enter a GitHub repository URL.');
      return;
    }
    if (!isGithubUrl(value)) {
      setRepoError('Use a github.com HTTPS or SSH address.');
      return;
    }
    if (isSavingRepo) return;
    setIsSavingRepo(true);
    setRepoError(null);
    try {
      await updateProject(project.id, { repoUrl: value });
      setIsEditingRepo(false);
      toast({ title: 'GitHub link saved.', tone: 'success' });
    } catch (error: any) {
      setRepoError(describeGitError(error, 'Unable to save the repository URL.'));
    } finally {
      setIsSavingRepo(false);
    }
  };

  const spinner = <span className="w-3.5 h-3.5 border-2 border-slate-600 border-t-indigo-400 rounded-full animate-spin" />;

  return (
    <>
      {isEditingRepo ? (
        <form onSubmit={saveRepo} className="flex flex-wrap items-center gap-1.5 min-w-[240px] flex-1 sm:flex-none">
          <Github className="w-3.5 h-3.5 text-content-faint shrink-0" />
          <input
            autoFocus
            type="text"
            value={repoDraft}
            onChange={e => setRepoDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') setIsEditingRepo(false);
            }}
            placeholder="https://github.com/owner/repo"
            aria-label="GitHub repository URL"
            className="flex-1 min-w-[200px] px-2.5 py-2 bg-surface-2 border border-indigo-500 rounded-xl text-xs font-mono text-content placeholder-slate-600 outline-none"
          />
          <button
            type="submit"
            disabled={isSavingRepo}
            className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
            title="Save GitHub link"
            aria-label="Save GitHub link"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsEditingRepo(false)}
            disabled={isSavingRepo}
            className="p-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-content transition-colors"
            title="Cancel"
            aria-label="Cancel editing GitHub link"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          {repoError && <span role="alert" className="w-full text-[11px] font-bold text-rose-600 dark:text-rose-300">{repoError}</span>}
        </form>
      ) : project.repoUrl ? (
        <span className="flex items-center gap-1">
          <a
            href={project.repoUrl}
            target="_blank"
            rel="noreferrer"
            title={project.repoUrl}
            className={headerBtn}
          >
            <Github className="w-3.5 h-3.5" />
            <span>GitHub</span>
          </a>
          <button
            type="button"
            onClick={openRepoEdit}
            title={`Edit GitHub link: ${project.repoUrl}`}
            aria-label="Edit GitHub link"
            className="p-2 rounded-xl text-slate-600 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </span>
      ) : (
        <button type="button" onClick={openRepoEdit} title="Set a GitHub repository URL" className={headerBtn}>
          <Github className="w-3.5 h-3.5" />
          <span>Set Repo</span>
        </button>
      )}

      {!isChecking && status && (
        <span
          title={status.is_repo ? `Branch ${status.branch || 'unknown'}${status.remote ? ` • ${status.remote}` : ''}` : 'Not a git repository yet'}
          className="hidden lg:inline-flex items-center px-2 py-2 rounded-xl bg-surface-2 border border-line text-[11px] font-mono text-content-faint"
        >
          {status.is_repo
            ? `${status.branch || 'repo'}${status.dirty_count > 0 ? ` • ${status.dirty_count} changed` : ' • clean'}`
            : 'not a repo'}
        </span>
      )}

      {project.repoUrl && !status?.is_repo && (
        <button
          type="button"
          onClick={() => void runAction('clone')}
          disabled={busy !== null || isChecking}
          title={project.directoryPath ? `Clone into ${project.directoryPath}` : 'Clone into a new project folder'}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/25 text-indigo-700 dark:text-indigo-300 text-xs font-bold hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
        >
          {busy === 'clone' ? spinner : <Download className="w-3.5 h-3.5" />}
          <span>Clone</span>
        </button>
      )}
      {status?.is_repo && (
        <>
          <button
            type="button"
            onClick={() => void runAction('pull')}
            disabled={busy !== null}
            title="git pull --ff-only"
            className={headerBtn}
          >
            {busy === 'pull' ? spinner : <Download className="w-3.5 h-3.5" />}
            <span>Pull</span>
          </button>
          <button
            type="button"
            onClick={handlePushClick}
            disabled={busy !== null}
            title={status?.has_changes ? 'git add -A + git commit + git push' : 'git push'}
            className={headerBtn}
          >
            {busy === 'push' ? spinner : <Upload className="w-3.5 h-3.5" />}
            <span>{status?.has_changes ? (showCommitBox ? 'Commit & Push' : `Push (${status.dirty_count} changed)`) : 'Push'}</span>
          </button>
          {showCommitBox && status?.has_changes && (
            <form
              onSubmit={e => {
                e.preventDefault();
                void runAction('push');
              }}
              className="flex flex-wrap items-center gap-1.5 min-w-[240px] flex-1 sm:flex-none"
            >
              <input
                autoFocus
                type="text"
                value={commitDraft}
                onChange={e => setCommitDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setShowCommitBox(false);
                    setCommitDraft('');
                  }
                }}
                placeholder="Commit message (optional)"
                aria-label="Commit message"
                maxLength={500}
                className="flex-1 min-w-[200px] px-2.5 py-2 bg-surface-2 border border-indigo-500 rounded-xl text-xs text-content placeholder-slate-600 outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  setShowCommitBox(false);
                  setCommitDraft('');
                }}
                disabled={busy !== null}
                className="p-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-content transition-colors"
                title="Cancel commit"
                aria-label="Cancel commit"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          )}
        </>
      )}
    </>
  );
};
