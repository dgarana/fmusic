import { useEffect, useState } from 'react';
import type { Track } from '../../../shared/types';
import { MusicIcon } from './icons';
import { NowPlayingIndicator } from './NowPlayingIndicator';

export function TrackTitleCell({
  track,
  isCurrent,
  isPlaying
}: {
  track: Track;
  isCurrent: boolean;
  isPlaying: boolean;
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setThumbnailUrl(null);
    void window.fmusic.trackArtworkDataUrl(track.id).then((url) => {
      if (!cancelled) setThumbnailUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [track.id]);

  return (
    <div className="track-title-cell">
      <div className="track-thumb-wrap">
        {thumbnailUrl ? (
          <img className="track-thumb" src={thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <div className="track-thumb-fallback" aria-hidden="true">
            <MusicIcon size={18} />
          </div>
        )}
        {isCurrent && (
          <div className="track-thumb-overlay">
            <NowPlayingIndicator playing={isPlaying} size={18} />
          </div>
        )}
      </div>
      <span className="track-title-text">{track.title}</span>
    </div>
  );
}
