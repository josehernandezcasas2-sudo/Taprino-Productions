import { useAuth } from '@clerk/expo';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { apiGet, apiPost } from '../../lib/api';
import { colors } from '../../lib/theme';

function tierBadge(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', color: colors.brass, text: colors.onBrass };
  if (adsEnabled === false) return { label: 'Free', color: colors.mint, text: colors.onBrass };
  return { label: 'Free with ads', color: colors.surface3, text: colors.ink };
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
function PlayIcon({ size = 13, color = colors.inkDim }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M7 4l14 8-14 8z" />
    </Svg>
  );
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

// Mirrors pages/series/[id].js — same tabs (Episodes/Bonus Content/About),
// same season grouping, same hero. Image-only hero (no autoplaying
// trailer), same simplification as Stream/Home/Watch everywhere else on
// mobile. Fed by the new GET /api/series-hub?id=, built on the same
// lib/seriesHub.js the website page itself now also calls — this is what
// every series card across the app (Stream, Watch Series/Movies, Home,
// Wishlist) now links to, instead of the no-op placeholder those screens
// shipped with.
export default function SeriesHub() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [activeTab, setActiveTab] = useState('episodes');
  const [activeSeason, setActiveSeason] = useState(null);
  const [wishlisted, setWishlisted] = useState(false);
  const tokenRef = useRef(null);

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
  }, [id]);

  async function toggleWishlist() {
    if (!state.data) return;
    const seriesId = state.data.seriesInfo.id;
    const next = !wishlisted;
    setWishlisted(next);
    try {
      await apiPost('/api/wishlist', { episodeId: seriesId, action: next ? 'add' : 'remove' }, tokenRef.current);
    } catch {
      setWishlisted(!next);
    }
  }

  if (state.loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator color={colors.brass} />
      </SafeAreaView>
    );
  }

  if (state.error || !state.data) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Text style={styles.errorText}>Couldn't load this series: {state.error || 'not found'}</Text>
      </SafeAreaView>
    );
  }

  const { seriesInfo, seriesEpisodes, bonusContent } = state.data;
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

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: seriesInfo.name }} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          {heroImage ? <Image source={{ uri: heroImage }} style={styles.heroImage} /> : <View style={styles.heroImage} />}
          <View style={styles.heroOverlay}>
            <Text style={styles.heroEyebrow}>Series{seriesInfo.isOriginal ? ' · Tapa Original' : ''}</Text>
            <Text style={styles.heroTitle}>{seriesInfo.name}</Text>
            {seriesInfo.desc ? <Text style={styles.heroDesc} numberOfLines={3}>{seriesInfo.desc}</Text> : null}
            <View style={styles.heroMetaRow}>
              {badge ? (
                <View style={[styles.badge, { backgroundColor: badge.color }]}>
                  <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
                </View>
              ) : null}
              <Text style={styles.heroMetaText}>
                {seasonNumbers.length > 1 ? `${seasonNumbers.length} seasons · ` : ''}{seriesEpisodes.length} episode{seriesEpisodes.length === 1 ? '' : 's'}
              </Text>
            </View>
            <View style={styles.heroActions}>
              {heroEpisode ? (
                <Pressable style={styles.playBtn} onPress={() => router.push(`/episode/${heroEpisode.id}`)}>
                  <Text style={styles.playBtnText}>▶ Play {heroEpisode.seriesOrder ? `S${heroEpisode.season || 1}E${heroEpisode.seriesOrder}` : heroEpisode.title}</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.saveBtn} onPress={toggleWishlist}>
                <HeartIcon active={wishlisted} size={15} />
                <Text style={styles.saveBtnText}> {wishlisted ? 'Saved' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        </View>

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
                      {ep.thumbnail ? <Image source={{ uri: ep.thumbnail }} style={styles.episodeThumbImg} /> : null}
                      <View style={[styles.episodeBadge, { backgroundColor: epBadge.color }]}>
                        <Text style={[styles.episodeBadgeText, { color: epBadge.text }]}>{epBadge.label}</Text>
                      </View>
                      {!ep.thumbnail ? (
                        <View style={styles.episodeThumbIconRow}>
                          {ep.tier === 'premium' ? <LockIcon size={13} /> : <PlayIcon size={13} />}
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.episodeInfo}>
                      <Text style={styles.episodeTitle} numberOfLines={1}>{ep.title}</Text>
                      <View style={styles.episodeMetaRow}>
                        <Text style={styles.episodeMeta}>{ep.seriesOrder ? `S${ep.season || 1} E${ep.seriesOrder}` : `Season ${ep.season || 1}`}</Text>
                        {ep.runtime ? <Text style={styles.episodeMeta}>{formatRuntimeLong(ep.runtime) || ep.runtime}</Text> : null}
                        {ep.rating ? <Text style={styles.metaPill}>{ep.rating}</Text> : null}
                      </View>
                      {ep.desc ? <Text style={styles.episodeDesc} numberOfLines={2}>{ep.desc}</Text> : null}
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
                {b.thumbnail ? <Image source={{ uri: b.thumbnail }} style={styles.bonusThumb} /> : <View style={styles.bonusThumb} />}
                <Text style={styles.bonusTitle} numberOfLines={1}>{b.title}</Text>
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { paddingBottom: 120 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  emptyText: { color: colors.inkDim, fontSize: 14, paddingHorizontal: 16 },

  hero: { width: '100%', aspectRatio: 3 / 4, position: 'relative', backgroundColor: colors.surface2 },
  heroImage: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  heroOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 18, paddingTop: 60, backgroundColor: 'rgba(12,19,31,0.55)' },
  heroEyebrow: { color: colors.olive, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase' },
  heroTitle: { color: colors.ink, fontSize: 24, fontWeight: '800', marginBottom: 6 },
  heroDesc: { color: colors.ink, fontSize: 13, opacity: 0.9, lineHeight: 18, marginBottom: 10 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  heroMetaText: { color: colors.inkDim, fontSize: 11 },
  badge: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  heroActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  playBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 18 },
  playBtnText: { color: colors.onBrass, fontSize: 13, fontWeight: '700' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, borderWidth: 1, borderColor: colors.hairline, paddingVertical: 11, paddingHorizontal: 16, backgroundColor: 'rgba(0,0,0,0.3)' },
  saveBtnText: { color: colors.ink, fontSize: 13, fontWeight: '600' },

  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.surface2 },
  tabOn: { backgroundColor: colors.surface3 },
  tabText: { color: colors.inkDim, fontSize: 13, fontWeight: '600' },
  tabTextOn: { color: colors.ink },

  seasonTabs: { paddingLeft: 16, marginBottom: 10 },
  seasonTabsContent: { gap: 8, paddingRight: 16 },
  seasonTab: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: colors.hairline },
  seasonTabOn: { backgroundColor: colors.brass, borderColor: colors.brass },
  seasonTabText: { color: colors.inkDim, fontSize: 12, fontWeight: '600' },
  seasonTabTextOn: { color: colors.onBrass },
  seasonHeading: { color: colors.ink, fontSize: 15, fontWeight: '700', paddingHorizontal: 16, marginBottom: 10 },

  episodeRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  episodeThumb: { width: 110, height: 66, borderRadius: 8, backgroundColor: colors.surface2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  episodeThumbImg: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  episodeThumbIconRow: { alignItems: 'center', justifyContent: 'center' },
  episodeBadge: { position: 'absolute', top: 5, left: 5, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 6 },
  episodeBadgeText: { fontSize: 8, fontWeight: '700' },
  episodeInfo: { flex: 1, minWidth: 0 },
  episodeTitle: { color: colors.ink, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  episodeMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  episodeMeta: { color: colors.inkFaint, fontSize: 10.5 },
  metaPill: { color: colors.inkDim, fontSize: 9, fontWeight: '700', borderWidth: 1, borderColor: colors.hairline, borderRadius: 4, paddingVertical: 1, paddingHorizontal: 4 },
  episodeDesc: { color: colors.inkDim, fontSize: 11.5, lineHeight: 15 },

  bonusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16 },
  bonusCard: { width: '47%' },
  bonusThumb: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: colors.surface2, marginBottom: 6 },
  bonusTitle: { color: colors.ink, fontSize: 12.5, fontWeight: '700' },
  bonusRuntime: { color: colors.inkFaint, fontSize: 10.5, marginTop: 1 },

  aboutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  aboutBox: { width: '47%', backgroundColor: colors.surface2, borderRadius: 10, padding: 14 },
  aboutLabel: { color: colors.inkFaint, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  aboutValue: { color: colors.ink, fontSize: 13 }
});
