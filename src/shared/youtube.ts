/**
 * Extracts a YouTube video id from a URL-like input.
 * Handles `youtu.be/<id>`, `youtube.com/watch?v=<id>`,
 * `youtube.com/embed/<id>` and `youtube.com/shorts/<id>`.
 */
export function extractYoutubeId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.replace(/^\//, '').split('/')[0];
      return id || null;
    }
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v) return v;
      const parts = url.pathname.split('/').filter(Boolean);
      const marker = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'v');
      if (marker >= 0 && parts[marker + 1]) return parts[marker + 1];
    }
  } catch {
    // fall through to regex
  }
  const match = trimmed.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/);
  return match ? match[1] : null;
}
