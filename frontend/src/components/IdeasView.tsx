import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Lightbulb, 
  Plus, 
  Sparkles, 
  Pencil, 
  ArrowRight, 
  Trash2, 
  Tag, 
  CheckCircle2, 
  Flame, 
  Zap, 
  DollarSign, 
  Target, 
  Image as ImageIcon,
  CheckSquare,
  Layers
} from 'lucide-react';
import { Idea, IdeaStatus, SketchObject } from '../types';
import { SketchCanvas } from './SketchCanvas';
import { SparkDetailView } from './SparkDetailView';
import { PageHeader, Button } from './ui';

export const IdeasView: React.FC = () => {
  const { 
    ideas, 
    addIdea, 
    updateIdea, 
    deleteIdea, 
    convertIdeaToProject, 
    openQuickAdd,
    setSelectedProjectId,
    setCurrentView,
    searchQuery,
    selectedSparkId,
    setSelectedSparkId
  } = useApp();

  if (selectedSparkId) {
    return <SparkDetailView />;
  }

  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [editingIdeaId, setEditingIdeaId] = useState<string | null>(null);
  const [sketchModalIdeaId, setSketchModalIdeaId] = useState<string | null>(null);
  const [newMvpFeature, setNewMvpFeature] = useState<{ [ideaId: string]: string }>({});
  const [convertingIdeaId, setConvertingIdeaId] = useState<string | null>(null);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [conversionErrorIdeaId, setConversionErrorIdeaId] = useState<string | null>(null);

  const filteredIdeas = ideas.filter(idea => {
    const matchesStatus = selectedStatusFilter === 'all' || idea.status === selectedStatusFilter;
    const matchesSearch = !searchQuery ||
      idea.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      idea.tagline.toLowerCase().includes(searchQuery.toLowerCase()) ||
      idea.problem.toLowerCase().includes(searchQuery.toLowerCase()) ||
      idea.solution.toLowerCase().includes(searchQuery.toLowerCase()) ||
      idea.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  const getStatusBadge = (status: IdeaStatus) => {
    switch (status) {
      case 'spark':
        return { label: 'Raw Spark', bg: 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200' };
      case 'evaluating':
        return { label: 'Evaluating', bg: 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border-blue-200' };
      case 'validated':
        return { label: 'Validated ★', bg: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200' };
      case 'converted':
        return { label: 'Converted to Project', bg: 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 border-indigo-200' };
      case 'archived':
        return { label: 'Archived', bg: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-content-faint border-slate-200' };
    }
  };

  const handleAddMvpFeature = (ideaId: string) => {
    const feat = newMvpFeature[ideaId];
    if (!feat || !feat.trim()) return;

    const idea = ideas.find(i => i.id === ideaId);
    if (!idea) return;

    updateIdea(ideaId, {
      mvpFeatures: [...(idea.mvpFeatures || []), feat.trim()]
    });

    setNewMvpFeature(prev => ({ ...prev, [ideaId]: '' }));
  };

  const handleRemoveMvpFeature = (ideaId: string, index: number) => {
    const idea = ideas.find(i => i.id === ideaId);
    if (!idea) return;
    const updated = [...idea.mvpFeatures];
    updated.splice(index, 1);
    updateIdea(ideaId, { mvpFeatures: updated });
  };

  const handleSaveSketch = async (dataUrl: string, objects: SketchObject[]) => {
    if (sketchModalIdeaId) {
      await updateIdea(sketchModalIdeaId, { sketchDataUrl: dataUrl, sketchObjects: objects });
      setSketchModalIdeaId(null);
    }
  };

  const handleConvert = async (ideaId: string) => {
    if (convertingIdeaId) return;
    setConvertingIdeaId(ideaId);
    setConversionError(null);
    setConversionErrorIdeaId(null);
    try {
      const proj = await convertIdeaToProject(ideaId);
      setSelectedProjectId(proj.id);
      setCurrentView('projects');
    } catch (e: any) {
      const detail = e?.response?.data?.error || e?.response?.data?.detail || e?.message;
      setConversionError(detail ? `Could not launch project: ${detail}` : 'Could not launch project. Please try again.');
      setConversionErrorIdeaId(ideaId);
    } finally {
      setConvertingIdeaId(null);
    }
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in">
      
      {/* Header */}
      <PageHeader
        eyebrow="Idea workspace"
        title="Ideas"
        description="Capture sparks, shape concepts, and promote the ones worth building."
        actions={<Button
          type="button"
          id="btn-spark-new-idea"
          onClick={() => openQuickAdd('idea')}
          className="bg-amber-400 text-slate-950 shadow-amber-500/20 hover:bg-amber-300"
        >
          <Sparkles className="w-4 h-4 fill-current" />
          <span>New idea</span>
        </Button>}
      />

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {['all', 'spark', 'evaluating', 'validated', 'converted'].map(statusKey => {
          const isSelected = selectedStatusFilter === statusKey;
          const count = statusKey === 'all' 
            ? ideas.length 
            : ideas.filter(i => i.status === statusKey).length;

          return (
            <button
              key={statusKey}
              type="button"
              onClick={() => setSelectedStatusFilter(statusKey)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                isSelected
                  ? 'bg-amber-500 text-black shadow-md'
                  : 'bg-surface-2 border border-line text-content-faint hover:text-content hover:bg-surface-3'
              }`}
            >
              <span className="capitalize">{statusKey === 'all' ? 'All Ideas' : statusKey}</span>
              <span className={`ml-1.5 text-[12px] px-1.5 py-0.2 rounded-full font-black ${
                isSelected ? 'bg-amber-600/60 text-black' : 'bg-surface-3 text-content-faint'
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Ideas Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredIdeas.map(idea => {
          const badge = getStatusBadge(idea.status);
          const featureInput = newMvpFeature[idea.id] || '';

          return (
            <div
              key={idea.id}
              onClick={() => setSelectedSparkId(idea.id)}
              className="p-6 rounded-3xl bg-surface border border-line shadow-xl hover:border-amber-500/60 transition-all flex flex-col justify-between space-y-4 relative overflow-hidden cursor-pointer group"
            >
              <div>
                {/* Top Badges & Actions */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-[12px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-md border ${badge.bg}`}>
                      {badge.label}
                    </span>
                    <span className="text-[12px] text-content-faint bg-surface-3/80 border border-line-strong/60 px-2 py-0.5 rounded-md font-semibold font-mono">
                      {idea.category}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        if (confirm(`Delete idea "${idea.title}"?`)) {
                          deleteIdea(idea.id);
                        }
                      }}
                      className="p-1 text-content-faint hover:text-rose-400 rounded transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Title & Tagline */}
                <h3 className="text-lg font-black text-content">
                  {idea.title}
                </h3>
                {idea.tagline && (
                  <p className="text-xs font-medium text-content-muted mt-0.5">
                    {idea.tagline}
                  </p>
                )}

                {/* Problem vs Solution 2-Col Box */}
                {(idea.problem || idea.solution) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-3">
                    {idea.problem && (
                      <div className="p-3.5 rounded-2xl bg-surface-3 border border-line text-xs">
                        <div className="font-bold text-content mb-1 flex items-center gap-1.5">
                          <Target className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                          <span>The Problem</span>
                        </div>
                        <p className="text-content-faint leading-relaxed">
                          {idea.problem}
                        </p>
                      </div>
                    )}

                    {idea.solution && (
                      <div className="p-3.5 rounded-2xl bg-surface-3 border border-line text-xs">
                        <div className="font-bold text-content mb-1 flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                          <span>The Solution</span>
                        </div>
                        <p className="text-content-faint leading-relaxed">
                          {idea.solution}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Concept Sketch Thumbnail / Attachment */}
                <div className="my-3 space-y-2" onClick={e => e.stopPropagation()}>
                  {idea.sketchDataUrl ? (
                    <div className="relative group rounded-2xl overflow-hidden border border-line bg-surface-inverse p-2">
                      <img
                        src={idea.sketchDataUrl}
                        alt="Idea sketch wireframe"
                        className="max-h-48 w-full object-contain rounded-xl"
                      />
                      <div className="absolute inset-0 bg-black/70 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSketchModalIdeaId(idea.id)}
                          className="px-3.5 py-1.5 rounded-xl bg-white text-black text-xs font-bold shadow-md hover:bg-slate-200"
                        >
                          Edit Sketch
                        </button>
                        <button
                          type="button"
                          onClick={() => updateIdea(idea.id, { sketchDataUrl: undefined })}
                          className="px-3.5 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold shadow-md hover:bg-rose-500"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSketchModalIdeaId(idea.id)}
                      className="w-full py-2.5 px-4 rounded-2xl border border-dashed border-line hover:border-amber-500/60 bg-surface-3/50 hover:bg-amber-500/5 text-content-faint hover:text-amber-300 text-xs font-bold flex items-center justify-center gap-2 transition-all"
                    >
                      <Pencil className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>Draw Wireframe Sketch</span>
                    </button>
                  )}

                </div>

                {/* MVP Scoped Features */}
                <div className="space-y-2 pt-2" onClick={e => e.stopPropagation()}>
                  <div className="text-xs font-black text-content-muted flex items-center gap-1.5">
                    <CheckSquare className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>MVP Feature Scope ({idea.mvpFeatures?.length || 0})</span>
                  </div>

                  <div className="space-y-1.5">
                    {idea.mvpFeatures?.map((feat, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-xs bg-surface-3 border border-line px-3 py-2 rounded-xl text-content-muted group"
                      >
                        <span className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                          <span>{feat}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveMvpFeature(idea.id, idx)}
                          className="text-content-faint hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add MVP feature inline */}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      placeholder="+ Add MVP feature..."
                      value={featureInput}
                      onChange={e => setNewMvpFeature({ ...newMvpFeature, [idea.id]: e.target.value })}
                      onKeyDown={e => e.key === 'Enter' && handleAddMvpFeature(idea.id)}
                      className="flex-1 px-3 py-1.5 text-xs bg-surface-3 border border-line rounded-xl text-content placeholder-slate-500 outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddMvpFeature(idea.id)}
                      disabled={!featureInput.trim()}
                      className="px-3 py-1.5 bg-surface-3 hover:bg-surface-3 text-content rounded-xl text-xs font-bold disabled:opacity-30 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Target Audience & Monetization */}
                {(idea.targetAudience || idea.monetization) && (
                  <div className="flex flex-wrap items-center gap-2 pt-2 text-[13px] text-content-faint">
                    {idea.targetAudience && (
                      <span className="px-2.5 py-0.5 rounded-md bg-surface-3 border border-line-strong/60 font-mono">
                        Audience: {idea.targetAudience}
                      </span>
                    )}
                    {idea.monetization && (
                      <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-500/20 font-mono">
                        {idea.monetization}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Card Footer: Status Update & 1-Click Promote to Active Project */}
              <div className="pt-3 border-t border-line flex flex-wrap items-center justify-between gap-3" onClick={e => e.stopPropagation()}>
                <select
                  value={idea.status}
                  onChange={e => updateIdea(idea.id, { status: e.target.value as IdeaStatus })}
                  className="text-xs bg-surface-3 text-content rounded-xl px-3 py-1.5 border border-line-strong font-bold outline-none cursor-pointer"
                >
                  <option value="spark">Raw Spark</option>
                  <option value="evaluating">Evaluating</option>
                  <option value="validated">Validated</option>
                  <option value="converted">Converted</option>
                  <option value="archived">Archived</option>
                </select>

                {idea.status === 'converted' && idea.convertedProjectId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProjectId(idea.convertedProjectId);
                      setCurrentView('projects');
                    }}
                    className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-300"
                  >
                    <span>View Project →</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleConvert(idea.id)}
                    disabled={convertingIdeaId !== null}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-900/30 border border-indigo-500/30 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-wait"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>{convertingIdeaId === idea.id ? 'Launching…' : 'Launch as Project'}</span>
                  </button>
                )}
                {conversionError && conversionErrorIdeaId === idea.id && convertingIdeaId === null && (
                  <p className="w-full text-right text-xs text-rose-700 dark:text-rose-300" role="alert">{conversionError}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* SKETCH CANVAS MODAL */}
      {sketchModalIdeaId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-4xl max-h-[95vh] overflow-y-auto">
            <SketchCanvas
              initialDataUrl={ideas.find(i => i.id === sketchModalIdeaId)?.sketchDataUrl}
              initialObjects={ideas.find(i => i.id === sketchModalIdeaId)?.sketchObjects}
              seed={ideas.find(i => i.id === sketchModalIdeaId)}
              id={sketchModalIdeaId}
              onSave={handleSaveSketch}
              onClose={() => setSketchModalIdeaId(null)}
            />
          </div>
        </div>
      )}

    </div>
  );
};
