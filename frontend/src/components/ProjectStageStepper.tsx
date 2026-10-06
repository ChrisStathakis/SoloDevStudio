import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Project } from '../types';
import { useWorkflowStages } from '../hooks/useWorkflowStages';

interface Props {
  project: Project;
  onAdvance: (stage: string) => void;
}

export const ProjectStageStepper: React.FC<Props> = ({ project, onAdvance }) => {
  const { activeStages, orderFor } = useWorkflowStages();
  const currentOrder = orderFor(project.currentStage);
  const many = activeStages.length > 7;

  return (
    <div
      className={many ? 'grid gap-2.5 grid-cols-2 sm:grid-cols-4' : 'grid gap-2.5 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7'}
      role="group"
      aria-label="Project lifecycle stages"
      style={many ? { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' } : undefined}
    >
      {activeStages.map(stg => {
        const isCurrent = project.currentStage === stg.key;
        const isCompleted = stg.order < currentOrder;

        return (
          <button
            key={stg.key}
            type="button"
            onClick={() => { if (!isCurrent) onAdvance(stg.key); }}
            disabled={isCurrent}
            aria-current={isCurrent ? 'step' : undefined}
            title={isCurrent ? `Current stage: ${stg.label}` : `Move to ${stg.label}`}
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
                Stage {stg.order}
              </span>
              {isCompleted && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
              {isCurrent && <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />}
            </div>
            <div className={`text-xs font-black ${isCurrent ? 'text-content' : ''}`}>
              {stg.label}
            </div>
            <p className="text-[12px] text-content-faint line-clamp-2 mt-1 leading-tight">
              {stg.description}
            </p>
          </button>
        );
      })}
    </div>
  );
};
