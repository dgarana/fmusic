import { describe, it, expect } from 'vitest';
import { formatDuration, isYouTubeUrl, extractYoutubeId } from '../util';

describe('formatDuration', () => {
  it('returns --:-- for null', () => {
    expect(formatDuration(null)).toBe('--:--');
  });

  it('returns --:-- for undefined', () => {
    expect(formatDuration(undefined)).toBe('--:--');
  });

  it('returns --:-- for NaN', () => {
    expect(formatDuration(NaN)).toBe('--:--');
  });

  it('formats zero as 0:00', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('formats seconds under a minute', () => {
    expect(formatDuration(45)).toBe('0:45');
  });

  it('pads seconds to two digits', () => {
    expect(formatDuration(61)).toBe('1:01');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2:05');
  });

  it('formats exactly one hour', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
  });

  it('formats hours, minutes and seconds', () => {
    expect(formatDuration(3723)).toBe('1:02:03');
  });

  it('pads minutes to two digits when hours are present', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('rounds fractional seconds', () => {
    expect(formatDuration(59.9)).toBe('1:00');
  });
});

describe('isYouTubeUrl', () => {
  it('recognises youtube.com/watch URLs', () => {
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=abc123')).toBe(true);
  });

  it('recognises short youtu.be URLs', () => {
    expect(isYouTubeUrl('https://youtu.be/abc123')).toBe(true);
  });

  it('recognises URLs without protocol', () => {
    expect(isYouTubeUrl('youtube.com/watch?v=abc123')).toBe(true);
  });

  it('recognises youtube.com/shorts URLs', () => {
    expect(isYouTubeUrl('https://www.youtube.com/shorts/abc123')).toBe(true);
  });

  it('returns false for non-YouTube URLs', () => {
    expect(isYouTubeUrl('https://soundcloud.com/track/123')).toBe(false);
  });

  it('returns false for plain search text', () => {
    expect(isYouTubeUrl('my favourite song')).toBe(false);
  });

  it('ignores leading and trailing spaces', () => {
    expect(isYouTubeUrl('  https://youtu.be/abc  ')).toBe(true);
  });
});

describe('extractYoutubeId', () => {
  it('extracts id from watch?v= URL', () => {
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts id from youtu.be URL', () => {
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts id from embed URL', () => {
    expect(extractYoutubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts id from shorts URL', () => {
    expect(extractYoutubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for empty string', () => {
    expect(extractYoutubeId('')).toBeNull();
  });

  it('returns null for non-YouTube input', () => {
    expect(extractYoutubeId('just a search query')).toBeNull();
  });

  it('returns null for a non-YouTube URL', () => {
    expect(extractYoutubeId('https://soundcloud.com/track/123')).toBeNull();
  });

  it('handles youtu.be with query params', () => {
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ');
  });
});
