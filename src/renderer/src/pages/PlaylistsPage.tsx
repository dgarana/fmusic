import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLibraryStore } from '../store/library';
import { usePlayerStore } from '../store/player';
import { formatDuration } from '../util';
import type { Track } from '../../../shared/types';

export function PlaylistsPage() {
  const params = useParams();
  const { playlists, refreshPlaylists } = useLibraryStore();
  const [newName, setNewName] = useState('');

  const activeId = params.id ? Number(params.id) : null;
  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === activeId) ?? null,
    [playlists, activeId]
  );

  async function createPlaylist() {
    const name = newName.trim();
    if (!name) return;
    await window.fmusic.createPlaylist(name);
    setNewName('');
    await refreshPlaylists();
  }

  if (activePlaylist) {
    return <PlaylistDetail id={activePlaylist.id} name={activePlaylist.name} />;
  }

  return (
    <div>
      <h1>Playlists</h1>
      <div className="search-row">
        <input
          placeholder="Nombre de la nueva playlist..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void createPlaylist();
          }}
        />
        <button className="primary" onClick={() => void createPlaylist()}>
          Crear playlist
        </button>
      </div>

      {playlists.length === 0 ? (
        <div className="empty">Aún no tienes playlists.</div>
      ) : (
        <div className="results-grid">
          {playlists.map((p) => (
            <div key={p.id} className="result-card" style={{ padding: 16 }}>
              <div className="title" style={{ fontSize: 16 }}>
                {p.name}
              </div>
              <div className="channel">{p.trackCount} canciones</div>
              <div className="actions" style={{ marginTop: 10 }}>
                <a href={`#/playlists/${p.id}`}>
                  <button>Abrir</button>
                </a>
                <button
                  className="danger"
                  onClick={async () => {
                    if (!confirm(`¿Eliminar playlist "${p.name}"?`)) return;
                    await window.fmusic.deletePlaylist(p.id);
                    await refreshPlaylists();
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlaylistDetail({ id, name }: { id: number; name: string }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const refreshPlaylists = useLibraryStore((s) => s.refreshPlaylists);

  async function refresh() {
    const list = await window.fmusic.listTracks({ playlistId: id });
    setTracks(list);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function openPicker() {
    setAdding(false);
    setSelected(new Set());
    setPickerQuery('');
    setPickerOpen(true);
    const all = await window.fmusic.listTracks({
      sortBy: 'title',
      sortDir: 'asc',
      limit: 10_000
    });
    setAllTracks(all);
  }

  async function commitAdd() {
    if (selected.size === 0) return;
    setAdding(true);
    for (const trackId of selected) {
      await window.fmusic.addTrackToPlaylist(id, trackId);
    }
    setPickerOpen(false);
    setSelected(new Set());
    setAdding(false);
    await refresh();
    await refreshPlaylists();
  }

  async function remove(trackId: number) {
    await window.fmusic.removeTrackFromPlaylist(id, trackId);
    await refresh();
    await refreshPlaylists();
  }

  async function moveUp(index: number) {
    if (index === 0) return;
    const ordered = [...tracks];
    [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]];
    setTracks(ordered);
    await window.fmusic.reorderPlaylist(id, ordered.map((t) => t.id));
  }

  const inPlaylist = useMemo(() => new Set(tracks.map((t) => t.id)), [tracks]);
  const candidates = useMemo(() => {
    const needle = pickerQuery.trim().toLowerCase();
    return allTracks.filter((t) => {
      if (inPlaylist.has(t.id)) return false;
      if (!needle) return true;
      const haystack = [t.title, t.artist, t.album, t.genre].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [allTracks, inPlaylist, pickerQuery]);

  function toggle(trackId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>{name}</h1>
        <button className="primary" onClick={() => void openPicker()}>
          + Añadir canciones
        </button>
      </div>

      {pickerOpen && (
        <div
          style={{
            marginBottom: 18,
            padding: 14,
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg-elevated)'
          }}
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              placeholder="Filtrar por título, artista, álbum o género..."
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              style={{ flex: 1 }}
              autoFocus
            />
            <button
              className="primary"
              onClick={() => void commitAdd()}
              disabled={selected.size === 0 || adding}
            >
              {adding ? 'Añadiendo...' : `Añadir ${selected.size || ''}`.trim()}
            </button>
            <button onClick={() => setPickerOpen(false)}>Cancelar</button>
          </div>
          {candidates.length === 0 ? (
            <div className="empty" style={{ padding: 12 }}>
              {allTracks.length === 0
                ? 'Tu biblioteca está vacía.'
                : 'Todas las canciones de la biblioteca ya están en esta playlist.'}
            </div>
          ) : (
            <div
              style={{
                maxHeight: 320,
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: 6
              }}
            >
              {candidates.map((t) => (
                <label
                  key={t.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{t.title}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {t.artist ?? '-'} &middot; {formatDuration(t.durationSec)}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {tracks.length === 0 ? (
        <div className="empty">
          Esta playlist está vacía. Añade canciones desde la Biblioteca o con el botón de arriba.
        </div>
      ) : (
        <table className="track-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Título</th>
              <th>Artista</th>
              <th>Duración</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t, i) => (
              <tr key={t.id}>
                <td>{i + 1}</td>
                <td>{t.title}</td>
                <td>{t.artist ?? '-'}</td>
                <td>{formatDuration(t.durationSec)}</td>
                <td className="actions">
                  <button onClick={() => void playTrack(t, tracks)} title="Reproducir">▶</button>{' '}
                  <button onClick={() => void moveUp(i)} disabled={i === 0} title="Subir">↑</button>{' '}
                  <button className="danger" onClick={() => void remove(t.id)} title="Quitar">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
