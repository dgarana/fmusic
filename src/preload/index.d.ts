import type { FmusicAPI } from './index';

declare global {
  interface Window {
    fmusic: FmusicAPI;
  }
}

export {};
