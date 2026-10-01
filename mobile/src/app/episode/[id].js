import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import Svg, { Circle, Path } from 'react-native-svg';
import { apiGet, apiPost } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import { formatRuntimeLong } from '../../lib/runtime';
import { useWishlist } from '../../lib/useWishlist';
import HeroSpotlight, { PlayIcon, heroButtonStyles } from '../../components/HeroSpotlight';
import { CardRow } from '../../components/LibraryRows';
import SmartImage from '../../components/SmartImage';

const CONTENT_TYPE_LABEL = { movie: 'Movie', short: 'Short', vertical: 'Vertical', podcast: 'Podcast', bonus: 'Bonus' };
const TYPE_COLOR = { movie: colors.mint, short: colors.sky, vertical: colors.rust, podcast: colors.olive, bonus: colors.inkFaint };
// lib/ageGate.js MIN_AGE_BY_RATING — only used to word the restricted screen.
const MIN_AGE_BY_RATING = { G: 0, 'TV-Y': 0, 'TV-G': 0, PG: 0, 'TV-PG': 0, 'TV-Y7': 7, 'PG-13': 13, 'TV-14': 14, R: 17, 'NC-17': 17, 'TV-MA': 17, 'Not Rated': 17 };

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

function HeartIcon({ active, size = 14, color }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={active ? color : 'none'} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </Svg>
  );
}
function BackArrowIcon({ size = 16, color = colors.olive }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9.5" />
      <Path d="M13.5 8.5L10 12l3.5 3.5" />
    </Svg>
  );
}

function sideTier(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', color: colors.danger };
  if (adsEnabled === false) return { label: 'Free', color: colors.ok };
  return { label: 'Free with ads', color: colors.brass };
}

