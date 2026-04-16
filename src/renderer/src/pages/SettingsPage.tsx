import { useEffect, useState } from 'react';
import type { AppSettings, DependencyStatus } from '../../../shared/types';

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [deps, setDeps] = useState<DependencyStatus | null>(null);
  const [history, setHistory] = useState<
    Array<{ version: number; name: string; applied_at: string }>
  >([]);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const [s, d, h] = await Promise.all([
      window.fmusic.getSettings(),
      window.fmusic.depsStatus(),
      window.fmusic.schemaHistory()
    ]);
    setSettings(s);
    setDeps(d);
    setHistory(h);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function update(patch: Partial<AppSettings>) {
    const next = await window.fmusic.updateSettings(patch);
    setSettings(next);
  }

  async function pickFolder() {
    const path = await window.fmusic.pickDirectory();
    if (path) await update({ downloadDir: path });
  }

  async function updateYtDlp() {
    setUpdating(true);
    setMessage(null);
    try {
      const res = await window.fmusic.updateYtDlp();
      setMessage(`yt-dlp actualizado (versión ${res.version ?? 'desconocida'}).`);
      const d = await window.fmusic.depsStatus();
      setDeps(d);
    } catch (err) {
      setMessage('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUpdating(false);
    }
  }

  if (!settings) return <div>Cargando...</div>;

  return (
    <div>
      <h1>Ajustes</h1>

      <h2>Descargas</h2>
      <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
        <label>
          Carpeta de descarga
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <input
              readOnly
              value={settings.downloadDir}
              style={{ flex: 1, fontFamily: 'monospace' }}
            />
            <button onClick={() => void pickFolder()}>Cambiar</button>
            <button onClick={() => void window.fmusic.openPath(settings.downloadDir)}>
              Abrir
            </button>
          </div>
        </label>
        <label>
          Formato por defecto
          <select
            value={settings.defaultFormat}
            onChange={(e) =>
              void update({ defaultFormat: e.target.value as AppSettings['defaultFormat'] })
            }
            style={{ marginLeft: 8 }}
          >
            <option value="mp3">MP3</option>
            <option value="m4a">M4A</option>
            <option value="opus">Opus</option>
          </select>
        </label>
        <label>
          Calidad por defecto
          <select
            value={settings.defaultQuality}
            onChange={(e) => void update({ defaultQuality: Number(e.target.value) })}
            style={{ marginLeft: 8 }}
          >
            <option value={128}>128 kbps</option>
            <option value={192}>192 kbps</option>
            <option value={256}>256 kbps</option>
            <option value={320}>320 kbps</option>
          </select>
        </label>
      </div>

      <h2>Red</h2>
      <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.skipCertCheck ?? false}
            onChange={(e) => void update({ skipCertCheck: e.target.checked })}
          />
          <span>
            Ignorar errores de certificado SSL
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
              Actívalo si estás detrás de una VPN corporativa con inspección SSL. Desactívalo en redes de confianza.
            </div>
          </span>
        </label>
      </div>

      <h2>Dependencias</h2>
      {deps && (
        <div>
          <div>
            <strong>yt-dlp</strong>: {deps.ytDlp.present ? '✅ disponible' : '❌ no encontrado'}
            {deps.ytDlp.version && ` (v${deps.ytDlp.version})`}
            {deps.ytDlp.path && (
              <div style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 11 }}>
                {deps.ytDlp.path}
              </div>
            )}
          </div>
          <div style={{ marginTop: 6 }}>
            <strong>ffmpeg</strong>: {deps.ffmpeg.present ? '✅ disponible' : '❌ no encontrado'}
            {deps.ffmpeg.path && (
              <div style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 11 }}>
                {deps.ffmpeg.path}
              </div>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => void updateYtDlp()} disabled={updating}>
              {updating ? 'Actualizando...' : 'Actualizar motor de descarga'}
            </button>
            {message && (
              <span style={{ marginLeft: 10, color: 'var(--text-muted)' }}>{message}</span>
            )}
          </div>
        </div>
      )}

      <h2>Esquema de la biblioteca</h2>
      <table className="track-table" style={{ maxWidth: 520 }}>
        <thead>
          <tr>
            <th>Versión</th>
            <th>Migración</th>
            <th>Aplicada</th>
          </tr>
        </thead>
        <tbody>
          {history.map((row) => (
            <tr key={row.version}>
              <td>{row.version}</td>
              <td>{row.name}</td>
              <td>{row.applied_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
