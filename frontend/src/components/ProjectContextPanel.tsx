import React, { useEffect, useState } from 'react';
import { Check, Copy, FileDown, Send, Eye } from 'lucide-react';
import type { Project } from '../types';
import type { TerminalDrawerHandle } from './TerminalDrawer';
import { useToast } from './Toaster';
import { ProjectContextPicker, type ContextSelectionValue } from './ProjectContextPicker';
import {
  CONTEXT_SECTIONS,
  describeContextError,
  fetchContextBrief,
  writeContextFile,
} from '../services/projectContext';

const MAX_CHAR_OPTIONS = [4000, 12000, 30000, 60000];
const DEFAULT_MAX_CHARS = 12000;

type BusyKind = null | 'preview' | 'copy' | 'send' | 'file';

const selectionKey = (value: ContextSelectionValue, maxChars: number) =>
  JSON.stringify({ stages: value.stages, sections: value.sections, maxChars });

const formatMeta = (stages: number, chars: number, truncated: boolean, suffix?: string) =>
  `${stages} phase${stages === 1 ? '' : 's'} · ${chars} chars${truncated ? ' · truncated' : ''}${suffix ? ` · ${suffix}` : ''}`;

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to legacy execCommand fallback (Electron / restricted clipboard).
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand('copy')) throw new Error('copy failed');
  } finally {
    document.body.removeChild(area);
  }
}

