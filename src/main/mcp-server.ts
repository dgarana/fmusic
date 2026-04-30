import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import { BrowserWindow } from 'electron';
import { Channels } from '../shared/channels.js';
import { getSettings } from './settings.js';
import {
  createTrackBookmark,
  deleteTrack,
  deleteTrackBookmark,
  findDownloadedYoutubeIds,
  getTrack,
  getTrackBookmark,
  getTrackMetadataSuggestions,
  listGenres,
  listTrackBookmarks,
  listTracks,
  resolveTrackFilePath,
  updateTrack,
  updateTrackBookmark
} from './library/tracks-repo.js';
import {
  addTrackToPlaylist,
  createPlaylist,
  createSmartPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  removeTrackFromPlaylist,
  renamePlaylist,
  reorderPlaylist,
  updateSmartPlaylist
} from './library/playlists-repo.js';
import { getDownloadManager } from './download-manager.js';
import { fetchPlaylistEntries, fetchVideoInfo, searchYouTube } from './ytdlp.js';
import {
  broadcastRemoteControllerData,
  dispatchRemoteControllerCommand,
  getRemoteControllerSnapshot
} from './remote-controller-server.js';
import { extractYoutubeId } from '../shared/youtube.js';
import type {
  DownloadRequest,
  McpServerInfo,
  RemoteControllerCommand,
  SmartPlaylistDefinition,
  Track,
  TrackQuery
} from '../shared/types.js';

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

let server: http.Server | null = null;
let serverPort = 0;

const emptySchema = {
  type: 'object',
  properties: {},
  additionalProperties: false
};

