import { useState } from 'react';
import { toErrorMessage } from '../../../shared/errors';
import { useT } from '../i18n';
import { useSettingsStore } from '../store/settings';

export function useMobileSync(onBeforeOpen?: () => void) {
  const t = useT();
  const mobileSyncEnabled = useSettingsStore((s) => s.settings?.mobileSyncEnabled ?? false);
  const [mobileSyncTrackId, setMobileSyncTrackId] = useState<number | null>(null);
  const [mobileSyncUrl, setMobileSyncUrl] = useState<string | null>(null);

  function closeMobileSync() {
    setMobileSyncTrackId(null);
    setMobileSyncUrl(null);
  }

  async function toggleMobileSync(trackId: number) {
    if (mobileSyncTrackId === trackId) {
      closeMobileSync();
      return;
    }

    if (!mobileSyncEnabled) {
      alert(t('library.mobileSyncDisabled'));
      return;
    }

    onBeforeOpen?.();
    setMobileSyncTrackId(trackId);
    setMobileSyncUrl(null);
    try {
      const url = await window.fmusic.getMobileSyncUrl(trackId);
      setMobileSyncUrl(url);
    } catch (err) {
      alert(t('common.error') + ': ' + toErrorMessage(err));
      closeMobileSync();
    }
  }

  return {
    mobileSyncEnabled,
    mobileSyncTrackId,
    mobileSyncUrl,
    toggleMobileSync,
    closeMobileSync
  };
}