function loadStoredSelection(projectId: string, currentStage: string): { selection: ContextSelectionValue; maxChars: number } {
  const fallback = { selection: { stages: [currentStage], sections: [...CONTEXT_SECTIONS] }, maxChars: DEFAULT_MAX_CHARS };
  try {
    const raw = window.localStorage.getItem(`solodev:context-selection:${projectId}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ContextSelectionValue & { maxChars: number }>;
    const stages = Array.isArray(parsed.stages) ? parsed.stages.filter(s => typeof s === 'string') : [];
    const sections = Array.isArray(parsed.sections)
      ? (CONTEXT_SECTIONS as readonly string[]).filter(s => (parsed.sections as string[]).includes(s))
      : [];
    const maxChars = MAX_CHAR_OPTIONS.includes(Number(parsed.maxChars)) ? Number(parsed.maxChars) : DEFAULT_MAX_CHARS;
    if (!stages.length || !sections.length) return fallback;
    return { selection: { stages, sections: sections as ContextSelectionValue['sections'] }, maxChars };
  } catch {
    return fallback;
  }
}

export const ProjectContextPanel: React.FC<{
  project: Project;
  terminalRef: React.RefObject<TerminalDrawerHandle | null>;
}> = ({ project, terminalRef }) => {
  const { toast } = useToast();
  const [selection, setSelection] = useState<ContextSelectionValue>(() => loadStoredSelection(project.id, project.currentStage).selection);
  const [maxChars, setMaxChars] = useState<number>(() => loadStoredSelection(project.id, project.currentStage).maxChars);
  const [preview, setPreview] = useState('');
  const [previewMeta, setPreviewMeta] = useState('');
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyKind>(null);
  const [copied, setCopied] = useState(false);

  // Reset (or restore persisted) selection when switching projects.
  useEffect(() => {
    const stored = loadStoredSelection(project.id, project.currentStage);
    setSelection(stored.selection);
    setMaxChars(stored.maxChars);
    setPreview('');
    setPreviewMeta('');
    setPreviewKey(null);
    setBusy(null);
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist picker choices per project.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        `solodev:context-selection:${project.id}`,
        JSON.stringify({ ...selection, maxChars }),
      );
    } catch {
      /* storage unavailable */
    }
  }, [project.id, selection, maxChars]);

  const isStale = previewKey !== null && previewKey !== selectionKey(selection, maxChars);

  const validateSelection = (): string | null => {
    if (!selection.stages.length || !selection.sections.length) return 'Select at least one phase and one info type.';
    return null;
  };

  const loadPreview = async () => {
    if (busy !== null) return;
    const invalid = validateSelection();
    if (invalid) {
      toast({ title: invalid, tone: 'error' });
      return;
    }
    setBusy('preview');
    try {
      const brief = await fetchContextBrief(project.id, selection, maxChars);
      setPreview(brief.markdown);
      setPreviewMeta(formatMeta(brief.stages.length, brief.chars, brief.truncated));
      setPreviewKey(selectionKey(selection, maxChars));
    } catch (error: any) {
      toast({ title: describeContextError(error, 'Unable to build the phase brief.'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    if (busy !== null) return;
    const invalid = validateSelection();
    if (invalid) {
      toast({ title: invalid, tone: 'error' });
      return;
    }
    setBusy('copy');
    try {
      // Always fetch fresh so Copy never serves a stale preview.
      const brief = await fetchContextBrief(project.id, selection, maxChars);
      setPreview(brief.markdown);
      setPreviewMeta(formatMeta(brief.stages.length, brief.chars, brief.truncated));
      setPreviewKey(selectionKey(selection, maxChars));
      await copyText(brief.markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast({ title: 'Phase brief copied to clipboard.', tone: 'success' });
    } catch {
      toast({ title: 'Clipboard blocked by the browser.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handleWriteFile = async () => {
    if (busy !== null) return;
    const invalid = validateSelection();
    if (invalid) {
      toast({ title: invalid, tone: 'error' });
      return;
    }
    setBusy('file');
    try {
      const res = await writeContextFile(project.id, selection, maxChars);
      setPreview(res.markdown);
      setPreviewMeta(formatMeta(res.stages.length, res.chars, res.truncated, 'written'));
      setPreviewKey(selectionKey(selection, maxChars));
      toast({ title: `Context written to ${res.context_md}`, tone: 'success' });
    } catch (error: any) {
      toast({ title: describeContextError(error, 'Unable to write the context file.'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handleSendToCmd = async () => {
    if (busy !== null) return;
    const invalid = validateSelection();
    if (invalid) {
      toast({ title: invalid, tone: 'error' });
      return;
    }
    setBusy('send');
    try {
      // Write the file server-side, then display it in CMD with `type`.
      // Piping raw markdown into cmd.exe would execute it line-by-line.
      const res = await writeContextFile(project.id, selection, maxChars);
      setPreview(res.markdown);
      setPreviewMeta(formatMeta(res.stages.length, res.chars, res.truncated, 'sent to CMD'));
      setPreviewKey(selectionKey(selection, maxChars));
      const drawer = terminalRef.current;
      if (!drawer) throw new Error('Terminal console is still loading. Try again in a moment.');
      const session = await drawer.create('cmd');
      const safePath = String(res.context_md).replace(/"/g, '');
      await drawer.sendInput(`type "${safePath}"\r`, session.id);
      toast({ title: 'Phase brief sent — displayed in the project CMD.', tone: 'success' });
    } catch (error: any) {
      toast({ title: describeContextError(error, 'Unable to send the brief to CMD.'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-6 rounded-3xl bg-surface border border-line shadow-xl space-y-5">
      <div>
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400 font-mono">
          Phase context → CMD
        </div>
        <h3 className="text-lg font-black text-content mt-1">Choose what CMD receives</h3>
        <p className="text-xs text-content-faint mt-1">
          Every CMD you open already carries <code className="font-mono">SOLODEV_PROJECT / SOLODEV_STAGE / SOLODEV_PROJECT_DIR</code> env
          vars. Use this panel for the full phase brief: preview it, copy it, write it to{' '}
          <code className="font-mono">.solodev/context.md</code>, or display it inside the project CMD.
        </p>
      </div>

      <ProjectContextPicker currentStage={project.currentStage} value={selection} onChange={setSelection} />

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="context-max-chars" className="text-[11px] font-black uppercase tracking-wider text-content-faint font-mono">
          Size limit
        </label>
        <select
          id="context-max-chars"
          value={maxChars}
          onChange={e => setMaxChars(Number(e.target.value))}
          disabled={busy !== null}
          className="px-2 py-1.5 rounded-lg bg-surface-2 border border-line text-[11px] font-mono text-content disabled:opacity-50"
        >
          {MAX_CHAR_OPTIONS.map(n => (
            <option key={n} value={n}>{n.toLocaleString()} chars</option>
          ))}
        </select>
        {isStale && (
          <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 font-mono">
            Preview outdated — rebuild to match current selection.
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void loadPreview()}
          disabled={busy !== null}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-2 border border-line text-content text-xs font-bold hover:bg-surface-3 disabled:opacity-50"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>{busy === 'preview' ? 'Building…' : 'Preview'}</span>
        </button>
        <button
          type="button"
          onClick={() => void handleCopy()}
          disabled={busy !== null}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-2 border border-line text-content text-xs font-bold hover:bg-surface-3 disabled:opacity-50"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <button
          type="button"
          onClick={() => void handleWriteFile()}
          disabled={busy !== null}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-2 border border-line text-content text-xs font-bold hover:bg-surface-3 disabled:opacity-50"
        >
          <FileDown className="w-3.5 h-3.5" />
          <span>{busy === 'file' ? 'Writing…' : 'Write .solodev file'}</span>
        </button>
        <button
          type="button"
          onClick={() => void handleSendToCmd()}
          disabled={busy !== null}
          title="Writes .solodev/context.md, opens the project CMD, and displays the brief there"
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{busy === 'send' ? 'Sending…' : 'Send to CMD'}</span>
        </button>
      </div>

      {previewMeta && <div className="text-[11px] font-mono text-content-faint">{previewMeta}</div>}
      {preview && (
        <pre className="max-h-96 overflow-auto rounded-2xl bg-surface-2 border border-line p-4 text-xs font-mono text-content whitespace-pre-wrap">
          {preview}
        </pre>
      )}
    </div>
  );
};
