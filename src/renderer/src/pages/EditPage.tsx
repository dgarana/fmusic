import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLibraryStore } from '../store/library';
import { usePlayerStore } from '../store/player';
import { formatDuration } from '../util';
import { useT } from '../i18n';
import type { Track } from '../../../shared/types';

export function EditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const t = useT();
  const refreshTracks = useLibraryStore((s) => s.refreshTracks);
  
  const [track, setTrack] = useState<Track | null>(null);
  const [trimStart, setTrimStart] = useState<string>('0');
  const [trimEnd, setTrimEnd] = useState<string>('');
  const [fadeIn, setFadeIn] = useState<string>('0');
  const [fadeOut, setFadeOut] = useState<string>('0');
  const [volume, setVolume] = useState<number>(100);
  const [isProcessing, setIsProcessing] = useState(false);

  const playTrack = usePlayerStore((s) => s.playTrack);
  const currentTrack = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const playerPosition = usePlayerStore((s) => s.position);
  const seek = usePlayerStore((s) => s.seek);

  useEffect(() => {
    if (!id) return;
    const trackId = parseInt(id, 10);
    const tr = useLibraryStore.getState().tracks.find((t) => t.id === trackId);
    if (tr) {
      setTrack(tr);
      setTrimStart('0');
      setTrimEnd(String(tr.durationSec ?? ''));
    } else {
      navigate('/library');
    }
  }, [id, navigate]);

  if (!track) return null;

  async function handleApply(mode: 'overwrite' | 'export') {
    setIsProcessing(true);
    try {
      await window.fmusic.editTrack(track!.id, {
        startSec: parseFloat(trimStart) || 0,
        endSec: trimEnd ? parseFloat(trimEnd) : null,
        fadeInSec: parseFloat(fadeIn) || 0,
        fadeOutSec: parseFloat(fadeOut) || 0,
        volumeFactor: volume / 100,
        mode
      });
      await refreshTracks();
      navigate('/library');
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  }

  const duration = track.durationSec || 1;
  const startPercent = (parseFloat(trimStart) / duration) * 100;
  const endPercent = (parseFloat(trimEnd || String(duration)) / duration) * 100;

  return (
    <div className="edit-page">
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <button className="back-button" onClick={() => navigate('/library')} title={t('common.cancel')}>
          ←
        </button>
        <h1>{t('library.editAudioTitle', { title: track.title })}</h1>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        
        <div className="edit-player-container">
          <div className="edit-player-top">
            <h3>{t('download.preview')}</h3>
            <div className="edit-player-controls">
              <button 
                className="edit-play-pause-btn"
                onClick={() => {
                  if (currentTrack?.id !== track.id) {
                    void playTrack(track, [track]);
                  } else {
                    togglePlay();
                  }
                }}
              >
                {currentTrack?.id === track.id && isPlaying ? '⏸' : '▶'}
              </button>
              <div className="edit-scrub-wrapper">
                <span className="time-display">
                  {formatDuration(currentTrack?.id === track.id ? playerPosition : 0)}
                </span>
                <input
                  type="range"
                  className="edit-scrub-bar"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={currentTrack?.id === track.id ? playerPosition : 0}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (currentTrack?.id !== track.id) {
                      void playTrack(track, [track]).then(() => seek(val));
                    } else {
                      seek(val);
                    }
                  }}
                />
                <span className="time-display">{formatDuration(duration)}</span>
              </div>
            </div>
          </div>

          <div className="trim-visual-container">
            <div className="trim-bar-bg">
              <div 
                className="trim-bar-active" 
                style={{
                  left: `${startPercent}%`,
                  right: `${100 - endPercent}%`
                }}
              />
              {currentTrack?.id === track.id && (
                <div 
                  className="trim-bar-current"
                  style={{ left: `${(playerPosition / duration) * 100}%` }}
                />
              )}
            </div>
            <input
              type="range"
              className="trim-slider start"
              min={0}
              max={duration}
              step={0.1}
              value={trimStart}
              onChange={(e) => {
                setTrimStart(e.target.value);
                if (currentTrack?.id === track.id) seek(parseFloat(e.target.value));
              }}
            />
            <input
              type="range"
              className="trim-slider end"
              min={0}
              max={duration}
              step={0.1}
              value={trimEnd || duration}
              onChange={(e) => {
                setTrimEnd(e.target.value);
                if (currentTrack?.id === track.id) seek(parseFloat(e.target.value));
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <div className="edit-option-card" style={{ flex: 1 }}>
              <label>✂️ {t('library.trimStart')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number"
                  step="0.1"
                  value={trimStart}
                  onChange={(e) => setTrimStart(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button 
                  title={t('library.trimSetStart')}
                  onClick={() => currentTrack?.id === track.id && setTrimStart(playerPosition.toFixed(1))}
                  disabled={currentTrack?.id !== track.id}
                >
                  📍
                </button>
              </div>
            </div>
            <div className="edit-option-card" style={{ flex: 1 }}>
              <label>✂️ {t('library.trimEnd')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number"
                  step="0.1"
                  value={trimEnd}
                  onChange={(e) => setTrimEnd(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button 
                  title={t('library.trimSetEnd')}
                  onClick={() => currentTrack?.id === track.id && setTrimEnd(playerPosition.toFixed(1))}
                  disabled={currentTrack?.id !== track.id}
                >
                  📍
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="edit-options-grid">
          <div className="edit-option-card">
            <label>✨ {t('library.editAudioFadeIn')}</label>
            <input 
              type="number" 
              min={0} 
              max={10} 
              step={0.5} 
              value={fadeIn} 
              onChange={(e) => setFadeIn(e.target.value)}
            />
          </div>
          <div className="edit-option-card">
            <label>✨ {t('library.editAudioFadeOut')}</label>
            <input 
              type="number" 
              min={0} 
              max={10} 
              step={0.5} 
              value={fadeOut} 
              onChange={(e) => setFadeOut(e.target.value)}
            />
          </div>
          <div className="edit-option-card">
            <label>🔊 {t('library.editAudioVolume')} ({volume}%)</label>
            <input 
              type="range" 
              min={0} 
              max={200} 
              step={1} 
              value={volume} 
              onChange={(e) => setVolume(parseInt(e.target.value, 10))}
            />
          </div>
        </div>

        <div className="edit-actions" style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button onClick={() => navigate('/library')}>{t('common.cancel')}</button>
          <button
            className="danger"
            onClick={() => handleApply('overwrite')}
            disabled={isProcessing}
          >
            {isProcessing ? t('library.editAudioProcessing') : t('library.editAudioOverwrite')}
          </button>
          <button
            className="primary"
            onClick={() => handleApply('export')}
            disabled={isProcessing}
            style={{ minWidth: 160, height: 40 }}
          >
            {isProcessing ? t('library.editAudioProcessing') : t('library.editAudioExport')}
          </button>
        </div>
      </div>
    </div>
  );
}
