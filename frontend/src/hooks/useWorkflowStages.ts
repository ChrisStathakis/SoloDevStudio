import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { workflowStagesKey } from '../services/queryClient';
import { STAGE_CONFIG, mapWorkflowStageFromApi, type WorkflowStage } from '../types';

function fallbackStages(): WorkflowStage[] {
  return Object.entries(STAGE_CONFIG).map(([key, cfg], idx) => ({
    id: key,
    key,
    label: cfg.label,
    description: cfg.description,
    color: '#6366f1',
    order: cfg.order ?? idx + 1,
    isActive: true,
    isBuiltin: true,
    builtinKey: key,
  }));
}

async function fetchStages(): Promise<WorkflowStage[]> {
  const res = await api.get('/settings/stages/');
  const rows = Array.isArray(res.data) ? res.data : (res.data?.stages || []);
  const mapped = rows.map(mapWorkflowStageFromApi);
  mapped.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  return mapped;
}

export function useWorkflowStages() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: workflowStagesKey, queryFn: fetchStages });

  const stages = useMemo(() => {
    if (query.data && query.data.length > 0) return query.data;
    if (query.data && query.data.length === 0) return fallbackStages();
    return fallbackStages();
  }, [query.data]);

  const activeStages = useMemo(() => stages.filter(s => s.isActive), [stages]);
  const byKey = useMemo(() => new Map(stages.map(s => [s.key, s])), [stages]);

  const labelFor = (key: string): string => byKey.get(key)?.label || STAGE_CONFIG[key]?.label || key;
  const orderFor = (key: string): number => byKey.get(key)?.order ?? STAGE_CONFIG[key]?.order ?? 999;

  return {
    stages,
    activeStages,
    byKey,
    labelFor,
    orderFor,
    isLoading: query.isLoading,
    isError: query.isError,
    isCustomized: (query.data || []).some(s => !s.isBuiltin || !s.isActive),
    refresh: () => queryClient.invalidateQueries({ queryKey: workflowStagesKey }),
  };
}
