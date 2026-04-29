import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  findDownloadedYoutubeIds,
  getTrack,
  getTrackEmbeddedArtworkDataUrl,
  listTracks
} from './library/tracks-repo.js';
import {
  addTrackToPlaylist,
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  removeTrackFromPlaylist,
  renamePlaylist,
  reorderPlaylist
} from './library/playlists-repo.js';
import { getDownloadManager } from './download-manager.js';
import { searchYouTube } from './ytdlp.js';
import { getSettings } from './settings.js';
import { getLocalIp, getServicePort } from './network.js';
import enBundle from '../shared/i18n/en.json';
import esBundle from '../shared/i18n/es.json';
import { toErrorMessage } from '../shared/errors.js';
import { extractYoutubeId } from '../shared/youtube.js';
import type {
  DownloadRequest,
  Locale,
  Playlist,
  RemoteControllerCommand,
  RemoteControllerInfo,
  RemotePlayerSnapshot,
  SearchResult,
  Track,
  TrackQuery
} from '../shared/types.js';

let token = crypto.randomBytes(24).toString('hex');
let lastSnapshot: RemotePlayerSnapshot | null = null;
let commandHandler: ((command: RemoteControllerCommand) => void) | null = null;
const clients = new Set<Duplex>();

type RemoteAction =
  | { type: 'library:list'; query?: TrackQuery }
  | { type: 'playlists:list' }
  | { type: 'playlist:tracks'; playlistId: number }
  | { type: 'playlist:create'; name: string }
  | { type: 'playlist:rename'; playlistId: number; name: string }
  | { type: 'playlist:delete'; playlistId: number }
  | { type: 'playlist:add-track'; playlistId: number; trackId: number }
  | { type: 'playlist:remove-track'; playlistId: number; trackId: number }
  | { type: 'playlist:reorder'; playlistId: number; orderedTrackIds: number[] }
  | { type: 'download:enqueue'; url: string; playlistId?: number }
  | { type: 'download:cancel'; id: string }
  | { type: 'yt:search'; query: string };

type RemoteIncoming =
  | ({ requestId?: string } & RemoteControllerCommand)
  | ({ requestId?: string } & RemoteAction)
  | { requestId?: string; type: 'request-state' };

interface RemoteDataSnapshot {
  tracks: Track[];
  playlists: Playlist[];
}

function remoteUrl(): string | null {
  const port = getServicePort('remote-controller');
  if (!port) return null;
  return `http://${getLocalIp()}:${port}/remote?token=${token}`;
}

function sendJson(socket: Duplex, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload));
  let header: Buffer;
  if (body.length < 126) {
    header = Buffer.from([0x81, body.length]);
  } else if (body.length <= 0xffff) {
    header = Buffer.concat([
      Buffer.from([0x81, 126]),
      Buffer.from([(body.length >> 8) & 0xff, body.length & 0xff])
    ]);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  socket.write(Buffer.concat([header, body]));
}

function broadcast(payload: unknown): void {
  for (const client of clients) sendJson(client, payload);
}

function remoteDataSnapshot(): RemoteDataSnapshot {
  return {
    tracks: listTracks({ limit: 80, sortBy: 'downloadedAt', sortDir: 'desc' }),
    playlists: listPlaylists()
  };
}

function broadcastData(): void {
  broadcast({ type: 'data', data: remoteDataSnapshot() });
}

export function broadcastRemoteControllerData(): void {
  broadcastData();
}

function currentLocale(): Locale {
  return (getSettings().language ?? 'en') as Locale;
}

function remoteSettingsPayload(): { language: Locale } {
  return { language: currentLocale() };
}

export function broadcastRemoteControllerSettings(): void {
  broadcast({ type: 'settings', data: remoteSettingsPayload() });
}

function readFrame(buffer: Buffer): string | null {
  if (buffer.length < 6) return null;
  const opcode = buffer[0] & 0x0f;
  if (opcode === 0x8) return null;
  let offset = 2;
  let length = buffer[1] & 0x7f;
  if (length === 126) {
    if (buffer.length < 8) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    return null;
  }
  const masked = (buffer[1] & 0x80) !== 0;
  if (!masked || buffer.length < offset + 4 + length) return null;
  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.alloc(length);
  for (let i = 0; i < length; i++) {
    payload[i] = buffer[offset + i] ^ mask[i % 4];
  }
  return payload.toString('utf8');
}

function numberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}

function normalizeIncoming(value: unknown): RemoteIncoming | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const requestId = typeof record.requestId === 'string' ? record.requestId : undefined;
  if (record.type === 'request-state') return { type: 'request-state', requestId };
  if (record.type === 'toggle-play' || record.type === 'prev' || record.type === 'next') {
    return { type: record.type, requestId };
  }
  if (record.type === 'seek' && typeof record.seconds === 'number') {
    return { type: 'seek', seconds: Math.max(0, record.seconds), requestId };
  }
  if (record.type === 'volume' && typeof record.volume === 'number') {
    return { type: 'volume', volume: Math.min(1, Math.max(0, record.volume)), requestId };
  }
  if (
    (record.type === 'play-track' || record.type === 'play-next-track') &&
    typeof record.trackId === 'number'
  ) {
    return {
      type: record.type,
      trackId: record.trackId,
      queueTrackIds: numberArray(record.queueTrackIds),
      requestId
    };
  }
  if (record.type === 'sonos-discover' || record.type === 'sonos-stop-all') {
    return { type: record.type, requestId };
  }
  if (
    (record.type === 'sonos-add-by-ip' ||
      record.type === 'sonos-cast' ||
      record.type === 'sonos-stop') &&
    typeof record.host === 'string'
  ) {
    return { type: record.type, host: record.host.trim(), requestId };
  }
  if (record.type === 'library:list') {
    return { type: 'library:list', query: record.query as TrackQuery | undefined, requestId };
  }
  if (record.type === 'playlists:list') return { type: 'playlists:list', requestId };
  if (record.type === 'playlist:tracks' && typeof record.playlistId === 'number') {
    return { type: 'playlist:tracks', playlistId: record.playlistId, requestId };
  }
  if (record.type === 'playlist:create' && typeof record.name === 'string') {
    return { type: 'playlist:create', name: record.name.trim(), requestId };
  }
  if (
    record.type === 'playlist:rename' &&
    typeof record.playlistId === 'number' &&
    typeof record.name === 'string'
  ) {
    return {
      type: 'playlist:rename',
      playlistId: record.playlistId,
      name: record.name.trim(),
      requestId
    };
  }
  if (record.type === 'playlist:delete' && typeof record.playlistId === 'number') {
    return { type: 'playlist:delete', playlistId: record.playlistId, requestId };
  }
  if (
    (record.type === 'playlist:add-track' || record.type === 'playlist:remove-track') &&
    typeof record.playlistId === 'number' &&
    typeof record.trackId === 'number'
  ) {
    return {
      type: record.type,
      playlistId: record.playlistId,
      trackId: record.trackId,
      requestId
    };
  }
  if (
    record.type === 'playlist:reorder' &&
    typeof record.playlistId === 'number' &&
    Array.isArray(record.orderedTrackIds)
  ) {
    return {
      type: record.type,
      playlistId: record.playlistId,
      orderedTrackIds: numberArray(record.orderedTrackIds) ?? [],
      requestId
    };
  }
  if (record.type === 'download:enqueue' && typeof record.url === 'string') {
    return {
      type: 'download:enqueue',
      url: record.url.trim(),
      playlistId: typeof record.playlistId === 'number' ? record.playlistId : undefined,
      requestId
    };
  }
  if (record.type === 'download:cancel' && typeof record.id === 'string') {
    return { type: 'download:cancel', id: record.id, requestId };
  }
  if (record.type === 'yt:search' && typeof record.query === 'string') {
    return { type: 'yt:search', query: record.query.trim(), requestId };
  }
  return null;
}

