import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import TopNav from '../components/TopNav';
import HeroSpotlight from '../components/HeroSpotlight';
import { CardRow, ContinueWatchingRow } from '../components/LibraryRows';

// Mirrors pages/stream.js: live banner, full-bleed HeroSpotlight, Continue
// Watching, New Releases, Leaving Soon, the Tapa + promo, then one row per
// genre — fed by the same ranking rules (lib/streamFeed.js, which ports
// components/GenreRow.js's series-consolidation) via GET /api/stream-feed.
//
// Differences from the website that remain: no wishlist hearts on cards,
// and the genre/type filter pills aren't built (search lives in the top
// nav's search screen instead of an in-page filter).
export default function Stream() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, feed: null });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await Promise.race([
          getToken().catch(() => null),
          new Promise((r) => setTimeout(() => r(null), 4000))
        ]);
        const feed = await apiGet('/api/stream-feed', token);
        if (!cancelled) setState({ loading: false, error: null, feed });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, feed: null });
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // pages/stream.js goToEpisode — Play means "start watching now".
  function playHero(item) {
    if (item.isSeries) {
      router.push(item.firstEpisodeId ? `/episode/${item.firstEpisodeId}` : `/series/${item.id}`);
      return;
    }
    if (item.contentType === 'podcast' && item.seriesId) {
      router.push(`/podcasts/${item.seriesId}`);
      return;
    }
    router.push(`/episode/${item.id}`);
  }

  // goToTrailer ("More info") and goToEpisodeInfo (browsing a card): tell
  // me more, don't start playing.
  function goToInfo(item) {
    if (item.isSeries || item.type === 'series') {
      router.push(`/series/${item.id}`);
      return;
    }
    if (item.contentType === 'podcast' && item.seriesId) {
      router.push(`/podcasts/${item.seriesId}`);
      return;
    }
    router.push(`/episode/${item.id}`);
  }

  if (state.loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><ActivityIndicator color={colors.brass} /></View>
      </SafeAreaView>
    );
  }
  if (state.error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><Text style={styles.errorText}>Couldn't load Stream: {state.error}</Text></View>
      </SafeAreaView>
    );
  }

  const { liveStream, isSubscriber, heroPool, newReleases, leavingSoon, continueWatching, genreRows } = state.feed;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>

        {liveStream ? <LiveBanner title={liveStream.title} /> : null}

        {heroPool.length > 0 && <HeroSpotlight pool={heroPool} onPlay={playHero} onTrailer={goToInfo} />}

        <View style={styles.stage}>
          <ContinueWatchingRow items={continueWatching} onPressItem={(ep) => router.push(`/episode/${ep.id}`)} />
          <CardRow title="New Releases" cards={newReleases} onPressCard={goToInfo} onSeeAll={() => router.push('/collection/new-releases')} />
          <CardRow title="Leaving Soon" cards={leavingSoon} onPressCard={goToInfo} onSeeAll={() => router.push('/collection/leaving-soon')} />

          {!isSubscriber && (
            <LinearGradient colors={[colors.brass, '#c98a2c']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.promo}>
              <View style={styles.promoInner}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.promoEyebrow}>Tapa +</Text>
                  <Text style={styles.promoTitle}>Go ad-free and back the creators directly.</Text>
                  <Text style={styles.promoBody}>Members get early episodes, gated series, and a direct line to what they fund.</Text>
                </View>
                <Pressable style={styles.promoCta} onPress={() => router.push('/account')}>
                  <Text style={styles.promoCtaText}>Join Tapa +</Text>
                </Pressable>
              </View>
            </LinearGradient>
          )}

          {genreRows.map((row) => (
            <CardRow key={row.genre} title={row.genre} cards={row.cards} onPressCard={goToInfo} onSeeAll={() => router.push(`/genre/${encodeURIComponent(row.genre)}`)} />
          ))}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// .live-now-banner (the live screen itself isn't built on mobile yet, so
// this isn't tappable like the website's link).
function LiveBanner({ title }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.35, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={styles.liveBanner}>
      <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
      <Text style={styles.liveText} numberOfLines={1}><Text style={styles.liveStrong}>Live now</Text> {'—'} {title}</Text>
      <Text style={styles.liveArrow}>Watch {'→'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { paddingBottom: 120 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center', fontFamily: fonts.display },

  // .live-now-banner
  liveBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 13, marginHorizontal: 19, marginBottom: 13, paddingVertical: 11, paddingHorizontal: 16, borderWidth: 1, borderColor: 'rgba(201,97,79,0.4)', backgroundColor: 'rgba(201,97,79,0.08)', borderRadius: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  liveText: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 13.6, color: colors.ink },
  liveStrong: { fontFamily: fonts.bodyBold, color: colors.danger },
  liveArrow: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.danger },

  // .stage.stage-single.stage-wide (≤640px)
  stage: { paddingTop: 38, paddingHorizontal: 19, paddingBottom: 48 },

  // .promo-banner
  promo: { borderRadius: 16, marginVertical: 40, overflow: 'hidden' },
  promoInner: { paddingVertical: 29, paddingHorizontal: 19, gap: 32, alignItems: 'flex-start' },
  promoEyebrow: { fontFamily: fonts.mono, fontSize: 10.9, letterSpacing: 0.9, textTransform: 'uppercase', color: '#3a2a08', opacity: 0.75, marginBottom: 6 },
  promoTitle: { fontFamily: fonts.displayBold, fontSize: 25.6, lineHeight: 31, color: '#241a05', marginBottom: 8 },
  promoBody: { fontFamily: fonts.body, fontSize: 14.4, lineHeight: 20, color: '#3a2a08' },
  promoCta: { backgroundColor: '#1a1408', borderRadius: 999, paddingVertical: 14, paddingHorizontal: 29 },
  promoCtaText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink }
});
