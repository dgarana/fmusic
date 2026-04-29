import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DownloadJob, SearchResult } from '../../../shared/types';
import { useDownloadsStore } from '../store/downloads';
import { useLibraryStore } from '../store/library';
import { PAGE_SIZE, useSearchStore } from '../store/search';
import {
  extractYoutubeId,
  extractYoutubePlaylistId,
  formatDuration,
  isYouTubeUrl
} from '../util';
import { useT } from '../i18n';
import { SearchIcon, DownloadIcon, CloseIcon } from '../components/icons';

function isSslError(message: string): boolean {
  return message.includes('CERTIFICATE_VERIFY_FAILED') || message.includes('SSL');
}

interface Preview {
  result: SearchResult;
  streamUrl: string | null;
  loading: boolean;
  error: string | null;
}

interface PlaylistPreview {
  url: string;
  title: string;
  entries: SearchResult[];
}

const ACTIVE_STATUSES: ReadonlyArray<DownloadJob['status']> = [
  'queued',
  'fetching-metadata',
  'downloading',
  'processing'
];

function jobYoutubeId(job: DownloadJob): string | null {
  return job.youtubeId ?? extractYoutubeId(job.request.url);
}

type TFn = ReturnType<typeof useT>;

function downloadProgressLabel(job: DownloadJob): string {
  if (job.status !== 'downloading') return '';
  return `${Math.round(job.progress * 100)}% · ${job.speedHuman ?? ''} · ETA ${formatDuration(job.etaSeconds ?? null)}`;
}

function DownloadProgress({ job }: { job: DownloadJob }) {
  return (
    <div className="download-output-progress">
      <div className="flex justify-between items-center fs-12 text-muted mb-4">
        <span className={`status-pill ${job.status}`}>{job.status}</span>
        <span>{Math.round(job.progress * 100)}%</span>
      </div>
      <div className="progress-bar">
        <div style={{ width: `${Math.min(100, Math.max(0, job.progress * 100))}%` }} />
      </div>
      {job.status === 'downloading' && (job.speedHuman || job.etaSeconds) && (
        <div className="fs-11 text-muted mt-4">
          {job.speedHuman ?? ''}
          {job.etaSeconds != null && ` · ETA ${formatDuration(job.etaSeconds)}`}
        </div>
      )}
    </div>
  );
}

function DownloadFailure({
  job,
  t,
  onSettings
}: {
  job: DownloadJob;
  t: TFn;
  onSettings: () => void;
}) {
  if (job.status !== 'failed') return null;
  return (
    <div className="text-danger fs-12 mt-6">
      {t('download.errorPrefix')} {job.error ?? t('download.failed')}
      {isSslError(job.error ?? '') && (
        <div className="mt-4 text-muted">
          <button className="btn-xxs" onClick={onSettings}>
            {t('download.enableIgnoreSsl')}
          </button>
        </div>
      )}
    </div>
  );
}

