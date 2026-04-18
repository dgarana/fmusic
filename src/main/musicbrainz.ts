import { app } from 'electron';
import type { Track, TrackMetadataLookupResult } from '../shared/types.js';

const MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2';
const MIN_REQUEST_INTERVAL_MS = 1100;
const GENERIC_GENRE_VALUES = new Set(['music', 'unknown', 'other', 'misc', 'default']);
let lastRequestAt = 0;

interface MusicBrainzArtistCredit {
  name?: string;
  joinphrase?: string;
}

interface MusicBrainzRelease {
  id?: string;
  title?: string;
  status?: string;
  date?: string;
  'release-group'?: {
    id?: string;
    title?: string;
  };
}

interface MusicBrainzGenre {
  name?: string;
  count?: number;
}

interface MusicBrainzSearchRecording {
  id: string;
  score?: number | string;
  title?: string;
  'artist-credit'?: MusicBrainzArtistCredit[];
  releases?: MusicBrainzRelease[];
}

interface MusicBrainzSearchResponse {
  recordings?: MusicBrainzSearchRecording[];
}

interface MusicBrainzLookupResponse {
  id?: string;
  title?: string;
  'artist-credit'?: MusicBrainzArtistCredit[];
  releases?: MusicBrainzRelease[];
  genres?: MusicBrainzGenre[];
}

interface MusicBrainzArtistSearchResult {
  id: string;
  name?: string;
  score?: number | string;
}

interface MusicBrainzArtistSearchResponse {
  artists?: MusicBrainzArtistSearchResult[];
}

interface MusicBrainzArtistLookupResponse {
  genres?: MusicBrainzGenre[];
}

interface MusicBrainzReleaseLookupResponse {
  genres?: MusicBrainzGenre[];
  'release-group'?: {
    id?: string;
  };
}

