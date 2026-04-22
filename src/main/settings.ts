import Store from 'electron-store';
import type { AppSettings } from '../shared/types.js';
import { defaultMusicDir } from './paths.js';

type Schema = {
  settings: AppSettings;
};

let store: Store<Schema> | null = null;

function getStore(): Store<Schema> {
  if (store) return store;
  store = new Store<Schema>({
    name: 'settings',
    defaults: {
      settings: {
        downloadDir: defaultMusicDir(),
        defaultFormat: 'mp3',
        defaultQuality: 192,
        concurrency: 1,
        theme: 'original',
        language: 'en',
        skipCertCheck: false,
        sonosKnownHosts: [],
        sonosEnabled: true,
        closeToTray: true,
        miniPlayerEnabled: true,
        mobileSyncEnabled: false,
        mobileSyncPort: 0,
        remoteControllerEnabled: false,
        remoteControllerPort: 0
      }
    }
  });
  return store;
}

export function getSettings(): AppSettings {
  return getStore().get('settings');
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const next: AppSettings = { ...current, ...partial };
  getStore().set('settings', next);
  return next;
}
