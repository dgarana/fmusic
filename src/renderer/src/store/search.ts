import { create } from 'zustand';
import type { SearchResult } from '../../../shared/types';

const PAGE_SIZE = 12;

interface SearchState {
  /** Current query text (survives navigation). */
  query: string;
  /** Latest results (survives navigation). */
  results: SearchResult[];
  /** How many results were requested for the current results set. */
  resultLimit: number;
  /** Transient error from the last search. */
  error: string | null;
  setQuery: (value: string) => void;
  setResults: (results: SearchResult[], limit: number) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  results: [],
  resultLimit: PAGE_SIZE,
  error: null,
  setQuery: (value) => set({ query: value }),
  setResults: (results, limit) => set({ results, resultLimit: limit }),
  setError: (error) => set({ error }),
  clear: () => set({ query: '', results: [], error: null, resultLimit: PAGE_SIZE })
}));

export { PAGE_SIZE };
