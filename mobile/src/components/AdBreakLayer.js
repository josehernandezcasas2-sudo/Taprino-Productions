import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, absoluteFill, inkTint } from '../lib/theme';
import { adBarWords, liveAdNote, liveCardWords, muteLabel, podCardWords, visitLabel } from '../lib/adBreakRules';
import MuteGlyph from './MuteGlyph';

// An ad break on screen, drawn by the episode player and the live player
// in whichever of their views is showing (the inline 16:9 strip or the
// full-screen Modal) from the break's state (mobile/src/lib/useAdBreak.js).
// It is the website's ad chrome, not a design of its own:
//   a title (components/VideoPlayer.js)     .tp-pod-video, .tp-pod-card,
//                                           .tp-adbar ("Ad", "1 of 2",
//                                           "0:12 left", "Your episode
//                                           resumes right after" — the last
//                                           hidden on a phone's strip, as
//                                           under 640px on the website),
//                                           .tp-pod-visit ("Visit … ↗")
//   a live channel (components/ChannelPlayer.js)  .channel-hold and its
//                                           .tp-adbar ("Back to TapaTV in
//                                           1:30" — kept on a phone too: it
//                                           is the break's only countdown);
//                                           no Visit link there
// `F` is the full-screen chrome (the player's fullChrome(), null inline):
// the bar and the link keep clear of the screen's edges and grow with it.
//
// Its mute (Jose, 2026-11-13: "Allow tv ads to be muted"): `mute` =
// { silent, onToggle } draws the player's speaker at the start of the bar,
// the website's .tp-ad-mute. It is the player's own mute
// (mobile/src/lib/adBreakRules.js "the sound"): muting during the ad keeps
// the programme muted after it. Mute only — an ad has no skip or seek.
//
// Each item type has its view (ITEM_VIEWS); a new source's type adds one.

function VideoItemView({ ad }) {
  return <VideoView player={ad.player} style={absoluteFill} contentFit="contain" nativeControls={false} />;
}

function TitleCardView({ item, F }) {
  const w = podCardWords(item);
  return (
    <LinearGradient colors={[colors.surface3, colors.surface0]} locations={[0, 0.6]} start={{ x: 0.2, y: 0.15 }} end={{ x: 0.8, y: 1 }} style={styles.card} accessibilityRole="text" accessibilityLiveRegion="polite">
      <Text style={[styles.cardKicker, F && F.adCardKicker]}>{w.kicker}</Text>
      {w.brand ? <Text style={[styles.cardBrand, F && F.adCardBrand]}>{w.brand}</Text> : null}
    </LinearGradient>
  );
}

function LiveCardView({ item, F, channelName }) {
  const w = liveCardWords(item, channelName);
  return (
    <View style={[styles.card, styles.liveCard]} accessibilityRole="text" accessibilityLiveRegion="polite">
      {w.kicker ? <Text style={[styles.cardKicker, F && F.adCardKicker]}>{w.kicker}</Text> : null}
      {w.brand ? <Text style={[styles.cardBrand, F && F.adCardBrand]}>{w.brand}</Text> : null}
      {w.line ? <Text style={[styles.liveLine, F && F.adCardKicker]}>{w.line}</Text> : null}
    </View>
  );
}

function LoadingView() {
  return (
    <View style={[styles.card, styles.loading]}>
      <ActivityIndicator color={colors.brass} />
    </View>
  );
}

// What each item type looks like over the ad's video (the video itself is
// always mounted under them while the break runs, so moving between items
// never flashes). 'countdown' is the live player's own card, drawn by it.
const ITEM_VIEWS = {
  ad: null,
  bumper: null,
  load: LoadingView,
  wait: { title: TitleCardView, live: LiveCardView },
  card: { title: TitleCardView, live: LiveCardView },
  hold: { title: TitleCardView, live: LiveCardView },
  countdown: null
};

