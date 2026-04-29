import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import { Channels } from '../shared/channels.js';
import type {
  AppSettings,
  DownloadJob,
  DownloadRequest,
  SmartPlaylistDefinition,
  TrackQuery
} from '../shared/types.js';
import { getSettings, updateSettings } from './settings.js';
import {
  fetchAudioStreamUrl,
  fetchPlaylistEntries,
  fetchVideoInfo,
  getDependencyStatus,
  searchYouTube,
  ytDlpVersion
} from './ytdlp.js';
import { getDownloadManager } from './download-manager.js';
import { updateYtDlp } from './updater.js';
import {
  deleteTrack,
  findByYoutubeId,
  findDownloadedYoutubeIds,
  getTrackMetadataSuggestions,
  incrementPlayCount,
  listGenres,
  listTracks,
  resolveTrackFilePath,
  updateTrack,
  updateTrackSourceUrl,
  getTrack,
  getTrackEmbeddedArtworkDataUrl,
  editTrack,
  renameTrackFile,
  importLocalTracks,
  moveLibrary,
  listTrackBookmarks,
  getTrackBookmark,
  createTrackBookmark,
  updateTrackBookmark,
  deleteTrackBookmark
} from './library/tracks-repo.js';
import {
  addTrackToPlaylist,
  createPlaylist,
  createSmartPlaylist,
  deletePlaylist,
  listPlaylists,
  playlistsForTrack,
  playlistsForTracks,
  removeTrackFromPlaylist,
  renamePlaylist,
  reorderPlaylist,
  updateSmartPlaylist
} from './library/playlists-repo.js';
import { getSchemaHistory } from './library/db.js';
import { discoverSonos, addSonosByIp, initSonosFromCache, sonosPlayTrack, sonosPause, sonosResume, sonosStop, stopActiveSonos, sonosSetVolume, sonosSeek, sonosGetPosition } from './sonos.js';
import { getTrackHttpUrl } from './sonos-server.js';
import { generateTrackMobileUrl } from './mobile-server.js';
import {
  broadcastRemoteControllerData,
  broadcastRemoteControllerSettings,
  getRemoteControllerInfo,
  regenerateRemoteControllerToken
} from './remote-controller-server.js';
import { startUnifiedServer, stopUnifiedServer } from './server-manager.js';
import { refreshTrayLanguage } from './tray.js';
import { checkForUpdates, downloadUpdate, quitAndInstall, getLastUpdaterStatus } from './app-updater.js';
import { lookupTrackMetadata } from './musicbrainz.js';

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