const tools: McpTool[] = [
  {
    name: 'player_get_state',
    description: 'Return the current FMusic player state, including the active track, position, volume, downloads, and Sonos status.',
    inputSchema: emptySchema
  },
  {
    name: 'player_play',
    description: 'Start playback if FMusic is currently paused.',
    inputSchema: emptySchema
  },
  {
    name: 'player_pause',
    description: 'Pause playback if FMusic is currently playing.',
    inputSchema: emptySchema
  },
  {
    name: 'player_toggle_play',
    description: 'Toggle play/pause in FMusic.',
    inputSchema: emptySchema
  },
  {
    name: 'player_next',
    description: 'Skip to the next queued track.',
    inputSchema: emptySchema
  },
  {
    name: 'player_previous',
    description: 'Skip to the previous queued track.',
    inputSchema: emptySchema
  },
  {
    name: 'player_seek',
    description: 'Seek the current track to an absolute position in seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        seconds: { type: 'number', minimum: 0 }
      },
      required: ['seconds'],
      additionalProperties: false
    }
  },
  {
    name: 'player_set_volume',
    description: 'Set FMusic volume. The value must be between 0 and 1.',
    inputSchema: {
      type: 'object',
      properties: {
        volume: { type: 'number', minimum: 0, maximum: 1 }
      },
      required: ['volume'],
      additionalProperties: false
    }
  },
  {
    name: 'library_search',
    description: 'Search the local FMusic library.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        genre: { type: 'string' },
        playlistId: { type: 'number' },
        limit: { type: 'number', minimum: 1, maximum: 200 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'library_list_genres',
    description: 'List all genres present in the local FMusic library.',
    inputSchema: emptySchema
  },
  {
    name: 'library_metadata_suggestions',
    description: 'List distinct artists, albums, and genres for metadata autocomplete.',
    inputSchema: emptySchema
  },
  {
    name: 'library_get_track',
    description: 'Get one local library track by id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' }
      },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'library_update_track_metadata',
    description: 'Update title, artist, album, or genre for a local track. MP3 files also get ID3 tag updates.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        title: { type: 'string' },
        artist: { type: ['string', 'null'] },
        album: { type: ['string', 'null'] },
        genre: { type: ['string', 'null'] }
      },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'library_delete_track',
    description: 'Delete a local library track. Pass confirm=true. Set deleteFile=true to also remove the audio file from disk.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        deleteFile: { type: 'boolean' },
        confirm: { type: 'boolean' }
      },
      required: ['id', 'confirm'],
      additionalProperties: false
    }
  },
  {
    name: 'library_list_playlists',
    description: 'List local FMusic playlists.',
    inputSchema: emptySchema
  },
  {
    name: 'playlist_get',
    description: 'Get one playlist by id.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: { type: 'number' }
      },
      required: ['playlistId'],
      additionalProperties: false
    }
  },
  {
    name: 'playlist_get_tracks',
    description: 'List tracks in a playlist, including smart playlists.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: { type: 'number' },
        limit: { type: 'number', minimum: 1, maximum: 500 }
      },
      required: ['playlistId'],
      additionalProperties: false
    }
  },
  {
    name: 'playlist_create',
    description: 'Create a manual playlist.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        sourceUrl: { type: ['string', 'null'] }
      },
      required: ['name'],
      additionalProperties: false
    }
  },
  {
    name: 'playlist_create_smart',
    description: 'Create a smart playlist from a SmartPlaylistDefinition.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        definition: { type: 'object' }
      },
      required: ['name', 'definition'],
      additionalProperties: false
    }
  },
  {
    name: 'playlist_update_smart',
    description: 'Update a smart playlist name and SmartPlaylistDefinition.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: { type: 'number' },
        name: { type: 'string' },
        definition: { type: 'object' }
      },
      required: ['playlistId', 'name', 'definition'],
      additionalProperties: false
    }
  },
  {
    name: 'playlist_rename',
    description: 'Rename a user-created playlist. Built-in playlists cannot be renamed.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: { type: 'number' },
        name: { type: 'string' }
      },
      required: ['playlistId', 'name'],
      additionalProperties: false
    }
  },
  {
    name: 'playlist_delete',
    description: 'Delete a user-created playlist. Built-in playlists cannot be deleted. Pass confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: { type: 'number' },
        confirm: { type: 'boolean' }
      },
      required: ['playlistId', 'confirm'],
      additionalProperties: false
    }
  },
  {
    name: 'playlist_add_track',
    description: 'Add a local track to a manual playlist.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: { type: 'number' },
        trackId: { type: 'number' }
      },
      required: ['playlistId', 'trackId'],
      additionalProperties: false
    }
  },
  {
    name: 'playlist_remove_track',
    description: 'Remove a local track from a manual playlist.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: { type: 'number' },
        trackId: { type: 'number' }
      },
      required: ['playlistId', 'trackId'],
      additionalProperties: false
    }
  },
  {
    name: 'playlist_reorder',
    description: 'Reorder tracks in a manual playlist.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: { type: 'number' },
        orderedTrackIds: {
          type: 'array',
          items: { type: 'number' }
        }
      },
      required: ['playlistId', 'orderedTrackIds'],
      additionalProperties: false
    }
  },
  {
    name: 'library_play_track',
    description: 'Play a local library track by id. Optionally pass queueTrackIds to set the queue context.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'number' },
        queueTrackIds: {
          type: 'array',
          items: { type: 'number' }
        }
      },
      required: ['trackId'],
      additionalProperties: false
    }
  },
  {
    name: 'queue_play_next_track',
    description: 'Insert a local track after the currently playing track. If the queue is empty, prepare that track as the current queue item.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'number' },
        queueTrackIds: {
          type: 'array',
          items: { type: 'number' }
        }
      },
      required: ['trackId'],
      additionalProperties: false
    }
  },
  {
    name: 'download_search_youtube',
    description: 'Search YouTube through yt-dlp and mark results that are already in the local library.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 25 }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'download_video_info',
    description: 'Fetch metadata for a YouTube URL through yt-dlp.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' }
      },
      required: ['url'],
      additionalProperties: false
    }
  },
  {
    name: 'download_fetch_playlist',
    description: 'Fetch a YouTube playlist preview through yt-dlp.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' }
      },
      required: ['url'],
      additionalProperties: false
    }
  },
  {
    name: 'download_enqueue_url',
    description: 'Enqueue a YouTube URL for download. Optionally add the downloaded track to a local playlist.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        playlistId: { type: 'number' },
        format: { type: 'string', enum: ['mp3', 'm4a', 'opus'] },
        quality: { type: 'number' }
      },
      required: ['url'],
      additionalProperties: false
    }
  },
  {
    name: 'download_list',
    description: 'List current and recent FMusic download jobs.',
    inputSchema: emptySchema
  },
  {
    name: 'download_cancel',
    description: 'Cancel a queued or active download job.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' }
      },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'bookmark_list',
    description: 'List bookmarks for a track.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'number' }
      },
      required: ['trackId'],
      additionalProperties: false
    }
  },
  {
    name: 'bookmark_create',
    description: 'Create a bookmark for a track at a position in seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'number' },
        positionSec: { type: 'number', minimum: 0 },
        label: { type: ['string', 'null'] },
        color: { type: ['string', 'null'] }
      },
      required: ['trackId', 'positionSec'],
      additionalProperties: false
    }
  },
  {
    name: 'bookmark_update',
    description: 'Update a track bookmark label, position, or color.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        label: { type: ['string', 'null'] },
        positionSec: { type: 'number', minimum: 0 },
        color: { type: ['string', 'null'] }
      },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'bookmark_delete',
    description: 'Delete a track bookmark.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' }
      },
      required: ['id'],
      additionalProperties: false
    }
  }
];

