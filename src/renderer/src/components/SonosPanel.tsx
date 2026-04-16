import { useEffect, useRef, useState } from 'react';
import { useSonosStore } from '../store/sonos';
import { usePlayerStore } from '../store/player';

export function SonosPanel() {
  const current = usePlayerStore((s) => s.current);
  const playerPosition = usePlayerStore((s) => s.position);
  const playerIsPlaying = usePlayerStore((s) => s.isPlaying);
  const playerToggle = usePlayerStore((s) => s.togglePlay);

  const { devices, activeHost, discovering, error, discover, startCasting, stop } =
    useSonosStore();

  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const isCasting = activeHost !== null;

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  async function handleCast(host: string) {
    if (!current) return;
    if (playerIsPlaying) playerToggle();
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
        title={isCasting ? 'Reproduciendo en Sonos' : 'Enviar a Sonos'}
      >
        ⊕
      </button>

      {open && (
        <div className="sonos-panel">
          <div className="sonos-panel-header">
            <span>Sonos</span>
          </div>

          {error && <div className="sonos-error">{error}</div>}

          {devices.length === 0 ? (
            <button onClick={() => void discover()} disabled={discovering} style={{ width: '100%' }}>
              {discovering ? 'Buscando...' : 'Buscar dispositivos'}
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
                      title="Reproducir aquí"
                    >
                      <span className="sonos-device-name">{d.name}</span>
                      <span className="sonos-device-host">{d.host}</span>
                    </button>
                    <button
                      className="sonos-device-stop danger"
                      onClick={() => void handleStop(d.host)}
                      title="Parar este dispositivo"
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
                {discovering ? 'Buscando...' : 'Volver a buscar'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
