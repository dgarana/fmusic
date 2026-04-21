import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { getTrack, resolveTrackFilePath } from './library/tracks-repo.js';

let server: http.Server | null = null;
let serverPort = 0;

/**
 * Maps trackId -> { token: string, expiresAt: number }
 */
const tokenRegistry = new Map<number, { token: string; expiresAt: number }>();

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

function parseRange(
  rangeHeader: string,
  total: number
): { start: number; end: number } | null {
  const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
  const start = parseInt(startStr, 10);
  const end = endStr ? parseInt(endStr, 10) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start || start >= total) return null;
  return { start, end: Math.min(end, total - 1) };
}

export function startMobileServer(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(serverPort);
      return;
    }
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const match = url.pathname.match(/^\/download\/(\d+)$/);
      
      if (!match) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const trackId = parseInt(match[1], 10);
      const token = url.searchParams.get('token');

      // Validate token
      const registered = tokenRegistry.get(trackId);
      if (!registered || registered.token !== token || registered.expiresAt < Date.now()) {
        res.writeHead(403);
        res.end('Forbidden: Invalid or expired token');
        return;
      }

      const track = getTrack(trackId);
      const filePath = track ? resolveTrackFilePath(track) : null;
      if (!filePath || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('File Not Found');
        return;
      }

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;
      const filename = path.basename(filePath);

      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Type', 'audio/mpeg');

      if (range) {
        const parsedRange = parseRange(range, fileSize);
        if (!parsedRange) {
          res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
          res.end();
          return;
        }
        const { start, end } = parsedRange;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Accept-Ranges': 'bytes'
        });
        fs.createReadStream(filePath).pipe(res);
      }
    });

    server.listen(port, '0.0.0.0', () => {
      serverPort = (server!.address() as { port: number }).port;
      console.log(`[mobile-server] Mobile sync server listening on port ${serverPort}`);
      resolve(serverPort);
    });
    server.on('error', reject);
  });
}

export function stopMobileServer(): void {
  server?.close();
  server = null;
  serverPort = 0;
  tokenRegistry.clear();
}

export function generateTrackMobileUrl(trackId: number): string {
  if (!server) {
    throw new Error('Mobile sync server is not running');
  }
  const token = crypto.randomBytes(16).toString('hex');
  // Token expires in 1 hour
  tokenRegistry.set(trackId, { token, expiresAt: Date.now() + 3600000 });
  
  return `http://${getLocalIp()}:${serverPort}/download/${trackId}?token=${token}`;
}

export function isMobileServerRunning(): boolean {
  return server !== null;
}
