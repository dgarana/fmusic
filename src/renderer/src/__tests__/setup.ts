import '@testing-library/jest-dom';
import { vi } from 'vitest';

const fmusicMock = {
  getAppVersion: vi.fn().mockResolvedValue('1.0.0'),
  getUpdaterStatus: vi.fn().mockResolvedValue({ status: 'idle' }),
  onUpdaterStatus: vi.fn().mockReturnValue(() => {}),
  playlistsForTrack: vi.fn().mockResolvedValue([]),
  addTrackToPlaylist: vi.fn().mockResolvedValue(undefined),
  removeTrackFromPlaylist: vi.fn().mockResolvedValue(undefined),
  sendTrayState: vi.fn(),
  sendMiniState: vi.fn(),
  onTrayCommand: vi.fn().mockReturnValue(() => {}),
  sonosAddByIp: vi.fn().mockResolvedValue({ name: 'New Device', host: '192.168.1.99', port: 1400 }),
  sonosStop: vi.fn().mockResolvedValue(undefined),
  sonosInitFromCache: vi.fn().mockResolvedValue([]),
  sonosDiscover: vi.fn().mockResolvedValue([]),
  sonosPlay: vi.fn().mockResolvedValue(undefined),
  sonosPause: vi.fn().mockResolvedValue(undefined),
  sonosResume: vi.fn().mockResolvedValue(undefined),
  sonosSeek: vi.fn().mockResolvedValue(undefined),
  sonosSetVolume: vi.fn().mockResolvedValue(undefined),
  sonosGetPosition: vi.fn().mockResolvedValue({ position: 0, duration: 0 }),
  trackStreamUrl: vi.fn().mockResolvedValue('blob:test'),
  markTrackPlayed: vi.fn().mockResolvedValue(undefined),
  downloadUpdate: vi.fn().mockResolvedValue(undefined),
  installUpdate: vi.fn().mockResolvedValue(undefined),
  openExternal: vi.fn().mockResolvedValue(undefined),
};

Object.defineProperty(window, 'fmusic', {
  value: fmusicMock,
  writable: true,
  configurable: true,
});
