import { useEffect, useState } from 'react';
import type { DependencyStatus } from '../../../shared/types';
import { useSettingsStore } from '../store/settings';

type Tab = 'downloads' | 'system' | 'network' | 'dependencies';

const TAB_LABELS: Record<Tab, string> = {
  downloads: '⬇️ Downloads',
  system: '🖥️ System',
  network: '🌐 Network',
  dependencies: '📦 Dependencies'
};

export function SettingsPage() {
  const { settings, update } = useSettingsStore();
  const [tab, setTab] = useState<Tab>('downloads');

  // Deps state is local — it's only needed in this page
  const [deps, setDeps] = useState<DependencyStatus | null>(null);
  const [ytDlpVersion, setYtDlpVersion] = useState<string | null>(null);
  const [history, setHistory] = useState<
    Array<{ version: number; name: string; applied_at: string }>
  >([]);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [d, h] = await Promise.all([
        window.fmusic.depsStatus(),
        window.fmusic.schemaHistory()
      ]);
      setDeps(d);
      setHistory(h);
      window.fmusic.depsVersion().then(setYtDlpVersion).catch(() => setYtDlpVersion(null));
    })();
  }, []);

  async function pickFolder() {
    const path = await window.fmusic.pickDirectory();
    if (path) await update({ downloadDir: path });
  }

  async function updateYtDlp() {
    setUpdating(true);
    setMessage(null);
    try {
      await window.fmusic.updateYtDlp();
      const [d, v] = await Promise.all([window.fmusic.depsStatus(), window.fmusic.depsVersion()]);
      setDeps(d);
      setYtDlpVersion(v);
      setMessage(`yt-dlp updated (version ${v ?? 'unknown'}).`);
    } catch (err) {
      setMessage('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUpdating(false);
    }
  }

  if (!settings) return <div>⏳ Loading...</div>;

  return (
    <div>
      <h1>⚙️ Settings</h1>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: t === tab ? '2px solid var(--accent)' : '2px solid transparent',
              borderRadius: 0,
              color: t === tab ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer',
              fontWeight: t === tab ? 600 : 400,
              marginBottom: -1,
              padding: '8px 18px'
            }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'downloads' && (
        <div style={{ display: 'grid', gap: 14, maxWidth: 520 }}>
          <label>
            📁 Download folder
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <input
                readOnly
                value={settings.downloadDir}
                style={{ flex: 1, fontFamily: 'monospace' }}
              />
              <button onClick={() => void pickFolder()}>✏️ Change</button>
              <button onClick={() => void window.fmusic.openPath(settings.downloadDir)}>
                📂 Open
              </button>
            </div>
          </label>
          <label>
            🎧 Default format
            <select
              value={settings.defaultFormat}
              onChange={(e) =>
                void update({ defaultFormat: e.target.value as typeof settings.defaultFormat })
              }
              style={{ marginLeft: 8 }}
            >
              <option value="mp3">MP3</option>
              <option value="m4a">M4A</option>
              <option value="opus">Opus</option>
            </select>
          </label>
          <label>
            🎚️ Default quality
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
      )}

      {tab === 'system' && (
        <div style={{ display: 'grid', gap: 16, maxWidth: 520 }}>
          <ToggleSetting
            label="🗔️ Minimize on close"
            description="When clicking × the app hides to the system tray instead of quitting."
            checked={settings.closeToTray ?? true}
            onChange={(v) => {
              // when disabling tray, also disable mini player
              void update(v ? { closeToTray: true } : { closeToTray: false, miniPlayerEnabled: false });
            }}
          />
          <ToggleSetting
            label="🎛️ Mini player"
            description="Clicking the tray icon opens the floating mini player."
            checked={settings.miniPlayerEnabled ?? true}
            disabled={!(settings.closeToTray ?? true)}
            onChange={(v) => void update({ miniPlayerEnabled: v })}
          />
        </div>
      )}

      {tab === 'network' && (
        <div style={{ display: 'grid', gap: 16, maxWidth: 520 }}>
          <ToggleSetting
            label="🔒 Ignore SSL certificate errors"
            description="Enable this if you are behind a corporate VPN with SSL inspection. Disable it on trusted networks."
            checked={settings.skipCertCheck ?? false}
            onChange={(v) => void update({ skipCertCheck: v })}
          />
          <ToggleSetting
            label="📡 Sonos integration"
            description="Enables streaming to Sonos speakers. Starts an internal HTTP server on the local network."
            checked={settings.sonosEnabled ?? true}
            onChange={(v) => void update({ sonosEnabled: v })}
          />
        </div>
      )}

      {tab === 'dependencies' && (
        <div>
          {deps ? (
            <>
              <div>
                <strong>yt-dlp</strong>:{' '}
                {deps.ytDlp.present ? '✅ available' : '❌ not found'}
                {ytDlpVersion
                  ? ` (v${ytDlpVersion})`
                  : deps.ytDlp.present
                  ? ' (checking version...)'
                  : ''}
                {deps.ytDlp.path && (
                  <div style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 11 }}>
                    {deps.ytDlp.path}
                  </div>
                )}
              </div>
              <div style={{ marginTop: 6 }}>
                <strong>ffmpeg</strong>:{' '}
                {deps.ffmpeg.present ? '✅ available' : '❌ not found'}
                {deps.ffmpeg.path && (
                  <div style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 11 }}>
                    {deps.ffmpeg.path}
                  </div>
                )}
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="primary" onClick={() => void updateYtDlp()} disabled={updating}>
                  {updating ? '⏳ Updating...' : '🔄 Update download engine'}
                </button>
                {message && (
                  <span style={{ marginLeft: 10, color: 'var(--text-muted)' }}>{message}</span>
                )}
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>⏳ Loading...</div>
          )}

          <h2>🗃️ Library schema</h2>
          <table className="track-table" style={{ maxWidth: 520 }}>
            <thead>
              <tr>
                <th>Version</th>
                <th>Migration</th>
                <th>Applied</th>
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
      )}
    </div>
  );
}

interface ToggleSettingProps {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

function ToggleSetting({ label, description, checked, disabled, onChange }: ToggleSettingProps) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        style={{ marginTop: 3, flexShrink: 0 }}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <div style={{ fontWeight: 500 }}>{label}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{description}</div>
      </span>
    </label>
  );
}
