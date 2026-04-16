import { useEffect, useRef, useState } from 'react';
import { useSonosStore } from '../store/sonos';
import { usePlayerStore } from '../store/player';

export function SonosPanel() {
  const current = usePlayerStore((s) => s.current);
  const playerPosition = usePlayerStore((s) => s.position);
  const playerPause = usePlayerStore((s) => s.pause);

  const { devices, activeHost, discovering, error, initFromCache, discover, startCasting, stop } =
    useSonosStore();

  const [open, setOpen] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [addingIp, setAddingIp] = useState(false);
  const [ipError, setIpError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isCasting = activeHost !== null;

  async function handleAddByIp() {
    const ip = manualIp.trim();
    if (!ip) return;
    setAddingIp(true);
    setIpError(null);
    try {
      const device = await window.fmusic.sonosAddByIp(ip);
      useSonosStore.setState((s) => ({
        devices: s.devices.some((d) => d.host === device.host)
          ? s.devices
          : [...s.devices, device],
        error: null
      }));
      setManualIp('');
    } catch (err) {
      setIpError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingIp(false);
    }
  }

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  // Pre-populate devices from cache the first time the panel opens
  const [cacheLoaded, setCacheLoaded] = useState(false);
  useEffect(() => {
    if (open && !cacheLoaded) {
      setCacheLoaded(true);
      void initFromCache();
    }
  }, [open, cacheLoaded, initFromCache]);

  async function handleCast(host: string) {
    if (!current) return;
    playerPause();
    const seekTo = playerPosition > 0 ? playerPosition : undefined;
    await startCasting(host, current.id, current.title ?? undefined, current.artist ?? undefined, seekTo);
  }

  async function handleStop(host: string) {
    await window.fmusic.sonosStop(host);
    // If we were casting to this device, clear the store state too
    if (activeHost === host) stop();
  }

  return (
    <div className="sonos-wrap" ref={panelRef}>
      <button
        className={`sonos-btn${isCasting ? ' is-casting' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={isCasting ? 'Playing on Sonos' : 'Cast to Sonos'}
      >
        ⊕
      </button>

      {open && (
        <div className="sonos-panel">
          <div className="sonos-panel-header">
            <span>📡 Sonos</span>
          </div>

          {error && <div className="sonos-error">⚠️ {error}</div>}

          {devices.length === 0 ? (
            <button onClick={() => void discover()} disabled={discovering} style={{ width: '100%' }}>
              {discovering ? '⏳ Searching...' : '🔍 Search for devices'}
            </button>
          ) : (
            <>
              <div className="sonos-devices">
                {devices.map((d) => (
                  <div key={d.host} className={`sonos-device-row${activeHost === d.host ? ' active' : ''}`}>
                    <button
                      className="sonos-device-cast"
                      onClick={() => void handleCast(d.host)}
                      disabled={!current}
                      title="Play here"
                    >
                      <span className="sonos-device-name">{d.name}</span>
                      <span className="sonos-device-host">{d.host}</span>
                    </button>
                    <button
                      className="sonos-device-stop danger"
                      onClick={() => void handleStop(d.host)}
                      title="Stop this device"
                    >
                      ■
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => void discover()}
                disabled={discovering}
                style={{ marginTop: 8, width: '100%', fontSize: 11 }}
              >
                {discovering ? '⏳ Searching...' : '🔄 Search again'}
              </button>
            </>
          )}

          <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              🔌 Add by IP (useful with VPN)
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                placeholder="192.168.1.x"
                value={manualIp}
                onChange={(e) => setManualIp(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAddByIp(); }}
                style={{ flex: 1, fontSize: 12 }}
              />
              <button onClick={() => void handleAddByIp()} disabled={addingIp || !manualIp.trim()}>
                {addingIp ? '⏳' : '➕ Add'}
              </button>
            </div>
            {ipError && (
              <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>{ipError}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