interface MusicBrainzReleaseGroupLookupResponse {
  genres?: MusicBrainzGenre[];
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeQueryValue(value: string): string {
  return value.replace(/([\\"])/g, '\\$1');
}

function joinArtistCredits(credits: MusicBrainzArtistCredit[] | undefined): string | null {
  if (!credits || credits.length === 0) return null;
  const joined = credits
    .map((credit) => `${credit.name?.trim() ?? ''}${credit.joinphrase ?? ''}`.trim())
    .filter(Boolean)
    .join('');
  return joined || null;
}

function chooseAlbum(releases: MusicBrainzRelease[] | undefined): string | null {
  if (!releases || releases.length === 0) return null;
  const preferred =
    releases.find((release) => release.status?.toLowerCase() === 'official') ?? releases[0];
  return preferred?.title?.trim() || null;
}

function choosePreferredRelease(releases: MusicBrainzRelease[] | undefined): MusicBrainzRelease | null {
  if (!releases || releases.length === 0) return null;
  return releases.find((release) => release.status?.toLowerCase() === 'official') ?? releases[0];
}

function chooseGenre(genres: MusicBrainzGenre[] | undefined): string | null {
  if (!genres || genres.length === 0) return null;
  const sorted = [...genres].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  return sorted[0]?.name?.trim() || null;
}

function sanitizeFallbackGenre(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return GENERIC_GENRE_VALUES.has(normalizeText(trimmed)) ? null : trimmed;
}

function tokenizeNormalized(value: string | null | undefined): string[] {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

function overlapScore(left: string | null | undefined, right: string | null | undefined): number {
  const leftTokens = tokenizeNormalized(left);
  const rightTokens = tokenizeNormalized(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const rightSet = new Set(rightTokens);
  const intersection = leftTokens.filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 ? intersection / union : 0;
}

function scoreCandidate(track: Track, candidate: MusicBrainzSearchRecording): number {
  const baseScore =
    typeof candidate.score === 'string'
      ? parseInt(candidate.score, 10)
      : candidate.score ?? 0;
  const trackTitle = normalizeText(track.title);
  const candidateTitle = normalizeText(candidate.title);
  const trackArtist = normalizeText(track.artist);
  const candidateArtist = normalizeText(joinArtistCredits(candidate['artist-credit']));
  const trackAlbum = normalizeText(track.album);
  const candidateAlbum = normalizeText(chooseAlbum(candidate.releases));
  const titleOverlap = overlapScore(track.title, candidate.title);
  const artistOverlap = overlapScore(track.artist, joinArtistCredits(candidate['artist-credit']));
  const albumOverlap = overlapScore(track.album, chooseAlbum(candidate.releases));

  let total = baseScore;

  if (trackTitle && candidateTitle === trackTitle) total += 15;
  else if (
    trackTitle &&
    candidateTitle &&
    (candidateTitle.includes(trackTitle) || trackTitle.includes(candidateTitle))
  ) {
    total += 8;
  } else if (trackTitle && candidateTitle) {
    total -= titleOverlap >= 0.5 ? 2 : titleOverlap >= 0.25 ? 10 : 28;
  }

  if (trackArtist && candidateArtist === trackArtist) total += 12;
  else if (
    trackArtist &&
    candidateArtist &&
    (candidateArtist.includes(trackArtist) || trackArtist.includes(candidateArtist))
  ) {
    total += 6;
  } else if (trackArtist && candidateArtist) {
    total -= artistOverlap >= 0.5 ? 2 : artistOverlap >= 0.25 ? 8 : 22;
  }

  if (trackAlbum && candidateAlbum === trackAlbum) total += 6;
  else if (
    trackAlbum &&
    candidateAlbum &&
    (candidateAlbum.includes(trackAlbum) || trackAlbum.includes(candidateAlbum))
  ) {
    total += 3;
  } else if (trackAlbum && candidateAlbum) {
    total -= albumOverlap >= 0.5 ? 1 : albumOverlap >= 0.25 ? 4 : 10;
  }

  return total;
}

function isReliableMatch(track: Track, candidate: MusicBrainzSearchRecording): boolean {
  const finalScore = scoreCandidate(track, candidate);
  const candidateTitle = normalizeText(candidate.title);
  const trackTitle = normalizeText(track.title);
  const candidateArtist = normalizeText(joinArtistCredits(candidate['artist-credit']));
  const trackArtist = normalizeText(track.artist);
  const titleOverlap = overlapScore(track.title, candidate.title);
  const artistOverlap = overlapScore(track.artist, joinArtistCredits(candidate['artist-credit']));
  const albumOverlap = overlapScore(track.album, chooseAlbum(candidate.releases));

  if (trackTitle && candidateTitle && titleOverlap < 0.34) {
    return false;
  }
  if (trackArtist && candidateArtist && artistOverlap < 0.25) {
    return false;
  }
  if (track.album && candidate.releases && candidate.releases.length > 0 && albumOverlap < 0.15) {
    return false;
  }

  if (candidateTitle && trackTitle && candidateTitle === trackTitle && candidateArtist === trackArtist) {
    return true;
  }
  if (candidateTitle && trackTitle && candidateTitle === trackTitle && !trackArtist) {
    return finalScore >= 72;
  }
  if (
    candidateTitle &&
    trackTitle &&
    candidateArtist &&
    trackArtist &&
    candidateTitle === trackTitle &&
    (candidateArtist.includes(trackArtist) || trackArtist.includes(candidateArtist))
  ) {
    return finalScore >= 70;
  }
  if (!trackArtist) return finalScore >= 78;
  if (candidateArtist === trackArtist) return finalScore >= 74;
  return finalScore >= 84;
}

async function throttleMusicBrainz(): Promise<void> {
  const waitMs = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastRequestAt = Date.now();
}

async function musicBrainzFetch<T>(pathname: string, query: URLSearchParams): Promise<T> {
  await throttleMusicBrainz();
  const url = `${MUSICBRAINZ_BASE}${pathname}?${query.toString()}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': `fmusic/${app.getVersion()} (https://github.com/dgara/fmusic)`
    }
  });

  if (!response.ok) {
    throw new Error(`MusicBrainz request failed with ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function searchRecordings(query: string, limit: number): Promise<MusicBrainzSearchRecording[]> {
  const search = await musicBrainzFetch<MusicBrainzSearchResponse>(
    '/recording',
    new URLSearchParams({
      fmt: 'json',
      limit: String(limit),
      query
    })
  );
  return search.recordings ?? [];
}

async function searchArtistByName(name: string): Promise<string | null> {
  const normalizedTarget = normalizeText(name);
  if (!normalizedTarget) return null;

  const search = await musicBrainzFetch<MusicBrainzArtistSearchResponse>(
    '/artist',
    new URLSearchParams({
      fmt: 'json',
      limit: '5',
      query: `artist:"${escapeQueryValue(name)}"`
    })
  );

  const artists = search.artists ?? [];
  if (artists.length === 0) return null;

  const ranked = [...artists].sort((a, b) => {
    const aName = normalizeText(a.name);
    const bName = normalizeText(b.name);
    const aScore = typeof a.score === 'string' ? parseInt(a.score, 10) : a.score ?? 0;
    const bScore = typeof b.score === 'string' ? parseInt(b.score, 10) : b.score ?? 0;
    const aBonus = aName === normalizedTarget ? 20 : aName.includes(normalizedTarget) ? 8 : 0;
    const bBonus = bName === normalizedTarget ? 20 : bName.includes(normalizedTarget) ? 8 : 0;
    return bScore + bBonus - (aScore + aBonus);
  });

  const best = ranked[0];
  return best?.id ?? null;
}

async function resolveGenreFallbacks(
  lookup: MusicBrainzLookupResponse,
  preferredArtistName: string | null
): Promise<string | null> {
  const recordingGenre = chooseGenre(lookup.genres);
  if (recordingGenre) return recordingGenre;

  const preferredRelease = choosePreferredRelease(lookup.releases);
  if (preferredRelease?.id) {
    const releaseLookup = await musicBrainzFetch<MusicBrainzReleaseLookupResponse>(
      `/release/${preferredRelease.id}`,
      new URLSearchParams({
        fmt: 'json',
        inc: 'genres+release-groups'
      })
    );
    const releaseGenre = chooseGenre(releaseLookup.genres);
    if (releaseGenre) return releaseGenre;

    const releaseGroupId =
      releaseLookup['release-group']?.id ?? preferredRelease['release-group']?.id;
    if (releaseGroupId) {
      const releaseGroupLookup = await musicBrainzFetch<MusicBrainzReleaseGroupLookupResponse>(
        `/release-group/${releaseGroupId}`,
        new URLSearchParams({
          fmt: 'json',
          inc: 'genres'
        })
      );
      const releaseGroupGenre = chooseGenre(releaseGroupLookup.genres);
      if (releaseGroupGenre) return releaseGroupGenre;
    }
  }

  if (preferredArtistName) {
    const artistId = await searchArtistByName(preferredArtistName);
    if (artistId) {
      const artistLookup = await musicBrainzFetch<MusicBrainzArtistLookupResponse>(
        `/artist/${artistId}`,
        new URLSearchParams({
          fmt: 'json',
          inc: 'genres'
        })
      );
      const artistGenre = chooseGenre(artistLookup.genres);
      if (artistGenre) return artistGenre;
    }
  }

  return null;
}

export async function lookupTrackMetadata(track: Track): Promise<TrackMetadataLookupResult | null> {
  const title = track.title.trim();
  if (!title) return null;

  const exactTitle = `recording:"${escapeQueryValue(title)}"`;
  const escapedArtist = track.artist?.trim()
    ? `artist:"${escapeQueryValue(track.artist.trim())}"`
    : null;
  const escapedAlbum = track.album?.trim()
    ? `release:"${escapeQueryValue(track.album.trim())}"`
    : null;

  const queryAttempts = [
    [exactTitle, escapedArtist, escapedAlbum].filter(Boolean).join(' AND '),
    [exactTitle, escapedArtist].filter(Boolean).join(' AND '),
    exactTitle,
    [escapeQueryValue(title), track.artist?.trim() ? escapeQueryValue(track.artist.trim()) : null]
      .filter(Boolean)
      .join(' ')
  ].filter((query, index, all) => query.length > 0 && all.indexOf(query) === index);

  const recordingsMap = new Map<string, MusicBrainzSearchRecording>();
  for (const query of queryAttempts) {
    const results = await searchRecordings(query, query === exactTitle ? 10 : 7);
    for (const recording of results) {
      if (!recordingsMap.has(recording.id)) {
        recordingsMap.set(recording.id, recording);
      }
    }
    if (recordingsMap.size >= 8) {
      break;
    }
  }

  const recordings = Array.from(recordingsMap.values());
  if (recordings.length === 0) return null;

  const ranked = [...recordings].sort((a, b) => scoreCandidate(track, b) - scoreCandidate(track, a));
  const best = ranked[0];
  if (!best || !isReliableMatch(track, best)) {
    return null;
  }

  const lookup = await musicBrainzFetch<MusicBrainzLookupResponse>(
    `/recording/${best.id}`,
    new URLSearchParams({
      fmt: 'json',
      inc: 'artist-credits+releases+genres'
    })
  );

  const artistName = joinArtistCredits(lookup['artist-credit']) ?? track.artist;
  const genre =
    (await resolveGenreFallbacks(lookup, artistName)) ?? sanitizeFallbackGenre(track.genre);

  return {
    title: lookup.title?.trim() || track.title,
    artist: artistName,
    album: chooseAlbum(lookup.releases) ?? track.album,
    genre,
    source: 'MusicBrainz',
    confidence: Math.max(0, Math.min(100, scoreCandidate(track, best)))
  };
}