function sendResult(socket: Duplex, requestId: string | undefined, data: unknown): void {
  if (requestId) sendJson(socket, { type: 'result', requestId, data });
}

function sendError(socket: Duplex, requestId: string | undefined, message: string): void {
  if (requestId) sendJson(socket, { type: 'error', requestId, message });
}

async function handleAction(socket: Duplex, action: RemoteAction & { requestId?: string }): Promise<void> {
  switch (action.type) {
    case 'library:list':
      sendResult(socket, action.requestId, listTracks({ limit: 120, ...(action.query ?? {}) }));
      return;
    case 'playlists:list':
      sendResult(socket, action.requestId, listPlaylists());
      return;
    case 'playlist:tracks':
      sendResult(socket, action.requestId, listTracks({ playlistId: action.playlistId, limit: 500 }));
      return;
    case 'playlist:create': {
      if (!action.name) throw new Error('Playlist name is required.');
      const playlist = createPlaylist(action.name);
      sendResult(socket, action.requestId, playlist);
      broadcastData();
      return;
    }
    case 'playlist:rename': {
      if (!action.name) throw new Error('Playlist name is required.');
      const playlist = renamePlaylist(action.playlistId, action.name);
      sendResult(socket, action.requestId, playlist);
      broadcastData();
      return;
    }
    case 'playlist:delete': {
      const deleted = deletePlaylist(action.playlistId);
      sendResult(socket, action.requestId, deleted);
      broadcastData();
      return;
    }
    case 'playlist:add-track':
      addTrackToPlaylist(action.playlistId, action.trackId);
      sendResult(socket, action.requestId, true);
      broadcastData();
      return;
    case 'playlist:remove-track':
      removeTrackFromPlaylist(action.playlistId, action.trackId);
      sendResult(socket, action.requestId, true);
      broadcastData();
      return;
    case 'playlist:reorder':
      reorderPlaylist(action.playlistId, action.orderedTrackIds);
      sendResult(socket, action.requestId, true);
      broadcastData();
      return;
    case 'download:enqueue': {
      if (!action.url) throw new Error('URL is required.');
      const youtubeId = extractYoutubeId(action.url);
      if (youtubeId && findDownloadedYoutubeIds([youtubeId]).includes(youtubeId)) {
        throw new Error('Already in library.');
      }
      const request: DownloadRequest = { url: action.url };
      if (action.playlistId !== undefined) request.playlistId = action.playlistId;
      const job = getDownloadManager().enqueue(request);
      sendResult(socket, action.requestId, job);
      return;
    }
    case 'download:cancel':
      sendResult(socket, action.requestId, getDownloadManager().cancel(action.id));
      return;
    case 'yt:search': {
      const results: SearchResult[] = action.query ? await searchYouTube(action.query, 10) : [];
      const downloaded = new Set(findDownloadedYoutubeIds(results.map((result) => result.id)));
      sendResult(
        socket,
        action.requestId,
        results.map((result) => ({ ...result, inLibrary: downloaded.has(result.id) }))
      );
      return;
    }
  }
}

