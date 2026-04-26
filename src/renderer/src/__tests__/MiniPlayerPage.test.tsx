import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MiniPlayerPage } from '../pages/MiniPlayerPage';

describe('MiniPlayerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests the initial mini-player state on mount', () => {
    render(<MiniPlayerPage />);
    expect(window.fmusic.sendMiniCommand).toHaveBeenCalledWith('request-state');
  });

  it('sends a clamped seek target when the quick-seek buttons are used', () => {
    let handleMiniState: ((state: {
      trackId: number | null;
      title: string | null;
      artist: string | null;
      isPlaying: boolean;
      hasPrev: boolean;
      hasNext: boolean;
      position: number;
      duration: number;
    }) => void) | null = null;

    vi.mocked(window.fmusic.onMiniState).mockImplementation((handler) => {
      handleMiniState = handler;
      return () => {};
    });

    render(<MiniPlayerPage />);

    act(() => {
      handleMiniState?.({
        trackId: 7,
        title: 'Track',
        artist: 'Artist',
        isPlaying: true,
        hasPrev: true,
        hasNext: true,
        position: 8,
        duration: 120
      });
    });

    fireEvent.click(screen.getByRole('button', { name: /back 10 seconds/i }));
    expect(window.fmusic.sendMiniSeek).toHaveBeenLastCalledWith(0);

    act(() => {
      handleMiniState?.({
        trackId: 7,
        title: 'Track',
        artist: 'Artist',
        isPlaying: true,
        hasPrev: true,
        hasNext: true,
        position: 118,
        duration: 120
      });
    });

    fireEvent.click(screen.getByRole('button', { name: /forward 10 seconds/i }));
    expect(window.fmusic.sendMiniSeek).toHaveBeenLastCalledWith(120);
  });
});