function mcpUrl(): string | null {
  if (!server) return null;
  return `http://127.0.0.1:${serverPort}/mcp`;
}

export function getMcpServerInfo(): McpServerInfo {
  const enabled = getSettings().mcpServerEnabled;
  return {
    enabled,
    running: server !== null,
    url: enabled ? mcpUrl() : null
  };
}

export async function startMcpServer(): Promise<number> {
  if (server) return serverPort;
  if (!getSettings().mcpServerEnabled) return 0;

  const port = getSettings().mcpServerPort;
  if (!port || port < 1 || port > 65535) {
    console.warn('[mcp] MCP server not started: no valid port configured');
    return 0;
  }
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      void handleRequest(req, res).catch((err) => {
        sendJson(res, 500, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: err instanceof Error ? err.message : String(err) }
        });
      });
    });
    server.on('error', (err) => {
      server = null;
      serverPort = 0;
      reject(err);
    });
    server.listen(port, '127.0.0.1', () => {
      serverPort = (server!.address() as { port: number }).port;
      console.log(`[mcp] FMusic MCP server listening on http://127.0.0.1:${serverPort}/mcp`);
      resolve(serverPort);
    });
  });
}

export function stopMcpServer(): void {
  if (server) {
    server.close();
    console.log('[mcp] FMusic MCP server stopped');
  }
  server = null;
  serverPort = 0;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  if (url.pathname !== '/mcp') {
    sendText(res, 404, 'Not Found');
    return;
  }
  if (req.method === 'GET') {
    sendJson(res, 200, getMcpServerInfo());
    return;
  }
  if (req.method !== 'POST') {
    sendText(res, 405, 'Method Not Allowed');
    return;
  }

  const request = await readJson(req);
  if (Array.isArray(request)) {
    const responses = await Promise.all(request.map((item) => handleRpc(item)));
    sendJson(res, 200, responses.filter(Boolean));
    return;
  }

  const response = await handleRpc(request);
  if (!response) {
    res.writeHead(204);
    res.end();
    return;
  }
  sendJson(res, 200, response);
}

async function handleRpc(value: unknown): Promise<unknown> {
  const request = value as JsonRpcRequest;
  const id = request?.id ?? null;
  try {
    switch (request.method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'fmusic',
            version: '0.1.0'
          }
        });
      case 'notifications/initialized':
        return null;
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, { tools });
      case 'tools/call':
        return rpcResult(id, await callTool(request.params));
      default:
        return rpcError(id, -32601, `Unknown MCP method: ${request.method ?? 'missing'}`);
    }
  } catch (err) {
    return rpcError(id, -32603, err instanceof Error ? err.message : String(err));
  }
}

