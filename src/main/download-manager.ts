import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import NodeID3 from 'node-id3';
import type {
  DownloadJob,
  DownloadRequest,
  DownloadStatus,
  Track
} from '../shared/types.js';
import { DownloadProcess } from './ytdlp.js';
import { getSettings } from './settings.js';
import { findByYoutubeId, insertTrack, updateTrackSourceUrl } from './library/tracks-repo.js';
import { addTrackToPlaylist } from './library/playlists-repo.js';

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

function normalizeOptionalMetadata(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^(n\/?a|none|null|undefined)$/i.test(trimmed)) return null;
  return trimmed;
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

async function hasEmbeddedArtwork(filePath: string): Promise<boolean> {
  try {
    const metadata = await parseFile(filePath);
    return Boolean(metadata.common.picture?.length);
  } catch {
    return false;
  }
}

async function fetchThumbnailBuffer(
  thumbnailUrl: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const response = await fetch(thumbnailUrl);
  if (!response.ok) {
    throw new Error(`thumbnail request failed with ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0) return null;

  return {
    buffer,
    mimeType: response.headers.get('content-type') || 'image/jpeg'
  };
}

async function ensureEmbeddedArtwork(filePath: string, thumbnailUrl: string | null): Promise<void> {
  if (await hasEmbeddedArtwork(filePath)) return;
  if (!thumbnailUrl) return;
  if (path.extname(filePath).toLowerCase() !== '.mp3') return;

  const thumbnail = await fetchThumbnailBuffer(thumbnailUrl);
  if (!thumbnail) return;

  const result = NodeID3.update(
    {
      image: {
        mime: thumbnail.mimeType,
        type: {
          id: NodeID3.TagConstants.AttachedPicture.PictureType.FRONT_COVER,
          name: 'front cover'
        },
        description: 'Cover',
        imageBuffer: thumbnail.buffer
      }
    },
    filePath
  );

  if (result instanceof Error) {
    throw result;
  }

  if (!(await hasEmbeddedArtwork(filePath))) {
    throw new Error('embedded artwork verification failed after fallback write');
  }
}

export class DownloadManager extends EventEmitter {
  private queue: DownloadJob[] = [];
  private active = new Map<string, { job: DownloadJob; proc: DownloadProcess }>();

  list(): DownloadJob[] {
    return [...this.active.values()].map(({ job }) => job).concat(this.queue);
  }

  enqueue(request: DownloadRequest): DownloadJob {
    const settings = getSettings();
    const job: DownloadJob = {
      id: randomUUID(),
      request: {
        url: request.url,
        format: request.format ?? settings.defaultFormat,
        quality: request.quality ?? settings.defaultQuality,
        playlistId: request.playlistId,
        batchId: request.batchId,
        batchTitle: request.batchTitle
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
    const active = this.active.get(jobId);
    if (active) {
      active.proc.cancel();
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

  refreshConcurrency(): void {
    queueMicrotask(() => this.processNext());
  }

  private async processNext(): Promise<void> {
    const settings = getSettings();
    const maxConcurrent = Math.max(1, Math.min(6, Math.floor(settings.concurrency || 1)));
    while (this.active.size < maxConcurrent) {
      const job = this.queue.shift();
      if (!job) return;
      void this.runJob(job);
    }
  }

  private async runJob(job: DownloadJob): Promise<void> {
    const settings = getSettings();
    const proc = new DownloadProcess({
      url: job.request.url,
      outputDir: settings.downloadDir,
      format: job.request.format ?? settings.defaultFormat,
      quality: job.request.quality ?? settings.defaultQuality
    });
    this.active.set(job.id, { job, proc });

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
      let album: string | null = normalizeOptionalMetadata(result.album);
      let genre: string | null = normalizeOptionalMetadata(result.genre);
      let durationSec = result.durationSec;
      let title = resolveImportedTitle(result.title, result.track, artist);

      try {
        const meta = await parseFile(result.filePath);
        artist = artist ?? meta.common.artist ?? meta.common.artists?.[0] ?? null;
        title =
          meta.common.title?.trim() ||
          resolveImportedTitle(result.title, result.track, artist);
        album = album ?? normalizeOptionalMetadata(meta.common.album);
        genre = genre ?? normalizeOptionalMetadata(meta.common.genre?.[0]);
        if (!durationSec && meta.format.duration) {
          durationSec = Math.round(meta.format.duration);
        }
      } catch {
        // ignore tag read errors; we still have the filepath and title
      }

      try {
        await ensureEmbeddedArtwork(result.filePath, result.thumbnail);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.warn('[FMusic] Could not ensure embedded artwork:', detail);
      }

      let track: Track;
      const existing = findByYoutubeId(result.youtubeId);
      if (existing) {
        track = existing;
        if (!track.sourceUrl) {
          updateTrackSourceUrl(track.id, job.request.url);
          track.sourceUrl = job.request.url;
        }
      } else {
        track = insertTrack({
          youtubeId: result.youtubeId,
          title,
          artist,
          album,
          genre,
          durationSec,
          filePath: result.filePath,
          thumbnailPath: null,
          sourceUrl: job.request.url
        });
      }

      // When the job belongs to a playlist import, make sure the finished
      // track ends up in the local playlist the user asked for. We swallow
      // errors so a misconfigured playlist id cannot break the download
      // pipeline — the track itself is already saved to the library.
      const destinationPlaylist = job.request.playlistId;
      if (destinationPlaylist != null) {
        try {
          addTrackToPlaylist(destinationPlaylist, track.id);
        } catch (err) {
          console.warn(
            `[FMusic] Could not add track ${track.id} to playlist ${destinationPlaylist}:`,
            err instanceof Error ? err.message : err
          );
        }
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
      this.active.delete(job.id);
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
