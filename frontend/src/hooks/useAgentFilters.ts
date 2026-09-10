import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrapPaginated } from '../services/api';
import { agentFiltersKey } from '../services/queryClient';
import type { AgentFilter } from '../types';

function mapFromApi(f: any): AgentFilter {
  return {
    id: String(f.id),
    name: f.name,
    slug: f.slug,
    order: f.order ?? 0,
  };
}

async function fetchFilters(): Promise<AgentFilter[]> {
  const res = await api.get('/agent-filters/');
  return unwrapPaginated<any>(res.data).map(mapFromApi);
}

export function useAgentFilters() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: agentFiltersKey, queryFn: fetchFilters });

  return {
    filters: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refresh: () => queryClient.invalidateQueries({ queryKey: agentFiltersKey }),
  };
}
