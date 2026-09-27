import React, { useState } from 'react';
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

export const ProjectContextPanel: React.FC<{
  project: Project;
  terminalRef: React.RefObject<TerminalDrawerHandle | null>;
}> = ({ project, terminalRef }) => {
  const { toast } = useToast();
  const [selection, setSelection] = useState<ContextSelectionValue>({
    stages: [project.currentStage],
    sections: [...CONTEXT_SECTIONS],
  });
  const [preview, setPreview] = useState('');
  const [previewMeta, setPreviewMeta] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [busy, setBusy] = useState<null | 'copy' | 'send' | 'file'>(null);
  const [copied, setCopied] = useState(false);

  const loadPreview = async () => {
    if (isLoading) return;
    if (!selection.stages.length || !selection.sections.length) {
      toast({ title: 'Select at least one phase and one info type.', tone: 'error' });
      return;
    }
    setIsLoading(true);
    try {
      const brief = await fetchContextBrief(project.id, selection);
      setPreview(brief.markdown);
      setPreviewMeta(
        `${brief.stages.length} phase${brief.stages.length === 1 ? '' : 's'} · ${brief.chars} chars${brief.truncated ? ' · truncated' : ''}`,
      );
    } catch (error: any) {
      toast({ title: describeContextError(error, 'Unable to build the phase brief.'), tone: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const ensurePreview = async (): Promise<string | null> => {
    if (preview) return preview;
    try {
      const brief = await fetchContextBrief(project.id, selection);
      setPreview(brief.markdown);
      setPreviewMeta(
        `${brief.stages.length} phase${brief.stages.length === 1 ? '' : 's'} · ${brief.chars} chars${brief.truncated ? ' · truncated' : ''}`,
      );
      return brief.markdown;
    } catch (error: any) {
      toast({ title: describeContextError(error, 'Unable to build the phase brief.'), tone: 'error' });
      return null;
    }
  };

  const handleCopy = async () => {
    if (busy) return;
    setBusy('copy');
    try {
      const text = await ensurePreview();
      if (!text) return;
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: 'Clipboard blocked by the browser.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handleWriteFile = async () => {
    if (busy) return;
    setBusy('file');
    try {
      const res = await writeContextFile(project.id, selection);
      setPreview(res.markdown);
      setPreviewMeta(`${res.chars} chars written`);
      toast({ title: `Context written to ${res.context_md}`, tone: 'success' });
    } catch (error: any) {
      toast({ title: describeContextError(error, 'Unable to write the context file.'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handleSendToCmd = async () => {
    if (busy) return;
    setBusy('send');
    try {
      // Write the file server-side, then display it in CMD with `type`.
      // Piping raw markdown into cmd.exe would execute it line-by-line.
      const res = await writeContextFile(project.id, selection);
      setPreview(res.markdown);
      setPreviewMeta(`${res.chars} chars · sent to CMD`);
      const drawer = terminalRef.current;
      if (!drawer) throw new Error('Terminal console is still loading. Try again in a moment.');
      const session = await drawer.create('cmd');
      await drawer.sendInput(`type "${res.context_md}"\r`, session.id);
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

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void loadPreview()}
          disabled={isLoading || busy !== null}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-2 border border-line text-content text-xs font-bold hover:bg-surface-3 disabled:opacity-50"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>{isLoading ? 'Building…' : 'Preview'}</span>
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