function serveRemotePage(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  const locale = currentLocale();
  const bundlesJson = JSON.stringify({ en: enBundle, es: esBundle }).replace(/</g, '\\u003c');
  res.end(`<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FMusic Remote</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101216; color: #f5f7fb; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #101216; overflow-x: hidden; }
    main { min-height: 100vh; display: grid; grid-template-rows: auto auto auto 1fr; gap: 10px; padding: 12px; }
    header { display: flex; justify-content: space-between; align-items: center; color: #9aa3b5; font-size: 13px; }
    nav { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; padding: 3px; border: 1px solid #272c36; border-radius: 12px; background: #171b22; }
    nav button { width: auto; height: 34px; border: 0; border-radius: 999px; font-size: 12px; background: transparent; color: #9aa3b5; }
    nav button.active { background: #242a35; color: #f5f7fb; }
    .view { display: none; min-width: 0; }
    .view.active { display: block; }
    .status { width: 9px; height: 9px; border-radius: 50%; background: #ef4444; display: inline-block; margin-right: 6px; }
    .status.on { background: #3ddc97; }
    .player-head { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 14px; align-items: center; margin-top: 4px; }
    .cover { width: 92px; aspect-ratio: 1; border-radius: 12px; background: #20242d; display: grid; place-items: center; overflow: hidden; box-shadow: 0 14px 32px rgba(0,0,0,.25); }
    .cover img { width: 100%; height: 100%; object-fit: cover; }
    .note { color: #687184; font-size: 38px; }
    h1 { margin: 0; font-size: 22px; line-height: 1.1; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .artist { margin-top: 6px; color: #a9b1c1; font-size: 14px; min-height: 19px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .scrub { margin-top: 14px; display: grid; grid-template-columns: 42px 1fr 42px; gap: 8px; align-items: center; color: #9aa3b5; font-variant-numeric: tabular-nums; font-size: 11px; }
    input[type="range"] { width: 100%; accent-color: #3ddc97; }
    .bookmark-strip { min-height: 34px; display: flex; gap: 7px; align-items: center; overflow-x: auto; padding: 8px 0 0 50px; scrollbar-width: none; }
    .bookmark-strip::-webkit-scrollbar { display: none; }
    .bookmark-chip { width: auto; max-width: 190px; height: 26px; min-width: 0; padding: 0 9px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--bookmark-color, #3ddc97) 65%, #303642); background: color-mix(in srgb, var(--bookmark-color, #3ddc97) 13%, #151920); color: #f5f7fb; font-size: 11px; display: inline-flex; align-items: center; gap: 6px; }
    .bookmark-chip::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--bookmark-color, #3ddc97); box-shadow: 0 0 8px color-mix(in srgb, var(--bookmark-color, #3ddc97) 55%, transparent); flex: 0 0 auto; }
    .bookmark-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bookmark-chip time { color: #9aa3b5; font-variant-numeric: tabular-nums; flex: 0 0 auto; }
    .buttons { display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 14px; }
    button { border: 1px solid #303642; background: #191d25; color: #f5f7fb; border-radius: 999px; width: 46px; height: 46px; font-size: 18px; }
    button.primary { width: 58px; height: 58px; background: #3ddc97; border: 0; color: #08110d; font-size: 22px; }
    button svg { width: 17px; height: 17px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    button .play-icon { fill: currentColor; stroke: none; }
    button:disabled { opacity: .35; }
    .volume { display: flex; align-items: center; gap: 10px; margin-top: 14px; color: #9aa3b5; font-size: 12px; }
    h2 { margin: 0 0 8px; font-size: 14px; color: #d8dce5; }
    .toolbar { display: flex; gap: 6px; margin: 0 0 8px; }
    .toolbar input, .toolbar select { min-width: 0; flex: 1; }
    input, select { height: 36px; border-radius: 9px; border: 1px solid #303642; background: #171b22; color: #f5f7fb; padding: 0 10px; }
    .wide { width: auto; min-width: 68px; height: 36px; border-radius: 9px; font-size: 12px; }
    .list { display: grid; gap: 6px; }
    .row, .job, .playlist { display: grid; gap: 6px; padding: 9px; border: 1px solid #252a34; border-radius: 10px; background: #151920; }
    .row-title, .job-title, .playlist-title { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 13px; }
    .row-title span:first-child, .job-title span:first-child, .playlist-title span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { color: #9aa3b5; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .actions button { width: auto; min-width: 46px; height: 30px; border-radius: 8px; font-size: 11px; padding: 0 9px; }
    .icon-btn-small { width: 34px !important; min-width: 34px !important; height: 30px !important; padding: 0 !important; border-radius: 8px !important; display: grid; place-items: center; font-size: 0 !important; }
    .icon-btn-small svg, .wide svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .wide.icon-only { min-width: 42px; display: grid; place-items: center; font-size: 0; }
    .library-row { display: grid; grid-template-columns: 54px minmax(0, 1fr); gap: 10px; align-items: start; }
    .thumb { width: 54px; height: 54px; border-radius: 9px; overflow: hidden; background: #20242d; display: grid; place-items: center; color: #687184; font-weight: 700; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; }
    .library-main { min-width: 0; display: grid; gap: 6px; }
    .library-title { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: baseline; font-size: 13px; }
    .library-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .duration { color: #9aa3b5; font-size: 11px; font-variant-numeric: tabular-nums; }
    .library-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .library-actions button { width: 100%; height: 30px; border-radius: 8px; font-size: 0; display: grid; place-items: center; }
    .library-actions svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .library-actions .play-icon { fill: currentColor; stroke: none; }
    .library-playlist { width: 100%; min-width: 0; height: 32px; font-size: 11px; }
    .playlist-track { grid-template-columns: 46px minmax(0, 1fr); gap: 9px; }
    .playlist-track .thumb { width: 46px; height: 46px; border-radius: 8px; }
    .playlist-track .actions { margin-top: 2px; }
    .download-result { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 9px; align-items: start; }
    .download-thumb { width: 74px; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; background: #20242d; display: grid; place-items: center; color: #687184; font-weight: 700; }
    .download-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .download-main { min-width: 0; display: grid; gap: 6px; }
    .download-title { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: baseline; font-size: 13px; }
    .download-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .download-actions { display: grid; grid-template-columns: 1fr; gap: 6px; }
    .download-actions button { width: 100%; height: 30px; border-radius: 8px; font-size: 11px; }
    .download-actions button.in-library { color: #9aa3b5; background: #20242d; }
    .bar { height: 6px; background: #252a34; border-radius: 999px; overflow: hidden; }
    .fill { height: 100%; background: #3ddc97; width: 0%; }
    .empty { color: #687184; font-size: 13px; }
    .message { min-height: 18px; color: #9aa3b5; font-size: 12px; margin-bottom: 10px; }
    .sonos-inline { margin-top: 12px; padding: 10px; border: 1px solid #252a34; border-radius: 12px; background: #151920; }
    .sonos-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; font-size: 12px; color: #cfd5df; }
    .sonos-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .sonos-actions button { width: auto; height: 30px; min-width: 62px; border-radius: 8px; font-size: 11px; padding: 0 9px; }
    .sonos-add { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; margin-bottom: 8px; }
    .sonos-add button { width: auto; height: 36px; min-width: 52px; border-radius: 999px; font-size: 12px; }
    .sonos-device { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 6px; align-items: center; padding: 7px 0; border-top: 1px solid #252a34; }
    .sonos-device:first-of-type { border-top: 0; }
    .sonos-device button { width: auto; min-width: 48px; height: 30px; border-radius: 8px; font-size: 11px; padding: 0 8px; }
    .badge { color: #3ddc97; font-size: 11px; }
    .hidden { display: none !important; }
    .row.now-playing { border-color: #3ddc97; background: rgba(61, 220, 151, 0.08); }
    .row.now-playing .library-title strong { color: #3ddc97; }
    .thumb { position: relative; }
    .now-playing-equalizer { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; gap: 2px; padding: 6px 4px; background: rgba(8, 17, 13, 0.45); pointer-events: none; }
    .now-playing-equalizer span { display: block; width: 3px; background: #3ddc97; border-radius: 1px; animation: remote-eq 1s ease-in-out infinite; }
    .now-playing-equalizer span:nth-child(1) { animation-delay: 0s; }
    .now-playing-equalizer span:nth-child(2) { animation-delay: .18s; }
    .now-playing-equalizer span:nth-child(3) { animation-delay: .36s; }
    .now-playing-equalizer span:nth-child(4) { animation-delay: .54s; }
    .now-playing-equalizer.paused span { animation-play-state: paused; }
    @keyframes remote-eq { 0%, 100% { height: 25%; } 50% { height: 95%; } }
    .beta-badge { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: #3ddc97; color: #08110d; font-size: 10px; font-weight: 700; letter-spacing: .04em; vertical-align: middle; }
    .beta-notice { margin: -4px 0 2px; padding: 8px 10px; border: 1px solid rgba(61, 220, 151, .35); border-radius: 10px; background: rgba(61, 220, 151, .08); color: #cfd5df; font-size: 11px; line-height: 1.35; }
  </style>
</head>
<body>
<main>
  <header><strong>FMusic Remote<span class="beta-badge" data-i18n="remote.status.betaBadge">BETA</span></strong><span><i id="dot" class="status"></i><span id="conn" data-i18n="remote.status.connecting">Connecting</span></span></header>
  <div class="beta-notice" role="note" data-i18n="remote.status.betaNotice">BETA: expect rough edges and occasional bugs.</div>
  <nav>
    <button class="active" data-view="player" data-i18n="nav.player">Player</button>
    <button data-view="library" data-i18n="nav.library">Library</button>
    <button data-view="downloads" data-i18n="nav.download">Downloads</button>
    <button data-view="playlists" data-i18n="nav.playlists">Playlists</button>
  </nav>
  <section id="player" class="view active">
    <div class="player-head">
      <div class="cover" id="cover"><span class="note">F</span></div>
      <div>
        <h1 id="title" data-i18n="player.nothingPlaying">Nothing playing</h1>
        <div class="artist" id="artist"></div>
      </div>
    </div>
    <div class="scrub"><span id="pos">0:00</span><input id="seek" type="range" min="0" max="1" step="0.5" value="0" disabled /><span id="dur">0:00</span></div>
    <div id="bookmarkStrip" class="bookmark-strip"></div>
    <div class="buttons">
      <button id="prev" data-i18n-aria="player.previous" data-i18n-title="player.previous" aria-label="Previous" title="Previous"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="play-icon" d="M19 20 9 12l10-8v16Z"/><path d="M5 19V5"/></svg></button>
      <button id="play" class="primary" data-i18n-aria="remote.player.toggle" data-i18n-title="remote.player.toggle" aria-label="Play or pause" title="Play or pause"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="play-icon" d="M8 5v14l11-7z"/></svg></button>
      <button id="next" data-i18n-aria="player.next" data-i18n-title="player.next" aria-label="Next" title="Next"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="play-icon" d="m5 4 10 8-10 8V4Z"/><path d="M19 5v14"/></svg></button>
    </div>
    <div class="volume"><span data-i18n="player.volume">Volume</span><input id="volume" type="range" min="0" max="1" step="0.01" value="0.9" /></div>
    <div id="sonosPanel" class="sonos-inline hidden"></div>
  </section>
  <section id="library" class="view">
    <div class="toolbar"><input id="libraryQuery" data-i18n-placeholder="library.searchPlaceholder" placeholder="Search library" /><button id="librarySearch" class="wide icon-only" data-i18n-aria="remote.library.search" data-i18n-title="remote.library.search" aria-label="Search" title="Search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button></div>
    <div id="libraryList" class="list empty" data-i18n="library.empty">No tracks</div>
  </section>
  <section id="downloads" class="view">
    <div class="toolbar"><input id="downloadUrl" data-i18n-placeholder="remote.download.placeholder" placeholder="YouTube URL or search" /><button id="downloadGo" class="wide icon-only" data-i18n-aria="remote.download.searchOrDownload" data-i18n-title="remote.download.searchOrDownload" aria-label="Search or download" title="Search or download"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button></div>
    <div id="downloadMessage" class="message"></div>
    <div id="searchResults" class="list"></div>
    <h2 data-i18n="remote.download.queue">Queue</h2>
    <div id="downloadList" class="list empty" data-i18n="remote.download.empty">No active downloads</div>
  </section>
  <section id="playlists" class="view">
    <div class="toolbar"><input id="playlistName" data-i18n-placeholder="playlists.newPlaceholder" placeholder="New playlist" /><button id="playlistCreate" class="wide icon-only" data-i18n-aria="playlists.create" data-i18n-title="playlists.create" aria-label="Create playlist" title="Create playlist"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>
    <div id="playlistList" class="list empty" data-i18n="playlists.none">No playlists</div>
  </section>
</main>
<script>
window.__REMOTE_I18N__ = ${bundlesJson};
window.__REMOTE_LOCALE__ = ${JSON.stringify(locale)};
let locale = window.__REMOTE_LOCALE__ || 'en';
const bundles = window.__REMOTE_I18N__ || { en: {}, es: {} };
function lookup(bundle, key) {
  const parts = String(key || '').split('.');
  let node = bundle;
  for (const part of parts) {
    if (!node || typeof node !== 'object') return null;
    node = node[part];
  }
  return typeof node === 'string' ? node : null;
}
function t(key, params) {
  const raw = lookup(bundles[locale] || {}, key) ?? lookup(bundles.en || {}, key);
  if (raw == null) return key;
  if (!params) return raw;
  return raw.replace(/\\{(\\w+)\\}/g, (_, name) => (params[name] != null ? String(params[name]) : '{' + name + '}'));
}
function applyI18n(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.getAttribute('data-i18n')); });
  scope.querySelectorAll('[data-i18n-title]').forEach((node) => { node.setAttribute('title', t(node.getAttribute('data-i18n-title'))); });
  scope.querySelectorAll('[data-i18n-aria]').forEach((node) => { node.setAttribute('aria-label', t(node.getAttribute('data-i18n-aria'))); });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach((node) => { node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder'))); });
}
const token = new URLSearchParams(location.search).get('token') || '';
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/remote-ws?token=' + encodeURIComponent(token));
const el = (id) => document.getElementById(id);
const fmt = (s) => { s = Math.max(0, Math.floor(Number(s) || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const equalizerMarkup = '<span class="now-playing-equalizer"><span></span><span></span><span></span><span></span></span>';
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="play-icon" d="M8 5v14l11-7z"/></svg>';
const playNextIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="play-icon" d="M5 5v14l8-7z"/><path d="M16 5v14M20 9v6M17 12h6"/></svg>';
const prevIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="play-icon" d="M19 20 9 12l10-8v16Z"/><path d="M5 19V5"/></svg>';
const nextIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="play-icon" d="m5 4 10 8-10 8V4Z"/><path d="M19 5v14"/></svg>';
const searchIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const downloadIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
const closeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const refreshIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/></svg>';
const stopIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';
const castIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M2 16a6 6 0 0 1 6 6"/><path d="M2 20a2 2 0 0 1 2 2"/><path d="M2 12a10 10 0 0 1 10 10"/></svg>';
const plusIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const openIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
const editIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const trashIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>';
const upIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>';
const downIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const extractYtId = (value) => {
  const text = String(value || '');
  const match = text.match(/(?:v=|youtu\\.be\\/|embed\\/|shorts\\/)([A-Za-z0-9_-]{6,})/);
  return match ? match[1] : null;
};
let current = null;
let data = { tracks: [], playlists: [] };
let playlistTracks = new Map();
let scrubbing = false;
let coverTrackId = null;
let requestSeq = 0;
const pending = new Map();
function send(msg) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
function request(msg) {
  const requestId = 'r' + (++requestSeq);
  send({ ...msg, requestId });
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        reject(new Error('Request timed out'));
      }
    }, 20000);
  });
}
function render(state) {
  current = state;
  el('title').textContent = state.title || t('player.nothingPlaying');
  el('artist').textContent = state.artist || state.album || '';
  el('play').innerHTML = state.isPlaying
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>'
    : playIcon;
  el('prev').disabled = !state.hasPrev;
  el('next').disabled = !state.hasNext;
  el('seek').disabled = !state.trackId || !state.duration;
  el('seek').max = state.duration || 1;
  if (!scrubbing) el('seek').value = state.position || 0;
  el('pos').textContent = fmt(scrubbing ? el('seek').value : state.position);
  el('dur').textContent = fmt(state.duration);
  const bookmarkStrip = el('bookmarkStrip');
  const bookmarks = [...(state.bookmarks || [])].sort((a, b) => (a.positionSec || 0) - (b.positionSec || 0));
  bookmarkStrip.innerHTML = bookmarks.length && state.duration
    ? bookmarks.map((bookmark) => {
        const time = fmt(bookmark.positionSec);
        const label = bookmark.label || time;
        const content = bookmark.label ? '<span>' + esc(bookmark.label) + '</span><time>' + esc(time) + '</time>' : '<time>' + esc(time) + '</time>';
        const aria = t('player.seekToBookmark', { time: fmt(bookmark.positionSec) });
        return '<button class="bookmark-chip" data-bookmark-seek="' + Number(bookmark.positionSec) + '" style="--bookmark-color:' + esc(bookmark.color || '#3ddc97') + '" aria-label="' + esc(aria) + '" title="' + esc(label) + '">' + content + '</button>';
      }).join('')
    : '';
  el('volume').value = state.volume ?? 0.9;
  const cover = el('cover');
  if (coverTrackId !== state.trackId) {
    coverTrackId = state.trackId;
    cover.innerHTML = state.trackId ? '<img alt="" src="/artwork/' + state.trackId + '?token=' + encodeURIComponent(token) + '&v=' + state.trackId + '">' : '<span class="note">F</span>';
  }
  const jobs = (state.downloads || []).filter((j) => !['completed', 'cancelled'].includes(j.status)).slice(0, 5);
  el('downloadList').className = jobs.length ? 'list' : 'list empty';
  el('downloadList').innerHTML = jobs.length ? jobs.map((j) => '<div class="job"><div class="job-title"><span>' + esc(j.title || j.request.url) + '</span><span>' + esc(j.status) + '</span></div><div class="bar"><div class="fill" style="width:' + Math.round((j.progress || 0) * 100) + '%"></div></div><div class="actions"><button class="icon-btn-small" data-cancel="' + esc(j.id) + '" aria-label="' + esc(t('remote.download.cancelTooltip')) + '" title="' + esc(t('remote.download.cancelTooltip')) + '">' + closeIcon + '</button></div></div>').join('') : t('remote.download.empty');
  renderSonos(state.sonos);
  updateHighlight();
}
function updateHighlight() {
  const currentId = current?.trackId ?? null;
  const isPlaying = !!current?.isPlaying;
  document.querySelectorAll('[data-track-id]').forEach((row) => {
    const id = Number(row.getAttribute('data-track-id'));
    const isCurrent = id === currentId && currentId !== null;
    row.classList.toggle('now-playing', isCurrent);
    const thumb = row.querySelector('.thumb');
    if (!thumb) return;
    let eq = thumb.querySelector(':scope > .now-playing-equalizer');
    if (isCurrent) {
      if (!eq) {
        thumb.insertAdjacentHTML('beforeend', equalizerMarkup);
        eq = thumb.querySelector(':scope > .now-playing-equalizer');
      }
      if (eq) eq.classList.toggle('paused', !isPlaying);
    } else if (eq) {
      eq.remove();
    }
  });
}
function activeDownloadIds() {
  return new Set((current?.downloads || [])
    .filter((job) => ['queued', 'fetching-metadata', 'downloading', 'processing'].includes(job.status))
    .map((job) => job.youtubeId || extractYtId(job.request?.url))
    .filter(Boolean));
}
function renderSonos(sonos) {
  const enabled = !!sonos?.enabled;
  const panel = el('sonosPanel');
  panel.classList.toggle('hidden', !enabled);
  if (!enabled) {
    panel.innerHTML = '';
    return;
  }
  const activeHost = sonos.activeHost;
  const message = sonos.error || (sonos.discovering ? t('remote.sonos.searching') : (activeHost ? t('remote.sonos.castingTo', { host: activeHost }) : t('remote.sonos.localPlayback')));
  const devices = sonos.devices || [];
  const discoverLabel = esc(t('remote.sonos.discover'));
  const stopAllAria = esc(t('remote.sonos.stopAllTooltip'));
  const stopAllLabel = esc(t('remote.sonos.stopAll'));
  const addIpPlaceholder = esc(t('remote.sonos.addIpPlaceholder'));
  const addIpAria = esc(t('remote.sonos.addIp'));
  const castHere = esc(t('remote.sonos.castHere'));
  const sonosStopLabel = esc(t('remote.sonos.stop'));
  const activeBadge = esc(t('remote.sonos.active'));
  panel.innerHTML =
    '<div class="sonos-head"><strong>' + esc(t('sonos.title')) + '</strong><span>' + esc(message) + '</span></div>' +
    '<div class="sonos-actions"><button class="icon-btn-small" data-sonos-discover aria-label="' + discoverLabel + '" title="' + discoverLabel + '">' + refreshIcon + '</button><button class="icon-btn-small" data-sonos-stop-all aria-label="' + stopAllAria + '" title="' + stopAllLabel + '">' + stopIcon + '</button></div>' +
    '<div class="sonos-add"><input id="sonosHost" placeholder="' + addIpPlaceholder + '" /><button class="icon-btn-small" data-sonos-add aria-label="' + addIpAria + '" title="' + addIpAria + '">' + plusIcon + '</button></div>' +
    (devices.length
      ? devices.map((d) => '<div class="sonos-device"><div><div class="row-title"><span>' + esc(d.name) + '</span></div><div class="meta">' + esc(d.host) + '</div></div><span class="badge">' + (d.host === activeHost ? activeBadge : '') + '</span><button class="icon-btn-small" data-sonos-cast="' + esc(d.host) + '"' + (current?.trackId ? '' : ' disabled') + ' aria-label="' + castHere + '" title="' + castHere + '">' + castIcon + '</button><button class="icon-btn-small" data-sonos-stop="' + esc(d.host) + '" aria-label="' + sonosStopLabel + '" title="' + sonosStopLabel + '">' + stopIcon + '</button></div>').join('')
      : '<div class="empty">' + esc(t('remote.sonos.noDevices')) + '</div>');
}
function renderData(next) {
  data = next || data;
  const tracks = data.tracks || [];
  const playlists = data.playlists || [];
  const unknownArtist = esc(t('remote.library.unknownArtist'));
  const playNowLabel = esc(t('remote.actions.playNow'));
  const playNextLabel = esc(t('remote.actions.playNext'));
  const addToPlaylistLabel = esc(t('library.addToPlaylistTooltip'));
  const openLabel = esc(t('remote.playlists.openTooltip'));
  const openShort = esc(t('playlists.open'));
  const playPlaylistLabel = esc(t('remote.playlists.playTooltip'));
  const renameLabel = esc(t('remote.playlists.renameTooltip'));
  const renameShort = esc(t('remote.playlists.rename'));
  const deleteLabel = esc(t('remote.playlists.deleteTooltip'));
  const deleteShort = esc(t('common.delete'));
  el('libraryList').className = tracks.length ? 'list' : 'list empty';
  el('libraryList').innerHTML = tracks.length ? tracks.map((tr) => '<div class="row library-row" data-track-id="' + tr.id + '"><div class="thumb"><img alt="" loading="lazy" src="/artwork/' + tr.id + '?token=' + encodeURIComponent(token) + '"></div><div class="library-main"><div class="library-title"><strong>' + esc(tr.title) + '</strong><span class="duration">' + fmt(tr.durationSec) + '</span></div><div class="meta">' + (tr.artist || tr.album ? esc(tr.artist || tr.album) : unknownArtist) + '</div><div class="library-actions"><button data-play="' + tr.id + '" aria-label="' + playNowLabel + '" title="' + playNowLabel + '">' + playIcon + '</button><button data-play-next="' + tr.id + '" aria-label="' + playNextLabel + '" title="' + playNextLabel + '">' + playNextIcon + '</button></div><select class="library-playlist" data-add="' + tr.id + '"><option value="">' + addToPlaylistLabel + '</option>' + playlists.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') + '</select></div></div>').join('') : t('library.empty');
  el('playlistList').className = playlists.length ? 'list' : 'list empty';
  el('playlistList').innerHTML = playlists.length ? playlists.map((p) => '<div class="playlist"><div class="playlist-title"><span>' + esc(p.name) + '</span><span>' + p.trackCount + '</span></div><div class="actions"><button class="icon-btn-small" data-open-playlist="' + p.id + '" aria-label="' + openLabel + '" title="' + openShort + '">' + openIcon + '</button><button class="icon-btn-small" data-play-playlist="' + p.id + '" aria-label="' + playPlaylistLabel + '" title="' + playPlaylistLabel + '">' + playIcon + '</button>' + (p.slug ? '' : '<button class="icon-btn-small" data-rename-playlist="' + p.id + '" aria-label="' + renameLabel + '" title="' + renameShort + '">' + editIcon + '</button><button class="icon-btn-small" data-delete-playlist="' + p.id + '" aria-label="' + deleteLabel + '" title="' + deleteShort + '">' + trashIcon + '</button>') + '</div><div id="playlistTracks' + p.id + '" class="list"></div></div>').join('') : t('playlists.none');
  updateHighlight();
}
async function searchLibrary() {
  const query = el('libraryQuery').value.trim();
  const tracks = await request({ type: 'library:list', query: { search: query, limit: 120, sortBy: 'downloadedAt', sortDir: 'desc' } });
  renderData({ ...data, tracks });
}
async function handleDownloadGo() {
  const value = el('downloadUrl').value.trim();
  if (!value) return;
  el('downloadMessage').textContent = t('remote.download.working');
  el('searchResults').innerHTML = '';
  try {
    if (/^https?:\\/\\//i.test(value)) {
      await request({ type: 'download:enqueue', url: value });
      el('downloadMessage').textContent = t('remote.download.enqueued');
      el('downloadUrl').value = '';
    } else {
      const results = await request({ type: 'yt:search', query: value });
      el('downloadMessage').textContent = results.length ? t('remote.download.searchResults') : t('remote.download.noResults');
      const activeIds = activeDownloadIds();
      el('searchResults').innerHTML = results.map((r) => {
        const isActive = activeIds.has(r.id);
        const disabled = r.inLibrary || isActive;
        const label = r.inLibrary ? t('download.inLibrary') : (isActive ? t('remote.download.queued') : t('download.download'));
        const labelEsc = esc(label);
        return '<div class="row download-result"><div class="download-thumb">' + (r.thumbnail ? '<img alt="" loading="lazy" src="' + esc(r.thumbnail) + '">' : 'F') + '</div><div class="download-main"><div class="download-title"><strong>' + esc(r.title) + '</strong><span class="duration">' + fmt(r.durationSec) + '</span></div><div class="meta">' + esc(r.channel) + '</div><div class="download-actions"><button aria-label="' + labelEsc + '" title="' + labelEsc + '" class="' + (disabled ? 'in-library' : '') + '" ' + (disabled ? 'disabled' : 'data-download-url="' + esc(r.url) + '"') + '>' + (disabled ? labelEsc : downloadIcon) + '</button></div></div></div>';
      }).join('');
    }
  } catch (err) {
    el('downloadMessage').textContent = err.message || String(err);
  }
}
applyI18n();
function setStatus(key) {
  const conn = el('conn');
  conn.setAttribute('data-i18n', key);
  conn.textContent = t(key);
}
ws.onopen = () => { el('dot').classList.add('on'); setStatus('remote.status.live'); send({ type: 'request-state' }); };
ws.onclose = () => { el('dot').classList.remove('on'); setStatus('remote.status.disconnected'); };
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'state') render(msg.state);
  else if (msg.type === 'data') renderData(msg.data);
  else if (msg.type === 'settings') {
    const nextLocale = msg.data?.language;
    if (nextLocale && bundles[nextLocale]) {
      locale = nextLocale;
      document.documentElement.setAttribute('lang', locale);
      applyI18n();
      if (current) render(current); else renderData(data);
    }
  }
  else if (msg.type === 'result' || msg.type === 'error') {
    const waiter = pending.get(msg.requestId);
    if (!waiter) return;
    pending.delete(msg.requestId);
    if (msg.type === 'error') waiter.reject(new Error(msg.message));
    else waiter.resolve(msg.data);
  }
};
document.body.addEventListener('error', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLImageElement)) return;
  const parent = target.parentElement;
  if (!parent) return;
  if (parent.classList.contains('thumb') || parent.classList.contains('download-thumb')) {
    parent.textContent = 'F';
  } else if (parent.classList.contains('cover')) {
    parent.innerHTML = '<span class="note">F</span>';
  }
}, true);
document.querySelectorAll('nav button').forEach((button) => button.onclick = () => {
  document.querySelectorAll('nav button').forEach((item) => item.classList.toggle('active', item === button));
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === button.dataset.view));
});
el('play').onclick = () => send({ type: 'toggle-play' });
el('prev').onclick = () => send({ type: 'prev' });
el('next').onclick = () => send({ type: 'next' });
el('seek').addEventListener('pointerdown', () => { scrubbing = true; });
el('seek').addEventListener('input', () => { el('pos').textContent = fmt(el('seek').value); });
el('seek').addEventListener('change', () => { scrubbing = false; send({ type: 'seek', seconds: Number(el('seek').value) }); });
el('volume').addEventListener('input', () => send({ type: 'volume', volume: Number(el('volume').value) }));
el('librarySearch').onclick = () => void searchLibrary();
el('libraryQuery').addEventListener('keydown', (event) => { if (event.key === 'Enter') void searchLibrary(); });
el('downloadGo').onclick = () => void handleDownloadGo();
el('downloadUrl').addEventListener('keydown', (event) => { if (event.key === 'Enter') void handleDownloadGo(); });
el('playlistCreate').onclick = async () => {
  const name = el('playlistName').value.trim();
  if (!name) return;
  await request({ type: 'playlist:create', name });
  el('playlistName').value = '';
};
document.body.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const bookmarkButton = target.closest('[data-bookmark-seek]');
  if (bookmarkButton instanceof HTMLElement) {
    send({ type: 'seek', seconds: Number(bookmarkButton.dataset.bookmarkSeek) });
  } else if (target.dataset.play) {
    send({ type: 'play-track', trackId: Number(target.dataset.play), queueTrackIds: data.tracks.map((t) => t.id) });
  } else if (target.dataset.playNext) {
    send({ type: 'play-next-track', trackId: Number(target.dataset.playNext), queueTrackIds: data.tracks.map((t) => t.id) });
    target.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    target.setAttribute('disabled', '');
  } else if (target.dataset.downloadUrl) {
    try {
      await request({ type: 'download:enqueue', url: target.dataset.downloadUrl });
      target.removeAttribute('data-download-url');
      target.setAttribute('disabled', '');
      target.textContent = t('remote.download.queued');
      el('downloadMessage').textContent = t('remote.download.enqueued');
    } catch (err) {
      target.removeAttribute('data-download-url');
      target.setAttribute('disabled', '');
      target.textContent = err.message === 'Already in library.' ? t('download.inLibrary') : t('remote.download.failed');
      el('downloadMessage').textContent = err.message || String(err);
    }
  } else if (target.dataset.cancel) {
    await request({ type: 'download:cancel', id: target.dataset.cancel });
  } else if (target.dataset.sonosDiscover !== undefined) {
    send({ type: 'sonos-discover' });
  } else if (target.dataset.sonosStopAll !== undefined) {
    send({ type: 'sonos-stop-all' });
  } else if (target.dataset.sonosAdd !== undefined) {
    const input = el('sonosHost');
    const host = input.value.trim();
    if (!host) return;
    send({ type: 'sonos-add-by-ip', host });
    input.value = '';
  } else if (target.dataset.sonosCast) {
    send({ type: 'sonos-cast', host: target.dataset.sonosCast });
  } else if (target.dataset.sonosStop) {
    send({ type: 'sonos-stop', host: target.dataset.sonosStop });
  } else if (target.dataset.openPlaylist) {
    const id = Number(target.dataset.openPlaylist);
    const tracks = await request({ type: 'playlist:tracks', playlistId: id });
    playlistTracks.set(id, tracks);
    const container = el('playlistTracks' + id);
    const unknownArtist = esc(t('remote.library.unknownArtist'));
    const moveUpLabel = esc(t('playlists.moveUpTooltip'));
    const moveDownLabel = esc(t('remote.playlists.moveDown'));
    const removeLabel = esc(t('remote.playlists.remove'));
    const removeShort = esc(t('playlists.removeTooltip'));
    container.innerHTML = tracks.map((tr, index) => '<div class="row library-row playlist-track" data-track-id="' + tr.id + '"><div class="thumb"><img alt="" loading="lazy" src="/artwork/' + tr.id + '?token=' + encodeURIComponent(token) + '"></div><div class="library-main"><div class="library-title"><strong>' + esc(tr.title) + '</strong><span class="duration">' + fmt(tr.durationSec) + '</span></div><div class="meta">' + (tr.artist ? esc(tr.artist) : unknownArtist) + '</div><div class="actions"><button class="icon-btn-small" data-move-playlist="' + id + ':' + index + ':-1" aria-label="' + moveUpLabel + '" title="' + moveUpLabel + '">' + upIcon + '</button><button class="icon-btn-small" data-move-playlist="' + id + ':' + index + ':1" aria-label="' + moveDownLabel + '" title="' + moveDownLabel + '">' + downIcon + '</button><button class="icon-btn-small" data-remove-from-playlist="' + id + ':' + tr.id + '" aria-label="' + removeLabel + '" title="' + removeShort + '">' + closeIcon + '</button></div></div></div>').join('');
    updateHighlight();
  } else if (target.dataset.playPlaylist) {
    const tracks = await request({ type: 'playlist:tracks', playlistId: Number(target.dataset.playPlaylist) });
    if (tracks[0]) send({ type: 'play-track', trackId: tracks[0].id, queueTrackIds: tracks.map((tr) => tr.id) });
  } else if (target.dataset.renamePlaylist) {
    const playlist = data.playlists.find((p) => p.id === Number(target.dataset.renamePlaylist));
    const name = prompt(t('remote.playlists.namePrompt'), playlist ? playlist.name : '');
    if (name) await request({ type: 'playlist:rename', playlistId: Number(target.dataset.renamePlaylist), name });
  } else if (target.dataset.deletePlaylist) {
    if (confirm(t('remote.playlists.deletePrompt'))) await request({ type: 'playlist:delete', playlistId: Number(target.dataset.deletePlaylist) });
  } else if (target.dataset.removeFromPlaylist) {
    const [playlistId, trackId] = target.dataset.removeFromPlaylist.split(':').map(Number);
    await request({ type: 'playlist:remove-track', playlistId, trackId });
    target.closest('.row')?.remove();
  } else if (target.dataset.movePlaylist) {
    const [playlistId, index, dir] = target.dataset.movePlaylist.split(':').map(Number);
    const tracks = playlistTracks.get(playlistId) || [];
    const nextIndex = index + dir;
    if (nextIndex < 0 || nextIndex >= tracks.length) return;
    const ordered = [...tracks];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(nextIndex, 0, moved);
    await request({ type: 'playlist:reorder', playlistId, orderedTrackIds: ordered.map((t) => t.id) });
    playlistTracks.set(playlistId, ordered);
    const button = document.querySelector('[data-open-playlist="' + playlistId + '"]');
    button?.click();
  }
});
document.body.addEventListener('keydown', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.id !== 'sonosHost' || event.key !== 'Enter') return;
  document.querySelector('[data-sonos-add]')?.click();
});
document.body.addEventListener('change', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || !target.dataset.add || !target.value) return;
  await request({ type: 'playlist:add-track', playlistId: Number(target.value), trackId: Number(target.dataset.add) });
  target.value = '';
});
</script>
</body>
</html>`);
}

