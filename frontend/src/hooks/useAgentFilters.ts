import { useCallback, useEffect, useState } from 'react';
import { api, unwrapPaginated } from '../services/api';
import type { AgentFilter } from '../types';

let cache: AgentFilter[] | null = null;

function mapFromApi(f: any): AgentFilter {
  return {
    id: String(f.id),
    name: f.name,
    slug: f.slug,
    order: f.order ?? 0,
  };
}

export function useAgentFilters() {
  const [filters, setFilters] = useState<AgentFilter[]>(cache || []);
  const [isLoading, setIsLoading] = useState<boolean>(!cache);

  const load = useCallback(async (force: boolean) => {
    if (!force && cache) {
      setFilters(cache);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await api.get('/agent-filters/');
      const mapped = unwrapPaginated<any>(res.data).map(mapFromApi);
      cache = mapped;
      setFilters(mapped);
    } catch (e) {
      console.error('Failed to load agent filters', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { filters, isLoading, refresh };
}
