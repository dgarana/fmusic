import { useState } from 'react';
import type { SearchResult } from '../../../shared/types';
import { useDownloadsStore } from '../store/downloads';
import { formatDuration, isYouTubeUrl } from '../util';

export function DownloadPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobs = useDownloadsStore((s) => s.jobs);

  async function submit() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setError(null);
    if (isYouTubeUrl(trimmed)) {
      await enqueue(trimmed);
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

  async function enqueue(url: string) {
    try {
      await window.fmusic.enqueueDownload({ url });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

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

      {preview && (
        <div style={{ marginBottom: 18 }}>
          <h2>Previsualización</h2>
          <iframe
            title="preview"
            width="100%"
            height={320}
            style={{ border: 0, borderRadius: 8, maxWidth: 640 }}
            src={`https://www.youtube.com/embed/${preview}?autoplay=1`}
            allow="autoplay; encrypted-media"
          />
        </div>
      )}

      {results.length > 0 && (
        <>
          <h2>Resultados</h2>
          <div className="results-grid">
            {results.map((r) => (
              <div key={r.id} className="result-card">
                {r.thumbnail ? <img src={r.thumbnail} alt="" /> : <div style={{ aspectRatio: '16/9' }} />}
                <div className="body">
                  <div className="title">{r.title}</div>
                  <div className="channel">
                    {r.channel} &middot; {formatDuration(r.durationSec)}
                  </div>
                  <div className="actions">
                    <button onClick={() => setPreview(r.id)}>Previsualizar</button>
                    <button className="primary" onClick={() => void enqueue(r.url)}>
                      Descargar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {jobs.length > 0 && (
        <>
          <h2>Cola de descargas</h2>
          <div className="jobs">
            {jobs.map((job) => (
              <div className="job" key={job.id}>
                <div>
                  <div className="title">{job.title ?? job.request.url}</div>
                  <div className="meta">
                    {job.status === 'downloading'
                      ? `${Math.round(job.progress * 100)}% \u00b7 ${job.speedHuman ?? ''} \u00b7 ETA ${formatDuration(job.etaSeconds ?? null)}`
                      : job.error ?? ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`status-pill ${job.status}`}>{job.status}</span>
                  {['queued', 'downloading', 'fetching-metadata'].includes(job.status) && (
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