function isAuthorized(url: URL): boolean {
  return url.searchParams.get('token') === token;
}

export function setRemoteControllerCommandHandler(
  handler: (command: RemoteControllerCommand) => void
): void {
  commandHandler = handler;
}

export async function handleRemoteRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  if (!isAuthorized(url)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (url.pathname === '/' || url.pathname === '/remote') {
    serveRemotePage(res);
    return;
  }
  const artworkMatch = url.pathname.match(/^\/artwork\/(\d+)$/);
  if (artworkMatch) {
    const track = getTrack(Number(artworkMatch[1]));
    const dataUrl = track ? await getTrackEmbeddedArtworkDataUrl(track) : null;
    if (!dataUrl) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': match[1],
      'Cache-Control': 'no-store'
    });
    res.end(Buffer.from(match[2], 'base64'));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
}

export function handleRemoteUpgrade(req: IncomingMessage, socket: Duplex, _head: Buffer): void {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  if (url.pathname !== '/remote-ws' || !isAuthorized(url)) {
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string') {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  clients.add(socket);
  sendJson(socket, { type: 'settings', data: remoteSettingsPayload() });
  if (lastSnapshot) sendJson(socket, { type: 'state', state: lastSnapshot });
  sendJson(socket, { type: 'data', data: remoteDataSnapshot() });
  socket.on('data', (buffer) => {
    const text = readFrame(buffer);
    if (!text) return;
    void (async () => {
      let message: RemoteIncoming | null = null;
      try {
        message = normalizeIncoming(JSON.parse(text));
        if (!message) return;
        if (message.type === 'request-state') {
          sendJson(socket, { type: 'settings', data: remoteSettingsPayload() });
          if (lastSnapshot) sendJson(socket, { type: 'state', state: lastSnapshot });
          sendJson(socket, { type: 'data', data: remoteDataSnapshot() });
          return;
        }
        if (
          message.type === 'toggle-play' ||
          message.type === 'prev' ||
          message.type === 'next' ||
          message.type === 'seek' ||
          message.type === 'volume' ||
          message.type === 'play-track' ||
          message.type === 'play-next-track' ||
          message.type === 'sonos-discover' ||
          message.type === 'sonos-add-by-ip' ||
          message.type === 'sonos-cast' ||
          message.type === 'sonos-stop' ||
          message.type === 'sonos-stop-all'
        ) {
          const { requestId: _requestId, ...command } = message;
          commandHandler?.(command as RemoteControllerCommand);
          sendResult(socket, message.requestId, true);
          return;
        }
        await handleAction(socket, message);
      } catch (err) {
        sendError(
          socket,
          message?.requestId,
          toErrorMessage(err)
        );
      }
    })();
  });
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
}

export function cleanupRemoteClients(): void {
  for (const client of clients) client.destroy();
  clients.clear();
  lastSnapshot = null;
}

export function updateRemoteControllerSnapshot(snapshot: RemotePlayerSnapshot): void {
  lastSnapshot = snapshot;
  broadcast({ type: 'state', state: snapshot });
}

export function regenerateRemoteControllerToken(): RemoteControllerInfo {
  token = crypto.randomBytes(24).toString('hex');
  for (const client of clients) client.destroy();
  clients.clear();
  return getRemoteControllerInfo();
}

export function getRemoteControllerInfo(): RemoteControllerInfo {
  const enabled = isRemoteEnabled();
  return {
    enabled,
    running: enabled,
    url: remoteUrl(),
    token: enabled ? token : null
  };
}

export function isRemoteEnabled(): boolean {
  return getSettings().remoteControllerEnabled;
}