export default function AdBreakLayer({ ad, full = false, F = null, live = false, channelName = '', mute = null }) {
  const s = ad && ad.state;
  if (!s) return null;
  const item = s.item || { type: 'load' };
  const entry = ITEM_VIEWS[item.type];
  const ItemView = entry && typeof entry === 'object' ? entry[live ? 'live' : 'title'] : entry;
  const bar = adBarWords({ index: s.index, total: s.total, remaining: s.remaining });
  const showVisit = !live && item.type === 'ad' && s.started && Boolean(item.clickUrl);
  return (
    <View style={absoluteFill} pointerEvents="box-none">
      <View style={styles.black} pointerEvents="none" />
      <View style={absoluteFill} pointerEvents="none"><VideoItemView ad={ad} /></View>
      {ItemView ? <View style={absoluteFill} pointerEvents="none"><ItemView item={item} F={F} channelName={channelName} /></View> : null}
      {/* A tap on the ad plays it again if it stopped (the phone locked, a
          call, a page the browser never reported closing); it never pauses. */}
      <Pressable style={absoluteFill} onPress={() => { if (ad.resume) ad.resume(); }} accessibilityRole="button" accessibilityLabel="Play the ad" />
      {/* The bar: not while a title's single ad is still being asked for
          (the website shows nothing until its ad is up), never over the
          live player's own countdown card. */}
      {item.type !== 'countdown' && (live || item.type !== 'load') ? (
        <LinearGradient colors={['rgba(10,11,15,0)', 'rgba(10,11,15,0.92)']} style={[styles.bar, F && F.adBar]} pointerEvents="box-none">
          {mute ? (
            <Pressable
              style={[styles.mute, F && F.adMute]}
              onPress={() => { if (mute.onToggle) mute.onToggle(); }}
              accessibilityRole="button"
              accessibilityLabel={muteLabel(mute.silent)}
              hitSlop={10}
            >
              <MuteGlyph muted={Boolean(mute.silent)} size={F && F.adMuteIcon ? F.adMuteIcon : 18} />
            </Pressable>
          ) : null}
          <View style={[styles.words, F && F.adWords]} pointerEvents="none">
            <View style={[styles.tag, F && F.adTag]}><Text style={[styles.tagText, F && F.adBarText]}>{bar.tag}</Text></View>
            {live ? (
              <Text style={[styles.barText, styles.note, F && F.adBarText]} numberOfLines={1}>{liveAdNote(channelName, s.left)}</Text>
            ) : (
              <>
                <Text style={[styles.barText, F && F.adBarText]}>{bar.count}</Text>
                {bar.time ? <Text style={[styles.barText, styles.time, F && F.adBarText]}>{bar.time}</Text> : null}
                {full ? <Text style={[styles.barText, styles.note, F && F.adBarText]} numberOfLines={1}>{bar.note}</Text> : null}
              </>
            )}
          </View>
        </LinearGradient>
      ) : null}
      {showVisit ? (
        <Pressable style={[styles.visit, F && F.adVisit]} onPress={() => ad.visit()} accessibilityRole="link" hitSlop={8}>
          <Text style={[styles.visitText, F && F.adVisitText]} numberOfLines={1}>{visitLabel(item.brand)}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// The website's numbers (styles/globals.css .tp-adbar, .tp-pod-card,
// .tp-pod-visit, .channel-hold) at a phone's root size.
const styles = StyleSheet.create({
  black: { ...absoluteFill, backgroundColor: '#000' },
  card: { ...absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 5, padding: 16, backgroundColor: colors.surface0 },
  liveCard: { gap: 6, padding: 20 },
  loading: { backgroundColor: 'transparent' },
  cardKicker: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', color: colors.inkFaint, textAlign: 'center' },
  cardBrand: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.ink, textAlign: 'center' },
  liveLine: { fontFamily: fonts.body, fontSize: 14, color: colors.inkDim, textAlign: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 18, paddingBottom: 10, paddingHorizontal: 14 },
  words: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 11 },
  // The player's round button (EpisodePlayer's .round, a little smaller in the bar).
  mute: { width: 32, height: 32, borderRadius: 16, marginVertical: -6, borderWidth: 1, borderColor: 'rgba(251,232,211,0.45)', backgroundColor: 'rgba(12,19,31,0.55)', alignItems: 'center', justifyContent: 'center' },
  barText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.85, textTransform: 'uppercase', color: colors.inkDim },
  tag: { backgroundColor: colors.olive, borderRadius: 2, paddingVertical: 2, paddingHorizontal: 7 },
  tagText: { fontFamily: fonts.monoBold, fontSize: 10.5, letterSpacing: 0.85, textTransform: 'uppercase', color: colors.surface0 },
  time: { color: colors.ink },
  note: { marginLeft: 'auto', opacity: 0.7, textTransform: 'none', letterSpacing: 0.4, flexShrink: 1 },
  visit: { position: 'absolute', right: 14, bottom: 45, backgroundColor: inkTint(0.92), borderRadius: 999, paddingVertical: 6, paddingHorizontal: 11, maxWidth: '70%' },
  visitText: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.onBrass }
});
