import { useState } from 'react';
import type { SearchResult } from '../../../shared/types';
import { useDownloadsStore } from '../store/downloads';
import { formatDuration, isYouTubeUrl } from '../util';

interface Preview {
  result: SearchResult;
  streamUrl: string | null;
  loading: boolean;
  error: string | null;
}

export function DownloadPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
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
        <div
          style={{
            marginBottom: 18,
            padding: 14,
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg-elevated)',
            display: 'flex',
            gap: 14,
            alignItems: 'center'
          }}
        >
          {preview.result.thumbnail && (
            <img
              src={preview.result.thumbnail}
              alt=""
              style={{ width: 120, aspectRatio: '16/9', objectFit: 'cover', borderRadius: 6 }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="title" style={{ marginBottom: 2 }}>
              {preview.result.title}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>
              {preview.result.channel} &middot; {formatDuration(preview.result.durationSec)}
            </div>
            {preview.loading && <div style={{ color: 'var(--text-muted)' }}>Obteniendo stream...</div>}
            {preview.error && (
              <div style={{ color: 'var(--danger)', marginBottom: 6 }}>
                {preview.error}
                <div>
                  <button
                    onClick={() => void window.fmusic.openExternal(preview.result.url)}
                    style={{ marginTop: 6 }}
                  >
                    Abrir en navegador
                  </button>
                </div>
              </div>
            )}
            {preview.streamUrl && (
              <audio
                controls
                autoPlay
                src={preview.streamUrl}
                style={{ width: '100%' }}
              />
            )}
          </div>
          <button onClick={() => setPreview(null)} title="Cerrar">
            ×
          </button>
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
                    <button onClick={() => void openPreview(r)}>Previsualizar</button>
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
