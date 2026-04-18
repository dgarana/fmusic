import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getTrack, resolveTrackFilePath } from './library/tracks-repo.js';

let server: http.Server | null = null;
let serverPort = 0;

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

function mimeForExt(ext: string): string {
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.flac') return 'audio/flac';
  return 'audio/mpeg';
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

export function startAudioServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(serverPort);
      return;
    }
    server = http.createServer((req, res) => {
      const match = req.url?.match(/^\/track\/(\d+)(?:\.\w+)?$/);
      if (!match) {
        res.writeHead(404);
        res.end();
        return;
      }
      const trackId = parseInt(match[1], 10);
      const track = getTrack(trackId);
      const filePath = track ? resolveTrackFilePath(track) : null;
      if (!filePath) {
        res.writeHead(404);
        res.end();
        return;
      }

      const contentType = mimeForExt(path.extname(filePath).toLowerCase());
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        res.writeHead(404);
        res.end();
        return;
      }
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parsedRange = parseRange(range, fileSize);
        if (!parsedRange) {
          res.writeHead(416, {
            'Content-Range': `bytes */${fileSize}`
          });
          res.end();
          return;
        }
        const { start, end } = parsedRange;
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
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes'
        });
        fs.createReadStream(filePath).pipe(res);
      }
    });

    server.listen(0, '0.0.0.0', () => {
      serverPort = (server!.address() as { port: number }).port;
      console.log(`[sonos-server] Audio server listening on port ${serverPort}`);
      resolve(serverPort);
    });
    server.on('error', reject);
  });
}

export function stopAudioServer(): void {
  server?.close();
  server = null;
  serverPort = 0;
}

export function getTrackHttpUrl(trackId: number, filePath?: string): string {
  const ext = filePath ? path.extname(filePath).toLowerCase() : '.mp3';
  return `http://${getLocalIp()}:${serverPort}/track/${trackId}${ext}`;
}
