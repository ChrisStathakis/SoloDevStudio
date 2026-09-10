import { ProjectStage, STAGE_CONFIG } from '../types';
import { useMemo } from 'react';

export function useProjectStats(
  projectId: string | null,
  tasks: { projectId: string; stage: ProjectStage; completed: boolean; timeSpentMinutes: number }[],
  timeEntries: { projectId: string; durationSeconds: number }[]
) {
  return useMemo(() => {
    if (!projectId) return { total: 0, done: 0, progressPct: 0, hours: 0 };
    const projTasks = tasks.filter(t => t.projectId === projectId);
    const done = projTasks.filter(t => t.completed).length;
    const total = projTasks.length;
    const progressPct = total === 0 ? 0 : Math.round((done / total) * 100);
    const hours = timeEntries.filter(e => e.projectId === projectId).reduce((s, e) => s + e.durationSeconds, 0) / 3600;
    return { total, done, progressPct, hours };
  }, [projectId, tasks, timeEntries]);
}

export function stageOrder(stage: ProjectStage): number {
  return STAGE_CONFIG[stage].order;
}
