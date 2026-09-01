import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  ArrowLeft,
  Trash2,
  Sparkles,
  Layers,
  Target,
  Zap,
  DollarSign,
  Tag,
  CheckSquare,
  Pencil,
  Image as ImageIcon,
  Download,
} from 'lucide-react';
import { Idea, IdeaStatus, SketchObject } from '../types';
import { SketchCanvas } from './SketchCanvas';
import { downloadPdf } from '../services/pdfDownload';
import { useIdeaCategories } from '../hooks/useIdeaCategories';

const STATUS_FLOW: { value: IdeaStatus; label: string }[] = [
  { value: 'spark', label: 'Raw Spark' },
  { value: 'evaluating', label: 'Evaluating' },
  { value: 'validated', label: 'Validated' },
  { value: 'converted', label: 'Converted' },
  { value: 'archived', label: 'Archived' },
];

const fieldCls =
  'w-full px-3.5 py-2.5 bg-surface-2 border border-line rounded-xl text-sm text-content placeholder-slate-500 outline-none focus:border-amber-500 transition-colors';
const labelCls =
  'text-[13px] font-black uppercase tracking-[0.15em] text-content-faint font-mono mb-1.5 flex items-center gap-1.5';

export const SparkDetailView: React.FC = () => {
  const {
    ideas,
    updateIdea,
    deleteIdea,
    convertIdeaToProject,
    selectedSparkId,
    setSelectedSparkId,
    setSelectedProjectId,
    setCurrentView,
  } = useApp();

  const idea = ideas.find(i => i.id === selectedSparkId) || null;
  const { categories } = useIdeaCategories();

  const [title, setTitle] = useState('');
  const [tagline, setTagline] = useState('');
  const [problem, setProblem] = useState('');
  const [solution, setSolution] = useState('');
  const [notes, setNotes] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [monetization, setMonetization] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [mvpFeatures, setMvpFeatures] = useState<string[]>([]);
  const [featureDraft, setFeatureDraft] = useState('');
  const [sketchModal, setSketchModal] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfExportError, setPdfExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!idea) return;
    setTitle(idea.title);
    setTagline(idea.tagline || '');
    setProblem(idea.problem || '');
    setSolution(idea.solution || '');
    setNotes(idea.notes || '');
    setTargetAudience(idea.targetAudience || '');
    setMonetization(idea.monetization || '');
    setTags(idea.tags || []);
    setMvpFeatures(idea.mvpFeatures || []);
  }, [idea?.id]);

  if (!idea) {
    return (
      <div className="space-y-6 pb-12 animate-in fade-in">
        <button
          type="button"
          onClick={() => setSelectedSparkId(null)}
          className="text-xs font-black text-amber-600 dark:text-amber-400 hover:text-amber-300 flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Sparks</span>
        </button>
        <div className="p-10 text-center rounded-3xl bg-surface border border-line text-content-faint font-mono">
          This spark no longer exists.
        </div>
      </div>
    );
  }

  const commit = (patch: Partial<Idea>) => updateIdea(idea.id, patch);

  const handleAddTag = () => {
    const t = tagDraft.trim();
    if (!t || tags.includes(t)) return;
    const next = [...tags, t];
    setTags(next);
    commit({ tags: next });
    setTagDraft('');
  };
  const handleRemoveTag = (t: string) => {
    const next = tags.filter(x => x !== t);
    setTags(next);
    commit({ tags: next });
  };

  const handleAddFeature = () => {
    const f = featureDraft.trim();
    if (!f) return;
    const next = [...mvpFeatures, f];
    setMvpFeatures(next);
    commit({ mvpFeatures: next });
    setFeatureDraft('');
  };
  const handleRemoveFeature = (idx: number) => {
    const next = mvpFeatures.filter((_, i) => i !== idx);
    setMvpFeatures(next);
    commit({ mvpFeatures: next });
  };

  const handleSaveSketch = async (dataUrl: string, objects: SketchObject[]) => {
    await commit({ sketchDataUrl: dataUrl, sketchObjects: objects });
    setSketchModal(false);
  };

  const handleDelete = () => {
    if (confirm(`Delete spark "${idea.title}"?`)) deleteIdea(idea.id);
  };

  const handleExportPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    setPdfExportError(null);
    try {
      await downloadPdf(`/ideas/${idea.id}/export-pdf/`, `${idea.title || 'idea'}-idea-brief.pdf`);
    } catch (error: any) {
      setPdfExportError(error?.message || 'Unable to export PDF.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleConvert = async () => {
    if (isConverting) return;
    setIsConverting(true);
    setConversionError(null);
    try {
      const proj = await convertIdeaToProject(idea.id);
      setSelectedProjectId(proj.id);
      setSelectedSparkId(null);
      setCurrentView('projects');
    } catch (e: any) {
      const detail = e?.response?.data?.error || e?.response?.data?.detail || e?.message;
      setConversionError(detail ? `Could not launch project: ${detail}` : 'Could not launch project. Please try again.');
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in">
      {/* Back & actions */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setSelectedSparkId(null)}
          className="text-xs font-black text-amber-600 dark:text-amber-400 hover:text-amber-300 flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Sparks</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={isExportingPdf}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-surface-2 border border-line text-content-muted hover:text-content hover:border-indigo-500/60 text-xs font-bold transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExportingPdf ? 'Exporting…' : 'Export PDF'}</span>
          </button>
          {idea.status === 'converted' && idea.convertedProjectId ? (
            <button
              type="button"
              onClick={() => {
                setSelectedProjectId(idea.convertedProjectId);
                setSelectedSparkId(null);
                setCurrentView('projects');
              }}
              className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-300"
            >
              <span>View Project →</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConvert}
              disabled={isConverting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-900/30 border border-indigo-500/30 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-wait"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{isConverting ? 'Launching…' : 'Launch as Project'}</span>
            </button>
          )}

          {conversionError && <p className="text-xs text-rose-700 dark:text-rose-300" role="alert">{conversionError}</p>}
          {pdfExportError && <p className="text-xs text-rose-700 dark:text-rose-300" role="alert">{pdfExportError}</p>}

          <button
            type="button"
            onClick={handleDelete}
            className="p-2 text-rose-600 dark:text-rose-400 hover:text-rose-300 rounded-xl bg-surface-2 border border-line hover:border-rose-800 transition-colors"
            title="Delete Spark"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="p-6 rounded-3xl bg-surface border border-line shadow-xl space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-black uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
              SPARK DETAIL
            </span>
          </div>

          <select
            value={idea.status}
            onChange={e => commit({ status: e.target.value as IdeaStatus })}
            className="text-xs bg-surface-3 text-content rounded-xl px-3 py-1.5 border border-line-strong font-bold outline-none cursor-pointer"
          >
            {STATUS_FLOW.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}><Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />Title</label>
            <input
              className={fieldCls + ' text-base font-black'}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => commit({ title: title.trim() || 'Untitled Spark' })}
              placeholder="Spark title"
            />
          </div>
          <div>
            <label className={labelCls}>Tagline</label>
            <input
              className={fieldCls}
              value={tagline}
              onChange={e => setTagline(e.target.value)}
              onBlur={() => commit({ tagline })}
              placeholder="One-line pitch"
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Category</label>
          <select
            className={fieldCls}
            value={idea.category}
            onChange={e => commit({ category: e.target.value })}
          >
            {categories.map(category => (
              <option key={category.id} value={category.name}>{category.name}</option>
            ))}
          </select>
        </div>

      </div>

      {/* Problem / Solution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-2">
          <label className={labelCls}><Target className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />The Problem</label>
          <textarea
            className={fieldCls + ' min-h-[120px] resize-y'}
            value={problem}
            onChange={e => setProblem(e.target.value)}
            onBlur={() => commit({ problem })}
            placeholder="What painful problem does this solve?"
          />
        </div>
        <div className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-2">
          <label className={labelCls}><Zap className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />The Solution</label>
          <textarea
            className={fieldCls + ' min-h-[120px] resize-y'}
            value={solution}
            onChange={e => setSolution(e.target.value)}
            onBlur={() => commit({ solution })}
            placeholder="How does it solve the problem?"
          />
        </div>
      </div>

      {/* Audience & Monetization */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-2">
          <label className={labelCls}>Target Audience</label>
          <input
            className={fieldCls}
            value={targetAudience}
            onChange={e => setTargetAudience(e.target.value)}
            onBlur={() => commit({ targetAudience })}
            placeholder="Who is this for?"
          />
        </div>
        <div className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-2">
          <label className={labelCls}><DollarSign className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />Monetization</label>
          <input
            className={fieldCls}
            value={monetization}
            onChange={e => setMonetization(e.target.value)}
            onBlur={() => commit({ monetization })}
            placeholder="e.g. $9/mo subscription"
          />
        </div>
      </div>

      {/* Sketch */}
      <div className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-3">
        <label className={labelCls}><ImageIcon className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />Concept Sketch</label>
        {idea.sketchDataUrl ? (
          <div className="relative group rounded-2xl overflow-hidden border border-line bg-surface-inverse p-2">
            <img src={idea.sketchDataUrl} alt="Idea sketch" className="max-h-72 w-full object-contain rounded-xl" />
            <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <button type="button" onClick={() => setSketchModal(true)} className="px-3.5 py-1.5 rounded-xl bg-white text-black text-xs font-bold">Edit Sketch</button>
              <button type="button" onClick={() => commit({ sketchDataUrl: '' })} className="px-3.5 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold">Remove</button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSketchModal(true)}
            className="w-full py-3 px-4 rounded-2xl border border-dashed border-line hover:border-amber-500/60 bg-surface-3/50 hover:bg-amber-500/5 text-content-faint hover:text-amber-300 text-xs font-bold flex items-center justify-center gap-2 transition-all"
          >
            <Pencil className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span>Draw Wireframe Sketch</span>
          </button>
        )}
      </div>

      {/* MVP Features */}
      <div className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-3">
        <label className={labelCls}><CheckSquare className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />MVP Feature Scope ({mvpFeatures.length})</label>
        <div className="space-y-1.5">
          {mvpFeatures.map((feat, idx) => (
            <div key={idx} className="flex items-center justify-between text-sm bg-surface-3 border border-line px-3 py-2 rounded-xl text-content-muted group">
              <span className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                <span>{feat}</span>
              </span>
              <button type="button" onClick={() => handleRemoveFeature(idx)} className="text-content-faint hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="+ Add MVP feature..."
            value={featureDraft}
            onChange={e => setFeatureDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddFeature()}
            className="flex-1 px-3 py-1.5 text-xs bg-surface-3 border border-line rounded-xl text-content placeholder-slate-500 outline-none focus:border-indigo-500"
          />
          <button type="button" onClick={handleAddFeature} disabled={!featureDraft.trim()} className="px-3 py-1.5 bg-surface-3 hover:bg-surface-3 text-content rounded-xl text-xs font-bold disabled:opacity-30">Add</button>
        </div>
      </div>

      {/* Tags */}
      <div className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-3">
        <label className={labelCls}><Tag className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />Tags</label>
        <div className="flex flex-wrap items-center gap-2">
          {tags.map(t => (
            <span key={t} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-3 border border-line text-content-muted text-xs font-medium">
              #{t}
              <button type="button" onClick={() => handleRemoveTag(t)} className="text-content-faint hover:text-rose-400">✕</button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="+ Add tag..."
            value={tagDraft}
            onChange={e => setTagDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddTag()}
            className="flex-1 px-3 py-1.5 text-xs bg-surface-3 border border-line rounded-xl text-content placeholder-slate-500 outline-none focus:border-amber-500"
          />
          <button type="button" onClick={handleAddTag} disabled={!tagDraft.trim()} className="px-3 py-1.5 bg-surface-3 hover:bg-surface-3 text-content rounded-xl text-xs font-bold disabled:opacity-30">Add</button>
        </div>
      </div>

      {/* Notes */}
      <div className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-2">
        <label className={labelCls}>Notes</label>
        <textarea
          className={fieldCls + ' min-h-[120px] resize-y'}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={() => commit({ notes })}
          placeholder="Freeform notes, thoughts, references..."
        />
      </div>

      {/* Sketch modal */}
      {sketchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-4xl max-h-[95vh] overflow-y-auto">
            <SketchCanvas
              initialDataUrl={idea.sketchDataUrl}
              initialObjects={idea.sketchObjects}
              seed={idea}
              id={idea.id}
              onSave={handleSaveSketch}
              onClose={() => setSketchModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
