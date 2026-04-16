import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import { Channels } from '../shared/channels.js';
import type {
  AppSettings,
  DownloadJob,
  DownloadRequest,
  TrackQuery
} from '../shared/types.js';
import { getSettings, updateSettings } from './settings.js';
import {
  fetchAudioStreamUrl,
  fetchVideoInfo,
  getDependencyStatus,
  searchYouTube,
  ytDlpVersion
} from './ytdlp.js';
import { getDownloadManager } from './download-manager.js';
import { updateYtDlp } from './updater.js';
import {
  deleteTrack,
  findDownloadedYoutubeIds,
  incrementPlayCount,
  listGenres,
  listTracks,
  resolveTrackFilePath,
  updateTrack,
  getTrack
} from './library/tracks-repo.js';
import {
  addTrackToPlaylist,
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  playlistsForTrack,
  playlistsForTracks,
  removeTrackFromPlaylist,
  renamePlaylist,
  reorderPlaylist
} from './library/playlists-repo.js';
import { getSchemaHistory } from './library/db.js';
import { discoverSonos, addSonosByIp, initSonosFromCache, sonosPlayTrack, sonosPause, sonosResume, sonosStop, sonosSetVolume, sonosSeek, sonosGetPosition } from './sonos.js';
import { startAudioServer, getTrackHttpUrl } from './sonos-server.js';
import { refreshTrayLanguage } from './tray.js';

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

