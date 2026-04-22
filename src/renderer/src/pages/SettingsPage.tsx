import { useEffect, useState } from 'react';
import type { DependencyStatus, Locale } from '../../../shared/types';
import { useSettingsStore } from '../store/settings';
import { useT } from '../i18n';
import { supportedLocales } from '../../../shared/i18n';

type Tab = 'downloads' | 'system' | 'network' | 'dependencies';

export function SettingsPage() {
  const t = useT();
  const { settings, update } = useSettingsStore();
  const [tab, setTab] = useState<Tab>('downloads');
  const tabLabels: Record<Tab, string> = {
    downloads: t('settings.tabs.downloads'),
    system: t('settings.tabs.system'),
    network: t('settings.tabs.network'),
    dependencies: t('settings.tabs.dependencies')
  };

  const [appVersion, setAppVersion] = useState<string | null>(null);

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
      const [d, h, v] = await Promise.all([
        window.fmusic.depsStatus(),
        window.fmusic.schemaHistory(),
        window.fmusic.getAppVersion()
      ]);
      setDeps(d);
      setHistory(h);
      setAppVersion(v);
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
      setMessage(t('settings.dependencies.updated', { version: v ?? t('common.unknown') }));
    } catch (err) {
      setMessage(t('common.error') + ': ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUpdating(false);
    }
  }

  if (!settings) return <div>{t('settings.loading')}</div>;

  return (
    <div>
      <h1>{t('settings.title')}</h1>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        {(Object.keys(tabLabels) as Tab[]).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: key === tab ? '2px solid var(--accent)' : '2px solid transparent',
              borderRadius: 0,
              color: key === tab ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer',
              fontWeight: key === tab ? 600 : 400,
              marginBottom: -1,
              padding: '8px 18px'
            }}
          >
            {tabLabels[key]}
          </button>
        ))}
      </div>

      {tab === 'downloads' && (
        <div style={{ display: 'grid', gap: 14, maxWidth: 520 }}>
          <label>
            {t('settings.downloads.folder')}
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <input
                readOnly
                value={settings.downloadDir}
                style={{ flex: 1, fontFamily: 'monospace' }}
              />
              <button onClick={() => void pickFolder()}>{t('settings.downloads.change')}</button>
              <button onClick={() => void window.fmusic.openPath(settings.downloadDir)}>
                {t('settings.downloads.open')}
              </button>
            </div>
          </label>
          <label>
            {t('settings.downloads.format')}
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
            {t('settings.downloads.quality')}
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
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontWeight: 500 }}>{t('settings.system.language')}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {t('settings.system.languageDescription')}
            </span>
            <select
              value={settings.language ?? 'en'}
              onChange={(e) => void update({ language: e.target.value as Locale })}
              style={{ width: 'fit-content', marginTop: 4 }}
            >
              {supportedLocales.map((loc) => (
                <option key={loc.code} value={loc.code}>
                  {loc.flag} {loc.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontWeight: 500 }}>{t('settings.system.theme')}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {t('settings.system.themeDescription')}
            </span>
            <select
              value={settings.theme ?? 'original'}
              onChange={(e) => void update({ theme: e.target.value as any })}
              style={{ width: 'fit-content', marginTop: 4 }}
            >
              <option value="original">{t('settings.system.themes.original')}</option>
              <option value="light">{t('settings.system.themes.light')}</option>
              <option value="darcula">{t('settings.system.themes.darcula')}</option>
            </select>
          </label>
          <ToggleSetting
            label={t('settings.system.minimize')}
            description={t('settings.system.minimizeDescription')}
            checked={settings.closeToTray ?? true}
            onChange={(v) => {
              // when disabling tray, also disable mini player
              void update(v ? { closeToTray: true } : { closeToTray: false, miniPlayerEnabled: false });
            }}
          />
          <ToggleSetting
            label={t('settings.system.miniPlayer')}
            description={t('settings.system.miniPlayerDescription')}
            checked={settings.miniPlayerEnabled ?? true}
            disabled={!(settings.closeToTray ?? true)}
            onChange={(v) => void update({ miniPlayerEnabled: v })}
          />
          {appVersion && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>
              {t('settings.system.appVersion')}: v{appVersion}
            </div>
          )}
        </div>
      )}

      {tab === 'network' && (
        <div style={{ display: 'grid', gap: 16, maxWidth: 520 }}>
          <ToggleSetting
            label={t('settings.network.skipCert')}
            description={t('settings.network.skipCertDescription')}
            checked={settings.skipCertCheck ?? false}
            onChange={(v) => void update({ skipCertCheck: v })}
          />
          <ToggleSetting
            label={t('settings.network.sonos')}
            description={t('settings.network.sonosDescription')}
            checked={settings.sonosEnabled ?? true}
            onChange={(v) => void update({ sonosEnabled: v })}
          />
          <ToggleSetting
            label={t('settings.network.mobileSync')}
            description={t('settings.network.mobileSyncDescription')}
            checked={settings.mobileSyncEnabled ?? false}
            onChange={(v) => void update({ mobileSyncEnabled: v })}
          />
          {settings.mobileSyncEnabled && (
            <label style={{ display: 'grid', gap: 4, marginLeft: 28 }}>
              <span style={{ fontWeight: 500 }}>{t('settings.network.mobileSyncPort')}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {t('settings.network.mobileSyncPortDescription')}
              </span>
              <input
                type="number"
                min="0"
                max="65535"
                value={settings.mobileSyncPort || 0}
                onChange={(e) => void update({ mobileSyncPort: Number(e.target.value) })}
                style={{ width: 100, marginTop: 4 }}
              />
            </label>
          )}
        </div>
      )}

      {tab === 'dependencies' && (
        <div>
          {deps ? (
            <>
              <div>
                <strong>yt-dlp</strong>:{' '}
                {deps.ytDlp.present ? t('settings.dependencies.available') : t('settings.dependencies.notFound')}
                {ytDlpVersion
                  ? ` (v${ytDlpVersion})`
                  : deps.ytDlp.present
                  ? ' ' + t('settings.dependencies.checkingVersion')
                  : ''}
                {deps.ytDlp.path && (
                  <div style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 11 }}>
                    {deps.ytDlp.path}
                  </div>
                )}
              </div>
              <div style={{ marginTop: 6 }}>
                <strong>ffmpeg</strong>:{' '}
                {deps.ffmpeg.present ? t('settings.dependencies.available') : t('settings.dependencies.notFound')}
                {deps.ffmpeg.path && (
                  <div style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 11 }}>
                    {deps.ffmpeg.path}
                  </div>
                )}
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="primary" onClick={() => void updateYtDlp()} disabled={updating}>
                  {updating ? t('settings.dependencies.updating') : t('settings.dependencies.updateEngine')}
                </button>
                {message && (
                  <span style={{ marginLeft: 10, color: 'var(--text-muted)' }}>{message}</span>
                )}
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>{t('settings.loading')}</div>
          )}

          <h2>{t('settings.dependencies.schemaTitle')}</h2>
          <table className="track-table" style={{ maxWidth: 520 }}>
            <thead>
              <tr>
                <th>{t('settings.dependencies.version')}</th>
                <th>{t('settings.dependencies.migration')}</th>
                <th>{t('settings.dependencies.applied')}</th>
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
