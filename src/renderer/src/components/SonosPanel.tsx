import { useEffect, useRef, useState } from 'react';
import { toErrorMessage } from '../../../shared/errors';
import { useSonosStore } from '../store/sonos';
import { usePlayerStore } from '../store/player';
import { useT } from '../i18n';
import { CastIcon, StopIcon } from './icons';

export function SonosPanel() {
  const t = useT();
  const current = usePlayerStore((s) => s.current);
  const playerPosition = usePlayerStore((s) => s.position);
  const playerPause = usePlayerStore((s) => s.pause);

  const { devices, activeHost, discovering, error, initFromCache, discover, addByIp, startCasting, stop } =
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
      await addByIp(ip);
      setManualIp('');
    } catch (err) {
      setIpError(toErrorMessage(err));
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
    if (activeHost === host) {
      // Route through the store so it resumes local playback from the
      // current Sonos position (and calls sonosStop once internally).
      await stop();
    } else {
      await window.fmusic.sonosStop(host).catch(() => {});
    }
  }

  return (
    <div className="sonos-wrap" ref={panelRef}>
      <button
        className={`sonos-btn${isCasting ? ' is-casting' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={isCasting ? t('sonos.playingTooltip') : t('sonos.castTooltip')}
      >
        <CastIcon size={18} />
      </button>

      {open && (
        <div className="sonos-panel">
          <div className="sonos-panel-header">
            <span>{t('sonos.title')}</span>
          </div>

          {error && <div className="sonos-error">{error}</div>}

          {devices.length === 0 ? (
            <button onClick={() => void discover()} disabled={discovering} className="w-full">
              {discovering ? t('common.searching') : t('sonos.search')}
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
                      title={t('sonos.playHere')}
                    >
                      <span className="sonos-device-name">{d.name}</span>
                      <span className="sonos-device-host">{d.host}</span>
                    </button>
                    <button
                      className="sonos-device-stop danger"
                      onClick={() => void handleStop(d.host)}
                      title={t('sonos.stopDevice')}
                    >
                      <StopIcon size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => void discover()}
                disabled={discovering}
                className="mt-8 w-full fs-11"
              >
                {discovering ? t('common.searching') : t('sonos.searchAgain')}
              </button>
            </>
          )}

          <div className="sonos-addip">
            <div className="sonos-addip-label">{t('sonos.addByIp')}</div>
            <div className="sonos-addip-row">
              <input
                placeholder="192.168.1.x"
                value={manualIp}
                onChange={(e) => setManualIp(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAddByIp(); }}
                className="flex-1 fs-12"
              />
              <button onClick={() => void handleAddByIp()} disabled={addingIp || !manualIp.trim()}>
                {addingIp ? '…' : t('sonos.add')}
              </button>
            </div>
            {ipError && (
              <div className="text-danger fs-11 mt-4">{ipError}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
