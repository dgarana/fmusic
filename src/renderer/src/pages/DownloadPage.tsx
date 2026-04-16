import { useEffect, useMemo, useState } from 'react';
import type { DownloadJob, SearchResult } from '../../../shared/types';
import { useDownloadsStore } from '../store/downloads';
import { useSearchStore } from '../store/search';
import { extractYoutubeId, formatDuration, isYouTubeUrl } from '../util';

interface Preview {
  result: SearchResult;
  streamUrl: string | null;
  loading: boolean;
  error: string | null;
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

export function DownloadPage() {
  const { query, results, error, setQuery, setResults, setError } = useSearchStore();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [searching, setSearching] = useState(false);
  const jobs = useDownloadsStore((s) => s.jobs);
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
    if (isYouTubeUrl(trimmed)) {
      await enqueue(trimmed, extractYoutubeId(trimmed));
      return;
    }
    setSearching(true);
    try {
      const items = await window.fmusic.search(trimmed, 12);
      setResults(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function enqueue(url: string, videoId: string | null) {
    if (videoId && (inLibrary.has(videoId) || jobByYoutubeId.has(videoId))) return;
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

  return (
    <div>
      <h1>Descargar</h1>
      <div className="search-row">
        <input
          placeholder="Pega un enlace de YouTube o escribe para buscar..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        <button className="primary" onClick={() => void submit()} disabled={searching}>
          {searching ? 'Buscando...' : 'Buscar / Descargar'}
        </button>
      </div>
      {error && <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}

      {results.length > 0 && (
        <>
          <h2>Resultados</h2>
          <div className="results-grid">
            {results.map((r) => {
              const job = jobByYoutubeId.get(r.id);
              const already = inLibrary.has(r.id);
              const active = job && ACTIVE_STATUSES.includes(job.status);
              const isPreviewing = preview?.result.id === r.id;
              return (
                <div key={r.id} className="result-card">
                  {r.thumbnail ? (
                    <img src={r.thumbnail} alt="" />
                  ) : (
                    <div style={{ aspectRatio: '16/9' }} />
                  )}
                  <div className="body">
                    <div className="title">{r.title}</div>
                    <div className="channel">
                      {r.channel} &middot; {formatDuration(r.durationSec)}
                    </div>

                    {isPreviewing && (
                      <div style={{ marginTop: 8 }}>
                        {preview!.loading && (
                          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                            Obteniendo stream...
                          </div>
                        )}
                        {preview!.error && (
                          <div style={{ color: 'var(--danger)', fontSize: 12 }}>
                            {preview!.error}
                            <div>
                              <button
                                onClick={() => void window.fmusic.openExternal(r.url)}
                                style={{ marginTop: 6 }}
                              >
                                Abrir en navegador
                              </button>
                            </div>
                          </div>
                        )}
                        {preview!.streamUrl && (
                          <audio
                            controls
                            autoPlay
                            src={preview!.streamUrl}
                            style={{ width: '100%' }}
                          />
                        )}
                      </div>
                    )}

                    {active && (
                      <div style={{ marginTop: 6 }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: 12,
                            color: 'var(--text-muted)',
                            marginBottom: 4
                          }}
                        >
                          <span className={`status-pill ${job!.status}`}>{job!.status}</span>
                          <span>{Math.round(job!.progress * 100)}%</span>
                        </div>
                        <div className="progress-bar">
                          <div
                            style={{
                              width: `${Math.min(100, Math.max(0, job!.progress * 100))}%`
                            }}
                          />
                        </div>
                        {job!.status === 'downloading' && (job!.speedHuman || job!.etaSeconds) && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                            {job!.speedHuman ?? ''}
                            {job!.etaSeconds != null && ` · ETA ${formatDuration(job!.etaSeconds)}`}
                          </div>
                        )}
                      </div>
                    )}

                    {job?.status === 'failed' && (
                      <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>
                        Error: {job.error ?? 'falló'}
                      </div>
                    )}

                    <div className="actions">
                      {isPreviewing ? (
                        <button onClick={() => setPreview(null)}>Cerrar preview</button>
                      ) : (
                        <button onClick={() => void openPreview(r)}>Previsualizar</button>
                      )}
                      {already ? (
                        <button disabled title="Ya la tienes en tu biblioteca">
                          ✓ En biblioteca
                        </button>
                      ) : active ? (
                        <button
                          className="danger"
                          onClick={() => void window.fmusic.cancelDownload(job!.id)}
                        >
                          Cancelar
                        </button>
                      ) : (
                        <button className="primary" onClick={() => void enqueue(r.url, r.id)}>
                          Descargar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {orphanJobs.length > 0 && (
        <>
          <h2>Otras descargas</h2>
          <div className="jobs">
            {orphanJobs.map((job) => (
              <div className="job" key={job.id}>
                <div>
                  <div className="title">{job.title ?? job.request.url}</div>
                  <div className="meta">
                    {job.status === 'downloading'
                      ? `${Math.round(job.progress * 100)}% · ${job.speedHuman ?? ''} · ETA ${formatDuration(job.etaSeconds ?? null)}`
                      : job.error ?? ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`status-pill ${job.status}`}>{job.status}</span>
                  {ACTIVE_STATUSES.includes(job.status) && (
                    <button onClick={() => void window.fmusic.cancelDownload(job.id)}>
                      Cancelar
                    </button>
                  )}
                </div>
                <div className="progress-bar">
                  <div style={{ width: `${Math.min(100, Math.max(0, job.progress * 100))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
