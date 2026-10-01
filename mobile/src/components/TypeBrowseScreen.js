import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { apiGet } from '../lib/api';
import { colors } from '../lib/theme';

const CONTENT_TYPE_LABEL = { movie: 'Movie', short: 'Short', vertical: 'Vertical', podcast: 'Podcast', bonus: 'Bonus content' };

function tierBadge(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', color: colors.brass, text: colors.onBrass };
  if (adsEnabled === false) return { label: 'Free', color: colors.mint, text: colors.onBrass };
  return { label: 'Free with ads', color: colors.surface3, text: colors.ink };
}

// Shared by every Watch screen (watch/series.js, watch/movies.js, and —
// once built — podcasts/vertical): mirrors pages/type/[type].js for
// whichever `type` is passed in. Hero spotlight (image only, same
// simplification as Stream/Home), a "Browse by Genre" icon row, the
// library heading + count, and one row per genre — via
// GET /api/type-feed?type=<type> (lib/typeFeed.js), sharing
// lib/libraryCards.js's ranking with the Stream screen.
//
// One real simplification from the website beyond the usual (hero video,
// search, filters): the website's rows come from an admin-configurable
// curated-groups system that defaults to "one row per genre" but can be
// hand-customized; this always shows that default, so a custom curated
// layout on the website won't appear here yet.
export default function TypeBrowseScreen({ type }) {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, error: null, feed: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, feed: null });
    apiGet(`/api/type-feed?type=${encodeURIComponent(type)}`)
      .then((feed) => { if (!cancelled) setState({ loading: false, error: null, feed }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, feed: null }); });
    return () => { cancelled = true; };
  }, [type]);

  // Card row taps and the hero's own card body / "More info".
  function goToEpisode(item) {
    if (item.isSeries || item.type === 'series') {
      router.push(`/series/${item.id}`);
      return;
    }
    if (item.contentType === 'podcast' || (item.type === 'standalone' && CONTENT_TYPE_LABEL[item.contentType] === 'Podcast')) return; // podcasts play from their show page, not built yet
    router.push(`/episode/${item.id}`);
  }

  // The hero's Play button specifically — jumps a series hero straight to
  // its first episode, same reasoning as stream.js's playHero.
  function playHero(item) {
    if (item.isSeries) {
      router.push(item.firstEpisodeId ? `/episode/${item.firstEpisodeId}` : `/series/${item.id}`);
      return;
    }
    goToEpisode(item);
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
        <Text style={styles.errorText}>Couldn't load this page: {state.error}</Text>
      </SafeAreaView>
    );
  }

  const { label, heroPool, mainGenres, genreRows, seriesCount, totalCount } = state.feed;
  const hero = heroPool[0];
  const countLabel = seriesCount != null ? `${seriesCount} series` : `${totalCount} title${totalCount === 1 ? '' : 's'}`;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>

        {hero && (
          <Pressable style={styles.hero} onPress={() => goToEpisode(hero)}>
            {(hero.heroImage || hero.poster || hero.thumbnail) ? (
              <Image source={{ uri: hero.heroImage || hero.poster || hero.thumbnail }} style={styles.heroImage} />
            ) : null}
            <View style={styles.heroScrim} />
            <View style={styles.heroContent}>
              <Text style={styles.heroEyebrow}>{hero.isSeries ? 'Most viewed series' : 'Most viewed'}</Text>
              <Text style={styles.heroTitle} numberOfLines={2}>{hero.title}</Text>
              <View style={[styles.badge, { backgroundColor: tierBadge(hero.tier, hero.adsEnabled).color }]}>
                <Text style={[styles.badgeText, { color: tierBadge(hero.tier, hero.adsEnabled).text }]}>{tierBadge(hero.tier, hero.adsEnabled).label}</Text>
              </View>
              {hero.desc ? <Text style={styles.heroDesc} numberOfLines={2}>{hero.desc}</Text> : null}
              <View style={styles.heroActions}>
                <Pressable style={styles.playBtn} onPress={() => playHero(hero)}>
                  <Text style={styles.playBtnText}>▶ {hero.isSeries ? 'Play first episode' : 'Play'}</Text>
                </Pressable>
                <Pressable style={styles.infoBtn} onPress={() => goToEpisode(hero)}><Text style={styles.infoBtnText}>ⓘ More info</Text></Pressable>
              </View>
            </View>
          </Pressable>
        )}

        {mainGenres.length > 0 && (
          <View style={styles.genreBrowseSection}>
            <Text style={styles.sectionTitle}>Browse by Genre</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowContent}>
              {mainGenres.map((g) => (
                <View key={g} style={styles.genreCircleItem}>
                  <View style={styles.genreCircle}><Text style={styles.genreCircleGlyph}>◆</Text></View>
                  <Text style={styles.genreCircleLabel}>{g}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.libraryHeading}>
          <Text style={styles.libraryTitle}>{label}</Text>
          <Text style={styles.librarySub}>{countLabel}</Text>
        </View>

        {genreRows.length === 0 ? (
          <Text style={styles.emptyText}>Nothing in {label} yet — check back soon.</Text>
        ) : (
          genreRows.map((row) => row.cards.length > 0 && (
            <CardRow key={row.genre} title={row.genre} cards={row.cards} onPressCard={goToEpisode} />
          ))
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { paddingBottom: 120 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  emptyText: { color: colors.inkDim, fontSize: 14, textAlign: 'center', marginTop: 24 },

  hero: { width: '100%', height: 360 },
  heroImage: { ...StyleSheet.absoluteFillObject },
  heroScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(12,19,31,0.35)' },
  heroContent: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20 },
  heroEyebrow: { color: colors.brass, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  heroTitle: { color: colors.ink, fontSize: 26, fontWeight: '800', marginBottom: 8 },
  heroDesc: { color: colors.inkDim, fontSize: 13, lineHeight: 19, marginVertical: 8, maxWidth: 480 },
  heroActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  playBtn: { backgroundColor: colors.ink, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20 },
  playBtnText: { color: colors.surface0, fontWeight: '800', fontSize: 13 },
  infoBtn: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20 },
  infoBtnText: { color: colors.ink, fontWeight: '700', fontSize: 13 },

  genreBrowseSection: { marginTop: 20 },
  genreCircleItem: { width: 86, alignItems: 'center' },
  genreCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  genreCircleGlyph: { color: colors.brass, fontSize: 22 },
  genreCircleLabel: { color: colors.inkDim, fontSize: 11, textAlign: 'center' },

  libraryHeading: { marginTop: 24, marginBottom: 4, paddingHorizontal: 16 },
  libraryTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  librarySub: { color: colors.inkFaint, fontSize: 12, marginTop: 2 },

  section: { marginTop: 20 },
  sectionTitle: { color: colors.inkDim, fontSize: 13, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10, marginLeft: 16 },
  rowContent: { paddingHorizontal: 16, gap: 12 },

  card: { width: 150 },
  cardImg: { width: 150, height: 225, borderRadius: 10, backgroundColor: colors.surface2 },
  cardInfo: { marginTop: 6 },
  cardTitle: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  cardSubtitle: { color: colors.inkFaint, fontSize: 11, marginTop: 1 },

  badge: { position: 'relative', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeOnCard: { position: 'absolute', top: 6, left: 6 },
  badgeText: { fontSize: 9, fontWeight: '800' },

  newBanner: { position: 'absolute', top: 6, right: 6, backgroundColor: colors.mint, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  newBannerText: { color: colors.onBrass, fontSize: 8, fontWeight: '800' }
});
