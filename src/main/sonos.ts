import { SonosManager, SonosDevice as SonosDeviceLib } from '@svrooij/sonos';
import type { SonosDevice, SonosPositionInfo } from '../shared/types.js';
import { t } from './i18n.js';
import { getSettings, updateSettings } from './settings.js';

let manager: SonosManager | null = null;
let activeHost: string | null = null;

export function getActiveSonosHost(): string | null {
  return activeHost;
}

function toInfo(d: SonosDeviceLib): SonosDevice {
  return { name: d.Name ?? d.Host, host: d.Host, port: d.Port };
}

function saveKnownHost(host: string): void {
  const known = getSettings().sonosKnownHosts ?? [];
  if (!known.includes(host)) {
    updateSettings({ sonosKnownHosts: [...known, host] });
  }
}

function removeKnownHost(host: string): void {
  const known = getSettings().sonosKnownHosts ?? [];
  updateSettings({ sonosKnownHosts: known.filter((h) => h !== host) });
}

export async function discoverSonos(timeoutSec = 5): Promise<SonosDevice[]> {
  manager = new SonosManager();
  await manager.InitializeWithDiscovery(timeoutSec);
  const devices = manager.Devices.map(toInfo);
  for (const d of devices) saveKnownHost(d.host);
  return devices;
}

export async function addSonosByIp(host: string): Promise<SonosDevice> {
  if (!manager) manager = new SonosManager();
  await manager.InitializeFromDevice(host);
  const device = manager.Devices.find((d) => d.Host === host);
  if (!device) throw new Error(t('sonos.connectFailed', { host }));
  saveKnownHost(host);
  return toInfo(device);
}

/**
 * Tries to reconnect to all cached Sonos hosts. Devices that fail to connect
 * are removed from the cache. Returns successfully reconnected devices.
 */
export async function initSonosFromCache(): Promise<SonosDevice[]> {
  const sonosKnownHosts = getSettings().sonosKnownHosts ?? [];
  if (sonosKnownHosts.length === 0) return [];
  if (!manager) manager = new SonosManager();
  const results = await Promise.allSettled(
    sonosKnownHosts.map((host) => manager!.InitializeFromDevice(host))
  );
  const connected: SonosDevice[] = [];
  for (let i = 0; i < sonosKnownHosts.length; i++) {
    const host = sonosKnownHosts[i];
    if (results[i].status === 'fulfilled') {
      const device = manager.Devices.find((d) => d.Host === host);
      if (device) connected.push(toInfo(device));
      else removeKnownHost(host);
    } else {
      removeKnownHost(host);
    }
  }
  return connected;
}

function getDevice(host: string): SonosDeviceLib | undefined {
  return manager?.Devices.find((d) => d.Host === host);
}

export async function sonosPlayTrack(
  host: string,
  trackUrl: string,
  title?: string,
  artist?: string
): Promise<void> {
  const device = getDevice(host);
  if (!device) throw new Error(t('sonos.deviceNotFoundDiscover', { host }));
  console.log(`[sonos] Playing on ${host}: ${trackUrl}`);
  await device.AVTransportService.SetAVTransportURI({
    InstanceID: 0,
    CurrentURI: trackUrl,
    CurrentURIMetaData: ''
  });
  activeHost = host;
  await device.Play();
  console.log(`[sonos] Play command sent (title=${title}, artist=${artist})`);
}

function isStaleTransitionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /UPnPError\s*701|Transition not available/i.test(msg);
}

export async function sonosPause(host: string): Promise<void> {
  const device = getDevice(host);
  if (!device) throw new Error(t('sonos.deviceNotFound', { host }));
  try {
    await device.Pause();
  } catch (err) {
    if (isStaleTransitionError(err)) {
      if (activeHost === host) activeHost = null;
      throw new Error('SONOS_STALE_SESSION');
    }
    throw err;
  }
}

export async function sonosResume(host: string): Promise<void> {
  const device = getDevice(host);
  if (!device) throw new Error(t('sonos.deviceNotFound', { host }));
  await device.Play();
}

export async function sonosStop(host: string): Promise<void> {
  const device = getDevice(host);
  if (!device) throw new Error(t('sonos.deviceNotFound', { host }));
  await device.Stop();
  if (activeHost === host) activeHost = null;
}

export async function stopActiveSonos(): Promise<void> {
  if (!activeHost) return;
  try {
    await sonosStop(activeHost);
  } catch {
    // best-effort on quit
  }
}

export async function sonosSeek(host: string, seconds: number): Promise<void> {
  const device = getDevice(host);
  if (!device) throw new Error(t('sonos.deviceNotFound', { host }));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const timestamp = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  await device.AVTransportService.Seek({ InstanceID: 0, Unit: 'REL_TIME', Target: timestamp });
}

function parseTimeToSeconds(time: string): number {
  const parts = time.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

export async function sonosGetPosition(host: string): Promise<SonosPositionInfo> {
  const device = getDevice(host);
  if (!device) throw new Error(t('sonos.deviceNotFound', { host }));
  const [info, transport] = await Promise.all([
    device.AVTransportService.GetPositionInfo({ InstanceID: 0 }),
    device.AVTransportService.GetTransportInfo({ InstanceID: 0 })
  ]);
  return {
    position: parseTimeToSeconds(info.RelTime ?? '0:00:00'),
    duration: parseTimeToSeconds(info.TrackDuration ?? '0:00:00'),
    transportState: transport.CurrentTransportState ?? 'STOPPED'
  };
}

export async function sonosSetVolume(host: string, volume: number): Promise<void> {
  const device = getDevice(host);
  if (!device) throw new Error(t('sonos.deviceNotFound', { host }));
  // volume is 0-1, Sonos expects 0-100
  await device.RenderingControlService.SetVolume({
    InstanceID: 0,
    Channel: 'Master',
    DesiredVolume: Math.round(volume * 100)
  });
}