async function callTool(params: unknown): Promise<unknown> {
  const record = params as { name?: string; arguments?: Record<string, unknown> };
  const args = record.arguments ?? {};
  let data: unknown;

  switch (record.name) {
    case 'player_get_state':
      data = getRemoteControllerSnapshot();
      break;
    case 'player_play':
      if (!getRemoteControllerSnapshot()?.isPlaying) dispatchCommand({ type: 'toggle-play' });
      data = { ok: true };
      break;
    case 'player_pause':
      if (getRemoteControllerSnapshot()?.isPlaying) dispatchCommand({ type: 'toggle-play' });
      data = { ok: true };
      break;
    case 'player_toggle_play':
      dispatchCommand({ type: 'toggle-play' });
      data = { ok: true };
      break;
    case 'player_next':
      dispatchCommand({ type: 'next' });
      data = { ok: true };
      break;
    case 'player_previous':
      dispatchCommand({ type: 'prev' });
      data = { ok: true };
      break;
    case 'player_seek':
      dispatchCommand({ type: 'seek', seconds: numberArg(args, 'seconds', 0) });
      data = { ok: true };
      break;
    case 'player_set_volume':
      dispatchCommand({ type: 'volume', volume: Math.min(1, Math.max(0, numberArg(args, 'volume', 1))) });
      data = { ok: true };
      break;
    case 'library_search':
      data = listTracks(normalizeTrackQuery(args));
      break;
    case 'library_list_genres':
      data = listGenres();
      break;
    case 'library_metadata_suggestions':
      data = getTrackMetadataSuggestions();
      break;
    case 'library_get_track':
      data = getTrack(numberArg(args, 'id'));
      break;
    case 'library_update_track_metadata':
      data = updateTrack(numberArg(args, 'id'), trackMetadataPatch(args));
      broadcastRemoteControllerData();
      break;
    case 'library_delete_track': {
      requireConfirmation(args);
      const id = numberArg(args, 'id');
      const track = getTrack(id);
      const filePath = track && boolArg(args, 'deleteFile', false) ? resolveTrackFilePath(track) : null;
      const deleted = deleteTrack(id);
      if (deleted && filePath) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Match the existing IPC behavior: library deletion is authoritative.
        }
      }
      broadcastRemoteControllerData();
      data = { deleted };
      break;
    }
    case 'library_list_playlists':
      data = listPlaylists();
      break;
    case 'playlist_get':
      data = getPlaylist(numberArg(args, 'playlistId'));
      break;
    case 'playlist_get_tracks':
      data = listTracks({
        playlistId: numberArg(args, 'playlistId'),
        limit: Math.min(500, Math.max(1, Math.floor(numberArg(args, 'limit', 500))))
      });
      break;
    case 'playlist_create':
      data = createPlaylist(stringArg(args, 'name'), nullableStringArg(args, 'sourceUrl'));
      broadcastPlaylistsChanged();
      broadcastRemoteControllerData();
      break;
    case 'playlist_create_smart':
      data = createSmartPlaylist(stringArg(args, 'name'), smartDefinitionArg(args, 'definition'));
      broadcastPlaylistsChanged();
      broadcastRemoteControllerData();
      break;
    case 'playlist_update_smart':
      data = updateSmartPlaylist(
        numberArg(args, 'playlistId'),
        stringArg(args, 'name'),
        smartDefinitionArg(args, 'definition')
      );
      if (data) broadcastPlaylistsChanged();
      broadcastRemoteControllerData();
      break;
    case 'playlist_rename':
      data = renamePlaylist(numberArg(args, 'playlistId'), stringArg(args, 'name'));
      if (data) broadcastPlaylistsChanged();
      broadcastRemoteControllerData();
      break;
    case 'playlist_delete':
      requireConfirmation(args);
      {
        const deleted = deletePlaylist(numberArg(args, 'playlistId'));
        data = { deleted };
        if (deleted) broadcastPlaylistsChanged();
      }
      broadcastRemoteControllerData();
      break;
    case 'playlist_add_track':
      addTrackToPlaylist(numberArg(args, 'playlistId'), numberArg(args, 'trackId'));
      data = { ok: true };
      broadcastPlaylistsChanged();
      broadcastRemoteControllerData();
      break;
    case 'playlist_remove_track':
      removeTrackFromPlaylist(numberArg(args, 'playlistId'), numberArg(args, 'trackId'));
      data = { ok: true };
      broadcastPlaylistsChanged();
      broadcastRemoteControllerData();
      break;
    case 'playlist_reorder':
      reorderPlaylist(numberArg(args, 'playlistId'), numberArrayArg(args.orderedTrackIds));
      data = { ok: true };
      broadcastPlaylistsChanged();
      broadcastRemoteControllerData();
      break;
    case 'library_play_track': {
      const command: RemoteControllerCommand = {
        type: 'play-track',
        trackId: numberArg(args, 'trackId')
      };
      const queueTrackIds = numberArrayArg(args.queueTrackIds);
      if (queueTrackIds.length > 0) command.queueTrackIds = queueTrackIds;
      dispatchCommand(command);
      data = { ok: true };
      break;
    }
    case 'queue_play_next_track': {
      const command: RemoteControllerCommand = {
        type: 'play-next-track',
        trackId: numberArg(args, 'trackId')
      };
      const queueTrackIds = numberArrayArg(args.queueTrackIds);
      if (queueTrackIds.length > 0) command.queueTrackIds = queueTrackIds;
      dispatchCommand(command);
      data = { ok: true };
      break;
    }
    case 'download_search_youtube': {
      const results = await searchYouTube(
        stringArg(args, 'query'),
        Math.min(25, Math.max(1, Math.floor(numberArg(args, 'limit', 10))))
      );
      const downloaded = new Set(findDownloadedYoutubeIds(results.map((result) => result.id)));
      data = results.map((result) => ({ ...result, inLibrary: downloaded.has(result.id) }));
      break;
    }
    case 'download_video_info':
      data = await fetchVideoInfo(stringArg(args, 'url'));
      break;
    case 'download_fetch_playlist':
      data = await fetchPlaylistEntries(stringArg(args, 'url'));
      break;
    case 'download_enqueue_url': {
      const url = stringArg(args, 'url');
      const youtubeId = extractYoutubeId(url);
      if (youtubeId && findDownloadedYoutubeIds([youtubeId]).includes(youtubeId)) {
        throw new Error('Already in library.');
      }
      const request: DownloadRequest = { url };
      const playlistId = optionalNumberArg(args, 'playlistId');
      const quality = optionalNumberArg(args, 'quality');
      const format = optionalStringArg(args, 'format');
      if (playlistId !== undefined) request.playlistId = playlistId;
      if (quality !== undefined) request.quality = quality;
      if (format === 'mp3' || format === 'm4a' || format === 'opus') request.format = format;
      data = getDownloadManager().enqueue(request);
      break;
    }
    case 'download_list':
      data = getDownloadManager().list();
      break;
    case 'download_cancel':
      data = { cancelled: getDownloadManager().cancel(stringArg(args, 'id')) };
      break;
    case 'bookmark_list':
      data = listTrackBookmarks(numberArg(args, 'trackId'));
      break;
    case 'bookmark_create': {
      const bookmark = createTrackBookmark(
        numberArg(args, 'trackId'),
        numberArg(args, 'positionSec'),
        nullableStringArg(args, 'label'),
        nullableStringArg(args, 'color')
      );
      broadcastTrackBookmarksChanged(bookmark.trackId);
      data = bookmark;
      break;
    }
    case 'bookmark_update': {
      const current = getTrackBookmark(numberArg(args, 'id'));
      data = updateTrackBookmark(numberArg(args, 'id'), bookmarkPatch(args));
      if (current) broadcastTrackBookmarksChanged(current.trackId);
      break;
    }
    case 'bookmark_delete': {
      const current = getTrackBookmark(numberArg(args, 'id'));
      const deleted = deleteTrackBookmark(numberArg(args, 'id'));
      if (current && deleted) broadcastTrackBookmarksChanged(current.trackId);
      data = { deleted };
      break;
    }
    default:
      throw new Error(`Unknown MCP tool: ${record.name ?? 'missing'}`);
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function dispatchCommand(command: RemoteControllerCommand): void {
  if (!dispatchRemoteControllerCommand(command)) {
    throw new Error('FMusic renderer is not ready to receive player commands yet.');
  }
}

