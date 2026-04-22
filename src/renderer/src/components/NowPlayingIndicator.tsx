interface NowPlayingIndicatorProps {
  /**
   * When false, the equalizer bars freeze in place to signal that the track
   * is the current one but playback is paused.
   */
  playing?: boolean;
  /** Height of the indicator in px. Defaults to 16. */
  size?: number;
  className?: string;
}

/**
 * Tiny CSS-only "audio equalizer" used to mark the track that is currently
 * playing across list views (Library, Playlist detail, ...). Four bars
 * bouncing with staggered, slightly different periods so the motion never
 * looks in-sync and cheesy. Falls back to a frozen snapshot when `playing`
 * is false, so the same indicator can represent a paused-but-selected row.
 */
export function NowPlayingIndicator({
  playing = true,
  size = 16,
  className
}: NowPlayingIndicatorProps) {
  return (
    <span
      className={`now-playing-equalizer${playing ? '' : ' paused'}${className ? ` ${className}` : ''}`}
      style={{ height: size }}
      aria-hidden="true"
    >
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
