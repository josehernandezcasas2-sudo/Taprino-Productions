import { useAuth } from '@clerk/expo';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { apiGet, apiPost } from '../../lib/api';
import { colors, fonts, absoluteFill } from '../../lib/theme';
import SmartImage from '../../components/SmartImage';
import TopNav from '../../components/TopNav';
import { PlayIcon, heroButtonStyles } from '../../components/HeroSpotlight';
import { BundleCard, BuyChip, useBuy } from '../../components/BuyBits';
import { AiSealChip } from '../../components/AiSeal';

// Mirrors components/GenreRow.js's tierBadge classes (the same pills as
// LibraryRows.js): free-ads = olive-deep, free-noads = green, premium = brass.
function tierBadge(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', color: colors.brass, text: '#241a05' };
  if (adsEnabled === false) return { label: 'Free', color: colors.ok, text: '#14261a' };
  return { label: 'Free with ads', color: colors.oliveDeep, text: colors.ink };
}

// Ported from lib/videoMetadata.js's formatRuntimeLong/parseRuntimeToSeconds
// — pure JS, kept in sync by hand (same reasoning as lib/verticalFeed.js).
function parseRuntimeToSeconds(runtime) {
  if (!runtime || typeof runtime !== 'string') return null;
  const parts = runtime.trim().split(':').map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  let seconds;
  if (nums.length === 3) {
    const [h, m, s] = nums;
    if (m > 59 || s > 59) return null;
    seconds = h * 3600 + m * 60 + s;
  } else {
    const [m, s] = nums;
    if (s > 59) return null;
    seconds = m * 60 + s;
  }
  return seconds > 0 ? seconds : null;
}
function formatRuntimeLong(runtime) {
  const totalSeconds = parseRuntimeToSeconds(runtime);
  if (totalSeconds == null) return null;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function HeartIcon({ active, size = 16 }) {
  return active ? (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={colors.danger}>
      <Path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </Svg>
  ) : (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </Svg>
  );
}
function LockIcon({ size = 13, color = colors.inkDim }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 11V7a6 6 0 0 1 12 0v4" />
      <Path d="M5 11h14v9H5z" />
    </Svg>
  );
}
function ThumbPlayIcon({ size = 13, color = colors.inkDim }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M7 4l14 8-14 8z" />
    </Svg>
  );
}
// The website's BackButton pill (TypeBrowseScreen.js carries the same one).
function BackArrowIcon({ size = 16, color = colors.olive }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9.5" />
      <Path d="M13.5 8.5L10 12l3.5 3.5" />
    </Svg>
  );
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

