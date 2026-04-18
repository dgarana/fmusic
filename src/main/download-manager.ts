import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { parseFile } from 'music-metadata';
import type {
  DownloadJob,
  DownloadRequest,
  DownloadStatus,
  Track
} from '../shared/types.js';
import { DownloadProcess } from './ytdlp.js';
import { getSettings } from './settings.js';
import { findByYoutubeId, insertTrack } from './library/tracks-repo.js';

type Listener = (...args: unknown[]) => void;

function stripArtistPrefixFromTitle(rawTitle: string, artist: string | null): string {
  const normalizedArtist = artist?.trim();
  const trimmedTitle = rawTitle.trim();
  if (!normalizedArtist || !trimmedTitle) return trimmedTitle;

  const separators = [' - ', ' – ', ' — ', ': '];
  for (const separator of separators) {
    const prefixed = `${normalizedArtist}${separator}`;
    if (trimmedTitle.toLowerCase().startsWith(prefixed.toLowerCase())) {
      return trimmedTitle.slice(prefixed.length).trim();
    }
  }

  return trimmedTitle;
}

function resolveImportedTitle(
  rawTitle: string,
  structuredTrack: string | null,
  artist: string | null
): string {
  const preferredTrack = structuredTrack?.trim();
  if (preferredTrack) return preferredTrack;
  return stripArtistPrefixFromTitle(rawTitle, artist);
}

export class DownloadManager extends EventEmitter {
  private queue: DownloadJob[] = [];
  private current: { job: DownloadJob; proc: DownloadProcess } | null = null;

  list(): DownloadJob[] {
    const all = [...this.queue];
    if (this.current) all.unshift(this.current.job);
    return all;
  }

  enqueue(request: DownloadRequest): DownloadJob {
    const settings = getSettings();
    const job: DownloadJob = {
      id: randomUUID(),
      request: {
        url: request.url,
        format: request.format ?? settings.defaultFormat,
        quality: request.quality ?? settings.defaultQuality
      },
      status: 'queued',
      progress: 0
    };
    this.queue.push(job);
    this.emitUpdate(job);
    queueMicrotask(() => this.processNext());
    return job;
  }

  cancel(jobId: string): boolean {
    if (this.current && this.current.job.id === jobId) {
      this.current.proc.cancel();
      return true;
    }
    const idx = this.queue.findIndex((j) => j.id === jobId);
    if (idx >= 0) {
      const [removed] = this.queue.splice(idx, 1);
      this.updateJob(removed, { status: 'cancelled' });
      return true;
    }
    return false;
  }

  private async processNext(): Promise<void> {
    if (this.current) return;
    const job = this.queue.shift();
    if (!job) return;

    const settings = getSettings();
    const proc = new DownloadProcess({
      url: job.request.url,
      outputDir: settings.downloadDir,
      format: job.request.format ?? settings.defaultFormat,
      quality: job.request.quality ?? settings.defaultQuality
    });
    this.current = { job, proc };

    this.updateJob(job, { status: 'fetching-metadata' });

    proc.on('info', (info: { id: string; title: string; thumbnail: string | null }) => {
      this.updateJob(job, {
        status: 'downloading',
        title: info.title,
        thumbnail: info.thumbnail ?? undefined,
        youtubeId: info.id
      });
    });

    proc.on(
      'progress',
      (progress: { percent: number; etaSeconds: number | null; speedHuman: string | null }) => {
        this.updateJob(job, {
          status: 'downloading',
          progress: progress.percent,
          etaSeconds: progress.etaSeconds ?? undefined,
          speedHuman: progress.speedHuman ?? undefined
        });
      }
    );

    try {
      const result = await proc.start();
      this.updateJob(job, { status: 'processing', progress: 1 });

      // Prefer the metadata yt-dlp already resolved (music videos on YouTube
      // expose structured artist/album/track); fall back to ID3 tags read
      // from the final file for cases where yt-dlp could not find them.
      let artist: string | null = result.artist;
      let album: string | null = result.album;
      let genre: string | null = result.genre;
      let durationSec = result.durationSec;
      let title = resolveImportedTitle(result.title, result.track, artist);

      try {
        const meta = await parseFile(result.filePath);
        artist = artist ?? meta.common.artist ?? meta.common.artists?.[0] ?? null;
        title =
          meta.common.title?.trim() ||
          resolveImportedTitle(result.title, result.track, artist);
        album = album ?? meta.common.album ?? null;
        genre = genre ?? meta.common.genre?.[0] ?? null;
        if (!durationSec && meta.format.duration) {
          durationSec = Math.round(meta.format.duration);
        }
      } catch {
        // ignore tag read errors; we still have the filepath and title
      }

      let track: Track;
      const existing = findByYoutubeId(result.youtubeId);
      if (existing) {
        track = existing;
      } else {
        track = insertTrack({
          youtubeId: result.youtubeId,
          title,
          artist,
          album,
          genre,
          durationSec,
          filePath: result.filePath,
          thumbnailPath: null
        });
      }

      this.updateJob(job, { status: 'completed', progress: 1, trackId: track.id });
      this.emit('track-added', track);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status: DownloadStatus = message.includes('cancelled')
        ? 'cancelled'
        : 'failed';
      this.updateJob(job, { status, error: message });
    } finally {
      this.current = null;
      queueMicrotask(() => this.processNext());
    }
  }

  private updateJob(job: DownloadJob, patch: Partial<DownloadJob>): void {
    Object.assign(job, patch);
    this.emitUpdate(job);
  }

  private emitUpdate(job: DownloadJob): void {
    // Emit a shallow clone so consumers cannot accidentally mutate internal state.
    this.emit('job-update', { ...job });
  }

  onJobUpdate(listener: (job: DownloadJob) => void): () => void {
    const wrapped: Listener = (job) => listener(job as DownloadJob);
    this.on('job-update', wrapped);
    return () => this.off('job-update', wrapped);
  }

  onTrackAdded(listener: (track: Track) => void): () => void {
    const wrapped: Listener = (track) => listener(track as Track);
    this.on('track-added', wrapped);
    return () => this.off('track-added', wrapped);
  }
}

let instance: DownloadManager | null = null;
export function getDownloadManager(): DownloadManager {
  if (!instance) instance = new DownloadManager();
  return instance;
}