export function registerIpc(): void {
  // ----- App / system -----
  ipcMain.handle(Channels.AppVersion, () => app.getVersion());
  ipcMain.handle(Channels.AppPlatform, () => process.platform);

  // ----- Updater -----
  ipcMain.handle(Channels.UpdaterCheck, () => checkForUpdates());
  ipcMain.handle(Channels.UpdaterGetStatus, () => getLastUpdaterStatus());
  ipcMain.handle(Channels.UpdaterDownload, () => downloadUpdate());
  ipcMain.handle(Channels.UpdaterInstall, () => quitAndInstall());
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
  ipcMain.handle(Channels.PickFiles, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'm4a', 'opus', 'ogg', 'flac', 'wav'] }
      ]
    });
    if (result.canceled) return [];
    return result.filePaths;
  });
  ipcMain.handle(Channels.MoveLibrary, async (_evt, oldDir: string, newDir: string) => {
    return moveLibrary(oldDir, newDir);
  });

  // ----- Dependencies -----
  ipcMain.handle(Channels.DepsStatus, () => getDependencyStatus());
  ipcMain.handle(Channels.DepsVersion, () => ytDlpVersion());
  ipcMain.handle(Channels.DepsUpdateYtDlp, () => updateYtDlp());

  // ----- Settings -----
  ipcMain.handle(Channels.SettingsGet, () => getSettings());
  ipcMain.handle(Channels.SettingsUpdate, async (_evt, patch: Partial<AppSettings>) => {
    const prev = getSettings();
    const next = updateSettings(patch);

    if (Object.prototype.hasOwnProperty.call(patch, 'language')) {
      refreshTrayLanguage();
      // Push the new language to every connected remote controller client so
      // the mobile web UI re-applies translations live, without reconnecting.
      broadcastRemoteControllerSettings();
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'concurrency')) {
      getDownloadManager().refreshConcurrency();
    }

    async function updateServerLifecycle() {
      const s = getSettings();
      if (s.mobileSyncEnabled || s.remoteControllerEnabled || s.sonosEnabled) {
        void startUnifiedServer().catch(console.error);
      } else {
        stopUnifiedServer();
      }
    }

    // Handle unified server lifecycle on setting changes
    if (
      patch.mobileSyncEnabled !== undefined ||
      patch.remoteControllerEnabled !== undefined ||
      patch.sonosEnabled !== undefined ||
      patch.localServerPort !== undefined
    ) {
      if (patch.sonosEnabled !== undefined) {
        console.log(`[settings] Sonos integration ${patch.sonosEnabled ? 'enabled' : 'disabled'}`);
        if (!patch.sonosEnabled) {
          // IMPORTANT: Stop playback before the server (which hosts the files) is shut down
          await stopActiveSonos();
        }
      }
      if (patch.mobileSyncEnabled !== undefined) {
        console.log(`[settings] Mobile sync ${patch.mobileSyncEnabled ? 'enabled' : 'disabled'}`);
      }
      if (patch.remoteControllerEnabled !== undefined) {
        console.log(`[settings] Remote controller ${patch.remoteControllerEnabled ? 'enabled' : 'disabled'}`);
      }
      await updateServerLifecycle();
    }

    // Notify every renderer (main window, mini player, …) so they can keep
    // their own zustand copy of the settings in sync — the theme, language
    // and other preferences must propagate across all windows.
    broadcast(Channels.SettingsChanged, next);

    return next;
  });

  // ----- YouTube -----
  ipcMain.handle(Channels.YtSearch, async (_evt, query: string, limit?: number) => {
    return searchYouTube(query, limit ?? 10);
  });
  ipcMain.handle(Channels.YtInfo, async (_evt, url: string) => fetchVideoInfo(url));
  ipcMain.handle(Channels.YtStreamUrl, async (_evt, url: string) => fetchAudioStreamUrl(url));
  ipcMain.handle(Channels.YtPlaylist, async (_evt, url: string) => fetchPlaylistEntries(url));

  // ----- Downloads -----
  const dm = getDownloadManager();
  dm.onJobUpdate((job) => broadcast(Channels.DownloadJobUpdate, job));
  dm.onTrackAdded((track) => {
    broadcast(Channels.TracksAdded, track);
    broadcastRemoteControllerData();
  });

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
  ipcMain.handle(Channels.TracksMetadataSuggestions, () => getTrackMetadataSuggestions());
  ipcMain.handle(Channels.TracksLookupMetadata, async (_evt, id: number) => {
    const track = getTrack(id);
    if (!track) return null;
    return lookupTrackMetadata(track);
  });
  ipcMain.handle(Channels.TracksArtwork, async (_evt, id: number) => {
    const track = getTrack(id);
    if (!track) return null;
    return getTrackEmbeddedArtworkDataUrl(track);
  });
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
  ipcMain.handle(
    Channels.TracksEdit,
    (_evt, id: number, options: Parameters<typeof editTrack>[1]) =>
      editTrack(id, options)
  );
  ipcMain.handle(Channels.TracksRename, (_evt, id: number, basename: string) =>
    renameTrackFile(id, basename)
  );
  ipcMain.handle(Channels.TracksGet, (_evt, id: number) => getTrack(id));
  ipcMain.handle(Channels.TracksDownloadedIds, (_evt, ids: string[]) =>
    findDownloadedYoutubeIds(ids)
  );
  ipcMain.handle(Channels.TracksImportLocal, (_evt, filePaths: string[]) =>
    importLocalTracks(filePaths)
  );
  ipcMain.handle(Channels.TrackBookmarksList, (_evt, trackId: number) =>
    listTrackBookmarks(trackId)
  );
  ipcMain.handle(
    Channels.TrackBookmarksCreate,
    (_evt, trackId: number, positionSec: number, label?: string | null, color?: string | null) => {
      const bookmark = createTrackBookmark(trackId, positionSec, label, color);
      broadcast(Channels.TrackBookmarksChanged, { trackId: bookmark.trackId });
      return bookmark;
    }
  );
  ipcMain.handle(
    Channels.TrackBookmarksUpdate,
    (_evt, id: number, patch: Parameters<typeof updateTrackBookmark>[1]) => {
      const bookmark = updateTrackBookmark(id, patch);
      if (bookmark) {
        broadcast(Channels.TrackBookmarksChanged, { trackId: bookmark.trackId });
      }
      return bookmark;
    }
  );
  ipcMain.handle(Channels.TrackBookmarksDelete, (_evt, id: number) => {
    const bookmark = getTrackBookmark(id);
    const deleted = deleteTrackBookmark(id);
    if (deleted && bookmark) {
      broadcast(Channels.TrackBookmarksChanged, { trackId: bookmark.trackId });
    }
    return deleted;
  });

  // ----- Playlists -----
  ipcMain.handle(Channels.PlaylistsList, () => listPlaylists());
  ipcMain.handle(
    Channels.PlaylistsCreate,
    (_evt, name: string, sourceUrl: string | null = null) => createPlaylist(name, sourceUrl)
  );
  ipcMain.handle(
    Channels.PlaylistsCreateSmart,
    (_evt, name: string, definition: SmartPlaylistDefinition) =>
      createSmartPlaylist(name, definition)
  );
  ipcMain.handle(
    Channels.PlaylistsUpdateSmart,
    (_evt, id: number, name: string, definition: SmartPlaylistDefinition) =>
      updateSmartPlaylist(id, name, definition)
  );
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
  ipcMain.handle(
    Channels.PlaylistsAddTracksByYoutubeIds,
    (_evt, playlistId: number, youtubeIdToUrl: Record<string, string>) => {
      // Adds every library track whose YouTube id is in the list to the given
      // playlist. Used when importing a YouTube playlist that contains videos
      // we already have locally — we still want them to appear in the newly
      // created local playlist, just without downloading them again.
      let added = 0;
      for (const [ytId, url] of Object.entries(youtubeIdToUrl)) {
        const track = findByYoutubeId(ytId);
        if (!track) continue;
        try {
          if (!track.sourceUrl && url) {
            updateTrackSourceUrl(track.id, url);
          }
          addTrackToPlaylist(playlistId, track.id);
          added++;
        } catch {
          // Ignore individual failures; duplicates are de-duped at the repo
          // layer via INSERT OR IGNORE so this should only hit on schema
          // errors.
        }
      }
      return added;
    }
  );

  // ----- Schema -----
  ipcMain.handle(Channels.SchemaHistory, () => getSchemaHistory());

  // ----- Sonos -----
  async function ensureSonosEnabled() {
    if (!getSettings().sonosEnabled) {
      throw new Error('Sonos integration is disabled.');
    }
    await startUnifiedServer();
  }

  ipcMain.handle(Channels.SonosDiscover, async () => {
    await ensureSonosEnabled();
    return discoverSonos();
  });
  ipcMain.handle(Channels.SonosAddByIp, async (_evt, host: string) => {
    await ensureSonosEnabled();
    return addSonosByIp(host);
  });
  ipcMain.handle(Channels.SonosInitFromCache, async () => {
    await ensureSonosEnabled();
    return initSonosFromCache();
  });
  ipcMain.handle(
    Channels.SonosPlay,
    async (_evt, host: string, trackId: number, title?: string, artist?: string) => {
      const track = getTrack(trackId);
      if (!track) {
        throw new Error(`Track ${trackId} not found.`);
      }
      const filePath = resolveTrackFilePath(track);
      if (!filePath) {
        throw new Error(`Track ${trackId} is missing on disk.`);
      }
      await ensureSonosEnabled();
      const url = getTrackHttpUrl(trackId, filePath);
      await sonosPlayTrack(host, url, title, artist);
    }
  );
  ipcMain.handle(Channels.SonosPause, async (_evt, host: string) => {
    await ensureSonosEnabled();
    return sonosPause(host);
  });
  ipcMain.handle(Channels.SonosResume, async (_evt, host: string) => {
    await ensureSonosEnabled();
    return sonosResume(host);
  });
  ipcMain.handle(Channels.SonosStop, async (_evt, host: string) => {
    try {
      return await sonosStop(host);
    } catch (err) {
      console.error(`[ipc] Error in sonos:stop for ${host}:`, err);
      throw err;
    }
  });
  ipcMain.handle(Channels.SonosVolume, async (_evt, host: string, volume: number) => {
    if (!getSettings().sonosEnabled) return;
    return sonosSetVolume(host, volume);
  });

  ipcMain.handle(Channels.SonosSeek, async (_evt, host: string, seconds: number) => {
    if (!getSettings().sonosEnabled) return;
    return sonosSeek(host, seconds);
  });

  ipcMain.handle(Channels.SonosPosition, async (_evt, host: string) => {
    if (!getSettings().sonosEnabled) {
      return { position: 0, duration: 0, transportState: 'STOPPED' };
    }
    return sonosGetPosition(host);
  });

  // ----- Mobile Sync -----
  ipcMain.handle(Channels.MobileSyncGetUrl, (_evt, trackId: number) => {
    return generateTrackMobileUrl(trackId);
  });

  // ----- Remote Controller -----
  ipcMain.handle(Channels.RemoteControllerInfo, () => getRemoteControllerInfo());
  ipcMain.handle(Channels.RemoteControllerRegenerate, () => regenerateRemoteControllerToken());

  // ----- Window Controls -----
  ipcMain.on('window:minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize();
  });
  ipcMain.on('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
  });
  ipcMain.on('window:close', () => {
    BrowserWindow.getFocusedWindow()?.close();
  });
  ipcMain.handle(Channels.WindowIsMaximized, () => {
    return BrowserWindow.getFocusedWindow()?.isMaximized() ?? false;
  });
}