function broadcastTrackBookmarksChanged(trackId: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(Channels.TrackBookmarksChanged, { trackId });
    }
  }
}

function broadcastPlaylistsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(Channels.PlaylistsChanged, null);
    }
  }
}

function normalizeTrackQuery(args: Record<string, unknown>): TrackQuery {
  const query: TrackQuery = {
    sortBy: 'downloadedAt',
    sortDir: 'desc',
    limit: Math.min(200, Math.max(1, Math.floor(numberArg(args, 'limit', 50))))
  };
  if (typeof args.search === 'string' && args.search.trim()) query.search = args.search.trim();
  if (typeof args.genre === 'string' && args.genre.trim()) query.genre = args.genre.trim();
  if (typeof args.playlistId === 'number' && Number.isFinite(args.playlistId)) {
    query.playlistId = Math.floor(args.playlistId);
  }
  return query;
}

function numberArg(args: Record<string, unknown>, key: string, fallback?: number): number {
  const value = args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing numeric argument: ${key}`);
}

function optionalNumberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error(`Missing string argument: ${key}`);
}

function optionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nullableStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  throw new Error(`Invalid string argument: ${key}`);
}

function boolArg(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = args[key];
  return typeof value === 'boolean' ? value : fallback;
}

function requireConfirmation(args: Record<string, unknown>): void {
  if (args.confirm !== true) {
    throw new Error('This destructive tool requires confirm=true.');
  }
}

function trackMetadataPatch(args: Record<string, unknown>): Partial<Pick<Track, 'title' | 'artist' | 'album' | 'genre'>> {
  const patch: Partial<Pick<Track, 'title' | 'artist' | 'album' | 'genre'>> = {};
  if (Object.prototype.hasOwnProperty.call(args, 'title')) patch.title = stringArg(args, 'title');
  if (Object.prototype.hasOwnProperty.call(args, 'artist')) patch.artist = nullableStringArg(args, 'artist');
  if (Object.prototype.hasOwnProperty.call(args, 'album')) patch.album = nullableStringArg(args, 'album');
  if (Object.prototype.hasOwnProperty.call(args, 'genre')) patch.genre = nullableStringArg(args, 'genre');
  return patch;
}

function bookmarkPatch(args: Record<string, unknown>) {
  const patch: Parameters<typeof updateTrackBookmark>[1] = {};
  if (Object.prototype.hasOwnProperty.call(args, 'label')) patch.label = nullableStringArg(args, 'label');
  if (Object.prototype.hasOwnProperty.call(args, 'positionSec')) patch.positionSec = numberArg(args, 'positionSec');
  if (Object.prototype.hasOwnProperty.call(args, 'color')) {
    const color = nullableStringArg(args, 'color');
    if (color !== null) patch.color = color;
  }
  return patch;
}

function smartDefinitionArg(args: Record<string, unknown>, key: string): SmartPlaylistDefinition {
  const value = args[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Missing smart playlist definition: ${key}`);
  }
  return value as SmartPlaylistDefinition;
}

function numberArrayArg(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}

function rpcResult(id: JsonRpcId, result: unknown): unknown {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'http://127.0.0.1'
  });
  res.end(JSON.stringify(payload));
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
