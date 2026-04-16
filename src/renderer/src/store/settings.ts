import { create } from 'zustand';
import type { AppSettings } from '../../../shared/types';

interface SettingsState {
  settings: AppSettings | null;
  load: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,

  async load() {
    const s = await window.fmusic.getSettings();
    set({ settings: s });
  },

  async update(patch) {
    const s = await window.fmusic.updateSettings(patch);
    set({ settings: s });
  }
}));