// Mirrors pages/episode/[id].js, fed by GET /api/episode-page (the same
// lib/episodePage.js the website uses — so opening a title here records
// the view and applies the age gate exactly like the site) plus
// POST /api/stream-token for the actual playable URL.
//
// Standalone titles open on the landing view (trailer or artwork, title,
// meta, Play / Save / Back this project) unless reached with ?autoplay=1
// (a Play button) or ?trailer=1; series episodes start playing straight
// away, as on the site. Then: the "Now screening" card with its credit
// chips, Next/Previous episode (series) or Watch next (standalone), and
// Bonus Content. Finishing a series episode moves on to the next one.
//
// Not on mobile yet: ad breaks (paused), captions / audio description
// (the website's AccessibilityPanel), and resume/progress saving.
export default function Episode() {
  const { id, autoplay, trailer } = useLocalSearchParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const { isWishlisted, toggle: toggleWishlist } = useWishlist();
  const [state, setState] = useState({ loading: true, error: null, page: null });
  const [showPlayer, setShowPlayer] = useState(false);
  const [showingTrailer, setShowingTrailer] = useState(trailer === '1');
  const [playback, setPlayback] = useState({ loading: false, src: null, locked: false, error: null });

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    setState({ loading: true, error: null, page: null });
    setPlayback({ loading: false, src: null, locked: false, error: null });
    (async () => {
      try {
        const token = await withTimeout(getToken().catch(() => null), 4000);
        const page = await apiGet(`/api/episode-page?id=${encodeURIComponent(id)}`, token);
        if (cancelled) return;
        setState({ loading: false, error: null, page });
        if (page.episode) {
          setShowingTrailer(trailer === '1');
          setShowPlayer(page.episode.contentType === 'series' || autoplay === '1' || trailer === '1');
        }
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, page: null });
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const episode = state.page && state.page.episode;

  // Fetch the real (entitlement- and age-checked) src only once the player
  // is actually shown — never for the landing view.
  useEffect(() => {
    if (!episode || !showPlayer || showingTrailer || playback.src || playback.locked || playback.loading) return undefined;
    let cancelled = false;
    setPlayback((p) => ({ ...p, loading: true }));
    (async () => {
      try {
        const token = await withTimeout(getToken().catch(() => null), 4000);
        const res = await apiPost('/api/stream-token', { episodeId: episode.id }, token);
        if (!cancelled) setPlayback({ loading: false, src: res.src, locked: false, error: null });
      } catch (err) {
        if (cancelled) return;
        const premiumLock = episode.tier === 'premium' && /member/i.test(err.message || '');
        setPlayback({ loading: false, src: null, locked: premiumLock, error: premiumLock ? null : err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [episode, showPlayer, showingTrailer]);

  const activeSrc = showingTrailer ? (episode && episode.trailerSrc) : playback.src;
  const player = useVideoPlayer(activeSrc || null, (p) => { p.play(); });

  // Same reason as HeroSpotlight's trailer: a play() issued before the
  // stream has loaded can be dropped, so start again once it's ready.
  useEffect(() => {
    if (!player) return undefined;
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' && !player.playing && player.currentTime === 0) player.play();
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    if (!player) return undefined;
    const sub = player.addListener('playToEnd', () => {
      if (showingTrailer) { setShowingTrailer(false); return; }
      const next = state.page && state.page.nextEpisode;
      if (episode && episode.contentType === 'series' && next) router.replace(`/episode/${next.id}?autoplay=1`);
    });
    return () => sub.remove();
  }, [player, showingTrailer, state.page]);

  function goBack() {
    if (router.canGoBack()) { router.back(); return; }
    if (episode && episode.contentType === 'series' && episode.seriesId) router.replace(`/series/${episode.seriesId}`);
    else if (episode && episode.contentType === 'podcast') router.replace('/watch/podcasts');
    else router.replace('/');
  }

  if (state.loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <Stack.Screen options={{ title: '' }} />
        <View style={styles.center}><ActivityIndicator color={colors.brass} /></View>
      </SafeAreaView>
    );
  }
  if (state.error) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Episode' }} />
        <View style={styles.center}><Text style={styles.errorText}>{state.error}</Text></View>
      </SafeAreaView>
    );
  }

  const page = state.page;

  if (page.ageRestricted) {
    const requiredAge = MIN_AGE_BY_RATING[page.requiredRating] ?? 17;
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Content restricted' }} />
        <ScrollView contentContainerStyle={styles.restrictedWrap}>
          <View style={styles.accountCard}>
            <Text style={styles.accountEyebrow}>Age-restricted content</Text>
            <Text style={styles.restrictedTitle}>
              {requiredAge >= 17 ? 'This title is for mature audiences (17+)' : `This title is rated ${page.requiredRating} (${requiredAge}+)`}
            </Text>
            <Text style={styles.restrictedBody}>
              {page.isSignedIn
                ? 'Your account settings don’t meet the age requirement for this rating. You can update your age in Account settings if it’s incorrect.'
                : 'Create a free account and confirm your age to watch. It only takes a minute, and it’s how we keep age-restricted titles limited to viewers old enough to see them.'}
            </Text>
            <Pressable style={styles.primaryBtn} onPress={() => router.push('/account')}>
              <Text style={styles.primaryBtnText}>{page.isSignedIn ? 'Go to account settings' : 'Create a free account'}</Text>
            </Pressable>
            {!page.isSignedIn ? (
              <Text style={styles.restrictedSmall}>
                Already have an account? <Text style={styles.linkText} onPress={() => router.push('/account')}>Sign in</Text>
              </Text>
            ) : null}
            <Pressable style={[styles.backBtn, { alignSelf: 'center', marginTop: 16, marginBottom: 0 }]} onPress={goBack}>
              <BackArrowIcon /><Text style={styles.backText}>Back</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const saved = isWishlisted(episode.id);
  const runtime = formatRuntimeLong(episode.runtime) || episode.runtime;
  const tierChip = episode.tier === 'free' ? 'Free tier · ad-supported' : 'Tapa + · ad-free';
  const eyebrow = showingTrailer ? 'Trailer' : episode.tier === 'premium' ? 'Now screening — Tapa + exclusive' : 'Now screening — free signal';
  const { nextEpisode, previousEpisode, previousEpisodeWatched, watchNext, bonusContent, parentSeriesName, isSignedIn } = page;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: episode.title }} />
      <ScrollView contentContainerStyle={styles.scroll}>

        {!showPlayer ? (
          <HeroSpotlight
            pool={[episode]}
            preferTrailer
            eyebrow={episode.contentType === 'movie' ? 'Movie' : 'Short'}
            onPlay={() => {}}
            onTrailer={() => {}}
            renderActions={() => (
              <View style={[heroButtonStyles.actions, { flexWrap: 'wrap' }]}>
                <Pressable style={heroButtonStyles.playBtn} onPress={() => setShowPlayer(true)}>
                  <PlayIcon /><Text style={heroButtonStyles.playText}>Play</Text>
                </Pressable>
                <Pressable style={heroButtonStyles.infoBtn} onPress={() => toggleWishlist(episode.id)}>
                  <HeartIcon active={saved} size={16} color={saved ? colors.danger : colors.ink} />
                  <Text style={heroButtonStyles.infoText}>{saved ? 'Saved' : 'Save for later'}</Text>
                </Pressable>
                {episode.fundingUrl ? (
                  <Pressable style={heroButtonStyles.infoBtn} onPress={() => Linking.openURL(episode.fundingUrl)}>
                    <Text style={heroButtonStyles.infoText}>{'◆'} Back this project</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          />
        ) : (
          <View style={styles.playerWrap}>
            {playback.locked ? (
              <View style={styles.lockPanel}>
                <Text style={styles.lockGlyph}>{'◈'}</Text>
                <Text style={styles.lockTitle}>Available to Tapa + members</Text>
                <Text style={styles.lockBody}>This one only screens for people who&rsquo;ve joined the circle. Members get early drops, deleted scenes, and creator updates before anyone else.</Text>
                <Pressable style={styles.unlockBtn} onPress={() => router.push('/account')}>
                  <Text style={styles.unlockText}>Join Tapa +</Text>
                </Pressable>
              </View>
            ) : activeSrc ? (
              <VideoView key={activeSrc} player={player} style={styles.player} contentFit="contain" nativeControls allowsFullscreen />
            ) : playback.error ? (
              <View style={[styles.player, styles.center]}><Text style={styles.errorText}>{playback.error}</Text></View>
            ) : (
              <View style={[styles.player, styles.center]}><ActivityIndicator color={colors.brass} /></View>
            )}
          </View>
        )}

        <View style={styles.stage}>
          <Pressable style={styles.backBtn} onPress={goBack}>
            <BackArrowIcon /><Text style={styles.backText}>Back</Text>
          </Pressable>

          <View style={styles.playerCard}>
            <View style={styles.nowHeading}>
              <Text style={styles.nowEyebrow}>{eyebrow}</Text>
              <Text style={styles.nowTitle}>{episode.title}</Text>
              {episode.desc ? <Text style={styles.nowDesc}>{episode.desc}</Text> : null}
              <View style={styles.creditLine}>
                {episode.artist ? <Text style={styles.creditText}>Made by {episode.artist}</Text> : null}
                {runtime ? <Text style={styles.creditText}>{runtime}</Text> : null}
                {episode.genre ? <Text style={styles.creditText}>{episode.genre}</Text> : null}
                {episode.rating ? <View style={styles.ratingTag}><Text style={styles.creditText}>{episode.rating}</Text></View> : null}
                {episode.isOriginal ? <View style={styles.originalTag}><Text style={styles.originalText}>Tapa Original</Text></View> : null}
                {episode.contentType === 'series' ? (
                  <Pressable style={[styles.typeTag, { borderColor: colors.brass }]} onPress={() => router.push(`/series/${episode.seriesId}`)}>
                    <Text style={[styles.typeTagText, { color: colors.brass }]}>{'▤'} Part of {parentSeriesName || 'a series'}{episode.seriesOrder ? ` · Ep. ${episode.seriesOrder}` : ''}</Text>
                  </Pressable>
                ) : (
                  <View style={[styles.typeTag, { borderColor: TYPE_COLOR[episode.contentType] || colors.inkDim }]}>
                    <Text style={[styles.typeTagText, { color: TYPE_COLOR[episode.contentType] || colors.inkDim }]}>{CONTENT_TYPE_LABEL[episode.contentType] || 'Short'}</Text>
                  </View>
                )}
                <View style={[styles.chip, { borderColor: 'rgba(251,232,211,0.18)' }]}><Text style={styles.chipText}>{tierChip}</Text></View>
                <Pressable style={[styles.chip, styles.chipRow, { borderColor: 'rgba(179,73,47,0.4)' }]} onPress={() => toggleWishlist(episode.id)}>
                  <HeartIcon active={saved} color={saved ? colors.danger : colors.inkDim} />
                  <Text style={[styles.chipText, { color: saved ? colors.danger : colors.inkDim }]}>{saved ? 'Saved to wishlist' : 'Add to wishlist'}</Text>
                </Pressable>
                {!showingTrailer && episode.trailerSrc ? (
                  <Pressable style={styles.chip} onPress={() => { setShowPlayer(true); setShowingTrailer(true); }}>
                    <Text style={styles.chipText}>{'🎬'} Watch trailer</Text>
                  </Pressable>
                ) : null}
              </View>
              {showingTrailer ? (
                <Pressable style={[styles.chip, { alignSelf: 'flex-start', marginBottom: 14 }]} onPress={() => setShowingTrailer(false)}>
                  <Text style={styles.chipText}>{'▶'} Back to full episode</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {episode.contentType === 'series' && !nextEpisode && !previousEpisode ? (
            <View style={styles.sidebar}>
              <Text style={styles.sideHeading}>Episodes</Text>
              <Text style={styles.sideNote}>This is the only episode in this show so far.</Text>
              <Pressable style={styles.seeAllEpisodes} onPress={() => router.push(`/series/${episode.seriesId}`)}>
                <Text style={styles.seeAllEpisodesText}>{'▤'} See show page</Text>
              </Pressable>
            </View>
          ) : null}

          {episode.contentType === 'series' && (nextEpisode || previousEpisode) ? (
            <View style={styles.sidebar}>
              {nextEpisode ? (
                <>
                  <Text style={styles.sideHeading}>Next episode</Text>
                  <SideCard item={nextEpisode} showCode onPress={() => router.replace(`/episode/${nextEpisode.id}?autoplay=1`)} />
                </>
              ) : null}
              {previousEpisode ? (
                <>
                  <Text style={styles.sideHeading}>Previous episode</Text>
                  <SideCard item={previousEpisode} showCode watched={previousEpisodeWatched} onPress={() => router.replace(`/episode/${previousEpisode.id}?autoplay=1`)} />
                </>
              ) : null}
              <Pressable style={styles.seeAllEpisodes} onPress={() => router.push(`/series/${episode.seriesId}`)}>
                <Text style={styles.seeAllEpisodesText}>{'▤'} See all episodes</Text>
              </Pressable>
            </View>
          ) : null}

          {episode.contentType !== 'series' && !isSignedIn ? (
            <View style={styles.sidebar}>
              <Text style={styles.sideHeading}>Watch next</Text>
              <Text style={styles.sideNote}>Sign in to get picks based on your wishlist and what you've watched.</Text>
            </View>
          ) : null}

          {episode.contentType !== 'series' && isSignedIn && watchNext.length > 0 ? (
            <View style={styles.sidebar}>
              <Text style={styles.sideHeading}>Watch next</Text>
              {watchNext.map((item) => (
                <SideCard key={item.id} item={item} onPress={() => router.push(`/episode/${item.id}?autoplay=1`)} />
              ))}
            </View>
          ) : null}

          {bonusContent.length > 0 ? (
            <View style={{ marginTop: 38 }}>
              <CardRow title="Bonus Content" cards={bonusContent} onPressCard={(b) => router.push(`/episode/${b.id}`)} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// .side-ep-card
function SideCard({ item, showCode, watched, onPress }) {
  const tier = sideTier(item.tier, item.adsEnabled);
  const runtime = formatRuntimeLong(item.runtime) || item.runtime;
  return (
    <Pressable style={styles.sideCard} onPress={onPress}>
      <View style={styles.sideThumb}>
        {item.thumbnail ? <SmartImage uri={item.thumbnail} style={StyleSheet.absoluteFillObject} /> : null}
        {watched ? (
          <View style={styles.watchedBadge}><Text style={styles.watchedText}>{'↺'} Watched</Text></View>
        ) : (
          <PlayIcon size={22} color={colors.ink} />
        )}
        {runtime ? <View style={styles.durBadge}><Text style={styles.durText}>{runtime}</Text></View> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.sideTitle}>
          {showCode && item.seriesOrder ? `S${item.season || 1}E${item.seriesOrder} — ` : ''}{item.title}
        </Text>
        {watched ? <Text style={styles.sideSub}>Watched</Text> : <Text style={[styles.sideSub, { color: tier.color }]}>{tier.label}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scroll: { paddingBottom: 120 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24, flex: 1 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center', fontFamily: fonts.display },

  playerWrap: { width: '100%', backgroundColor: '#000' },
  player: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },

  // .lock-panel / .unlock-btn
  lockPanel: { padding: 35, alignItems: 'center', backgroundColor: 'rgba(10,10,14,0.5)' },
  lockGlyph: { fontSize: 26, color: colors.ink, marginBottom: 10 },
  lockTitle: { fontFamily: fonts.displayBold, fontSize: 17.6, color: colors.ink, marginBottom: 6, textAlign: 'center' },
  lockBody: { fontFamily: fonts.body, fontSize: 13.6, lineHeight: 20, color: colors.inkDim, textAlign: 'center', maxWidth: 280, marginBottom: 16 },
  unlockBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 22 },
  unlockText: { fontFamily: fonts.displaySemi, fontSize: 13.6, color: '#08201e' },

  // .stage.stage-single
  stage: { paddingTop: 38, paddingHorizontal: 19 },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.4, borderColor: colors.olive, marginBottom: 19 },
  backText: { color: colors.olive, fontFamily: fonts.monoBold, fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase' },

  // .player-card / .now-heading / .credit-line
  playerCard: { borderRadius: 4, overflow: 'hidden', backgroundColor: '#171923', borderWidth: 1, borderColor: 'rgba(251,232,211,0.08)' },
  nowHeading: { paddingTop: 17.6, paddingHorizontal: 17.6 },
  nowEyebrow: { fontFamily: fonts.mono, fontSize: 10.9, letterSpacing: 2.2, textTransform: 'uppercase', color: colors.brass, marginBottom: 8 },
  nowTitle: { fontFamily: fonts.displayBold, fontSize: 20.8, color: colors.ink, marginBottom: 6 },
  nowDesc: { fontFamily: fonts.body, fontSize: 14.4, lineHeight: 21, color: colors.inkDim, marginBottom: 16 },
  creditLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 9, marginTop: 6, marginBottom: 16 },
  creditText: { fontFamily: fonts.mono, fontSize: 11.2, color: colors.inkDim },
  ratingTag: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.35)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  originalTag: { backgroundColor: colors.oliveBright, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 },
  originalText: { fontFamily: fonts.monoBold, fontSize: 11.5, color: '#1a1408' },
  typeTag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  typeTagText: { fontFamily: fonts.mono, fontSize: 9.9, letterSpacing: 0.2 },
  chip: { borderWidth: 1, borderColor: 'rgba(74,168,162,0.4)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 4 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipText: { fontFamily: fonts.mono, fontSize: 10.9, color: colors.brass },

  // .episode-nav-sidebar (stacked below the card on phones)
  sidebar: { marginTop: 24 },
  sideHeading: { fontFamily: fonts.mono, fontSize: 10.9, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.inkDim, marginBottom: 11 },
  sideNote: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: colors.inkDim },
  sideCard: { flexDirection: 'row', gap: 13, marginBottom: 19 },
  sideThumb: { width: 128, height: 72, borderRadius: 6, backgroundColor: colors.surface2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  durBadge: { position: 'absolute', bottom: 5, right: 5, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
  durText: { color: colors.ink, fontSize: 10.4, fontFamily: fonts.mono },
  watchedBadge: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2 },
  watchedText: { color: colors.ink, fontSize: 11, fontFamily: fonts.mono },
  sideTitle: { fontFamily: fonts.bodyBold, fontSize: 13.6, color: colors.ink, marginBottom: 3 },
  sideSub: { fontFamily: fonts.body, fontSize: 12, color: colors.inkDim },
  seeAllEpisodes: { alignItems: 'center', paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 6, marginTop: 6 },
  seeAllEpisodesText: { fontFamily: fonts.body, fontSize: 13, color: colors.ink },

  // age-restricted (.account-card)
  restrictedWrap: { padding: 19, paddingTop: 64 },
  accountCard: { backgroundColor: colors.surface2, borderRadius: 14, borderWidth: 1, borderColor: colors.oceanInk, padding: 22, alignItems: 'center' },
  accountEyebrow: { fontFamily: fonts.mono, fontSize: 10.9, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.brass, marginBottom: 8 },
  restrictedTitle: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.ink, textAlign: 'center', marginBottom: 10 },
  restrictedBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkDim, textAlign: 'center', marginBottom: 19 },
  primaryBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 24 },
  primaryBtnText: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.onBrass },
  restrictedSmall: { fontFamily: fonts.body, fontSize: 13, color: colors.inkDim, marginTop: 14 },
  linkText: { color: colors.olive, textDecorationLine: 'underline' }
});
