import { spawn, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { ffmpegPath, hasFfmpeg, hasYtDlp, ytDlpPath } from './paths.js';
import type { AudioFormat, SearchResult } from '../shared/types.js';

/**
 * Progress marker that yt-dlp emits on stdout via --progress-template.
 * We prefix it so it's easy to parse unambiguously.
 */
const PROGRESS_PREFIX = '__FMP__';
const PROGRESS_TEMPLATE = `${PROGRESS_PREFIX}%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s`;

/**
 * Baseline spawn options used by every yt-dlp invocation. We force UTF-8 on
 * the child's stdio so that titles / file paths with non-ASCII characters
 * (e.g. "Tïesto", accented vowels, CJK) come back to us intact regardless of
 * the system's active code page — otherwise Windows consoles can mangle them
 * into the OEM code page, making fs.existsSync fail later on.
 */
function spawnOptions(): SpawnOptions {
  return {
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      LC_ALL: 'C.UTF-8',
      LANG: 'C.UTF-8'
    }
  };
}

function decodeUtf8(chunk: Buffer | string): string {
  return Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
}

function assertBinaries() {
  if (!hasYtDlp()) {
    throw new Error(
      'yt-dlp no est\u00e1 disponible. Ve a Ajustes y pulsa "Actualizar motor de descarga".'
    );
  }
}

export async function ytDlpVersion(): Promise<string | null> {
  if (!hasYtDlp()) return null;
  return new Promise((resolve) => {
    const proc = spawn(ytDlpPath(), ['--version'], spawnOptions());
    let out = '';
    proc.stdout?.on('data', (chunk) => (out += decodeUtf8(chunk)));
    proc.on('error', () => resolve(null));
    proc.on('close', () => resolve(out.trim() || null));
  });
}

/**
 * Runs yt-dlp and collects its stdout as text.
 */
function runCollecting(args: string[]): Promise<string> {
  assertBinaries();
  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlpPath(), args, spawnOptions());
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk) => (stdout += decodeUtf8(chunk)));
    proc.stderr?.on('data', (chunk) => (stderr += decodeUtf8(chunk)));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`yt-dlp exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

function parseYtSearchLine(line: string): SearchResult | null {
  try {
    const data = JSON.parse(line);
    const id: string | undefined = data.id;
    if (!id) return null;
    const thumbnails: Array<{ url: string; width?: number }> | undefined = data.thumbnails;
    const thumbnail =
      data.thumbnail ??
      (thumbnails && thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : null);
    return {
      id,
      title: data.title ?? 'Unknown title',
      channel: data.channel ?? data.uploader ?? 'Unknown channel',
      durationSec: typeof data.duration === 'number' ? data.duration : null,
      thumbnail,
      url: data.webpage_url ?? `https://www.youtube.com/watch?v=${id}`
    };
  } catch {
    return null;
  }
}

/**
 * Search YouTube using `ytsearch<N>:<query>`. yt-dlp streams one JSON line per
 * result when invoked with `--dump-json --flat-playlist`.
 */
export async function searchYouTube(query: string, limit = 10): Promise<SearchResult[]> {
  const stdout = await runCollecting([
    '--no-warnings',
    '--flat-playlist',
    '--dump-json',
    `ytsearch${limit}:${query}`
  ]);
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseYtSearchLine)
    .filter((r): r is SearchResult => r !== null);
}

export interface VideoInfo {
  id: string;
  title: string;
  channel: string;
  durationSec: number | null;
  thumbnail: string | null;
  url: string;
  /** Best-effort metadata extracted from yt-dlp's JSON. */
  artist: string | null;
  album: string | null;
  track: string | null;
  genre: string | null;
  releaseYear: number | null;
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function parseYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.match(/(\d{4})/);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

export async function fetchVideoInfo(url: string): Promise<VideoInfo> {
  const stdout = await runCollecting(['--no-warnings', '--dump-json', url]);
  const data = JSON.parse(stdout);
  return {
    id: data.id,
    title: data.title,
    channel: data.channel ?? data.uploader ?? 'Unknown channel',
    durationSec: typeof data.duration === 'number' ? data.duration : null,
    thumbnail: data.thumbnail ?? null,
    url: data.webpage_url ?? url,
    artist: firstString(data.artist, data.creator, data.uploader, data.channel),
    album: firstString(data.album),
    track: firstString(data.track),
    genre: firstString(data.genre, Array.isArray(data.genres) ? data.genres[0] : null, Array.isArray(data.categories) ? data.categories[0] : null),
    releaseYear: parseYear(data.release_year ?? data.release_date ?? data.upload_date)
  };
}

/**
 * Resolves the direct media URL for the best audio-only format. Used for
 * previewing a track before downloading without relying on the YouTube
 * embed iframe (which is blocked from `file://` origins).
 */
export async function fetchAudioStreamUrl(url: string): Promise<string> {
  const stdout = await runCollecting([
    '--no-warnings',
    '--no-playlist',
    '-f',
    'bestaudio/best',
    '-g',
    url
  ]);
  const directUrl = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!directUrl) throw new Error('No se pudo resolver la URL del stream.');
  return directUrl;
}

export interface DownloadProgress {
  percent: number; // 0..1
  etaSeconds: number | null;
  speedHuman: string | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
}

function parsePercent(raw: string): number {
  const cleaned = raw.replace('%', '').trim();
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n / 100));
}

