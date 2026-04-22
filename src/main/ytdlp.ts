import { spawn, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  binDir,
  ffmpegPath,
  ffprobePath,
  hasFfmpeg,
  hasFfprobe,
  hasYtDlp,
  ytDlpPath
} from './paths.js';
import { getSettings } from './settings.js';
import type { AudioFormat, SearchResult, YoutubePlaylistFetch } from '../shared/types.js';

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
  const currentPath = process.env.PATH ?? process.env.Path ?? '';
  const augmentedPath = [binDir(), currentPath].filter(Boolean).join(path.delimiter);
  return {
    windowsHide: true,
    env: {
      ...process.env,
      PATH: augmentedPath,
      Path: augmentedPath,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      LC_ALL: 'C.UTF-8',
      LANG: 'C.UTF-8'
    }
  };
}

/** Extra args prepended to every yt-dlp invocation. */
function baseArgs(): string[] {
  return getSettings().skipCertCheck ? ['--no-check-certificates'] : [];
}

function decodeUtf8(chunk: Buffer | string): string {
  return Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
}

function assertBinaries() {
  if (!hasYtDlp()) {
    throw new Error(
      'yt-dlp is not available. Go to Settings and click "Update download engine".'
    );
  }
}

function assertAudioBinaries() {
  assertBinaries();
  if (!hasFfmpeg() || !hasFfprobe()) {
    throw new Error(
      `ffmpeg/ffprobe are required for audio downloads. Re-run \`npm install\` so the bundled binaries are copied into resources/bin.\n${dependencyDiagnostics()}`
    );
  }
}

function dependencyDiagnostics(): string {
  return [
    `binDir=${binDir()}`,
    `yt-dlp=${ytDlpPath()} present=${hasYtDlp()}`,
    `ffmpeg=${ffmpegPath()} present=${hasFfmpeg()}`,
    `ffprobe=${ffprobePath()} present=${hasFfprobe()}`,
    `cwd=${process.cwd()}`
  ].join('\n');
}

function shellQuote(value: string): string {
  return JSON.stringify(value);
}

function ytDlpDiagnostics(args: string[]): string {
  return [
    dependencyDiagnostics(),
    `command=${[ytDlpPath(), ...args].map(shellQuote).join(' ')}`
  ].join('\n');
}

