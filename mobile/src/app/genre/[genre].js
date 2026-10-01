import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiGet } from '../../lib/api';
import { colors } from '../../lib/theme';

const CONTENT_TYPE_LABEL = { movie: 'Movie', short: 'Short', vertical: 'Vertical', podcast: 'Podcast', bonus: 'Bonus content' };

function tierBadge(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', color: colors.brass, text: colors.onBrass };
  if (adsEnabled === false) return { label: 'Free', color: colors.mint, text: colors.onBrass };
  return { label: 'Free with ads', color: colors.surface3, text: colors.ink };
}

// Mirrors pages/genre/[genre].js — hero spotlight scoped to this genre,
// then New Releases/Leaving Soon/one-row-per-content-type, via the new
// GET /api/genre-feed (lib/genreFeed.js, sharing lib/libraryCards.js's
// ranking with Stream/Watch — deliberately NOT the same lib the website
// page itself uses, since that one consolidates from raw episodes
// client-side via components/GenreRow.js; same reasoning as Stream).
export default function GenreLibrary() {
  const { genre } = useLocalSearchParams();
  const router = useRouter();
  const [state, setState] = useState({ loading: true, error: null, feed: null });

  useEffect(() => {
    if (!genre) return undefined;
    let cancelled = false;
    apiGet(`/api/genre-feed?genre=${encodeURIComponent(genre)}`)
      .then((feed) => { if (!cancelled) setState({ loading: false, error: null, feed }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, feed: null }); });
    return () => { cancelled = true; };
  }, [genre]);

  function goToCard(item) {
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
  function playHero(item) {
    if (item.isSeries) {
      router.push(item.firstEpisodeId ? `/episode/${item.firstEpisodeId}` : `/series/${item.id}`);
      return;
    }
    goToCard(item);
  }

  if (state.loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator color={colors.brass} />
      </SafeAreaView>
    );
  }
  if (state.error || !state.feed) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Text style={styles.errorText}>Couldn't load {genre}: {state.error || 'not found'}</Text>
      </SafeAreaView>
    );
  }

  const { heroPool, rows, totalCount } = state.feed;
  const hero = heroPool[0];

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: genre }} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        {hero ? (
          <Pressable style={styles.hero} onPress={() => goToCard(hero)}>
            {(hero.heroImage || hero.poster || hero.thumbnail) ? (
              <Image source={{ uri: hero.heroImage || hero.poster || hero.thumbnail }} style={styles.heroImage} />
            ) : null}
            <View style={styles.heroScrim} />
            <View style={styles.heroContent}>
              <Text style={styles.heroEyebrow}>{genre}</Text>
              <Text style={styles.heroTitle} numberOfLines={2}>{hero.title}</Text>
              <View style={styles.badge}>
                <Text style={[styles.badgeText, { color: tierBadge(hero.tier, hero.adsEnabled).text }]}>{tierBadge(hero.tier, hero.adsEnabled).label}</Text>
              </View>
              {hero.desc ? <Text style={styles.heroDesc} numberOfLines={2}>{hero.desc}</Text> : null}
              <View style={styles.heroActions}>
                <Pressable style={styles.playBtn} onPress={() => playHero(hero)}>
                  <Text style={styles.playBtnText}>▶ {hero.isSeries ? 'Play first episode' : 'Play'}</Text>
                </Pressable>
                <Pressable style={styles.infoBtn} onPress={() => goToCard(hero)}><Text style={styles.infoBtnText}>ⓘ More info</Text></Pressable>
              </View>
            </View>
          </Pressable>
        ) : null}

        {totalCount === 0 ? (
          <Text style={styles.emptyText}>Nothing tagged {genre} yet — check back soon.</Text>
        ) : (
          rows.map((row) => <CardRow key={row.key} title={row.title} cards={row.cards} onPressCard={goToCard} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function CardRow({ title, cards, onPressCard }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
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
                <View style={[styles.cardBadge, { backgroundColor: badge.color }]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { paddingBottom: 120 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  emptyText: { color: colors.inkDim, fontSize: 14, paddingHorizontal: 16, marginTop: 10 },

  hero: { width: '100%', aspectRatio: 3 / 4, position: 'relative', backgroundColor: colors.surface2, marginBottom: 16 },
  heroImage: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  heroScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(12,19,31,0.4)' },
  heroContent: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 18, paddingTop: 50 },
  heroEyebrow: { color: colors.olive, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  heroTitle: { color: colors.ink, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9, backgroundColor: colors.surface3, marginBottom: 8 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  heroDesc: { color: colors.ink, fontSize: 13, opacity: 0.9, lineHeight: 18, marginBottom: 12 },
  heroActions: { flexDirection: 'row', gap: 10 },
  playBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 18 },
  playBtnText: { color: colors.onBrass, fontSize: 13, fontWeight: '700' },
  infoBtn: { borderRadius: 999, paddingVertical: 11, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.hairline, backgroundColor: 'rgba(0,0,0,0.3)' },
  infoBtnText: { color: colors.ink, fontSize: 13, fontWeight: '600' },

  section: { marginBottom: 20 },
  sectionTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', marginBottom: 10, paddingHorizontal: 16 },
  rowContent: { gap: 12, paddingHorizontal: 16 },
  card: { width: 130 },
  cardImg: { width: '100%', aspectRatio: 2 / 3, borderRadius: 8, backgroundColor: colors.surface2 },
  cardBadge: { position: 'absolute', top: 6, left: 6, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 7 },
  newBanner: { position: 'absolute', bottom: 6, left: 6, right: 6, backgroundColor: 'rgba(12,19,31,0.85)', borderRadius: 4, paddingVertical: 2, paddingHorizontal: 5 },
  newBannerText: { color: colors.olive, fontSize: 8.5, fontWeight: '700', textAlign: 'center' },
  cardInfo: { marginTop: 6 },
  cardTitle: { color: colors.ink, fontSize: 12.5, fontWeight: '700' },
  cardSubtitle: { color: colors.inkFaint, fontSize: 10.5, marginTop: 1 }
});
