import { create } from 'zustand';
import type { DownloadJob } from '../../../shared/types';

interface DownloadsState {
  jobs: DownloadJob[];
  refresh: () => Promise<void>;
  applyUpdate: (job: DownloadJob) => void;
}

export const useDownloadsStore = create<DownloadsState>((set, get) => ({
  jobs: [],

  async refresh() {
    const jobs = await window.fmusic.listDownloads();
    set({ jobs });
  },

  applyUpdate(job) {
    const { jobs } = get();
    const idx = jobs.findIndex((j) => j.id === job.id);
    if (idx < 0) {
      set({ jobs: [job, ...jobs] });
    } else {
      const next = [...jobs];
      next[idx] = job;
      set({ jobs: next });
    }
  }
}));
