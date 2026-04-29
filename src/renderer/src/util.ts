import { extractYoutubeId as extractSharedYoutubeId } from '../../shared/youtube';
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '--:--';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatAddedDate(value: string | null | undefined): string {
  if (!value) return '-';
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

export function isYouTubeUrl(input: string): boolean {
  return /(^https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(input.trim());
}

export function clampSeekPosition(
  seconds: number,
  duration: number | null | undefined
): number {
  const safeSeconds = Number.isFinite(seconds) ? seconds : 0;
  if (duration == null || !Number.isFinite(duration) || duration <= 0) {
    return Math.max(0, safeSeconds);
  }
  return Math.min(Math.max(0, safeSeconds), duration);
}

export function offsetSeekPosition(
  position: number,
  delta: number,
  duration: number | null | undefined
): number {
  return clampSeekPosition(position + delta, duration);
}

/**
 * Extracts the YouTube video id from a URL, returning null if none is found.
 * Handles `youtu.be/<id>`, `youtube.com/watch?v=<id>`, `youtube.com/embed/<id>`,
 * `youtube.com/shorts/<id>`.
 */
export function extractYoutubeId(input: string): string | null {
  return extractSharedYoutubeId(input);
}

/**
 * Extracts the YouTube playlist id from a URL, returning null if none is found.
 * Matches both dedicated playlist URLs (`youtube.com/playlist?list=<id>`) and
 * watch URLs that carry a playlist context (`youtube.com/watch?v=xxx&list=<id>`).
 */
export function extractYoutubePlaylistId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
      const list = url.searchParams.get('list');
      if (list) return list;
    }
  } catch {
    // fall through to regex
  }
  const match = trimmed.match(/[?&]list=([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Returns true when the URL points to (or carries context of) a YouTube
 * playlist. Note that regular watch URLs with `&list=` also qualify — callers
 * that want to distinguish "video with mix context" from a real playlist
 * should check the shape of the id (user-curated playlists start with `PL`,
 * while auto-generated mixes start with `RD`, `UU`, etc.).
 */
export function isYouTubePlaylistUrl(input: string): boolean {
  return isYouTubeUrl(input) && extractYoutubePlaylistId(input) !== null;
}
