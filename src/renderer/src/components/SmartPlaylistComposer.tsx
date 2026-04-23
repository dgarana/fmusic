import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type {
  SmartPlaylistDefinition,
  SmartPlaylistField,
  SmartPlaylistMatchMode,
  SmartPlaylistOperator,
  SmartPlaylistRule,
  Track,
  TrackMetadataSuggestions
} from '../../../shared/types';
import { useT } from '../i18n';

interface SmartPlaylistComposerProps {
  onClose: () => void;
  onCreated?: (playlistId: number) => void;
  onSaved?: (playlistId: number) => void;
  playlistId?: number;
  initialName?: string;
  initialDefinition?: SmartPlaylistDefinition | null;
}

type ComposerStep = 'field' | 'operator' | 'value';

interface FieldOption {
  field: SmartPlaylistField;
  labelKey: string;
  operators: SmartPlaylistOperator[];
}

interface OperatorOption {
  operator: SmartPlaylistOperator;
  labelKey: string;
}

type Suggestion =
  | { kind: 'field'; label: string; field: SmartPlaylistField }
  | { kind: 'operator'; label: string; operator: SmartPlaylistOperator }
  | { kind: 'value'; label: string; value: string }
  | { kind: 'action'; label: string; action: 'commit-text' | 'commit-list-value' | 'commit-list-rule' };

const FIELD_OPTIONS: FieldOption[] = [
  { field: 'title', labelKey: 'playlists.smart.fields.title', operators: ['contains', 'is', 'isAnyOf'] },
  { field: 'artist', labelKey: 'playlists.smart.fields.artist', operators: ['contains', 'is', 'isAnyOf'] },
  { field: 'album', labelKey: 'playlists.smart.fields.album', operators: ['contains', 'is', 'isAnyOf'] },
  { field: 'genre', labelKey: 'playlists.smart.fields.genre', operators: ['contains', 'is', 'isAnyOf'] }
];

const OPERATOR_OPTIONS: OperatorOption[] = [
  { operator: 'contains', labelKey: 'playlists.smart.operators.contains' },
  { operator: 'is', labelKey: 'playlists.smart.operators.is' },
  { operator: 'isAnyOf', labelKey: 'playlists.smart.operators.isAnyOf' }
];

let nextRuleId = 1;

