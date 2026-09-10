import React from 'react';

interface Props {
  errors: Record<string, string>;
  onDismiss: (field: string) => void;
  onDismissAll: () => void;
}

export const ProjectRuntimeErrors: React.FC<Props> = ({ errors, onDismiss, onDismissAll }) => {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2" role="alert" aria-label="Project action errors">
      {entries.map(([field, msg]) => (
        <div key={field} className="flex items-start justify-between gap-3 px-3.5 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs font-bold text-rose-700 dark:text-rose-300">
          <span><span className="uppercase tracking-wider opacity-70">[{field}]</span> {msg}</span>
          <button type="button" onClick={() => onDismiss(field)} className="shrink-0 rounded-lg px-1.5 text-rose-700 dark:text-rose-300 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400" aria-label={`Dismiss ${field} error`}>×</button>
        </div>
      ))}
      {entries.length > 1 && (
        <div className="text-right">
          <button type="button" onClick={onDismissAll} className="text-[11px] font-bold text-content-faint hover:text-content underline underline-offset-2">Dismiss all</button>
        </div>
      )}
    </div>
  );
};
