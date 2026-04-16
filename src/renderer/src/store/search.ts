import { create } from 'zustand';
import type { SearchResult } from '../../../shared/types';

interface SearchState {
  /** Current query text (survives navigation). */
  query: string;
  /** Latest results (survives navigation). */
  results: SearchResult[];
  /** Transient error from the last search. */
  error: string | null;
  setQuery: (value: string) => void;
  setResults: (results: SearchResult[]) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  results: [],
  error: null,
  setQuery: (value) => set({ query: value }),
  setResults: (results) => set({ results }),
  setError: (error) => set({ error }),
  clear: () => set({ query: '', results: [], error: null })
}));
