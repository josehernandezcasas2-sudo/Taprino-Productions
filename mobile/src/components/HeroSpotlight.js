import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import Svg, { Circle, Line, Path, Polygon, Rect } from 'react-native-svg';
import SmartImage from './SmartImage';
import { colors, fonts } from '../lib/theme';
import { formatRuntimeLong } from '../lib/runtime';

const ROTATE_MS = 9000;

// Ported from components/HeroSpotlight.js, same rules: `pool` is the
// pre-built candidate list from lib/heroCandidates.js; a candidate shows a
// purpose-built heroImage first, else (when it has no trailer) its
// poster/thumbnail, else an autoplaying muted trailer. Starts on the LAST
// candidate and rotates every 9s, exactly like the site.
function tierMeta(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', bg: colors.brass, fg: '#241a05' };
  if (adsEnabled === false) return { label: 'Free', bg: colors.ok, fg: '#14261a' };
  return { label: 'Free with ads', bg: colors.brass, fg: '#241a05' };
}

export function PlayIcon({ size = 16, color = '#1a1408' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M8 5v14l11-7z" />
    </Svg>
  );
}
function InfoIcon({ size = 16, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
      <Circle cx="12" cy="12" r="10" />
      <Line x1="12" y1="16" x2="12" y2="12" />
      <Line x1="12" y1="8" x2="12.01" y2="8" />
    </Svg>
  );
}
function VolumeIcon({ muted }) {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Polygon points="3 9 3 15 8 15 13 20 13 4 8 9 3 9" fill={colors.ink} stroke="none" />
      {muted ? (<><Line x1="17" y1="9" x2="22" y2="15" /><Line x1="22" y1="9" x2="17" y2="15" /></>) : (<Path d="M16 8.5a5 5 0 010 7" />)}
    </Svg>
  );
}
function PauseIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill={colors.ink}>
      <Rect x="6" y="5" width="4" height="14" rx="1" />
      <Rect x="14" y="5" width="4" height="14" rx="1" />
    </Svg>
  );
}

function TrailerBackground({ src, muted, paused, height }) {
  const player = useVideoPlayer(src, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  useEffect(() => { if (player) player.muted = muted; }, [muted, player]);
  useEffect(() => {
    if (!player) return;
    if (paused) player.pause(); else player.play();
  }, [paused, player]);
  // A play() issued before the stream has loaded can be silently dropped
  // (the trailer would load and then just sit paused on its first frame),
  // so ask again the moment the player reports it's ready.
  useEffect(() => {
    if (!player) return undefined;
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' && !paused) player.play();
    });
    return () => sub.remove();
  }, [player, paused]);
  return <VideoView player={player} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height }} contentFit="cover" nativeControls={false} />;
}

