import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrapPaginated } from '../services/api';
import { ideaCategoriesKey } from '../services/queryClient';
import type { IdeaCategory } from '../types';

function mapFromApi(category: any): IdeaCategory {
  return {
    id: String(category.id),
    name: String(category.name),
    order: category.order ?? 0,
    ideaCount: category.idea_count ?? 0,
  };
}

async function fetchCategories(): Promise<IdeaCategory[]> {
  const response = await api.get('/idea-categories/');
  return unwrapPaginated<any>(response.data).map(mapFromApi);
}

export function useIdeaCategories() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ideaCategoriesKey, queryFn: fetchCategories });

  return {
    categories: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refresh: () => queryClient.invalidateQueries({ queryKey: ideaCategoriesKey }),
  };
}
