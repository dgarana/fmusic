import { translate, type Locale } from '../shared/i18n/index.js';
import { getSettings } from './settings.js';

/**
 * Main-process translator. Reads the current language from electron-store on
 * every call so it stays in sync with user changes without needing a dedicated
 * event bus.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const locale = (getSettings().language ?? 'en') as Locale;
  return translate(locale, key, params);
}