function createRuleId(): string {
  const id = `smart-rule-${nextRuleId}`;
  nextRuleId += 1;
  return id;
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function formatRuleValue(rule: SmartPlaylistRule): string {
  if (rule.value.kind === 'text') return rule.value.value;
  if (rule.value.kind === 'text-list') return rule.value.values.join(', ');
  if (rule.value.kind === 'number') return String(rule.value.value);
  if (rule.value.kind === 'number-range') return `${rule.value.min} - ${rule.value.max}`;
  return String(rule.value.value);
}

function getTrackTextValue(track: Track, field: SmartPlaylistField): string | null {
  if (field === 'title') return track.title;
  if (field === 'artist') return track.artist;
  if (field === 'album') return track.album;
  if (field === 'genre') return track.genre;
  return null;
}

function matchesRule(track: Track, rule: SmartPlaylistRule): boolean {
  const rawValue = getTrackTextValue(track, rule.field);
  const value = rawValue ? normalizeText(rawValue) : '';

  if (rule.operator === 'contains' && rule.value.kind === 'text') {
    return value.includes(normalizeText(rule.value.value));
  }
  if (rule.operator === 'is' && rule.value.kind === 'text') {
    return value === normalizeText(rule.value.value);
  }
  if (rule.operator === 'isAnyOf' && rule.value.kind === 'text-list') {
    return rule.value.values.some((item) => normalizeText(item) === value);
  }
  return false;
}

function filterPreviewTracks(
  tracks: Track[],
  rules: SmartPlaylistRule[],
  match: SmartPlaylistMatchMode
): Track[] {
  if (rules.length === 0) return [];
  return tracks.filter((track) =>
    match === 'all' ? rules.every((rule) => matchesRule(track, rule)) : rules.some((rule) => matchesRule(track, rule))
  );
}

export function SmartPlaylistComposer({
  onClose,
  onCreated,
  onSaved,
  playlistId,
  initialName = '',
  initialDefinition = null
}: SmartPlaylistComposerProps) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [match, setMatch] = useState<SmartPlaylistMatchMode>(initialDefinition?.match ?? 'all');
  const [rules, setRules] = useState<SmartPlaylistRule[]>(initialDefinition?.rules ?? []);
  const [step, setStep] = useState<ComposerStep>('field');
  const [query, setQuery] = useState('');
  const [selectedField, setSelectedField] = useState<SmartPlaylistField | null>(null);
  const [selectedOperator, setSelectedOperator] = useState<SmartPlaylistOperator | null>(null);
  const [pendingListValues, setPendingListValues] = useState<string[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [metadataSuggestions, setMetadataSuggestions] = useState<TrackMetadataSuggestions>({
    artists: [],
    albums: [],
    genres: []
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.fmusic.listTracks({ sortBy: 'title', sortDir: 'asc', limit: 10_000 }),
      window.fmusic.trackMetadataSuggestions()
    ]).then(([tracks, suggestions]) => {
      if (cancelled) return;
      setAllTracks(tracks);
      setMetadataSuggestions(suggestions);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetToken() {
    setStep('field');
    setQuery('');
    setSelectedField(null);
    setSelectedOperator(null);
    setPendingListValues([]);
    setHighlightedIndex(0);
  }

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const playlist = playlistId
        ? await window.fmusic.updateSmartPlaylist(playlistId, name.trim(), definition)
        : await window.fmusic.createSmartPlaylist(name.trim(), definition);
      if (!playlist) {
        throw new Error('Playlist not found.');
      }
      if (playlistId) onSaved?.(playlist.id);
      else onCreated?.(playlist.id);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function commitRule(value: string) {
    if (!selectedField || !selectedOperator) return;
    const trimmed = value.trim();
    let nextRule: SmartPlaylistRule | null = null;
    if (selectedOperator === 'isAnyOf') {
      nextRule = {
        id: createRuleId(),
        field: selectedField,
        operator: selectedOperator,
        value: { kind: 'text-list', values: [...pendingListValues, ...(trimmed ? [trimmed] : [])] }
      };
    } else if (trimmed) {
      nextRule = {
        id: createRuleId(),
        field: selectedField,
        operator: selectedOperator,
        value: { kind: 'text', value: trimmed }
      };
    }
    if (!nextRule) return;
    if (nextRule.value.kind === 'text-list' && nextRule.value.values.length === 0) return;
    setRules((prev) => [...prev, nextRule]);
    resetToken();
  }

  function commitPendingListValue(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setPendingListValues((prev) =>
      prev.some((item) => normalizeText(item) === normalizeText(trimmed)) ? prev : [...prev, trimmed]
    );
    setQuery('');
    setHighlightedIndex(0);
  }

  function removeRule(ruleId: string) {
    setRules((prev) => prev.filter((rule) => rule.id !== ruleId));
  }

  const visibleSuggestions = useMemo<Suggestion[]>(() => {
    const needle = normalizeText(query);

    if (step === 'field') {
      return FIELD_OPTIONS
        .map((option) => ({ kind: 'field' as const, label: t(option.labelKey), field: option.field }))
        .filter((option) => !needle || normalizeText(option.label).includes(needle));
    }

    if (step === 'operator' && selectedField) {
      const operators = FIELD_OPTIONS.find((option) => option.field === selectedField)?.operators ?? [];
      return operators
        .map((operator) => {
          const option = OPERATOR_OPTIONS.find((item) => item.operator === operator)!;
          return { kind: 'operator' as const, label: t(option.labelKey), operator };
        })
        .filter((option) => !needle || normalizeText(option.label).includes(needle));
    }

    if (step === 'value' && selectedField && selectedOperator) {
      const distinctValues =
        selectedField === 'artist'
          ? metadataSuggestions.artists
          : selectedField === 'album'
            ? metadataSuggestions.albums
            : selectedField === 'genre'
              ? metadataSuggestions.genres
              : [];
      const suggestions = distinctValues
        .filter((item) => !needle || normalizeText(item).includes(needle))
        .filter((item) => !pendingListValues.some((pending) => normalizeText(pending) === normalizeText(item)))
        .slice(0, 8)
        .map((item) => ({ kind: 'value' as const, label: item, value: item }));

      if (selectedOperator === 'isAnyOf') {
        const actions: Suggestion[] = [];
        if (query.trim()) {
          actions.push({
            kind: 'action',
            label: t('playlists.smart.actions.addValue', { value: query.trim() }),
            action: 'commit-list-value'
          });
        }
        if (pendingListValues.length > 0) {
          actions.push({
            kind: 'action',
            label: t('playlists.smart.actions.finishList', { count: pendingListValues.length }),
            action: 'commit-list-rule'
          });
        }
        return [...suggestions, ...actions];
      }

      if (query.trim()) {
        return [
          ...suggestions,
          {
            kind: 'action',
            label: t('playlists.smart.actions.useValue', { value: query.trim() }),
            action: 'commit-text'
          }
        ];
      }

      return suggestions;
    }

    return [];
  }, [metadataSuggestions, pendingListValues, query, selectedField, selectedOperator, step, t]);

  useEffect(() => {
    setHighlightedIndex((current) =>
      visibleSuggestions.length === 0 ? 0 : Math.min(current, visibleSuggestions.length - 1)
    );
  }, [visibleSuggestions]);

  const previewTracks = useMemo(
    () => filterPreviewTracks(allTracks, rules, match),
    [allTracks, match, rules]
  );

  const currentFieldLabel = selectedField
    ? t(FIELD_OPTIONS.find((option) => option.field === selectedField)?.labelKey ?? 'playlists.smart.fields.title')
    : '';
  const currentOperatorLabel = selectedOperator
    ? t(
        OPERATOR_OPTIONS.find((option) => option.operator === selectedOperator)?.labelKey ??
          'playlists.smart.operators.contains'
      )
    : '';

  const inputPlaceholder =
    step === 'field'
      ? t('playlists.smart.hints.field')
      : step === 'operator'
        ? t('playlists.smart.hints.operator', { field: currentFieldLabel })
        : selectedOperator === 'isAnyOf'
          ? t('playlists.smart.hints.valueList')
          : t('playlists.smart.hints.value', { field: currentFieldLabel });

  function applySuggestion(suggestion: Suggestion) {
    if (suggestion.kind === 'field') {
      setSelectedField(suggestion.field);
      setStep('operator');
      setQuery('');
      setHighlightedIndex(0);
      return;
    }
    if (suggestion.kind === 'operator') {
      setSelectedOperator(suggestion.operator);
      setStep('value');
      setQuery('');
      setHighlightedIndex(0);
      return;
    }
    if (suggestion.kind === 'value') {
      if (selectedOperator === 'isAnyOf') commitPendingListValue(suggestion.value);
      else commitRule(suggestion.value);
      return;
    }
    if (suggestion.action === 'commit-text') {
      commitRule(query);
      return;
    }
    if (suggestion.action === 'commit-list-value') {
      commitPendingListValue(query);
      return;
    }
    commitRule('');
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((current) =>
        visibleSuggestions.length === 0 ? 0 : Math.min(current + 1, visibleSuggestions.length - 1)
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const suggestion = visibleSuggestions[highlightedIndex];
      if (suggestion) applySuggestion(suggestion);
      return;
    }
    if (event.key === 'Backspace' && !query) {
      if (step === 'value' && selectedOperator === 'isAnyOf' && pendingListValues.length > 0) {
        event.preventDefault();
        setPendingListValues((prev) => prev.slice(0, -1));
        return;
      }
      if (step === 'value') {
        event.preventDefault();
        setStep('operator');
        setSelectedOperator(null);
        return;
      }
      if (step === 'operator') {
        event.preventDefault();
        setStep('field');
        setSelectedField(null);
        return;
      }
      if (rules.length > 0) {
        event.preventDefault();
        removeRule(rules[rules.length - 1].id);
      }
    }
  }

  const definition: SmartPlaylistDefinition = { match, rules };
  const canSave = name.trim().length > 0 && rules.length > 0;

  return (
    <div className="smart-playlist-panel">
      <div className="smart-playlist-header">
        <div>
          <h2>{t('playlists.smart.title')}</h2>
          <div className="smart-playlist-subtitle">{t('playlists.smart.subtitle')}</div>
        </div>
        <button onClick={onClose}>{t('common.cancel')}</button>
      </div>

      <div className="smart-playlist-grid">
        <div className="smart-playlist-builder">
          <label className="smart-playlist-label">
            <span>{t('playlists.smart.name')}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('playlists.smart.namePlaceholder')}
            />
          </label>

          <div className="smart-playlist-segmented" role="radiogroup" aria-label={t('playlists.smart.match')}>
            <button className={match === 'all' ? 'primary' : ''} onClick={() => setMatch('all')}>
              {t('playlists.smart.matchAll')}
            </button>
            <button className={match === 'any' ? 'primary' : ''} onClick={() => setMatch('any')}>
              {t('playlists.smart.matchAny')}
            </button>
          </div>

          <div className="smart-token-box">
            <div className="smart-chip-list">
              {rules.map((rule) => (
                <button
                  key={rule.id}
                  className="smart-rule-chip"
                  onClick={() => removeRule(rule.id)}
                  title={t('playlists.smart.removeRule')}
                >
                  <span>{t(`playlists.smart.fields.${rule.field}`)}</span>
                  <span>{t(`playlists.smart.operators.${rule.operator}`)}</span>
                  <span>{formatRuleValue(rule)}</span>
                  <span aria-hidden="true">x</span>
                </button>
              ))}
              {selectedField && (
                <span className="smart-draft-chip">
                  {currentFieldLabel}
                  {selectedOperator ? ` ${currentOperatorLabel}` : ''}
                </span>
              )}
              {pendingListValues.map((value) => (
                <span key={value} className="smart-value-chip">
                  {value}
                </span>
              ))}
              <input
                className="smart-token-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={inputPlaceholder}
              />
            </div>
          </div>

          <div className="smart-suggestion-list">
            {visibleSuggestions.length === 0 ? (
              <div className="smart-suggestion-empty">{t('playlists.smart.noSuggestions')}</div>
            ) : (
              visibleSuggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.kind}-${index}-${suggestion.label}`}
                  className={`smart-suggestion-item ${index === highlightedIndex ? 'active' : ''}`}
                  onClick={() => applySuggestion(suggestion)}
                >
                  {suggestion.label}
                </button>
              ))
            )}
          </div>

          <div className="smart-playlist-actions">
            <div className="smart-playlist-footnote">
              {saveError
                ? t('playlists.smart.saveError', { detail: saveError })
                : canSave
                  ? t('playlists.smart.readyToSave')
                  : t('playlists.smart.saveRequirements')}
            </div>
            <div className="smart-playlist-action-buttons">
              <button onClick={onClose}>{t('common.cancel')}</button>
              <button
                className="primary"
                disabled={!canSave || saving}
                onClick={() => void handleSave()}
              >
                {saving
                  ? t('common.loading')
                  : playlistId
                    ? t('playlists.smart.saveChanges')
                    : t('playlists.smart.save')}
              </button>
            </div>
          </div>
        </div>

        <div className="smart-playlist-preview">
          <div className="smart-preview-card">
            <div className="smart-preview-label">{t('playlists.smart.preview')}</div>
            <div className="smart-preview-count">{t('playlists.smart.previewCount', { count: previewTracks.length })}</div>
            <div className="smart-preview-name">{name.trim() || t('playlists.smart.untitled')}</div>
          </div>

          <div className="smart-preview-card">
            <div className="smart-preview-label">{t('playlists.smart.previewMatches')}</div>
            {previewTracks.length === 0 ? (
              <div className="smart-suggestion-empty">{t('playlists.smart.previewEmpty')}</div>
            ) : (
              <div className="smart-preview-list">
                {previewTracks.slice(0, 6).map((track) => (
                  <div key={track.id} className="smart-preview-row">
                    <div className="smart-preview-title">{track.title}</div>
                    <div className="smart-preview-meta">
                      {[track.artist, track.album, track.genre].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <details className="smart-preview-card">
            <summary>{t('playlists.smart.debugTitle')}</summary>
            <pre className="smart-preview-json">{JSON.stringify(definition, null, 2)}</pre>
          </details>
        </div>
      </div>
    </div>
  );
}
