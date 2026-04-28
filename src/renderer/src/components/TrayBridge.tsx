import { useEffect } from 'react';
import { usePlayerStore } from '../store/player';
import { useSonosStore } from '../store/sonos';
import { useDownloadsStore } from '../store/downloads';
import { useSettingsStore } from '../store/settings';
import type { RemoteControllerCommand } from '../../../shared/types';

/**
 * Keeps the tray menu and the mini-player window in sync with the current
 * playback state, regardless of whether the audio is coming from the local
 * Howl or a Sonos speaker. Also routes commands issued from the tray or
 * mini-player back to the right sink.
 */
export function TrayBridge() {
  const current = usePlayerStore((s) => s.current);
  const localIsPlaying = usePlayerStore((s) => s.isPlaying);
  const playerPosition = usePlayerStore((s) => s.position);
  const playerDuration = usePlayerStore((s) => s.duration);
  const index = usePlayerStore((s) => s.index);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const seek = usePlayerStore((s) => s.seek);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const downloads = useDownloadsStore((s) => s.jobs);
  const settingsLoaded = useSettingsStore((s) => s.settings !== null);
  const sonosEnabled = useSettingsStore((s) => s.settings?.sonosEnabled ?? true);

  const sonosActiveHost = useSonosStore((s) => s.activeHost);
  const sonosIsPlaying = useSonosStore((s) => s.isPlaying);
  const sonosPosition = useSonosStore((s) => s.position);
  const sonosDuration = useSonosStore((s) => s.duration);
  const sonosTogglePlay = useSonosStore((s) => s.togglePlay);
  const sonosSeek = useSonosStore((s) => s.seek);
  const sonosDevices = useSonosStore((s) => s.devices);
  const sonosDiscovering = useSonosStore((s) => s.discovering);
  const sonosError = useSonosStore((s) => s.error);
  const sonosInitFromCache = useSonosStore((s) => s.initFromCache);
  const sonosDiscover = useSonosStore((s) => s.discover);
  const sonosAddByIp = useSonosStore((s) => s.addByIp);
  const sonosStartCasting = useSonosStore((s) => s.startCasting);
  const sonosStop = useSonosStore((s) => s.stop);
  const sonosStopAll = useSonosStore((s) => s.stopAll);

  const isCasting = sonosActiveHost !== null;
  const isPlaying = isCasting ? sonosIsPlaying : localIsPlaying;
  const position = isCasting ? sonosPosition : playerPosition;
  const duration = isCasting
    ? sonosDuration || current?.durationSec || 0
    : playerDuration || current?.durationSec || 0;

  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < queueLength - 1;

  // Tray menu: updated only when the top-level fields change. We don't
  // include `position` here because the tray menu has no scrubbing, and
  // rebuilding it every 500ms is wasteful.
  useEffect(() => {
    window.fmusic.sendTrayState({
      title: current?.title ?? null,
      artist: current?.artist ?? null,
      isPlaying,
      hasPrev,
      hasNext
    });
  }, [current?.id, isPlaying, hasPrev, hasNext]);

  // Mini player: a real audio player, so it needs every tick (position +
  // duration). Sending state is a cheap IPC, so we accept firing every
  // time the position advances.
  useEffect(() => {
    window.fmusic.sendMiniState({
      trackId: current?.id ?? null,
      title: current?.title ?? null,
      artist: current?.artist ?? null,
      isPlaying,
      hasPrev,
      hasNext,
      position,
      duration
    });
  }, [current?.id, isPlaying, hasPrev, hasNext, position, duration]);

  useEffect(() => {
    window.fmusic.sendRemoteState({
      trackId: current?.id ?? null,
      title: current?.title ?? null,
      artist: current?.artist ?? null,
      album: current?.album ?? null,
      isPlaying,
      hasPrev,
      hasNext,
      position,
      duration,
      volume,
      downloads,
      sonos: {
        enabled: sonosEnabled,
        devices: sonosEnabled ? sonosDevices : [],
        activeHost: sonosEnabled ? sonosActiveHost : null,
        isPlaying: sonosEnabled ? sonosIsPlaying : false,
        discovering: sonosEnabled ? sonosDiscovering : false,
        error: sonosEnabled ? sonosError : null
      }
    });
  }, [
    current?.id,
    isPlaying,
    hasPrev,
    hasNext,
    position,
    duration,
    volume,
    downloads,
    sonosEnabled,
    sonosDevices,
    sonosActiveHost,
    sonosIsPlaying,
    sonosDiscovering,
    sonosError
  ]);

  useEffect(() => {
    if (settingsLoaded && sonosEnabled) void sonosInitFromCache();
  }, [settingsLoaded, sonosEnabled, sonosInitFromCache]);

  // Commands from the tray or mini player. Route them to Sonos when
  // casting so pause/next work on the speaker; otherwise they hit the
  // local player.
  useEffect(() => {
    const handleBasicCommand = (cmd: 'toggle-play' | 'prev' | 'next') => {
      if (cmd === 'toggle-play') {
        if (isCasting) void sonosTogglePlay();
        else togglePlay();
      } else if (cmd === 'next') {
        void next();
      } else if (cmd === 'prev') {
        void prev();
      }
    };
    const handleRemoteCommand = (cmd: RemoteControllerCommand) => {
      if (cmd.type === 'play-track') {
        void (async () => {
          const queue =
            cmd.queueTrackIds && cmd.queueTrackIds.length > 0
              ? (await Promise.all(cmd.queueTrackIds.map((id) => window.fmusic.getTrack(id)))).filter(
                  (track): track is NonNullable<typeof track> => track !== null
                )
              : undefined;
          const track = queue?.find((item) => item.id === cmd.trackId) ?? await window.fmusic.getTrack(cmd.trackId);
          if (track) await playTrack(track, queue);
        })();
      } else if (cmd.type === 'play-next-track') {
        void (async () => {
          const track = await window.fmusic.getTrack(cmd.trackId);
          if (!track) return;
          const player = usePlayerStore.getState();
          if (player.queue.length === 0 && cmd.queueTrackIds && cmd.queueTrackIds.length > 0) {
            const queue = (await Promise.all(cmd.queueTrackIds.map((id) => window.fmusic.getTrack(id)))).filter(
              (item): item is NonNullable<typeof item> => item !== null
            );
            const index = queue.findIndex((item) => item.id === cmd.trackId);
            usePlayerStore.setState({
              queue,
              index: index >= 0 ? index : 0,
              current: track,
              isPlaying: false,
              position: 0,
              duration: track.durationSec ?? 0
            });
            return;
          }
          const insertAt =
            player.index >= 0
              ? Math.min(player.index + 1, player.queue.length)
              : player.queue.length;
          usePlayerStore.setState({
            queue: [
              ...player.queue.slice(0, insertAt),
              track,
              ...player.queue.slice(insertAt)
            ]
          });
        })();
      } else if (cmd.type === 'toggle-play' || cmd.type === 'prev' || cmd.type === 'next') {
        handleBasicCommand(cmd.type);
      } else if (cmd.type === 'sonos-discover') {
        void sonosDiscover();
      } else if (cmd.type === 'sonos-add-by-ip') {
        void sonosAddByIp(cmd.host);
      } else if (cmd.type === 'sonos-cast') {
        if (!current || !sonosEnabled) return;
        usePlayerStore.getState().pause();
        const seekTo = position > 0 ? position : undefined;
        void sonosStartCasting(
          cmd.host,
          current.id,
          current.title ?? undefined,
          current.artist ?? undefined,
          seekTo
        );
      } else if (cmd.type === 'sonos-stop') {
        if (sonosActiveHost === cmd.host) {
          void sonosStop();
        } else {
          void window.fmusic.sonosStop(cmd.host).catch(() => {});
        }
      } else if (cmd.type === 'sonos-stop-all') {
        void sonosStopAll();
      }
    };
    const offTray = window.fmusic.onTrayCommand(handleBasicCommand);
    const offRemote = window.fmusic.onRemoteCommand(handleRemoteCommand);
    return () => {
      offTray();
      offRemote();
    };
  }, [
    isCasting,
    togglePlay,
    next,
    prev,
    sonosTogglePlay,
    playTrack,
    current,
    position,
    sonosEnabled,
    sonosDiscover,
    sonosAddByIp,
    sonosStartCasting,
    sonosActiveHost,
    sonosStop,
    sonosStopAll
  ]);

  // Seek events coming from the mini player's scrub bar.
  useEffect(() => {
    const handleSeek = (seconds: number) => {
      if (isCasting) {
        void sonosSeek(seconds);
      } else {
        seek(seconds);
      }
    };
    const offMini = window.fmusic.onMiniSeek(handleSeek);
    const offRemote = window.fmusic.onRemoteSeek(handleSeek);
    return () => {
      offMini();
      offRemote();
    };
  }, [isCasting, seek, sonosSeek]);

  useEffect(() => {
    return window.fmusic.onRemoteVolume((nextVolume) => {
      setVolume(nextVolume);
    });
  }, [setVolume]);

  return null;
}
