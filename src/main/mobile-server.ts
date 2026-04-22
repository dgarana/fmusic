import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { getTrack, resolveTrackFilePath, listTracks } from './library/tracks-repo.js';
import { getMobileUiHtml } from './mobile-ui.js';
import type { MobilePlayerState, MobileCommand } from '../shared/types.js';

let server: http.Server | null = null;
let wss: WebSocketServer | null = null;
let serverPort = 0;
let sessionToken: string | null = null;
let commandHandler: ((cmd: MobileCommand) => void) | null = null;
let lastState: MobilePlayerState | null = null;

function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return '127.0.0.1';
}

function parseRange(rangeHeader: string, total: number): { start: number; end: number } | null {
  const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
  const start = parseInt(startStr, 10);
  const end = endStr ? parseInt(endStr, 10) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start || start >= total) return null;
  return { start, end: Math.min(end, total - 1) };
}

function serveFile(
  res: http.ServerResponse,
  filePath: string,
  contentType: string,
  rangeHeader: string | undefined
): void {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  if (rangeHeader) {
    const range = parseRange(rangeHeader, fileSize);
    if (!range) {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      res.end();
      return;
    }
    const { start, end } = range;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

export function onMobileCommand(handler: (cmd: MobileCommand) => void): void {
  commandHandler = handler;
}

export function broadcastPlayerState(state: MobilePlayerState): void {
  lastState = state;
  if (!wss) return;
  const msg = JSON.stringify({ type: 'state', data: state });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

export function getMobileSessionUrl(): string | null {
  if (!server || !sessionToken) return null;
  return `http://${getLocalIp()}:${serverPort}/?token=${sessionToken}`;
}

export function startMobileServer(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(serverPort);
      return;
    }

    sessionToken = crypto.randomBytes(24).toString('hex');

    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');

      if (token !== sessionToken) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      // Web UI
      if (url.pathname === '/') {
        const html = getMobileUiHtml();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      // Stream audio: GET /stream/:trackId
      const streamMatch = url.pathname.match(/^\/stream\/(\d+)$/);
      if (streamMatch) {
        const trackId = parseInt(streamMatch[1], 10);
        const track = getTrack(trackId);
        const filePath = track ? resolveTrackFilePath(track) : null;
        if (!filePath || !fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end('File Not Found');
          return;
        }
        serveFile(res, filePath, 'audio/mpeg', req.headers.range);
        return;
      }

      // Thumbnail: GET /thumbnail/:trackId
      const thumbMatch = url.pathname.match(/^\/thumbnail\/(\d+)$/);
      if (thumbMatch) {
        const trackId = parseInt(thumbMatch[1], 10);
        const track = getTrack(trackId);
        const thumbPath = track?.thumbnailPath ?? null;
        if (!thumbPath || !fs.existsSync(thumbPath)) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        const ext = path.extname(thumbPath).toLowerCase();
        const mime =
          ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        serveFile(res, thumbPath, mime, undefined);
        return;
      }

      // Library JSON: GET /api/tracks
      if (url.pathname === '/api/tracks') {
        const tracks = listTracks({});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tracks));
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    wss = new WebSocketServer({ server });

    wss.on('connection', (ws, req) => {
      const reqUrl = new URL(req.url || '/', `http://localhost`);
      const token = reqUrl.searchParams.get('token');

      if (token !== sessionToken) {
        ws.close(4001, 'Unauthorized');
        return;
      }

      // Send current state immediately on connect
      if (lastState) {
        ws.send(JSON.stringify({ type: 'state', data: lastState }));
      }

      ws.on('message', (data) => {
        try {
          const cmd = JSON.parse(data.toString()) as MobileCommand;
          commandHandler?.(cmd);
        } catch {
          // ignore malformed messages
        }
      });
    });

    server.listen(port, '0.0.0.0', () => {
      serverPort = (server!.address() as { port: number }).port;
      console.log(`[mobile-server] Listening on port ${serverPort}`);
      resolve(serverPort);
    });

    server.on('error', reject);
  });
}

export function stopMobileServer(): void {
  wss?.close();
  wss = null;
  server?.close();
  server = null;
  serverPort = 0;
  sessionToken = null;
  lastState = null;
}

export function isMobileServerRunning(): boolean {
  return server !== null;
}
