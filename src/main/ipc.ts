import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
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
  ipcMain.handle(Channels.DepsStatus, async () => {
    const base = getDependencyStatus();
    return {
      ytDlp: { ...base.ytDlp, version: await ytDlpVersion() },
      ffmpeg: base.ffmpeg
    };
  });
  ipcMain.handle(Channels.DepsUpdateYtDlp, async () => {
    const result = await updateYtDlp();
    const version = await ytDlpVersion();
    return { ...result, version };
  });

  // ----- Settings -----
  ipcMain.handle(Channels.SettingsGet, () => getSettings());
  ipcMain.handle(Channels.SettingsUpdate, (_evt, patch: Partial<AppSettings>) =>
    updateSettings(patch)
  );

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
    const removed = deleteTrack(id);
    if (removed && deleteFile && track && fs.existsSync(track.filePath)) {
      try {
        fs.unlinkSync(track.filePath);
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
    if (!track || !fs.existsSync(track.filePath)) return null;
    return pathToFileURL(track.filePath).toString();
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
}
