import { api } from './api';
import type { MarketResearchResult, TechResearchResult, GroundingSource } from '../types';

export interface MarketResearchInput {
  title: string;
  tagline?: string;
  problem?: string;
  solution?: string;
  category?: string;
}

export interface TechResearchInput {
  title: string;
  category?: string;
  description?: string;
  currentTechStack?: string[];
}

interface SearchEnvelope<T> {
  data: T;
  sources: GroundingSource[];
  searchQueries: string[];
}

/** Django-backed research (works in browser + desktop loopback). No API key needed. */
export async function fetchMarketResearch(input: MarketResearchInput): Promise<MarketResearchResult> {
  const res = await api.post<SearchEnvelope<MarketResearchResult>>('/search/market/', input);
  return res.data.data;
}

export async function fetchTechResearch(input: TechResearchInput): Promise<TechResearchResult> {
  const res = await api.post<SearchEnvelope<TechResearchResult>>('/search/tech-stack/', input);
  return res.data.data;
}