function parseEta(raw: string): number | null {
  // yt-dlp emits e.g. "00:05" or "--:--"
  if (!raw || raw.includes('-')) return null;
  const parts = raw.split(':').map((p) => parseInt(p, 10));
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function parseInteger(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export interface DownloadOptions {
  url: string;
  outputDir: string;
  format: AudioFormat;
  quality: number; // kbps
}

export interface DownloadResult {
  filePath: string;
  title: string;
  youtubeId: string;
  durationSec: number | null;
  thumbnail: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  releaseYear: number | null;
}

export class DownloadProcess extends EventEmitter {
  private proc: ReturnType<typeof spawn> | null = null;
  private cancelled = false;
  private finalFile: string | null = null;
  private info: VideoInfo | null = null;

  constructor(private readonly options: DownloadOptions) {
    super();
  }

  cancel(): void {
    this.cancelled = true;
    if (this.proc) {
      this.proc.kill('SIGTERM');
    }
  }

  async start(): Promise<DownloadResult> {
    assertBinaries();
    fs.mkdirSync(this.options.outputDir, { recursive: true });

    // Step 1: fetch info so we know the title up front.
    this.info = await fetchVideoInfo(this.options.url);
    this.emit('info', this.info);

    // Step 2: run yt-dlp with audio extraction.
    const outputTemplate = path.join(this.options.outputDir, '%(title)s [%(id)s].%(ext)s');
    const args: string[] = [
      '--no-warnings',
      '--no-playlist',
      '-x',
      '--audio-format',
      this.options.format,
      '--audio-quality',
      `${this.options.quality}K`,
      '--embed-thumbnail',
      '--add-metadata',
      // Promote yt-dlp fields into ID3 tags so other players pick them up.
      '--parse-metadata',
      '%(artist,creator,uploader)s:%(meta_artist)s',
      '--parse-metadata',
      '%(album)s:%(meta_album)s',
      '--parse-metadata',
      '%(track,title)s:%(meta_title)s',
      '--parse-metadata',
      '%(genre,categories.0)s:%(meta_genre)s',
      '--parse-metadata',
      '%(release_year,release_date>%Y,upload_date>%Y)s:%(meta_date)s',
      '--progress',
      '--newline',
      '--progress-template',
      `download:${PROGRESS_TEMPLATE}`,
      '--print',
      'after_move:__FMP_DONE__%(filepath)s',
      '-o',
      outputTemplate
    ];

    if (hasFfmpeg()) {
      args.push('--ffmpeg-location', ffmpegPath());
    }

    args.push(this.options.url);

    return new Promise<DownloadResult>((resolve, reject) => {
      const proc = spawn(ytDlpPath(), args, spawnOptions());
      this.proc = proc;
      let stderr = '';

      const onLine = (line: string) => {
        line = line.trim();
        if (!line) return;
        if (line.startsWith(PROGRESS_PREFIX)) {
          const body = line.slice(PROGRESS_PREFIX.length);
          const [pct, speed, eta, downloaded, total] = body.split('|');
          const progress: DownloadProgress = {
            percent: parsePercent(pct ?? '0'),
            etaSeconds: parseEta(eta ?? ''),
            speedHuman: (speed ?? '').trim() || null,
            downloadedBytes: parseInteger(downloaded ?? ''),
            totalBytes: parseInteger(total ?? '')
          };
          this.emit('progress', progress);
          return;
        }
        if (line.startsWith('__FMP_DONE__')) {
          this.finalFile = line.slice('__FMP_DONE__'.length).trim();
          return;
        }
      };

      let stdoutBuffer = '';
      proc.stdout?.on('data', (chunk) => {
        stdoutBuffer += decodeUtf8(chunk);
        const parts = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = parts.pop() ?? '';
        for (const part of parts) onLine(part);
      });

      proc.stderr?.on('data', (chunk) => {
        stderr += decodeUtf8(chunk);
      });

      proc.on('error', reject);
      proc.on('close', (code) => {
        if (this.cancelled) {
          reject(new Error('Descarga cancelada'));
          return;
        }
        if (code !== 0) {
          reject(new Error(`yt-dlp exited with code ${code}: ${stderr.trim()}`));
          return;
        }
        if (!this.finalFile || !this.info) {
          reject(new Error('yt-dlp finaliz\u00f3 pero no se pudo resolver el fichero generado.'));
          return;
        }
        // Normalise the path: yt-dlp sometimes emits NFD-decomposed Unicode
        // (e.g. 'i' + combining diaeresis) whereas NTFS stores NFC. Round-trip
        // through path.normalize + String.normalize('NFC') so subsequent
        // fs.existsSync lookups match the on-disk entry.
        const normalizedPath = path.normalize(this.finalFile).normalize('NFC');
        resolve({
          filePath: normalizedPath,
          title: this.info.title,
          youtubeId: this.info.id,
          durationSec: this.info.durationSec,
          thumbnail: this.info.thumbnail,
          artist: this.info.artist,
          album: this.info.album,
          genre: this.info.genre,
          releaseYear: this.info.releaseYear
        });
      });
    });
  }
}

export function getDependencyStatus() {
  return {
    ytDlp: {
      present: hasYtDlp(),
      path: hasYtDlp() ? ytDlpPath() : null
    },
    ffmpeg: {
      present: hasFfmpeg(),
      path: hasFfmpeg() ? ffmpegPath() : null
    }
  };
}
