import { QRCodeSVG } from 'qrcode.react';
import { useT } from '../i18n';

interface MobileSyncCardProps {
  trackId: number;
  trackTitle: string;
  mobileSyncUrl: string | null;
  onClose: () => void;
}

export function MobileSyncCard({ trackId, trackTitle, mobileSyncUrl, onClose }: MobileSyncCardProps) {
  const t = useT();

  return (
    <div className="mobile-sync-card">
      <div className="mobile-sync-header">
        <h3>{t('library.mobileSyncTitle')}</h3>
        {mobileSyncUrl && (
          <p>{t('library.mobileSyncInstructions', { title: trackTitle })}</p>
        )}
      </div>

      {mobileSyncUrl ? (
        <>
          <div className="mobile-sync-qr-wrapper">
            <QRCodeSVG
              value={mobileSyncUrl}
              size={220}
              level="H"
              includeMargin={false}
              imageSettings={{
                src: 'fmusic-media://artwork/' + trackId,
                height: 40,
                width: 40,
                excavate: true
              }}
            />
          </div>
          <div className="mobile-sync-url">{mobileSyncUrl}</div>
        </>
      ) : (
        <div className="empty not-italic">
          {t('common.loading')}
        </div>
      )}

      <div className="track-editor-actions mt-24">
        <button onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
