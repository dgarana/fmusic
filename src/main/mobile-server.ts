import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getTrack, resolveTrackFilePath } from './library/tracks-repo.js';
import { getLocalIp, parseRange, getServicePort } from './network.js';
import { getSettings } from './settings.js';

/**
 * Maps trackId -> { token: string, expiresAt: number }
 */
const tokenRegistry = new Map<number, { token: string; expiresAt: number }>();

export async function handleMobileRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
}

export function cleanupMobileSync(): void {
  tokenRegistry.clear();
}

export function generateTrackMobileUrl(trackId: number): string {
  const port = getServicePort('mobile-sync');
  if (!port) {
    throw new Error('Mobile sync server is not running');
  }
  const token = crypto.randomBytes(16).toString('hex');
  // Token expires in 1 hour
  tokenRegistry.set(trackId, { token, expiresAt: Date.now() + 3600000 });

  return `http://${getLocalIp()}:${port}/download/${trackId}?token=${token}`;
}

export function isMobileSyncEnabled(): boolean {
  return getSettings().mobileSyncEnabled;
}
