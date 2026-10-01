import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { apiGet } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import TopNav from './TopNav';
import SmartImage from './SmartImage';
import HeroSpotlight from './HeroSpotlight';
import { CardRow } from './LibraryRows';


// Default emoji icons from components/GenreBrowseRow.js — an admin-uploaded
// image (genreIcons) overrides any of these per genre.
const GENRE_ICONS = {
  Comedy: '😂', Action: '💥', Horror: '👻', 'Science Fiction': '🛸', Fantasy: '⚔️',
  Romance: '💕', Documentary: '🎬', Mystery: '🔍', Animation: '🎨', Anime: '🌸'
};

function BackArrowIcon({ size = 16, color = colors.olive }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9.5" />
      <Path d="M13.5 8.5L10 12l3.5 3.5" />
    </Svg>
  );
}

// Mirrors pages/type/[type].js (HeroSpotlight, back button, "Browse by
// Genre" row, library heading + count, one GenreRow per genre) for
// whichever `type` is passed in, via GET /api/type-feed?type=<type>
// (lib/typeFeed.js), sharing lib/libraryCards.js's ranking with Stream.
//
// Differences from the website that remain: no wishlist heart on cards yet,
// and the website's admin-configurable "curated rows" layout isn't read —
// this always shows the default one-row-per-genre layout.
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

  // Card taps and the hero's "More info" (website: goToInfo / onTrailer).
  function goToEpisode(item) {
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

  // The hero's Play button — a series hero jumps straight to episode 1.
  function playHero(item) {
    if (item.isSeries) {
      router.push(item.firstEpisodeId ? `/episode/${item.firstEpisodeId}` : `/series/${item.id}`);
      return;
    }
    goToEpisode(item);
  }

  function goBack() {
    if (router.canGoBack()) router.back(); else router.replace('/stream');
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
        <View style={styles.center}><Text style={styles.errorText}>Couldn't load this page: {state.error}</Text></View>
      </SafeAreaView>
    );
  }

  const { label, heroPool, mainGenres, genreIcons, genreRows, seriesCount, totalCount } = state.feed;
  const countLabel = seriesCount != null ? `${seriesCount} series` : `${totalCount} title${totalCount === 1 ? '' : 's'}`;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>

        {heroPool.length > 0 && <HeroSpotlight pool={heroPool} onPlay={playHero} onTrailer={goToEpisode} />}

        <View style={styles.stage}>
          <Pressable style={styles.backBtn} onPress={goBack}>
            <BackArrowIcon />
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          {mainGenres.length > 0 && (
            <View style={styles.genreBrowseRow}>
              <Text style={styles.rowHeading}>Browse by Genre</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.genreTrack}>
                {mainGenres.map((g) => {
                  const custom = genreIcons && genreIcons[g];
                  return (
                    <Pressable key={g} style={styles.genreItem} onPress={() => router.push(`/genre/${encodeURIComponent(g)}`)}>
                      <View style={styles.genreCircle}>
                        {custom ? <SmartImage uri={custom} style={styles.genreImg} /> : <Text style={styles.genreGlyph}>{GENRE_ICONS[g] || '◆'}</Text>}
                      </View>
                      <Text style={styles.genreLabel}>{g}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <Text style={styles.libraryHeading}>{label}</Text>
          <Text style={styles.librarySub}>{countLabel}</Text>

          {genreRows.length === 0 ? (
            <Text style={styles.emptyText}>Nothing in {label} yet — check back soon.</Text>
          ) : (
            genreRows.map((row) => row.cards.length > 0 && (
              <CardRow key={row.genre} title={row.genre} cards={row.cards} onPressCard={goToEpisode} onSeeAll={() => router.push(`/genre/${encodeURIComponent(row.genre)}`)} />
            ))
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { paddingBottom: 120 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center', fontFamily: fonts.display },
  emptyText: { color: colors.inkDim, fontSize: 14, marginTop: 24, fontFamily: fonts.mono },

  // .library-stage
  stage: { paddingTop: 26, paddingHorizontal: 19 },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.4, borderColor: colors.olive, marginBottom: 19 },
  backText: { color: colors.olive, fontFamily: fonts.monoBold, fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase' },

  // .cat-row-heading
  rowHeading: { fontFamily: fonts.mono, fontSize: 20, letterSpacing: 2, textTransform: 'uppercase', color: colors.inkDim, marginBottom: 11 },

  // .genre-browse-*
  genreBrowseRow: { marginBottom: 32 },
  genreTrack: { flexDirection: 'row', gap: 24, paddingTop: 6, paddingBottom: 8 },
  genreItem: { width: 90, alignItems: 'center', gap: 10 },
  genreCircle: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.12)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  genreImg: { width: 84, height: 84 },
  genreGlyph: { fontSize: 32, color: colors.ink },
  genreLabel: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.ink, textAlign: 'center' },

  // .library-heading / .library-sub
  libraryHeading: { fontFamily: fonts.displayBold, fontSize: 27, color: colors.ink, marginBottom: 5 },
  librarySub: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkDim, marginBottom: 26 }
});
