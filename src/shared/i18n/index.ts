// Shared translation registry used by main + renderer.
//
// Adding a new language:
//   1. Copy `en.json` to `xx.json` (e.g. `fr.json`) and translate the values.
//   2. Register it below in `bundles` (and add the code to the `Locale` union in
//      `src/shared/types.ts`).
//
// Translations support simple {placeholder} interpolation. Missing keys fall
// back to English, and if the English key is missing too the raw dot-key is
// returned (so it's easy to spot bugs during development).
import type { Locale } from '../types.js';
import en from './en.json';
import es from './es.json';

type TranslationTree = { [key: string]: string | TranslationTree };

const bundles: Record<Locale, TranslationTree> = {
  en: en as TranslationTree,
  es: es as TranslationTree
};

export const supportedLocales: ReadonlyArray<{ code: Locale; name: string; flag: string }> = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Español', flag: '🇪🇸' }
];

function lookup(tree: TranslationTree, key: string): string | null {
  const parts = key.split('.');
  let node: string | TranslationTree = tree;
  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return null;
    const next: string | TranslationTree | undefined = node[part];
    if (next === undefined) return null;
    node = next;
  }
  return typeof node === 'string' ? node : null;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : `{${name}}`
  );
}

/**
 * Translate a dot-keyed message for the given locale. Falls back to English
 * when the key is missing in the requested locale, and to the raw key when it
 * is missing in English too.
 */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>
): string {
  const preferred = bundles[locale] ?? bundles.en;
  const raw = lookup(preferred, key) ?? lookup(bundles.en, key);
  if (raw === null) return key;
  return interpolate(raw, params);
}

export type { Locale } from '../types.js';