function DownloadOutputCard({
  title,
  meta,
  thumbnail,
  children,
  actions
}: {
  title: string;
  meta: string | null;
  thumbnail: string | null | undefined;
  children?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="download-output-card">
      {thumbnail ? <img src={thumbnail} alt="" /> : <div className="aspect-16-9" />}
      <div className="body">
        <div className="title">{title}</div>
        {meta && <div className="channel">{meta}</div>}
        {children}
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}

function DownloadJobCard({
  job,
  t,
  onSettings,
  onCancel,
  onDismiss
}: {
  job: DownloadJob;
  t: TFn;
  onSettings: () => void;
  onCancel: (jobId: string) => void;
  onDismiss: (jobId: string) => void;
}) {
  const active = ACTIVE_STATUSES.includes(job.status);
  const meta = active ? downloadProgressLabel(job) : job.request.url;
  return (
    <DownloadOutputCard
      title={job.title ?? job.request.url}
      meta={meta}
      thumbnail={job.thumbnail}
      actions={
        <>
          {active ? (
            <button className="danger" onClick={() => onCancel(job.id)}>
              {t('download.cancelJob')}
            </button>
          ) : (
            <button className="icon-btn" onClick={() => onDismiss(job.id)} title={t('download.dismissJob')}>
              <CloseIcon size={14} />
            </button>
          )}
        </>
      }
    >
      {active && <DownloadProgress job={job} />}
      {!active && (
        <div className="mt-6">
          <span className={`status-pill ${job.status}`}>{job.status}</span>
        </div>
      )}
      <DownloadFailure job={job} t={t} onSettings={onSettings} />
    </DownloadOutputCard>
  );
}

export function DownloadPage() {
  const t = useT();
  const navigate = useNavigate();
  const { query, results, resultLimit, error, setQuery, setResults, setError } = useSearchStore();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [playlistPreview, setPlaylistPreview] = useState<PlaylistPreview | null>(null);
  const jobs = useDownloadsStore((s) => s.jobs);
  const dismissJob = useDownloadsStore((s) => s.dismiss);
  const refreshPlaylists = useLibraryStore((s) => s.refreshPlaylists);
  const [inLibrary, setInLibrary] = useState<Set<string>>(new Set());

  // Build a lookup: youtubeId -> active job (the most recent one wins if there
  // are several, which should not happen with our sequential queue).
  const jobByYoutubeId = useMemo(() => {
    const map = new Map<string, DownloadJob>();
    for (const job of jobs) {
      const id = jobYoutubeId(job);
      if (!id) continue;
      map.set(id, job);
    }
    return map;
  }, [jobs]);

  // When results change, ask the main process which of these ids we already
  // have in the library so we can grey out the download button.
  useEffect(() => {
    if (results.length === 0) {
      setInLibrary(new Set());
      return;
    }
    let cancelled = false;
    void window.fmusic
      .downloadedYoutubeIds(results.map((r) => r.id))
      .then((ids) => {
        if (!cancelled) setInLibrary(new Set(ids));
      });
    return () => {
      cancelled = true;
    };
  }, [results]);

  // If a download finishes for a result we have visible, mark it as in-library
  // immediately without waiting for a refetch.
  useEffect(() => {
    const completedIds = jobs
      .filter((j) => j.status === 'completed')
      .map(jobYoutubeId)
      .filter((id): id is string => id !== null);
    if (completedIds.length === 0) return;
    setInLibrary((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of completedIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [jobs]);

  async function submit() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setError(null);
    setInfo(null);
    if (isYouTubeUrl(trimmed)) {
      const videoId = extractYoutubeId(trimmed);
      const playlistId = extractYoutubePlaylistId(trimmed);
      // If the URL carries a `list=` (dedicated playlist, user-curated list
      // or an auto-generated mix/radio) we treat it as a playlist download.
      // This matches the user-facing promise: "paste a playlist link and it
      // will download all of its items". Users who only want the single
      // video can paste a URL without the `&list=` parameter.
      if (playlistId) {
        await loadPlaylistPreview(trimmed);
        return;
      }
      setPlaylistPreview(null);
      await enqueue(trimmed, videoId);
      return;
    }
    setPlaylistPreview(null);
    setSearching(true);
    try {
      const items = await window.fmusic.search(trimmed, PAGE_SIZE);
      setResults(items, PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function loadPlaylistPreview(url: string) {
    setSearching(true);
    setInfo(t('download.fetchingPlaylist'));
    setPlaylistPreview(null);
    try {
      const { title: rawTitle, entries } = await window.fmusic.fetchYoutubePlaylist(url);
      if (entries.length === 0) {
        setInfo(t('download.playlistEmpty'));
        setResults([], PAGE_SIZE);
        return;
      }

      const playlistTitle = rawTitle?.trim() || t('download.playlistDefaultName');
      setPlaylistPreview({ url, title: playlistTitle, entries });
      setResults(entries, entries.length);
      setInfo(t('download.playlistReady', { title: playlistTitle, count: entries.length }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInfo(null);
    } finally {
      setSearching(false);
    }
  }

  async function enqueuePlaylist(preview: PlaylistPreview) {
    setSearching(true);
    setError(null);
    try {
      let localPlaylist: { id: number };
      try {
        localPlaylist = await window.fmusic.createPlaylist(preview.title, preview.url);
        await refreshPlaylists();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }

      const batchId = `pl-${localPlaylist.id}-${Date.now()}`;
      const entries = preview.entries;
      const entryIds = entries.map((e) => e.id);
      const alreadyIn = new Set(await window.fmusic.downloadedYoutubeIds(entryIds));

      // Anything already in the library should still end up in the newly
      // created local playlist — we just skip the download part.
      const preExisting = entries.filter((e) => alreadyIn.has(e.id));
      if (preExisting.length > 0) {
        try {
          const idToUrl = Object.fromEntries(preExisting.map((e) => [e.id, e.url]));
          await window.fmusic.addTracksByYoutubeIdsToPlaylist(
            localPlaylist.id,
            idToUrl
          );
          await refreshPlaylists();
        } catch {
          // Non-fatal: the local playlist exists, we just couldn't prefill
          // some tracks. The user can add them manually.
        }
      }

      let enqueued = 0;
      let skipped = 0;
      for (const entry of entries) {
        const activeJob = jobByYoutubeId.get(entry.id);
        const isActive = activeJob && ACTIVE_STATUSES.includes(activeJob.status);
        if (alreadyIn.has(entry.id) || isActive) {
          skipped++;
          continue;
        }
        try {
          await window.fmusic.enqueueDownload({
            url: entry.url,
            playlistId: localPlaylist.id,
            batchId,
            batchTitle: preview.title
          });
          enqueued++;
        } catch {
          // Individual failures will surface as failed jobs in the list; we
          // don't want one bad entry to abort the whole playlist import.
        }
      }

      setInfo(
        t('download.playlistEnqueued', {
          total: entries.length,
          enqueued,
          skipped,
          playlist: preview.title
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInfo(null);
    } finally {
      setSearching(false);
    }
  }

  async function cancelBatch(batchId: string) {
    const targets = jobs.filter(
      (j) => j.request.batchId === batchId && ACTIVE_STATUSES.includes(j.status)
    );
    await Promise.all(targets.map((j) => window.fmusic.cancelDownload(j.id)));
  }

  function dismissBatch(batchId: string) {
    for (const job of jobs) {
      if (job.request.batchId === batchId && !ACTIVE_STATUSES.includes(job.status)) {
        dismissJob(job.id);
      }
    }
  }

  async function loadMore() {
    const trimmed = query.trim();
    if (!trimmed) return;
    const nextLimit = resultLimit + PAGE_SIZE;
    setLoadingMore(true);
    try {
      const items = await window.fmusic.search(trimmed, nextLimit);
      setResults(items, nextLimit);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function enqueue(url: string, videoId: string | null) {
    const existingJob = videoId ? jobByYoutubeId.get(videoId) : undefined;
    const isActive = existingJob && ACTIVE_STATUSES.includes(existingJob.status);
    if (videoId && inLibrary.has(videoId)) {
      setInfo(t('download.alreadyHave'));
      return;
    }
    if (isActive) return;
    try {
      await window.fmusic.enqueueDownload({ url });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openPreview(result: SearchResult) {
    setPreview({ result, streamUrl: null, loading: true, error: null });
    try {
      const streamUrl = await window.fmusic.ytStreamUrl(result.url);
      setPreview({ result, streamUrl, loading: false, error: null });
    } catch (err) {
      setPreview({
        result,
        streamUrl: null,
        loading: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const orphanJobs = useMemo(() => {
    // Jobs that have no matching search result — typically direct URL pastes
    // or downloads queued from elsewhere. Keep them visible at the bottom.
    const visibleIds = new Set(results.map((r) => r.id));
    return jobs.filter((j) => {
      const id = jobYoutubeId(j);
      return !id || !visibleIds.has(id);
    });
  }, [jobs, results]);

  // Jobs that belong to a playlist import are rendered in their own group so
  // the user can see "Playlist X: 12 tracks" and cancel them all at once.
  const batches = useMemo(() => {
    const groups = new Map<string, { title: string; jobs: DownloadJob[] }>();
    for (const job of orphanJobs) {
      const id = job.request.batchId;
      if (!id) continue;
      const title = job.request.batchTitle ?? t('download.playlistDefaultName');
      const existing = groups.get(id);
      if (existing) existing.jobs.push(job);
      else groups.set(id, { title, jobs: [job] });
    }
    return Array.from(groups.entries()).map(([id, g]) => ({ id, ...g }));
  }, [orphanJobs, t]);

  const unbatchedOrphanJobs = useMemo(
    () => orphanJobs.filter((j) => !j.request.batchId),
    [orphanJobs]
  );

  return (
    <div className="main">
      <h1>{t('download.title')}</h1>
      <div className="search-row">
        <div className="input-with-icon">
          <SearchIcon size={16} />
          <input
            placeholder={t('download.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        </div>
        <button className="primary" onClick={() => void submit()} disabled={searching}>
          {searching ? t('common.searching') : t('download.searchButton')}
        </button>
      </div>
      {error && (
        <div className="text-danger mb-12">
          {error}
          {isSslError(error) && (
            <div className="mt-6 fs-13 text-muted">
              {t('download.sslHintBefore')}
              <button
                className="btn-xs"
                onClick={() => navigate('/settings')}
              >
                {t('download.ignoreSslErrors')}
              </button>
              {t('download.sslHintAfter')}
            </div>
          )}
        </div>
      )}
      {info && <div className="text-muted mb-12">{info}</div>}
      {playlistPreview && (
        <div className="download-playlist-preview mb-16">
          <div>
            <div className="fw-600">{playlistPreview.title}</div>
            <div className="text-muted fs-12">
              {t('download.playlistReady', {
                title: playlistPreview.title,
                count: playlistPreview.entries.length
              })}
            </div>
          </div>
          <button
            className="primary flex items-center gap-6"
            onClick={() => void enqueuePlaylist(playlistPreview)}
            disabled={searching}
          >
            <DownloadIcon size={14} />
            {t('download.downloadPlaylist')}
          </button>
        </div>
      )}

      {batches.map((batch) => {
        const activeCount = batch.jobs.filter((j) => ACTIVE_STATUSES.includes(j.status)).length;
        const completedCount = batch.jobs.filter((j) => j.status === 'completed').length;
        return (
          <section className="download-batch mb-16" key={batch.id}>
            <div className="flex items-center justify-between gap-12 mb-8">
              <h2 className="m-0">
                {t('download.playlistBatchTitle', { title: batch.title })}
              </h2>
              <div className="flex items-center gap-8 fs-13 text-muted">
                <span>
                  {t('download.playlistBatchProgress', {
                    done: completedCount,
                    total: batch.jobs.length
                  })}
                </span>
                {activeCount > 0 ? (
                  <button className="danger" onClick={() => void cancelBatch(batch.id)}>
                    {t('download.cancelAll')}
                  </button>
                ) : (
                  <button onClick={() => dismissBatch(batch.id)}>
                    {t('download.dismissAll')}
                  </button>
                )}
              </div>
            </div>
            <div className="download-output-grid">
              {batch.jobs.map((job) => (
                <DownloadJobCard
                  key={job.id}
                  job={job}
                  t={t}
                  onSettings={() => navigate('/settings')}
                  onCancel={(jobId) => void window.fmusic.cancelDownload(jobId)}
                  onDismiss={dismissJob}
                />
              ))}
            </div>
          </section>
        );
      })}

      {unbatchedOrphanJobs.length > 0 && (
        <>
          <h2>{t('download.otherDownloads')}</h2>
          <div className="download-output-grid">
            {unbatchedOrphanJobs.map((job) => (
              <DownloadJobCard
                key={job.id}
                job={job}
                t={t}
                onSettings={() => navigate('/settings')}
                onCancel={(jobId) => void window.fmusic.cancelDownload(jobId)}
                onDismiss={dismissJob}
              />
            ))}
          </div>
        </>
      )}

      {results.length > 0 && (
        <>
          <h2>{t('download.results')}</h2>
          <div className="results-grid">
            {results.map((r) => {
              const job = jobByYoutubeId.get(r.id);
              const already = inLibrary.has(r.id);
              const active = job && ACTIVE_STATUSES.includes(job.status);
              const isPreviewing = preview?.result.id === r.id;
              return (
                <DownloadOutputCard
                  key={r.id}
                  title={r.title}
                  meta={`${r.channel} · ${formatDuration(r.durationSec)}`}
                  thumbnail={r.thumbnail}
                  actions={
                    <>
                      {isPreviewing ? (
                        <button onClick={() => setPreview(null)}>{t('download.closePreview')}</button>
                      ) : (
                        <button onClick={() => void openPreview(r)}>{t('download.preview')}</button>
                      )}
                      {already ? (
                        <button disabled title={t('download.alreadyInLibraryTooltip')}>
                          {t('download.inLibrary')}
                        </button>
                      ) : active ? (
                        <button
                          className="danger"
                          onClick={() => void window.fmusic.cancelDownload(job!.id)}
                        >
                          {t('download.cancelJob')}
                        </button>
                      ) : (
                        <button
                          className="primary flex items-center gap-6"
                          onClick={() => void enqueue(r.url, r.id)}
                        >
                          <DownloadIcon size={14} />
                          {t('download.download')}
                        </button>
                      )}
                    </>
                  }
                >
                  {isPreviewing && (
                    <div className="mt-8">
                      {preview!.loading && (
                        <div className="text-muted fs-12">
                          {t('download.fetchingStream')}
                        </div>
                      )}
                      {preview!.error && (
                        <div className="text-danger fs-12">
                          {preview!.error}
                          <div>
                            <button
                              onClick={() => void window.fmusic.openExternal(r.url)}
                              className="mt-6"
                            >
                              {t('download.openInBrowser')}
                            </button>
                          </div>
                        </div>
                      )}
                      {preview!.streamUrl && (
                        <audio controls autoPlay src={preview!.streamUrl} className="w-full" />
                      )}
                    </div>
                  )}

                  {active && <DownloadProgress job={job!} />}
                  {job?.status === 'failed' && (
                    <DownloadFailure
                      job={job}
                      t={t}
                      onSettings={() => navigate('/settings')}
                    />
                  )}
                </DownloadOutputCard>
              );
            })}
          </div>
          {!playlistPreview && results.length >= resultLimit && (
            <div className="text-center mt-16">
              <button onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? t('download.loading') : t('download.loadMore')}
              </button>
            </div>
          )}
        </>
      )}

    </div>
  );
}