function cleanupStaleIntermediateFiles(dir: string, youtubeId: string): void {
  const staleExts = new Set([
    '.webm',
    '.part',
    '.ytdl',
    '.temp',
    '.tmp'
  ]);
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.includes(`[${youtubeId}]`)) continue;
      const lower = entry.toLowerCase();
      const isStale = [...staleExts].some(
        (ext) => lower.endsWith(ext) || lower.includes(`${ext}.`)
      );
      if (!isStale) continue;
      const fullPath = path.join(dir, entry);
      if (fs.statSync(fullPath).isFile()) {
        fs.unlinkSync(fullPath);
      }
    }
  } catch (err) {
    console.warn(
      '[FMusic] Could not clean stale yt-dlp intermediates:',
      err instanceof Error ? err.message : String(err)
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

type SpawnedProc = ReturnType<typeof spawn>;

/**
 * Runs yt-dlp and collects its stdout as text. Optionally exposes the spawned
 * child process via `onProcess` so long-running callers (e.g. DownloadProcess)
 * can cancel the pre-download metadata step, not just the final download.
 */
function runCollecting(
  args: string[],
  onProcess?: (proc: SpawnedProc) => void
): Promise<string> {
  assertBinaries();
  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlpPath(), [...baseArgs(), ...args], spawnOptions());
    onProcess?.(proc);
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

/**
 * Resolves the entries of a YouTube playlist. Uses `--flat-playlist` so we
 * avoid paying the metadata-fetch cost for every single video — that happens
 * later, once each entry is enqueued as its own download. `--yes-playlist`
 * forces yt-dlp to treat watch URLs with `&list=` as playlists instead of
 * single videos. Alongside the entries we also surface the playlist title
 * (best-effort) so callers can use it when creating a matching local
 * playlist.
 */
export async function fetchPlaylistEntries(url: string): Promise<YoutubePlaylistFetch> {
  const stdout = await runCollecting([
    '--no-warnings',
    '--yes-playlist',
    '--flat-playlist',
    '--dump-json',
    url
  ]);

  let title: string | null = null;
  const entries: SearchResult[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parsed = parseYtSearchLine(line);
    if (parsed) entries.push(parsed);
    // Extract the playlist title from any entry that carries it. yt-dlp
    // exposes it as `playlist_title` (preferred) or `playlist`. We take
    // the first non-empty occurrence since every entry in the same batch
    // should agree.
    if (title === null) {
      try {
        const data = JSON.parse(line);
        const candidate =
          (typeof data.playlist_title === 'string' && data.playlist_title.trim()) ||
          (typeof data.playlist === 'string' && data.playlist.trim()) ||
          null;
        if (candidate) title = candidate;
      } catch {
        // ignore malformed lines
      }
    }
  }

  return { title, entries };
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

export async function fetchVideoInfo(
  url: string,
  onProcess?: (proc: SpawnedProc) => void
): Promise<VideoInfo> {
  // `--no-playlist` is critical here: without it, a watch URL that carries a
  // `&list=` (mix / radio / playlist context) makes yt-dlp iterate every
  // entry and emit one JSON object per line. That both blows up `JSON.parse`
  // below and stalls the metadata step long enough to make the download
  // look unresponsive.
  const stdout = await runCollecting(
    ['--no-warnings', '--no-playlist', '--dump-json', url],
    onProcess
  );
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
  if (!directUrl) throw new Error('Could not resolve the stream URL.');
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
  track: string | null;
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
    assertAudioBinaries();
    fs.mkdirSync(this.options.outputDir, { recursive: true });

    // Step 1: fetch info so we know the title up front. Expose the spawned
    // process so cancel() can interrupt even this (normally short) step.
    this.info = await fetchVideoInfo(this.options.url, (proc) => {
      this.proc = proc;
    });
    this.proc = null;
    if (this.cancelled) {
      throw new Error('Download cancelled');
    }
    this.emit('info', this.info);

    // Step 2: run yt-dlp with audio extraction.
    cleanupStaleIntermediateFiles(this.options.outputDir, this.info.id);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fmusic-ytdlp-'));
    const outputTemplate = path.join(this.options.outputDir, '%(title)s [%(id)s].%(ext)s');
    const args: string[] = [
      '--no-warnings',
      '--no-playlist',
      '--no-continue',
      '--paths',
      `temp:${tempDir}`,
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
      args.push('--ffmpeg-location', binDir());
    }

    args.push(this.options.url);
    const fullArgs = [...baseArgs(), ...args];

    return new Promise<DownloadResult>((resolve, reject) => {
      const proc = spawn(ytDlpPath(), fullArgs, spawnOptions());
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
          fs.rmSync(tempDir, { recursive: true, force: true });
          reject(new Error('Download cancelled'));
          return;
        }
        if (code !== 0) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          const trimmed = stderr.trim();
          // yt-dlp emits this exact line when ffprobe runs but can't parse
          // the file. In practice that happens either because ffprobe is
          // missing (handled by copying ffprobe-static in postinstall) or
          // because the downloaded file is not what yt-dlp expected —
          // typically a middleware / VPN that returns an HTTP redirect as
          // the response body. Surface a more actionable hint.
          if (/unable to obtain file audio codec with ffprobe/i.test(trimmed)) {
            const hint = !hasFfprobe()
              ? 'ffprobe is not installed next to ffmpeg. Re-run `npm install` or click "Update download engine" in Settings.'
              : 'The downloaded file is not valid media. This usually means a proxy or VPN is intercepting the download — try disabling it or switching networks.';
            reject(new Error(`${trimmed}\n${hint}\n\nDiagnostics:\n${ytDlpDiagnostics(fullArgs)}`));
            return;
          }
          reject(
            new Error(
              `yt-dlp exited with code ${code}: ${trimmed}\n\nDiagnostics:\n${ytDlpDiagnostics(fullArgs)}`
            )
          );
          return;
        }
        if (!this.finalFile || !this.info) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          reject(new Error('yt-dlp finished but could not resolve the generated file.'));
          return;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
        // Normalise the path: yt-dlp sometimes emits NFD-decomposed Unicode
        // (e.g. 'i' + combining diaeresis) whereas NTFS stores NFC. Round-trip
        // through path.normalize + String.normalize('NFC') so subsequent
        // fs.existsSync lookups match the on-disk entry.
        const normalizedPath = path.normalize(this.finalFile).normalize('NFC');
        resolve({
          filePath: normalizedPath,
          title: this.info.title,
          track: this.info.track,
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
    },
    ffprobe: {
      present: hasFfprobe(),
      path: hasFfprobe() ? ffprobePath() : null
    }
  };
}
