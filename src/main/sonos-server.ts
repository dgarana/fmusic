import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { getTrack, resolveTrackFilePath } from './library/tracks-repo.js';
import { getLocalIp, parseRange, getServicePort } from './network.js';
import { getSettings } from './settings.js';

function mimeForExt(ext: string): string {
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.flac') return 'audio/flac';
  return 'audio/mpeg';
}

export async function handleSonosRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
}

export function getTrackHttpUrl(trackId: number, filePath?: string): string {
  const ext = filePath ? path.extname(filePath).toLowerCase() : '.mp3';
  const port = getServicePort('sonos-server');
  return `http://${getLocalIp()}:${port}/track/${trackId}${ext}`;
}