export function registerIpc(): void {
  // ----- App / system -----
  ipcMain.handle(Channels.OpenExternal, async (_evt, url: string) => {
    await shell.openExternal(url);
  });
  ipcMain.handle(Channels.OpenPath, async (_evt, p: string) => {
    await shell.openPath(p);
  });
  ipcMain.handle(Channels.PickDirectory, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ----- Dependencies -----
  ipcMain.handle(Channels.DepsStatus, () => getDependencyStatus());
  ipcMain.handle(Channels.DepsVersion, () => ytDlpVersion());
  ipcMain.handle(Channels.DepsUpdateYtDlp, () => updateYtDlp());

  // ----- Settings -----
  ipcMain.handle(Channels.SettingsGet, () => getSettings());
  ipcMain.handle(Channels.SettingsUpdate, (_evt, patch: Partial<AppSettings>) => {
    const next = updateSettings(patch);
    if (Object.prototype.hasOwnProperty.call(patch, 'language')) {
      refreshTrayLanguage();
    }
    return next;
  });

  // ----- YouTube -----
  ipcMain.handle(Channels.YtSearch, async (_evt, query: string, limit?: number) => {
    return searchYouTube(query, limit ?? 10);
  });
  ipcMain.handle(Channels.YtInfo, async (_evt, url: string) => fetchVideoInfo(url));
  ipcMain.handle(Channels.YtStreamUrl, async (_evt, url: string) => fetchAudioStreamUrl(url));

  // ----- Downloads -----
  const dm = getDownloadManager();
  dm.onJobUpdate((job) => broadcast(Channels.DownloadJobUpdate, job));
  dm.onTrackAdded((track) => broadcast(Channels.TracksAdded, track));

  ipcMain.handle(
    Channels.DownloadEnqueue,
    (_evt, request: DownloadRequest): DownloadJob => dm.enqueue(request)
  );
  ipcMain.handle(Channels.DownloadCancel, (_evt, id: string) => dm.cancel(id));
  ipcMain.handle(Channels.DownloadList, () => dm.list());

  // ----- Tracks -----
  ipcMain.handle(Channels.TracksList, (_evt, query: TrackQuery = {}) =>
    listTracks(query)
  );
  ipcMain.handle(Channels.TracksGenres, () => listGenres());
  ipcMain.handle(
    Channels.TracksUpdate,
    (_evt, id: number, patch: Parameters<typeof updateTrack>[1]) => updateTrack(id, patch)
  );
  ipcMain.handle(Channels.TracksDelete, (_evt, id: number, deleteFile: boolean) => {
    const track = getTrack(id);
    const resolvedPath = track ? resolveTrackFilePath(track) : null;
    const removed = deleteTrack(id);
    if (removed && deleteFile && resolvedPath) {
      try {
        fs.unlinkSync(resolvedPath);
      } catch {
        // ignore
      }
    }
    return removed;
  });
  ipcMain.handle(Channels.TracksPlayed, (_evt, id: number) => {
    incrementPlayCount(id);
  });
  ipcMain.handle(Channels.TracksStream, (_evt, id: number) => {
    const track = getTrack(id);
    if (!track) return null;
    // Probe the filesystem up-front so we can surface a friendly null to the
    // renderer when the file is missing; actual streaming happens through the
    // custom `fmusic-media://` protocol registered in main/index.ts, which
    // works both in dev (http://localhost origin) and in production (file://).
    const actualPath = resolveTrackFilePath(track);
    if (!actualPath) {
      console.warn(
        `[tracks] Could not locate file for track ${id} (${track.title}). Stored path: ${track.filePath}`
      );
      return null;
    }
    return `fmusic-media://track/${id}`;
  });
  ipcMain.handle(Channels.TracksDownloadedIds, (_evt, ids: string[]) =>
    findDownloadedYoutubeIds(ids)
  );

  // ----- Playlists -----
  ipcMain.handle(Channels.PlaylistsList, () => listPlaylists());
  ipcMain.handle(Channels.PlaylistsCreate, (_evt, name: string) => createPlaylist(name));
  ipcMain.handle(Channels.PlaylistsRename, (_evt, id: number, name: string) =>
    renamePlaylist(id, name)
  );
  ipcMain.handle(Channels.PlaylistsDelete, (_evt, id: number) => deletePlaylist(id));
  ipcMain.handle(Channels.PlaylistsAddTrack, (_evt, playlistId: number, trackId: number) =>
    addTrackToPlaylist(playlistId, trackId)
  );
  ipcMain.handle(
    Channels.PlaylistsRemoveTrack,
    (_evt, playlistId: number, trackId: number) => removeTrackFromPlaylist(playlistId, trackId)
  );
  ipcMain.handle(
    Channels.PlaylistsReorder,
    (_evt, playlistId: number, orderedTrackIds: number[]) =>
      reorderPlaylist(playlistId, orderedTrackIds)
  );
  ipcMain.handle(Channels.PlaylistsForTrack, (_evt, trackId: number) =>
    playlistsForTrack(trackId)
  );
  ipcMain.handle(Channels.PlaylistsForTracks, (_evt, trackIds: number[]) => {
    const map = playlistsForTracks(trackIds);
    // Map is not JSON-serializable across IPC; send as array of tuples.
    return Array.from(map.entries());
  });

  // ----- Schema -----
  ipcMain.handle(Channels.SchemaHistory, () => getSchemaHistory());

  // ----- Sonos -----
  ipcMain.handle(Channels.SonosDiscover, async () => {
    await startAudioServer();
    return discoverSonos();
  });
  ipcMain.handle(Channels.SonosAddByIp, async (_evt, host: string) => {
    await startAudioServer();
    return addSonosByIp(host);
  });
  ipcMain.handle(Channels.SonosInitFromCache, async () => {
    await startAudioServer();
    return initSonosFromCache();
  });
  ipcMain.handle(
    Channels.SonosPlay,
    async (_evt, host: string, trackId: number, title?: string, artist?: string) => {
      const track = getTrack(trackId);
      const filePath = track ? resolveTrackFilePath(track) : undefined;
      const url = getTrackHttpUrl(trackId, filePath ?? undefined);
      await sonosPlayTrack(host, url, title, artist);
    }
  );
  ipcMain.handle(Channels.SonosPause, (_evt, host: string) => sonosPause(host));
  ipcMain.handle(Channels.SonosResume, (_evt, host: string) => sonosResume(host));
  ipcMain.handle(Channels.SonosStop, (_evt, host: string) => sonosStop(host));
  ipcMain.handle(Channels.SonosVolume, (_evt, host: string, volume: number) =>
    sonosSetVolume(host, volume)
  );
  ipcMain.handle(Channels.SonosSeek, (_evt, host: string, seconds: number) =>
    sonosSeek(host, seconds)
  );
  ipcMain.handle(Channels.SonosPosition, (_evt, host: string) => sonosGetPosition(host));
}