// eyebrow / renderActions / preferTrailer let the episode landing view
// (pages/episode/[id].js) reuse this: it labels the hero Movie/Short, has
// Play / Save / Back-this-project buttons, and plays a trailer even when
// artwork exists.
export default function HeroSpotlight({ pool, onPlay, onTrailer, eyebrow, renderActions, preferTrailer }) {
  const { height: windowHeight } = useWindowDimensions();
  const [index, setIndex] = useState(Math.max(pool.length - 1, 0));
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const timerRef = useRef(null);

  const heroHeight = Math.min(900, Math.max(300, Math.round(windowHeight * 0.75)));

  useEffect(() => {
    if (paused || pool.length <= 1) return undefined;
    timerRef.current = setTimeout(() => setIndex((i) => (i + 1) % pool.length), ROTATE_MS);
    return () => clearTimeout(timerRef.current);
  }, [index, paused, pool.length]);

  if (pool.length === 0) return null;

  const ep = pool[index % pool.length];
  const fallbackImage = !ep.trailerSrc ? (ep.poster || ep.thumbnail) : null;
  const imageSrc = preferTrailer
    ? (ep.trailerSrc ? null : (ep.heroImage || ep.poster || ep.thumbnail))
    : (ep.heroImage || fallbackImage);
  const isImageMode = !!imageSrc;
  const tier = tierMeta(ep.tier, ep.adsEnabled);
  const runtime = formatRuntimeLong(ep.runtime) || ep.runtime;
  const metaText = [ep.mainGenre, ep.releaseYear, runtime].filter(Boolean).join(' · ');
  const goTo = (i) => setIndex(((i % pool.length) + pool.length) % pool.length);

  return (
    <View style={[styles.hero, { height: heroHeight }]}>
      {isImageMode ? (
        <SmartImage key={ep.id} uri={imageSrc} style={StyleSheet.absoluteFillObject} />
      ) : ep.trailerSrc ? (
        <TrailerBackground key={ep.id} src={ep.trailerSrc} muted={muted} paused={paused} height={heroHeight} />
      ) : null}
      <LinearGradient
        colors={['rgba(10,10,14,0.35)', 'rgba(10,10,14,0.15)', 'rgba(10,10,14,0.45)', 'rgba(10,10,14,0.92)']}
        locations={[0, 0.3, 0.55, 1]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      {pool.length > 1 ? (
        <View style={styles.dots} pointerEvents="box-none">
          {pool.map((_, i) => (
            <Pressable key={i} onPress={() => goTo(i)} hitSlop={6} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
      ) : null}

      {!isImageMode && ep.trailerSrc ? (
        <View style={styles.controls}>
          <Pressable style={styles.circleBtn} onPress={() => setMuted((m) => !m)}><VolumeIcon muted={muted} /></Pressable>
          <Pressable style={styles.circleBtn} onPress={() => setPaused((p) => !p)}>{paused ? <PlayIcon size={13} color={colors.ink} /> : <PauseIcon />}</Pressable>
        </View>
      ) : null}

      {pool.length > 1 ? (
        <>
          <Pressable style={[styles.arrow, { left: 8 }]} onPress={() => goTo(index - 1)}><Text style={styles.arrowText}>{'‹'}</Text></Pressable>
          <Pressable style={[styles.arrow, { right: 8 }]} onPress={() => goTo(index + 1)}><Text style={styles.arrowText}>{'›'}</Text></Pressable>
        </>
      ) : null}

      <View style={styles.content}>
        <Text style={styles.eyebrow}>{eyebrow || (ep.isSeries ? 'Most viewed series' : 'Most viewed')}</Text>
        {ep.titleImageUrl ? (
          <Image source={{ uri: ep.titleImageUrl }} style={styles.titleImage} resizeMode="contain" />
        ) : (
          <Text style={styles.title}>{ep.title}</Text>
        )}
        <View style={styles.meta}>
          <View style={[styles.tierBadge, { backgroundColor: tier.bg }]}><Text style={[styles.tierBadgeText, { color: tier.fg }]}>{tier.label}</Text></View>
          {metaText ? (<><Text style={styles.metaDot}>{'•'}</Text><Text style={styles.metaText}>{metaText}</Text></>) : null}
          {ep.rating ? (<><Text style={styles.metaDot}>{'•'}</Text><View style={styles.ratingTag}><Text style={styles.ratingText}>{ep.rating}</Text></View></>) : null}
          {ep.isOriginal ? (<><Text style={styles.metaDot}>{'•'}</Text><View style={styles.originalTag}><Text style={styles.originalText}>Tapa Original</Text></View></>) : null}
          {ep.isSeries ? (<><Text style={styles.metaDot}>{'•'}</Text><Text style={styles.metaText}>{'▤'} Series</Text></>) : null}
        </View>
        {ep.desc ? <Text style={styles.desc}>{ep.desc}</Text> : null}
        {renderActions ? renderActions(ep) : (
        <View style={styles.actions}>
          <Pressable style={styles.playBtn} onPress={() => onPlay(ep)}>
            <PlayIcon />
            <Text style={styles.playText}>{ep.isSeries ? 'Play first episode' : 'Play'}</Text>
          </Pressable>
          <Pressable style={styles.infoBtn} onPress={() => onTrailer(ep)}>
            <InfoIcon />
            <Text style={styles.infoText}>More info</Text>
          </Pressable>
        </View>
        )}
      </View>
    </View>
  );
}

const shadow = { textShadowColor: 'rgba(0,0,0,0.85)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 };

const styles = StyleSheet.create({
  hero: { width: '100%', backgroundColor: '#000', overflow: 'hidden' },
  dots: { position: 'absolute', top: 21, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, zIndex: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(251,232,211,0.35)' },
  dotActive: { backgroundColor: colors.olive, width: 18 },
  controls: { position: 'absolute', top: 14, right: 16, flexDirection: 'row', gap: 8, zIndex: 3 },
  circleBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(251,232,211,0.3)', backgroundColor: 'rgba(10,10,14,0.5)', alignItems: 'center', justifyContent: 'center' },
  arrow: { position: 'absolute', top: '38%', marginTop: -18, width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(251,232,211,0.25)', backgroundColor: 'rgba(10,10,14,0.45)', alignItems: 'center', justifyContent: 'center', zIndex: 3 },
  arrowText: { color: colors.ink, fontSize: 19, lineHeight: 24, fontFamily: fonts.body },
  content: { position: 'absolute', left: 19, right: 19, bottom: 0, paddingBottom: 24, zIndex: 2 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 2.2, textTransform: 'uppercase', color: colors.olive, marginBottom: 8, ...shadow },
  title: { fontFamily: fonts.bodyBold, fontSize: 33.6, lineHeight: 35, color: colors.ink, marginBottom: 8, ...shadow },
  titleImage: { width: '100%', height: 110, alignSelf: 'flex-start', marginBottom: 8 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 8, marginBottom: 16 },
  tierBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
  tierBadgeText: { fontFamily: fonts.monoBold, fontSize: 11.5, letterSpacing: 0.2 },
  metaDot: { color: colors.inkDim, opacity: 0.6, fontFamily: fonts.mono, fontSize: 12.5 },
  metaText: { color: colors.inkDim, fontFamily: fonts.mono, fontSize: 12.5, ...shadow, textShadowRadius: 6 },
  ratingTag: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.35)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1.5 },
  ratingText: { color: colors.inkDim, fontFamily: fonts.mono, fontSize: 11.5 },
  desc: { fontFamily: fonts.body, fontSize: 14.4, lineHeight: 21, color: colors.ink, opacity: 0.9, marginBottom: 11, ...shadow, textShadowRadius: 6 },
  actions: { flexDirection: 'row', gap: 8 },
  playBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ink, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 18 },
  playText: { fontFamily: fonts.displayBold, fontSize: 13.6, color: '#1a1408' },
  infoBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(20,21,28,0.4)', borderWidth: 1, borderColor: 'rgba(251,232,211,0.4)', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 18 },
  infoText: { fontFamily: fonts.displaySemi, fontSize: 13.6, color: colors.ink },
  originalTag: { backgroundColor: colors.oliveBright, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 },
  originalText: { fontFamily: fonts.monoBold, fontSize: 11.5, color: '#1a1408' }
});

// The hero's Play / secondary button styles, for screens that pass their
// own renderActions (the episode landing view).
export const heroButtonStyles = { playBtn: styles.playBtn, playText: styles.playText, infoBtn: styles.infoBtn, infoText: styles.infoText, actions: styles.actions };
