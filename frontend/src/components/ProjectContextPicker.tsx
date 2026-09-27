import React from 'react';
import { STAGE_CONFIG, type ProjectStage } from '../types';
import { CONTEXT_SECTIONS, type ContextSection } from '../services/projectContext';

export interface ContextSelectionValue {
  stages: string[];
  sections: ContextSection[];
}

const SECTION_LABELS: Record<ContextSection, string> = {
  brief: 'Project brief',
  checklists: 'Checklists',
  tasks: 'Tasks',
  blockers: 'Blockers',
  notes: 'Stage notes',
  skills: 'Active skills',
  git: 'Git status',
};

const ALL_STAGES = Object.keys(STAGE_CONFIG) as ProjectStage[];

export const ProjectContextPicker: React.FC<{
  currentStage: ProjectStage;
  value: ContextSelectionValue;
  onChange: (next: ContextSelectionValue) => void;
  compact?: boolean;
}> = ({ currentStage, value, onChange, compact }) => {
  const toggleStage = (stage: string) => {
    const next = value.stages.includes(stage)
      ? value.stages.filter(s => s !== stage)
      : [...value.stages, stage];
    onChange({ ...value, stages: ALL_STAGES.filter(s => next.includes(s)) });
  };
  const toggleSection = (section: ContextSection) => {
    const next = value.sections.includes(section)
      ? value.sections.filter(s => s !== section)
      : [...value.sections, section];
    onChange({ ...value, sections: CONTEXT_SECTIONS.filter(s => next.includes(s)) });
  };
  const chip = 'px-2 py-1 rounded-lg border text-[11px] font-bold transition-colors';

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-black uppercase tracking-wider text-content-faint font-mono">Phases</span>
          <span className="flex gap-1">
            <button
              type="button"
              onClick={() => onChange({ ...value, stages: [currentStage] })}
              className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Current only
            </button>
            <span className="text-content-faint">·</span>
            <button
              type="button"
              onClick={() => onChange({ ...value, stages: [...ALL_STAGES] })}
              className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              All
            </button>
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ALL_STAGES.map(stage => {
            const active = value.stages.includes(stage);
            return (
              <button
                key={stage}
                type="button"
                onClick={() => toggleStage(stage)}
                aria-pressed={active}
                title={STAGE_CONFIG[stage].description}
                className={`${chip} font-mono ${active
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-surface-2 border-line text-content-faint hover:text-content'}`}
              >
                {STAGE_CONFIG[stage].label}{stage === currentStage ? ' · current' : ''}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div className="text-[11px] font-black uppercase tracking-wider text-content-faint font-mono mb-1.5">
          Info to pass
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CONTEXT_SECTIONS.map(section => {
            const active = value.sections.includes(section);
            return (
              <button
                key={section}
                type="button"
                onClick={() => toggleSection(section)}
                aria-pressed={active}
                className={`${chip} ${active
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-surface-2 border-line text-content-faint hover:text-content'}`}
              >
                {SECTION_LABELS[section]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
