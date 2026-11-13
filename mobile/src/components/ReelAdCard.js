import { useEffect, useRef } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAuth } from '../lib/stableAuth';
import { colors, absoluteFill } from '../lib/theme';
import { REEL_AD_CTA } from '../lib/adBreakRules';
import { firePixel } from '../lib/adSlots';
import { visitAdvertiser } from '../lib/adVisit';

// The swipe feeds' house-ad card (Vertical Discover, Snippets), the
// website's components/ReelAdCard.js: a sibling of ReelPlayer, not a
// variant of it — an ad creative is a direct MP4 that loops while the card
// is on screen, with the feed's mute, an "Ad" label and, when the ad has a
// link, "Learn more →". The impression fires each time the card becomes
// the one on screen (scrolling back to it counts again, as on the
// website); "Learn more →" fires the click tracker and opens the
// advertiser's page in the in-app browser, the card paused until the
// viewer is back (mobile/src/lib/adVisit.js, which knows when on Android
// too). `ad` is one slot's item from
// mobile/src/lib/adSlots.js. `insets` keeps the label clear of the notch.
export default function ReelAdCard({ ad, active, muted, onToggleMute, insets = null }) {
  const { getToken } = useAuth();
  const player = useVideoPlayer(ad && ad.src ? ad.src : null, (p) => {
    p.loop = true;
  });
  const firedRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const visitingRef = useRef(false);

  async function learnMore() {
    if (visitingRef.current || !ad) return;
    visitingRef.current = true;
    try { player.pause(); } catch { /* released */ }
    await visitAdvertiser(ad, getToken);
    visitingRef.current = false;
    try { if (activeRef.current) player.play(); } catch { /* released */ }
  }

  useEffect(() => {
    if (!player) return;
    if (active) {
      try {
        player.currentTime = 0;
        player.play();
      } catch { /* a released player */ }
      if (!firedRef.current) {
        firedRef.current = true;
        if (ad && ad.impressionUrl) firePixel(ad.impressionUrl, getToken);
      }
    } else {
      try { player.pause(); } catch { /* released */ }
      // Back on screen later = a new impression, like a fresh pre-roll.
      firedRef.current = false;
    }
  }, [active, player, ad, getToken]);

  useEffect(() => {
    try { if (player) player.muted = muted; } catch { /* released */ }
  }, [muted, player]);

  // Back in the app (expo-video pauses every player when it goes to the
  // background): the card on screen plays again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && activeRef.current && !visitingRef.current) {
        try { player.play(); } catch { /* released */ }
      }
    });
    return () => { try { sub.remove(); } catch { /* gone */ } };
  }, [player]);

  const top = (insets ? insets.top : 0) + 16;
  const bottom = (insets ? insets.bottom : 0) + 30;
  return (
    <Pressable style={styles.wrap} onPress={onToggleMute} accessibilityLabel={muted ? 'Unmute the ad' : 'Mute the ad'}>
      <VideoView player={player} style={absoluteFill} contentFit="cover" nativeControls={false} />
      <View style={[styles.badge, { top }]} pointerEvents="none"><Text style={styles.badgeText}>Ad</Text></View>
      <View style={[styles.caption, { paddingBottom: bottom }]} pointerEvents="box-none">
        {ad && ad.title ? <Text style={styles.title}>{ad.title}</Text> : null}
        {ad && ad.clickUrl ? (
          <Pressable onPress={learnMore} accessibilityRole="link" hitSlop={8}>
            <Text style={styles.cta}>{REEL_AD_CTA}</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

// styles/globals.css .reel-ad-badge, .reel-caption, .reel-ad-cta.
const styles = StyleSheet.create({
  wrap: { ...absoluteFill, backgroundColor: '#000' },
  badge: { position: 'absolute', left: 16, zIndex: 5, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  badgeText: { color: colors.ink, fontSize: 11, fontWeight: '700', letterSpacing: 0.45, textTransform: 'uppercase' },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3, paddingHorizontal: 18, paddingTop: 60 },
  title: { color: colors.ink, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  cta: { marginTop: 8, color: colors.sky, fontWeight: '700', fontSize: 14.5 }
});
