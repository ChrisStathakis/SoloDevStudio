import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { ProjectStage, Project, STAGE_CONFIG } from '../types';

interface Props {
  project: Project;
  onAdvance: (stage: ProjectStage) => void;
}

export const ProjectStageStepper: React.FC<Props> = ({ project, onAdvance }) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5" role="group" aria-label="Project lifecycle stages">
      {(Object.keys(STAGE_CONFIG) as ProjectStage[]).map(stg => {
        const cfg = STAGE_CONFIG[stg];
        const isCurrent = project.currentStage === stg;
        const isCompleted = cfg.order < STAGE_CONFIG[project.currentStage].order;

        return (
          <button
            key={stg}
            type="button"
            onClick={() => { if (!isCurrent) onAdvance(stg); }}
            disabled={isCurrent}
            aria-current={isCurrent ? 'step' : undefined}
            title={isCurrent ? `Current stage: ${cfg.label}` : `Move to ${cfg.label}`}
            className={`p-3 rounded-2xl border text-left transition-all relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              isCurrent
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 ring-1 ring-indigo-500 shadow-md cursor-default'
                : isCompleted
                ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 hover:border-emerald-700'
                : 'border-line bg-surface-2 hover:bg-surface-3 text-content-faint'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-mono font-bold uppercase text-content-faint">
                Stage {cfg.order}
              </span>
              {isCompleted && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
              {isCurrent && <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />}
            </div>
            <div className={`text-xs font-black ${isCurrent ? 'text-content' : ''}`}>
              {cfg.label}
            </div>
            <p className="text-[12px] text-content-faint line-clamp-2 mt-1 leading-tight">
              {cfg.description}
            </p>
          </button>
        );
      })}
    </div>
  );
};
