import { useEffect } from 'react';
import { Image, Pressable, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import Svg, { Line, Polygon, Path } from 'react-native-svg';
import { colors } from '../lib/theme';

// Minimal reel player, mirroring components/ReelPlayer.js's own scope cut
// (deliberately not the full VideoPlayer.js — no ads/captions/progress
// tracking here). expo-video plays HLS natively on both platforms, so
// unlike the website's ReelPlayer this needs no hls.js-equivalent
// attach/detach dance — just point the player at `src` and let it decode.
function VolumeIcon({ muted, size = 17 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Polygon points="3 9 3 15 8 15 13 20 13 4 8 9 3 9" fill={colors.ink} stroke="none" />
      {muted ? (
        <>
          <Line x1="16" y1="9" x2="22" y2="15" />
          <Line x1="22" y1="9" x2="16" y2="15" />
        </>
      ) : (
        <Path d="M16 8a5 5 0 0 1 0 8" />
      )}
    </Svg>
  );
}

export default function ReelPlayer({ src, active, muted, onToggleMute, onEnded, thumbnail }) {
  const player = useVideoPlayer(src || null, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    if (!player) return;
    if (active && src) {
      player.currentTime = 0;
      player.play();
    } else {
      player.pause();
    }
  }, [active, src, player]);

  useEffect(() => {
    if (player) player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    if (!player || !onEnded) return undefined;
    const sub = player.addListener('playToEnd', onEnded);
    return () => sub.remove();
  }, [player, onEnded]);

  return (
    <Pressable style={styles.wrap} onPress={onToggleMute}>
      {!src && thumbnail ? <Image source={{ uri: thumbnail }} style={styles.poster} /> : null}
      {src ? (
        <VideoView player={player} style={styles.video} contentFit="cover" nativeControls={false} />
      ) : null}
      <Pressable style={styles.muteToggle} onPress={onToggleMute}>
        <VolumeIcon muted={muted} size={16} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  video: { ...StyleSheet.absoluteFillObject },
  poster: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  muteToggle: {
    position: 'absolute',
    left: 12,
    bottom: 40,
    zIndex: 3,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center'
  }
});
