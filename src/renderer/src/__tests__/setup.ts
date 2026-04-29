import '@testing-library/jest-dom';
import { vi } from 'vitest';

const fmusicMock = {
  getAppVersion: vi.fn().mockResolvedValue('1.0.0'),
  getUpdaterStatus: vi.fn().mockResolvedValue({ status: 'idle' }),
  onUpdaterStatus: vi.fn().mockReturnValue(() => {}),
  playlistsForTrack: vi.fn().mockResolvedValue([]),
  addTrackToPlaylist: vi.fn().mockResolvedValue(undefined),
  removeTrackFromPlaylist: vi.fn().mockResolvedValue(undefined),
  renamePlaylist: vi.fn().mockResolvedValue(null),
  createPlaylist: vi.fn().mockResolvedValue(null),
  deletePlaylist: vi.fn().mockResolvedValue(false),
  listPlaylists: vi.fn().mockResolvedValue([]),
  listTracks: vi.fn().mockResolvedValue([]),
  getMobileSyncUrl: vi.fn().mockResolvedValue('http://localhost/test.mp3'),
  sendTrayState: vi.fn(),
  sendMiniState: vi.fn(),
  onMiniState: vi.fn().mockReturnValue(() => {}),
  sendMiniCommand: vi.fn(),
  sendMiniSeek: vi.fn(),
  trackArtworkDataUrl: vi.fn().mockResolvedValue(null),
  sendRemoteState: vi.fn(),
  onTrayCommand: vi.fn().mockReturnValue(() => {}),
  onRemoteCommand: vi.fn().mockReturnValue(() => {}),
  onMiniSeek: vi.fn().mockReturnValue(() => {}),
  onRemoteSeek: vi.fn().mockReturnValue(() => {}),
  onRemoteVolume: vi.fn().mockReturnValue(() => {}),
  getTrack: vi.fn().mockResolvedValue(null),
  listTrackBookmarks: vi.fn().mockResolvedValue([]),
  createTrackBookmark: vi.fn().mockResolvedValue({
    id: 1,
    trackId: 1,
    label: null,
    positionSec: 0,
    color: '#f59e0b',
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00'
  }),
  updateTrackBookmark: vi.fn().mockResolvedValue(null),
  deleteTrackBookmark: vi.fn().mockResolvedValue(true),
  onTrackBookmarksChanged: vi.fn().mockReturnValue(() => {}),
  getRemoteControllerInfo: vi.fn().mockResolvedValue({
    enabled: false,
    running: false,
    url: null,
    token: null
  }),
  regenerateRemoteControllerToken: vi.fn().mockResolvedValue({
    enabled: false,
    running: false,
    url: null,
    token: null
  }),
  sonosAddByIp: vi.fn().mockResolvedValue({ name: 'New Device', host: '************', port: 1400 }),
  sonosStop: vi.fn().mockResolvedValue(undefined),
  sonosInitFromCache: vi.fn().mockResolvedValue([]),
  sonosDiscover: vi.fn().mockResolvedValue([]),
  sonosPlay: vi.fn().mockResolvedValue(undefined),
  sonosPause: vi.fn().mockResolvedValue(undefined),
  sonosResume: vi.fn().mockResolvedValue(undefined),
  sonosSeek: vi.fn().mockResolvedValue(undefined),
  sonosSetVolume: vi.fn().mockResolvedValue(undefined),
  sonosGetPosition: vi.fn().mockResolvedValue({
    position: 0,
    duration: 0,
    transportState: 'STOPPED'
  }),
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
