import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet } from '../lib/api';
import { colors } from '../lib/theme';

const ROTATE_MS = 9000;
const CONTENT_TYPE_LABEL = { movie: 'Movie', short: 'Short', vertical: 'Vertical', podcast: 'Podcast', bonus: 'Bonus content' };

function tierBadge(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', color: colors.brass, text: colors.onBrass };
  if (adsEnabled === false) return { label: 'Free', color: colors.mint, text: colors.onBrass };
  return { label: 'Free with ads', color: colors.surface3, text: colors.ink };
}

// Mirrors pages/stream.js section for section: hero spotlight, Continue
// Watching, New Releases, Leaving Soon, the membership promo, and every
// genre row — fed by the same ranking rules (lib/streamFeed.js, which
// ports components/GenreRow.js's own series-consolidation algorithm)
// via the new GET /api/stream-feed route.
//
// Deliberately out of scope for this pass: the hero's autoplaying video
// background (image-only here, same simplification as the Connect
// homepage's hero), the search box, and genre/type filter pills — none
// of those have a mobile-shaped UI yet. Wishlist hearts on cards aren't
// wired up either.
export default function Stream() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, feed: null });
  const [heroIndex, setHeroIndex] = useState(0);
  const heroTimer = useRef(null);

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

  const heroPool = state.feed?.heroPool || [];

  useEffect(() => {
    if (heroPool.length <= 1) return undefined;
    heroTimer.current = setTimeout(() => setHeroIndex((i) => (i + 1) % heroPool.length), ROTATE_MS);
    return () => clearTimeout(heroTimer.current);
  }, [heroIndex, heroPool.length]);

  // Card row taps and the hero's own card body / "More info" — "tell me
  // more about this," same reasoning as goToTrailer on the website.
  function goToEpisode(item) {
    if (item.isSeries || item.type === 'series') {
      router.push(`/series/${item.id}`);
      return;
    }
    router.push(`/episode/${item.id}`);
  }

  // The hero's Play button specifically — "start watching now," so a
  // series hero jumps straight to its first episode (matches
  // pages/stream.js's own goToEpisode) rather than the series overview.
  function playHero(item) {
    if (item.isSeries) {
      router.push(item.firstEpisodeId ? `/episode/${item.firstEpisodeId}` : `/series/${item.id}`);
      return;
    }
    router.push(`/episode/${item.id}`);
  }

  if (state.loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator color={colors.brass} />
      </SafeAreaView>
    );
  }
  if (state.error) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Text style={styles.errorText}>Couldn't load Stream: {state.error}</Text>
      </SafeAreaView>
    );
  }

  const { liveStream, isSubscriber, newReleases, leavingSoon, continueWatching, genreRows } = state.feed;
  const hero = heroPool[heroIndex % heroPool.length];

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>

        {liveStream && (
          <Pressable style={styles.liveBanner}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live now — {liveStream.title}</Text>
          </Pressable>
        )}

        {hero && (
          <Pressable style={styles.hero} onPress={() => goToEpisode(hero)}>
            {(hero.heroImage || hero.poster || hero.thumbnail) ? (
              <Image source={{ uri: hero.heroImage || hero.poster || hero.thumbnail }} style={styles.heroImage} />
            ) : null}
            <View style={styles.heroScrim} />
            <View style={styles.heroContent}>
              <Text style={styles.heroEyebrow}>{hero.isSeries ? 'Most viewed series' : 'Most viewed'}</Text>
              <Text style={styles.heroTitle} numberOfLines={2}>{hero.title}</Text>
              <View style={styles.heroMetaRow}>
                <View style={[styles.badge, styles.badgeInline, { backgroundColor: tierBadge(hero.tier, hero.adsEnabled).color }]}>
                  <Text style={[styles.badgeText, { color: tierBadge(hero.tier, hero.adsEnabled).text }]}>{tierBadge(hero.tier, hero.adsEnabled).label}</Text>
                </View>
                {hero.mainGenre ? <Text style={styles.heroMetaText}>{hero.mainGenre}</Text> : null}
                {hero.isSeries ? <Text style={styles.heroMetaText}>▤ Series</Text> : null}
              </View>
              {hero.desc ? <Text style={styles.heroDesc} numberOfLines={2}>{hero.desc}</Text> : null}
              <View style={styles.heroActions}>
                <Pressable style={styles.playBtn} onPress={() => playHero(hero)}>
                  <Text style={styles.playBtnText}>▶ {hero.isSeries ? 'Play first episode' : 'Play'}</Text>
                </Pressable>
                <Pressable style={styles.infoBtn} onPress={() => goToEpisode(hero)}><Text style={styles.infoBtnText}>ⓘ More info</Text></Pressable>
              </View>
              {heroPool.length > 1 ? (
                <View style={styles.dotsRow}>
                  {heroPool.map((_, i) => (
                    <Pressable key={i} onPress={() => setHeroIndex(i)} style={[styles.dot, i === heroIndex && styles.dotActive]} />
                  ))}
                </View>
              ) : null}
            </View>
          </Pressable>
        )}

        {continueWatching.length > 0 && (
          <Section title="Continue Watching">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowContent}>
              {continueWatching.map((ep) => {
                const pct = parseRuntimeSeconds(ep.runtime) ? Math.min(100, Math.round((ep.resumeSeconds / parseRuntimeSeconds(ep.runtime)) * 100)) : null;
                return (
                  <Pressable key={ep.id} style={styles.card} onPress={() => router.push(`/episode/${ep.id}`)}>
                    {ep.thumbnail ? <Image source={{ uri: ep.thumbnail }} style={styles.cardImg} /> : <View style={styles.cardImg} />}
                    <View style={styles.cardInfo}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{ep.title}</Text>
                      {ep.artist ? <Text style={styles.cardSubtitle} numberOfLines={1}>{ep.artist}</Text> : null}
                    </View>
                    {pct != null ? (
                      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Section>
        )}

        {newReleases.length > 0 && <CardRow title="New Releases" cards={newReleases} onPressCard={goToEpisode} />}
        {leavingSoon.length > 0 && <CardRow title="Leaving Soon" cards={leavingSoon} onPressCard={goToEpisode} />}

        {!isSubscriber && (
          <View style={styles.promo}>
            <Text style={styles.promoEyebrow}>TAPA +</Text>
            <Text style={styles.promoTitle}>Go ad-free and back the creators directly.</Text>
            <Text style={styles.promoBody}>Members get early episodes, gated series, and a direct line to what they fund.</Text>
            <Pressable style={styles.promoBtn} onPress={() => router.push('/account')}>
              <Text style={styles.promoBtnText}>Join Tapa +</Text>
            </Pressable>
          </View>
        )}

        {genreRows.map((row) => row.cards.length > 0 && (
          <CardRow key={row.genre} title={row.genre} cards={row.cards} onPressCard={goToEpisode} />
        ))}

      </ScrollView>
    </SafeAreaView>
  );
}

function parseRuntimeSeconds(runtime) {
  if (!runtime) return null;
  const parts = String(runtime).split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function CardRow({ title, cards, onPressCard }) {
  return (
    <Section title={title}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowContent}>
        {cards.map((card) => {
          const badge = tierBadge(card.tier, card.adsEnabled);
          const typeLabel = card.type === 'series' ? 'Series' : (CONTENT_TYPE_LABEL[card.contentType] || 'Short');
          const subtitle = card.type === 'series' ? `${card.episodeCount} episode${card.episodeCount === 1 ? '' : 's'}` : (card.runtime || '');
          return (
            <Pressable key={card.id} style={styles.card} onPress={() => onPressCard(card)}>
              <View>
                {card.thumbnail ? <Image source={{ uri: card.thumbnail }} style={styles.cardImg} /> : <View style={styles.cardImg} />}
                {card.hasNew ? <View style={styles.newBanner}><Text style={styles.newBannerText}>New episode</Text></View> : null}
                <View style={[styles.badge, styles.badgeOnCard, { backgroundColor: badge.color }]}>
                  <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
                </View>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardTitle} numberOfLines={1}>{card.title}</Text>
                <Text style={styles.cardSubtitle} numberOfLines={1}>{subtitle}{subtitle ? ' · ' : ''}{typeLabel}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </Section>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { paddingBottom: 120 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center' },

  liveBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.brassDeep, margin: 16, marginBottom: 0, padding: 12, borderRadius: 12 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brass },
  liveText: { color: colors.ink, fontSize: 13, fontWeight: '700' },

  hero: { width: '100%', height: 480 },
  heroImage: { ...StyleSheet.absoluteFillObject },
  heroScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(12,19,31,0.35)' },
  heroContent: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20 },
  heroEyebrow: { color: colors.brass, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  heroTitle: { color: colors.ink, fontSize: 30, fontWeight: '800', marginBottom: 8 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  heroMetaText: { color: colors.inkDim, fontSize: 12 },
  heroDesc: { color: colors.inkDim, fontSize: 13, lineHeight: 19, marginBottom: 14, maxWidth: 480 },
  heroActions: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  playBtn: { backgroundColor: colors.ink, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20 },
  playBtnText: { color: colors.surface0, fontWeight: '800', fontSize: 13 },
  infoBtn: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20 },
  infoBtnText: { color: colors.ink, fontWeight: '700', fontSize: 13 },
  dotsRow: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { backgroundColor: colors.brass, width: 18 },

  section: { marginTop: 20 },
  sectionTitle: { color: colors.inkDim, fontSize: 13, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10, marginLeft: 16 },
  rowContent: { paddingHorizontal: 16, gap: 12 },

  card: { width: 150 },
  cardImg: { width: 150, height: 225, borderRadius: 10, backgroundColor: colors.surface2 },
  cardInfo: { marginTop: 6 },
  cardTitle: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  cardSubtitle: { color: colors.inkFaint, fontSize: 11, marginTop: 1 },

  badge: { position: 'absolute', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  badgeOnCard: { top: 6, left: 6 },
  badgeInline: { position: 'relative', top: 0, left: 0 },
  badgeText: { fontSize: 9, fontWeight: '800' },

  newBanner: { position: 'absolute', top: 6, right: 6, backgroundColor: colors.mint, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  newBannerText: { color: colors.onBrass, fontSize: 8, fontWeight: '800' },

  progressTrack: { height: 3, backgroundColor: colors.surface2, borderRadius: 2, marginTop: 4, overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: colors.brass },

  promo: { margin: 16, marginTop: 24, backgroundColor: colors.surface2, borderRadius: 16, borderWidth: 1, borderColor: colors.oceanInk, padding: 18 },
  promoEyebrow: { color: colors.brass, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  promoTitle: { color: colors.ink, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  promoBody: { color: colors.inkDim, fontSize: 13, marginBottom: 14, lineHeight: 19 },
  promoBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 10, alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 20 },
  promoBtnText: { color: colors.onBrass, fontWeight: '800', fontSize: 13 }
});