// Mirrors pages/series/[id].js — the site header (TopNav, 2026-10-29: the
// screen used to show the native stack header, which looked like another
// app), the same hero as the website's SeriesHero (image or a flat stand-in,
// kicker, Fraunces title, description, tier pill, episode count, "Made by",
// the AI seal, First episode / Save this series), the Back pill under it,
// then the same tabs (Episodes / Bonus Content / About) and season
// grouping. Image-only hero (no autoplaying trailer), same simplification
// as Stream/Home/Watch everywhere else on mobile. Fed by GET
// /api/series-hub?id=, built on the same lib/seriesHub.js the website page
// calls — every series card across the app links here.
export default function SeriesHub() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const { height: windowHeight } = useWindowDimensions();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [activeTab, setActiveTab] = useState('episodes');
  const [activeSeason, setActiveSeason] = useState(null);
  const [wishlisted, setWishlisted] = useState(false);
  const tokenRef = useRef(null);
  // Buy to own: bumping this reloads the hub after Checkout closes.
  const [reloadKey, setReloadKey] = useState(0);
  const { buy, busy: buyBusy } = useBuy({
    getToken: () => withTimeout(getToken().catch(() => tokenRef.current), 4000),
    router,
    isSignedIn: Boolean(state.data && state.data.isSignedIn),
    onDone: () => setReloadKey((k) => k + 1)
  });

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const token = await withTimeout(getToken().catch(() => null), 4000);
        tokenRef.current = token;
        const data = await apiGet(`/api/series-hub?id=${encodeURIComponent(id)}`, token);
        if (cancelled) return;
        setState({ loading: false, error: null, data });
        setWishlisted((data.wishlist || []).includes(data.seriesInfo.id));
        const seasonNumbers = [...new Set(data.seriesEpisodes.map((e) => e.season || 1))].sort((a, b) => a - b);
        setActiveSeason(seasonNumbers[0] || 1);
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, data: null });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, reloadKey]);

  async function toggleWishlist() {
    if (!state.data) return;
    const seriesId = state.data.seriesInfo.id;
    const next = !wishlisted;
    setWishlisted(next);
    try {
      await apiPost('/api/wishlist', { episodeId: seriesId, action: next ? 'add' : 'remove' }, await getToken().catch(() => tokenRef.current));
    } catch {
      setWishlisted(!next);
    }
  }

  function goBack() {
    if (router.canGoBack()) router.back(); else router.replace('/stream');
  }

  // The same 56% hero as the Stream screen's HeroSpotlight.
  const heroHeight = Math.min(600, Math.max(300, Math.round(windowHeight * 0.56)));

  if (state.loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <TopNav />
        <View style={styles.center}><ActivityIndicator color={colors.brass} /></View>
      </SafeAreaView>
    );
  }

  if (state.error || !state.data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <TopNav />
        <View style={styles.center}>
          <Text style={styles.errorText}>Couldn't load this series: {state.error || 'not found'}</Text>
          <Pressable style={styles.backBtn} onPress={goBack}>
            <BackArrowIcon />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { seriesInfo, seriesEpisodes, bonusContent, bundle = null, episodeOffers = {} } = state.data;
  const ownsEp = (ep) => Boolean(episodeOffers[ep.id] && episodeOffers[ep.id].owned);
  const seasonNumbers = [...new Set(seriesEpisodes.map((e) => e.season || 1))].sort((a, b) => a - b);
  const activeSeasonEpisodes = seriesEpisodes
    .filter((e) => (e.season || 1) === activeSeason)
    .sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
  const heroEpisode = seriesEpisodes[0];
  const heroImage = seriesInfo.heroImage || (heroEpisode && heroEpisode.heroImage) || seriesInfo.poster || seriesInfo.thumbnail;
  const seriesGenres = [...new Set(seriesEpisodes.map((e) => e.genre).filter(Boolean))];
  const representativeRating = seriesEpisodes.find((e) => e.rating)?.rating;
  const seriesArtist = seriesInfo.artist || heroEpisode?.artist;
  const badge = heroEpisode ? tierBadge(heroEpisode.tier, heroEpisode.adsEnabled) : null;
  const playLabel = heroEpisode && heroEpisode.seriesOrder ? `Play S${heroEpisode.season || 1}E${heroEpisode.seriesOrder}` : 'Play first episode';

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        <View style={[styles.hero, { height: heroHeight }]}>
          {heroImage ? <SmartImage uri={heroImage} style={absoluteFill} /> : <View style={[absoluteFill, styles.heroFallback]} />}
          <LinearGradient colors={['rgba(12,19,31,0)', 'rgba(12,19,31,0.88)', colors.surface0]} locations={[0.2, 0.72, 1]} style={absoluteFill} pointerEvents="none" />
          <View style={styles.heroContent}>
            <Text style={styles.eyebrow}>Series{seriesInfo.isOriginal ? ' · Tapa Original' : ''}</Text>
            <Text style={styles.title}>{seriesInfo.name}</Text>
            {seriesInfo.desc ? <Text style={styles.desc} numberOfLines={3}>{seriesInfo.desc}</Text> : null}
            <View style={styles.meta}>
              {badge ? (
                <View style={[styles.tierBadge, { backgroundColor: badge.color }]}>
                  <Text style={[styles.tierBadgeText, { color: badge.text }]}>{badge.label}</Text>
                </View>
              ) : null}
              <Text style={styles.metaText}>
                {seasonNumbers.length > 1 ? `${seasonNumbers.length} seasons · ` : ''}{seriesEpisodes.length} episode{seriesEpisodes.length === 1 ? '' : 's'}
              </Text>
              {seriesArtist ? <Text style={styles.metaText}>Made by {seriesArtist}</Text> : null}
              {/* The maker's "Not for AI training" seal (components/AiSeal.js). */}
              {state.data.aiSeal !== false ? <AiSealChip /> : null}
            </View>
            <View style={heroButtonStyles.actions}>
              {heroEpisode ? (
                <Pressable style={heroButtonStyles.playBtn} onPress={() => router.push(`/episode/${heroEpisode.id}?autoplay=1`)}>
                  <PlayIcon size={14} />
                  <Text style={heroButtonStyles.playText}>{playLabel}</Text>
                </Pressable>
              ) : null}
              <Pressable style={heroButtonStyles.infoBtn} onPress={toggleWishlist}>
                <HeartIcon active={wishlisted} size={15} />
                <Text style={heroButtonStyles.infoText}>{wishlisted ? 'Saved' : 'Save this series'}</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.stage}>
          <Pressable style={styles.backBtn} onPress={goBack}>
            <BackArrowIcon />
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          {bundle && bundle.owned ? (
            <Text style={styles.ownedSeries}>You own this series: every episode plays ad-free, including ones added later.</Text>
          ) : null}
          <BundleCard
            bundle={bundle}
            creatorName={seriesArtist}
            isSubscriber={state.data.isSubscriber}
            busy={buyBusy}
            onBuy={() => buy('series', seriesInfo.id, `/series/${seriesInfo.id}`)}
            ownedNames={(bundle && bundle.ownedEpisodeIds ? bundle.ownedEpisodeIds : []).map((eid) => { const e = seriesEpisodes.find((x) => x.id === eid); return e ? (e.seriesOrder ? `Episode ${e.seriesOrder}` : e.title) : null; }).filter(Boolean)}
          />

          <View style={styles.tabs}>
            <Pressable style={[styles.tab, activeTab === 'episodes' && styles.tabOn]} onPress={() => setActiveTab('episodes')}>
              <Text style={[styles.tabText, activeTab === 'episodes' && styles.tabTextOn]}>Episodes</Text>
            </Pressable>
            {bonusContent.length > 0 ? (
              <Pressable style={[styles.tab, activeTab === 'bonus' && styles.tabOn]} onPress={() => setActiveTab('bonus')}>
                <Text style={[styles.tabText, activeTab === 'bonus' && styles.tabTextOn]}>Bonus Content</Text>
              </Pressable>
            ) : null}
            <Pressable style={[styles.tab, activeTab === 'about' && styles.tabOn]} onPress={() => setActiveTab('about')}>
              <Text style={[styles.tabText, activeTab === 'about' && styles.tabTextOn]}>About</Text>
            </Pressable>
          </View>

          {activeTab === 'episodes' ? (
            seriesEpisodes.length === 0 ? (
              <Text style={styles.emptyText}>Nothing published in this series yet — check back soon.</Text>
            ) : (
              <>
                {seasonNumbers.length > 1 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.seasonTabs} contentContainerStyle={styles.seasonTabsContent}>
                    {seasonNumbers.map((num) => (
                      <Pressable key={num} style={[styles.seasonTab, num === activeSeason && styles.seasonTabOn]} onPress={() => setActiveSeason(num)}>
                        <Text style={[styles.seasonTabText, num === activeSeason && styles.seasonTabTextOn]}>Season {num}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={styles.seasonHeading}>Season {activeSeason}</Text>
                )}

                {activeSeasonEpisodes.map((ep) => {
                  const epBadge = tierBadge(ep.tier, ep.adsEnabled);
                  return (
                    <Pressable key={ep.id} style={styles.episodeRow} onPress={() => router.push(`/episode/${ep.id}`)}>
                      <View style={styles.episodeThumb}>
                        {ep.thumbnail ? <SmartImage uri={ep.thumbnail} style={absoluteFill} /> : null}
                        <View style={[styles.episodeBadge, { backgroundColor: epBadge.color }]}>
                          <Text style={[styles.episodeBadgeText, { color: epBadge.text }]}>{epBadge.label}</Text>
                        </View>
                        {!ep.thumbnail ? (
                          <View style={styles.episodeThumbIconRow}>
                            {ep.tier === 'premium' && !ownsEp(ep) ? <LockIcon size={13} /> : <ThumbPlayIcon size={13} />}
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.episodeInfo}>
                        <Text style={styles.episodeTitle} numberOfLines={2}>{ep.title}</Text>
                        <View style={styles.episodeMetaRow}>
                          <Text style={styles.episodeMeta}>{ep.seriesOrder ? `S${ep.season || 1} E${ep.seriesOrder}` : `Season ${ep.season || 1}`}</Text>
                          {ep.runtime ? <Text style={styles.episodeMeta}>{formatRuntimeLong(ep.runtime) || ep.runtime}</Text> : null}
                          {ep.rating ? <Text style={styles.metaPill}>{ep.rating}</Text> : null}
                        </View>
                        {ep.desc ? <Text style={styles.episodeDesc} numberOfLines={2}>{ep.desc}</Text> : null}
                        {/* Buy to own: the episode's own price, or Owned. */}
                        {episodeOffers[ep.id] ? (
                          <View style={{ marginTop: 6 }}>
                            <BuyChip offer={episodeOffers[ep.id]} busy={buyBusy} onBuy={() => buy('episode', ep.id, `/series/${seriesInfo.id}`)} />
                          </View>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </>
            )
          ) : null}

          {activeTab === 'bonus' ? (
            <View style={styles.bonusGrid}>
              {bonusContent.map((b) => (
                <Pressable key={b.id} style={styles.bonusCard} onPress={() => router.push(`/episode/${b.id}`)}>
                  {b.thumbnail ? <SmartImage uri={b.thumbnail} style={styles.bonusThumb} /> : <View style={styles.bonusThumb} />}
                  <Text style={styles.bonusTitle} numberOfLines={2}>{b.title}</Text>
                  <Text style={styles.bonusRuntime}>{formatRuntimeLong(b.runtime) || b.runtime}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {activeTab === 'about' ? (
            <View style={styles.aboutGrid}>
              <View style={styles.aboutBox}>
                <Text style={styles.aboutLabel}>Genre</Text>
                <Text style={styles.aboutValue}>{seriesGenres.length > 0 ? seriesGenres.join(', ') : '—'}</Text>
              </View>
              <View style={styles.aboutBox}>
                <Text style={styles.aboutLabel}>Creator</Text>
                <Text style={styles.aboutValue}>{seriesArtist || '—'}</Text>
              </View>
              <View style={styles.aboutBox}>
                <Text style={styles.aboutLabel}>Rating</Text>
                <Text style={styles.aboutValue}>{representativeRating || 'Not rated'}</Text>
              </View>
              <View style={styles.aboutBox}>
                <Text style={styles.aboutLabel}>Episodes</Text>
                <Text style={styles.aboutValue}>{seriesEpisodes.length} across {seasonNumbers.length} season{seasonNumbers.length === 1 ? '' : 's'}</Text>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const shadow = { textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { paddingBottom: 120 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center', fontFamily: fonts.display },
  emptyText: { color: colors.inkDim, fontSize: 14, fontFamily: fonts.body },

  // components/SeriesHero.js (.hero-carousel.full-bleed + .hero-content)
  hero: { width: '100%', position: 'relative', backgroundColor: colors.surface2, overflow: 'hidden' },
  heroFallback: { backgroundColor: colors.surface2 },
  heroContent: { position: 'absolute', left: 19, right: 19, bottom: 0, paddingBottom: 24 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 2.2, textTransform: 'uppercase', color: colors.olive, marginBottom: 8, ...shadow },
  title: { fontFamily: fonts.bodyBold, fontSize: 32, lineHeight: 34, color: colors.ink, marginBottom: 8, ...shadow },
  desc: { fontFamily: fonts.body, fontSize: 14.4, lineHeight: 21, color: colors.ink, opacity: 0.9, marginBottom: 11, ...shadow, textShadowRadius: 6 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 8, marginBottom: 16 },
  tierBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  tierBadgeText: { fontFamily: fonts.monoBold, fontSize: 11, letterSpacing: 0.2 },
  metaText: { color: colors.inkDim, fontFamily: fonts.mono, fontSize: 12.5, ...shadow, textShadowRadius: 6 },

  // .stage.stage-single (≤640px) with the website's BackButton pill
  stage: { paddingTop: 22, paddingHorizontal: 19 },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.4, borderColor: colors.olive, marginBottom: 19 },
  backText: { color: colors.olive, fontFamily: fonts.monoBold, fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase' },
  ownedSeries: { color: colors.inkFaint, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, paddingBottom: 14 },

  tabs: { flexDirection: 'row', gap: 8, paddingTop: 4, paddingBottom: 14 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(251,232,211,0.14)', backgroundColor: 'transparent' },
  tabOn: { backgroundColor: colors.surface2, borderColor: colors.olive },
  tabText: { color: colors.inkDim, fontFamily: fonts.displaySemi, fontSize: 13 },
  tabTextOn: { color: colors.ink },

  seasonTabs: { marginBottom: 10 },
  seasonTabsContent: { gap: 8 },
  seasonTab: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(251,232,211,0.14)' },
  seasonTabOn: { backgroundColor: colors.brass, borderColor: colors.brass },
  seasonTabText: { color: colors.inkDim, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  seasonTabTextOn: { color: '#241a05' },
  seasonHeading: { color: colors.inkDim, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: 10 },

  episodeRow: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(251,232,211,0.08)' },
  episodeThumb: { width: 120, height: 68, borderRadius: 8, backgroundColor: colors.surface2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  episodeThumbIconRow: { alignItems: 'center', justifyContent: 'center' },
  episodeBadge: { position: 'absolute', bottom: 5, left: 5, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 6 },
  episodeBadgeText: { fontFamily: fonts.mono, fontSize: 7.5, letterSpacing: 0.5, textTransform: 'uppercase' },
  episodeInfo: { flex: 1, minWidth: 0 },
  episodeTitle: { color: colors.ink, fontFamily: fonts.displaySemi, fontSize: 14, lineHeight: 18, marginBottom: 4 },
  episodeMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  episodeMeta: { color: colors.inkFaint, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' },
  metaPill: { color: colors.inkDim, fontFamily: fonts.mono, fontSize: 9, borderWidth: 1, borderColor: 'rgba(251,232,211,0.25)', borderRadius: 4, paddingVertical: 1, paddingHorizontal: 4 },
  episodeDesc: { color: colors.inkDim, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17 },

  bonusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  bonusCard: { width: '47%' },
  bonusThumb: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: colors.surface2, marginBottom: 7 },
  bonusTitle: { color: colors.ink, fontFamily: fonts.displaySemi, fontSize: 12.8, lineHeight: 16 },
  bonusRuntime: { color: colors.inkFaint, fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 2 },

  aboutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  aboutBox: { width: '47%', backgroundColor: colors.surface2, borderRadius: 10, padding: 14 },
  aboutLabel: { color: colors.inkFaint, fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5 },
  aboutValue: { color: colors.ink, fontFamily: fonts.display, fontSize: 13.5, lineHeight: 18 }
});
