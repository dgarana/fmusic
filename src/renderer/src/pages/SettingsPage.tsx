import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { DependencyStatus, Locale, RemoteControllerInfo } from '../../../shared/types';
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
  const [remoteInfo, setRemoteInfo] = useState<RemoteControllerInfo | null>(null);
  const [moving, setMoving] = useState(false);

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

  useEffect(() => {
    if (!settings?.remoteControllerEnabled) {
      setRemoteInfo(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      window.fmusic.getRemoteControllerInfo().then((info) => {
        if (!cancelled) setRemoteInfo(info);
      }).catch(() => {
        if (!cancelled) setRemoteInfo(null);
      });
    };
    refresh();
    const id = window.setTimeout(refresh, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [settings?.remoteControllerEnabled, settings?.localServerPort]);

  async function pickFolder() {
    const newPath = await window.fmusic.pickDirectory();
    if (!newPath || newPath === settings?.downloadDir) return;

    const tracks = await window.fmusic.listTracks({ limit: 1 });
    if (tracks.length > 0) {
      const ok = confirm(t('settings.downloads.moveLibraryConfirm'));
      if (ok) {
        setMoving(true);
        try {
          await window.fmusic.moveLibrary(settings!.downloadDir, newPath);
        } catch (err) {
          console.error('Failed to move library:', err);
          alert(t('common.error') + ': ' + (err instanceof Error ? err.message : String(err)));
        } finally {
          setMoving(false);
        }
      }
    }
    await update({ downloadDir: newPath });
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

      <div className="pill-tabs">
        {(Object.keys(tabLabels) as Tab[]).map((key) => (
          <button
            key={key}
            className={`pill-tab${key === tab ? ' active' : ''}`}
            onClick={() => setTab(key)}
          >
            {tabLabels[key]}
          </button>
        ))}
      </div>

      {tab === 'downloads' && (
        <div className="grid gap-14 max-w-520">
          <label>
            {t('settings.downloads.folder')}
            <div className="flex gap-6 mt-4">
              <input
                readOnly
                value={settings.downloadDir}
                className="flex-1 font-mono"
              />
              <button onClick={() => void pickFolder()} disabled={moving}>
                {moving ? t('settings.downloads.movingLibrary') : t('settings.downloads.change')}
              </button>
              <button onClick={() => void window.fmusic.openPath(settings.downloadDir)} disabled={moving}>
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
              className="ml-8"
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
              className="ml-8"
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
        <div className="grid gap-16 max-w-520">
          <label className="grid gap-4">
            <span className="fw-500">{t('settings.system.language')}</span>
            <span className="text-muted fs-12">
              {t('settings.system.languageDescription')}
            </span>
            <select
              value={settings.language ?? 'en'}
              onChange={(e) => void update({ language: e.target.value as Locale })}
              className="w-fit mt-4"
            >
              {supportedLocales.map((loc) => (
                <option key={loc.code} value={loc.code}>
                  {loc.flag} {loc.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-4">
            <span className="fw-500">{t('settings.system.theme')}</span>
            <span className="text-muted fs-12">
              {t('settings.system.themeDescription')}
            </span>
            <select
              value={settings.theme ?? 'original'}
              onChange={(e) => void update({ theme: e.target.value as any })}
              className="w-fit mt-4"
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
            <div className="text-muted fs-12 mt-8">
              {t('settings.system.appVersion')}: v{appVersion}
            </div>
          )}
        </div>
      )}

      {tab === 'network' && (
        <div className="grid gap-16 max-w-520">
          <ToggleSetting
            label={t('settings.network.skipCert')}
            description={t('settings.network.skipCertDescription')}
            checked={settings.skipCertCheck ?? false}
            onChange={(v) => void update({ skipCertCheck: v })}
          />
          <label className="grid gap-4">
            <span className="fw-500">{t('settings.network.localServerPort')}</span>
            <span className="text-muted fs-12">
              {t('settings.network.localServerPortDescription')}
            </span>
            <input
              type="number"
              min="0"
              max="65535"
              value={settings.localServerPort || 0}
              onChange={(e) => void update({ localServerPort: Number(e.target.value) })}
              className="w-100px mt-4"
            />
          </label>
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
          <ToggleSetting
            label={t('settings.network.remoteController')}
            description={t('settings.network.remoteControllerDescription')}
            checked={settings.remoteControllerEnabled ?? false}
            onChange={(v) => void update({ remoteControllerEnabled: v })}
          />
          {settings.remoteControllerEnabled && (
            <div className="remote-controller-settings">
              <div className="remote-controller-beta" role="note">
                <span className="remote-controller-beta-badge">
                  {t('remote.status.betaBadge')}
                </span>
                <div>
                  <div className="fw-600">
                    {t('settings.network.remoteControllerBetaTitle')}
                  </div>
                  <div className="text-muted fs-12">
                    {t('settings.network.remoteControllerBetaDescription')}
                  </div>
                </div>
              </div>
              {remoteInfo?.url ? (
                <div className="remote-controller-qr">
                  <QRCodeSVG value={remoteInfo.url} size={164} marginSize={2} />
                  <div className="remote-controller-details">
                    <div className="fw-500">{t('settings.network.remoteControllerQr')}</div>
                    <div className="remote-controller-url">{remoteInfo.url}</div>
                    <div className="flex gap-8 flex-wrap">
                      <button onClick={() => void window.fmusic.openExternal(remoteInfo.url!)}>
                        {t('settings.network.remoteControllerOpen')}
                      </button>
                      <button
                        onClick={() =>
                          void window.fmusic.regenerateRemoteControllerToken().then(setRemoteInfo)
                        }
                      >
                        {t('settings.network.remoteControllerRegenerate')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-muted fs-12">
                  {t('settings.network.remoteControllerStarting')}
                </div>
              )}
            </div>
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
                  <div className="text-muted font-mono fs-11">
                    {deps.ytDlp.path}
                  </div>
                )}
              </div>
              <div className="mt-6">
                <strong>ffmpeg</strong>:{' '}
                {deps.ffmpeg.present ? t('settings.dependencies.available') : t('settings.dependencies.notFound')}
                {deps.ffmpeg.path && (
                  <div className="text-muted font-mono fs-11">
                    {deps.ffmpeg.path}
                  </div>
                )}
              </div>
              <div className="mt-6">
                <strong>ffprobe</strong>:{' '}
                {deps.ffprobe.present ? t('settings.dependencies.available') : t('settings.dependencies.notFound')}
                {deps.ffprobe.path && (
                  <div className="text-muted font-mono fs-11">
                    {deps.ffprobe.path}
                  </div>
                )}
              </div>
              <div className="mt-12">
                <button className="primary" onClick={() => void updateYtDlp()} disabled={updating}>
                  {updating ? t('settings.dependencies.updating') : t('settings.dependencies.updateEngine')}
                </button>
                {message && (
                  <span className="text-muted ml-10">{message}</span>
                )}
              </div>
            </>
          ) : (
            <div className="text-muted">{t('settings.loading')}</div>
          )}

          <h2>{t('settings.dependencies.schemaTitle')}</h2>
          <table className="track-table max-w-520">
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
      className="flex items-start gap-12"
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        className="mt-4 flex-shrink-0"
        style={{ marginTop: 3 }} // Kept exact 3px for fine-tuning checkbox alignment
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <div className="fw-500">{label}</div>
        <div className="text-muted fs-12 mt-2">{description}</div>
      </span>
    </label>
  );
}
