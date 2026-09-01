import { useCallback, useEffect, useState } from 'react';
import { api, unwrapPaginated } from '../services/api';
import type { IdeaCategory } from '../types';

let cache: IdeaCategory[] | null = null;
const listeners = new Set<(categories: IdeaCategory[]) => void>();

function publish(categories: IdeaCategory[]) {
  cache = categories;
  listeners.forEach(listener => listener(categories));
}

function mapFromApi(category: any): IdeaCategory {
  return {
    id: String(category.id),
    name: String(category.name),
    order: category.order ?? 0,
    ideaCount: category.idea_count ?? 0,
  };
}

export function useIdeaCategories() {
  const [categories, setCategories] = useState<IdeaCategory[]>(cache || []);
  const [isLoading, setIsLoading] = useState(!cache);

  const load = useCallback(async (force: boolean) => {
    if (!force && cache) {
      setCategories(cache);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const response = await api.get('/idea-categories/');
      const next = unwrapPaginated<any>(response.data).map(mapFromApi);
      publish(next);
    } catch (error) {
      console.error('Failed to load idea categories', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const listener = (next: IdeaCategory[]) => setCategories(next);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => { void load(false); }, [load]);
  const refresh = useCallback(() => load(true), [load]);
  return { categories, isLoading, refresh };
}
