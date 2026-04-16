import { useMemo } from 'react';
import { translate, type Locale } from '../../shared/i18n';
import type { Playlist } from '../../shared/types';
import { useSettingsStore } from './store/settings';

export type Translator = (key: string, params?: Record<string, string | number>) => string;

/**
 * Subscribes the component to the current app locale and returns a `t()`
 * function. Falls back to English until settings are loaded.
 */
export function useT(): Translator {
  const locale = useSettingsStore((s) => (s.settings?.language ?? 'en') as Locale);
  return useMemo<Translator>(
    () => (key, params) => translate(locale, key, params),
    [locale]
  );
}

/**
 * Resolve the user-visible name for a playlist. Built-in playlists use their
 * stable slug and are translated at render time; user-created playlists keep
 * their stored name.
 */
export function playlistDisplayName(
  playlist: Pick<Playlist, 'name' | 'slug'>,
  t: Translator
): string {
  if (playlist.slug) return t(`playlists.builtins.${playlist.slug}`);
  return playlist.name;
}

export { translate } from '../../shared/i18n';
export type { Locale } from '../../shared/i18n';
