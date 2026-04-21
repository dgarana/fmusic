import { useEffect, useState } from 'react';
import { useT } from '../i18n';

export function WindowTitleBar() {
  const t = useT();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Initial state
    window.fmusic.isMaximized().then(setIsMaximized).catch(() => {});
    
    // Listen for changes
    return window.fmusic.onMaximizeChange(setIsMaximized);
  }, []);

  // Hide on macOS as it has its own traffic lights
  const isMac = navigator.userAgent.includes('Macintosh');
  if (isMac) return <div style={{ height: 32, WebkitAppRegion: 'drag' } as any} />;

  return (
    <div className="window-title-bar">
      <div className="window-title-bar-drag">
        <span className="window-title">FMusic</span>
      </div>
      <div className="window-controls">
        <button 
          className="window-control minimize" 
          onClick={() => window.fmusic.minimize()}
          title={t('common.minimize', { defaultValue: 'Minimize' })}
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="10" height="1" fill="currentColor"/>
          </svg>
        </button>
        <button 
          className="window-control maximize" 
          onClick={() => window.fmusic.maximize()}
          title={isMaximized ? t('common.restore', { defaultValue: 'Restore' }) : t('common.maximize', { defaultValue: 'Maximize' })}
        >
          {isMaximized ? (
            // Restore icon (two overlapping squares)
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 1H9V7M1 3H7V9H1V3Z" stroke="currentColor" strokeWidth="1"/>
            </svg>
          ) : (
            // Maximize icon (single square)
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor"/>
            </svg>
          )}
        </button>
        <button 
          className="window-control close" 
          onClick={() => window.fmusic.close()}
          title={t('common.close', { defaultValue: 'Close' })}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
