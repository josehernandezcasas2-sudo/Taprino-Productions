import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useVideoPlayer } from 'expo-video';
import { useEvent } from 'expo';
import Svg, { Circle, Path } from 'react-native-svg';
import { apiGet, apiPost } from '../../lib/api';
import { readViewingTerms, saveViewingTerms, withTerms, TERMS_URL } from '../../lib/viewingTerms';
import { advisoryFor, useContentRatings } from '../../lib/contentAdvisory';
import ContentAdvisory from '../../components/ContentAdvisory';
import { colors, fonts, absoluteFill, inkTint, oliveTint } from '../../lib/theme';
import { parseRuntimeToSeconds as runtimeSeconds } from '../../lib/runtime';
import { useWishlist } from '../../lib/useWishlist';
import { useWatchProgress } from '../../lib/useWatchProgress';
import { useCaptureBlock } from '../../lib/captureBlock';
import { useFullscreenChrome } from '../../lib/fullscreenChrome';
import { withQueryFlag } from '../../lib/captions';
import { episodeCode } from '../../lib/seriesResume';
import { episodeHasPage } from '../../lib/showRules';
import { CONTACT_EMAIL } from '../../lib/suspensionRules';
import PreviewBar, { PreviewFootnote, openSiteHref } from '../../components/PreviewBar';
import { endCardFor } from '../../lib/endCardRules';
import TopNav from '../../components/TopNav';
import { PlayIcon } from '../../components/HeroSpotlight';
import EpisodePlayer from '../../components/EpisodePlayer';
import { CardRow, EpisodeStrip } from '../../components/LibraryRows';
import SmartImage from '../../components/SmartImage';
import { OwnTitleCard, OwnedChip, useBuy } from '../../components/BuyBits';
import { TipButton, TipGlyph } from '../../components/TipSheet';
import { AiSealChip } from '../../components/AiSeal';
import { dollars } from '../../lib/purchaseRules';
import { formatOpensAt } from '../../lib/earlyAccess';

const CONTENT_TYPE_LABEL = { movie: 'Movie', short: 'Short', vertical: 'Vertical', podcast: 'Podcast', bonus: 'Bonus' };
const TYPE_COLOR = { movie: colors.mint, short: colors.sky, vertical: colors.rust, podcast: colors.olive, bonus: colors.inkFaint };
// lib/ageGate.js MIN_AGE_BY_RATING — only used to word the restricted screen.
const MIN_AGE_BY_RATING = { G: 0, 'TV-Y': 0, 'TV-G': 0, PG: 0, 'TV-PG': 0, 'TV-Y7': 7, 'PG-13': 13, 'TV-14': 14, R: 17, 'NC-17': 17, 'TV-MA': 17, 'Not Rated': 17 };

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

const enc = (x) => encodeURIComponent(String(x));

// A token colour at an alpha (the landing strip's tag and button over the
// still: the show pages' color-mix habit).
function tint(hex, a) {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// The notes' paragraphs: a blank line starts a new one.
function paragraphs(text) {
  return String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

// "22 min" from a "22:00" runtime (the website's minutesLabel).
function minutesLabel(runtime) {
  const s = runtimeSeconds(runtime);
  return s ? `${Math.max(1, Math.round(s / 60))} min` : (runtime || '');
}

// components/GenreRow.js tierBadge: free-ads = olive-deep, free-noads = green, premium = brass.
function tierBadge(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', bg: colors.brass, fg: '#241a05' };
  if (adsEnabled === false) return { label: 'Free', bg: 'rgba(132,205,152,0.2)', fg: colors.ink };
  return { label: 'Free with ads', bg: 'rgba(242,193,78,0.2)', fg: colors.ink };
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
function ChevronIcon({ size = 10, color = colors.brass }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M9 6l6 6-6 6" />
    </Svg>
  );
}
// components/PlayerIcons.js TicketIcon / DiamondIcon.
function TicketIcon({ size = 18, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 8.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.2a1.7 1.7 0 0 0 0 3.2v1.6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.6a1.7 1.7 0 0 0 0-3.2z" />
      <Path d="M15 6.5v11" strokeDasharray="1.6 1.6" />
    </Svg>
  );
}
function DiamondIcon({ size = 16, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round">
      <Path d="M12 3l9 9-9 9-9-9z" />
    </Svg>
  );
}

// Mirrors pages/episode/[id].js, fed by GET /api/episode-page (the same
// lib/episodePage.js the website uses — so opening a title here records
// the view and applies the age gate exactly like the site) plus
// POST /api/stream-token for the actual playable URL.
//
// The page after Play (Jose, 2026-10-29, the "After Play" canvas,
// https://claude.ai/artifact/UJZJriGJqXaDXeJgSzcKsf): the site header,
// a 16:9 player with the site's own controls (components/EpisodePlayer.js,
// full screen sideways), then one title block — the show kicker, the
// title, the meta line, four round actions (Save, Tip, Own, Trailer) —
// the Up next card, the description and credits, the season as a strip
// of landscape cards, and Bonus content. A title with its own page opens
// on it (below) unless reached with ?autoplay=1 (a Play button) or
// ?trailer=1; series episodes start playing straight away, as on the
// site. When a title plays out the end card comes up over
// the last frame (components/EndCard.js): the next episode with a
// ten-second timer, or one pick once the show is over.
//
// Signed-in viewers resume where they left off and their progress is
// saved (lib/useWatchProgress.js), like the website. Captions play from
// the same gated track as the website's (/api/captions/<id>, with
// ?preview=1 in a preview), drawn by the player with its CC button
// (components/EpisodePlayer.js); `captionsUrl` is on the episode only for
// a viewer who may watch it, and never for a trailer. Not on mobile yet:
// ad breaks (paused), audio description and the website's Accessibility
// panel under the description (AccessibilityPanel).
//
// The series revamp, slice 4 (boards V2 and V3): an episode of a show (or
// an extra) whose own page is on opens on the V2 landing — the still or
// the trailer in a 16:9 strip, the title block, Play / Save / Tip, the
// creator's notes, the credit lines, the full Own card, the season strip
// ("Now open") — and Play turns it into the player in place (?autoplay=1).
// With the page off (the default for a show's episodes) it plays at once.
// Since 2026-11-08 films and shorts open on the same landing (Jose,
// question 1 of slice 4: the hero that repeated the title, meta and
// description under it is gone), with Watch next in the season strip's
// place.
// ?preview=1 is the owner's private preview of an episode that isn't live:
// the preview bar, a signed play with no views, progress, Tip, Own, Buy or
// end card, and the "Pulled" panel while it's held (the team still plays
// it).
export default function Episode() {
  const { id, autoplay, trailer, preview: previewParam } = useLocalSearchParams();
  const previewAsked = previewParam === '1';
  const router = useRouter();
  const { getToken } = useAuth();
  const { isWishlisted, toggle: toggleWishlist } = useWishlist();
  const [state, setState] = useState({ loading: true, error: null, page: null });
  const [showPlayer, setShowPlayer] = useState(false);
  const [showingTrailer, setShowingTrailer] = useState(trailer === '1');
  const [playback, setPlayback] = useState({ loading: false, src: null, locked: false, error: null });
  // Bumping this reloads the page: after Buy to own's Checkout closes, or
  // after the viewing terms are taken.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    setState({ loading: true, error: null, page: null });
    setPlayback({ loading: false, src: null, locked: false, error: null });
    (async () => {
      try {
        const token = await withTimeout(getToken().catch(() => null), 4000);
        const page = await apiGet(await withTerms(`/api/episode-page?id=${encodeURIComponent(id)}${previewAsked ? '&preview=1' : ''}`), token);
        if (cancelled) return;
        setState({ loading: false, error: null, page });
        if (page.episode) {
          setShowingTrailer(trailer === '1');
          // Its own page (decision 11) unless it was opened to play.
          setShowPlayer(!episodeHasPage(page.episode) || autoplay === '1' || trailer === '1');
        }
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, page: null });
      }
    })();
    return () => { cancelled = true; };
  }, [id, reloadKey, previewAsked]); // eslint-disable-line react-hooks/exhaustive-deps

  const episode = state.page && state.page.episode;
  // The owner's preview (?preview=1): the server's { role, status, held,
  // canPlay, strong, text, linkHref, linkLabel }, or null on a public title.
  const previewInfo = state.page && state.page.preview && typeof state.page.preview === 'object' ? state.page.preview : null;
  const previewing = Boolean(previewInfo);
  const canPlay = !previewing || previewInfo.canPlay !== false;
  const purchase = previewing ? null : state.page && state.page.purchase;
  const owned = Boolean(purchase && purchase.owned);
  // Tips (components/TipSheet.js): never in a preview.
  const tipping = previewing ? null : state.page && state.page.tipping;
  const { buy, busy: buyBusy } = useBuy({
    getToken: () => withTimeout(getToken().catch(() => null), 4000),
    router,
    isSignedIn: Boolean(state.page && state.page.isSignedIn),
    onDone: () => setReloadKey((k) => k + 1)
  });

  // Fetch the real (entitlement- and age-checked) src only once the player
  // is actually shown — never for the landing view.
  useEffect(() => {
    if (!episode || !showPlayer || showingTrailer || playback.src || playback.locked || playback.loading) return undefined;
    // A held title in a preview plays for the team only.
    if (!canPlay) { setPlayback({ loading: false, src: null, locked: 'held', error: null }); return undefined; }
    let cancelled = false;
    setPlayback((p) => ({ ...p, loading: true }));
    (async () => {
      try {
        const token = await withTimeout(getToken().catch(() => null), 4000);
        const body = { episodeId: episode.id, terms: await readViewingTerms() };
        if (previewing) body.preview = true;
        const res = await apiPost('/api/stream-token', body, token);
        if (!cancelled) setPlayback({ loading: false, src: res.src, locked: false, error: null });
      } catch (err) {
        if (cancelled) return;
        // A preview of a title pulled while the team looks at it (403 held).
        if (/pulled while/i.test(err.message || '')) { setPlayback({ loading: false, src: null, locked: 'held', error: null }); return; }
        // Early screenings (the website's lib/earlyAccess.js): the first
        // day after release is Premium's; the server says so in the message.
        const earlyLock = /early screening/i.test(err.message || '');
        const premiumLock = episode.tier === 'premium' && /member/i.test(err.message || '');
        setPlayback({ loading: false, src: null, locked: earlyLock ? 'early' : premiumLock, error: earlyLock || premiumLock ? null : err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [episode, showPlayer, showingTrailer]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSrc = showingTrailer ? (episode && episode.trailerSrc) : playback.src;
  const player = useVideoPlayer(activeSrc || null, (p) => { p.play(); });
  // Content advisory over the first seconds (mobile/src/lib/contentAdvisory.js).
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const ratingsList = useContentRatings();
  const advisoryInfo = episode && !showingTrailer ? advisoryFor(episode, ratingsList) : null;
  // While the advisory card is up the player keeps its captions off it.
  const [advisoryOn, setAdvisoryOn] = useState(false);
  // A preview starts at the beginning and saves no progress.
  const resumeSeconds = previewing ? 0 : (state.page && state.page.resumeSeconds) || 0;
  useWatchProgress({
    player,
    episodeId: episode && episode.id,
    enabled: Boolean(state.page && state.page.isSignedIn && !previewing && !showingTrailer && playback.src),
    startAt: resumeSeconds,
    getToken: () => withTimeout(getToken().catch(() => null), 4000)
  });
  // No screenshots or recording while the title itself plays; trailers
  // are promotional and stay capturable (mobile/src/lib/captureBlock.js).
  useCaptureBlock(Boolean(showPlayer && !showingTrailer && playback.src));
  // The full-screen Tip pill grows with the device like the player's own
  // chrome (mobile/src/lib/fullscreenChrome.js).
  const chrome = useFullscreenChrome();

  // Same reason as HeroSpotlight's trailer: a play() issued before the
  // stream has loaded can be dropped, so start again once it's ready.
  useEffect(() => {
    if (!player) return undefined;
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' && !player.playing && player.currentTime === 0) player.play();
    });
    return () => sub.remove();
  }, [player]);

  // The end card once the title plays out (mobile/src/lib/endCardRules.js,
  // drawn by components/EndCard.js inside the player; Jose, 2026-10-30):
  // the next episode with a ten-second timer, or the pick once the show
  // is over. `endedSrc` is the src that played out — a trailer's end never
  // raises the card over the episode that follows it, and play clears it.
  const [endedSrc, setEndedSrc] = useState(null);
  const endCard = useMemo(() => {
    const p = state.page;
    if (!p || !p.episode || (p.preview && typeof p.preview === 'object')) return null;
    return endCardFor({ episode: p.episode, nextEpisode: p.nextEpisode, pick: p.afterShow, seriesName: p.parentSeriesName, trailer: showingTrailer });
  }, [state.page, showingTrailer]);
  useEffect(() => {
    if (!player) return undefined;
    const sub = player.addListener('playToEnd', () => {
      if (showingTrailer) { setShowingTrailer(false); return; }
      setEndedSrc(activeSrc || null);
    });
    return () => sub.remove();
  }, [player, showingTrailer, activeSrc]);
  useEffect(() => { if (isPlaying) setEndedSrc(null); }, [isPlaying]);
  const endCardProps = endCard && endedSrc && endedSrc === activeSrc ? {
    card: endCard,
    onGo: (target) => { if (target) router.replace(`/episode/${target.id}?autoplay=1`); },
    onBack: () => router.replace(endCard.back && endCard.back.seriesId ? `/series/${endCard.back.seriesId}` : '/stream'),
    onStay: () => setEndedSrc(null)
  } : null;

  function goBack() {
    if (router.canGoBack()) { router.back(); return; }
    if (episode && episode.contentType === 'series' && episode.seriesId) router.replace(`/series/${episode.seriesId}${previewing ? '?preview=1' : ''}`);
    else if (episode && episode.contentType === 'podcast') router.replace('/watch/podcasts');
    else router.replace('/stream');
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
        <View style={styles.center}><Text style={styles.errorText}>{state.error}</Text></View>
      </SafeAreaView>
    );
  }

  const page = state.page;

  if (page.ageRestricted && page.termsRequired) {
    const requiredAge = page.requiredAge ?? 13;
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <ScrollView contentContainerStyle={styles.restrictedWrap}>
          <View style={styles.accountCard}>
            <Text style={styles.accountEyebrow}>Rated {page.requiredRating}</Text>
            <Text style={styles.restrictedTitle}>A quick confirmation before this plays</Text>
            <Text style={styles.restrictedBody}>
              This title is rated {page.requiredRating} ({requiredAge}+). By continuing you confirm you’re old enough for the ratings shown and accept the viewing terms. Titles rated 17+ still need an account with your age.
            </Text>
            <Pressable style={styles.primaryBtn} onPress={async () => { await saveViewingTerms(); setReloadKey((k) => k + 1); }}>
              <Text style={styles.primaryBtnText}>Confirm and watch</Text>
            </Pressable>
            <Text style={styles.restrictedSmall}>
              <Text style={styles.linkText} onPress={() => Linking.openURL(TERMS_URL).catch(() => {})}>Read the viewing terms</Text>
              {page.isSignedIn ? ' · or add your age on your account and skip this next time.' : ' · signed-in viewers with an age on their account skip this.'}
            </Text>
            <Pressable style={[styles.backBtn, { alignSelf: 'center', marginTop: 16, marginBottom: 0 }]} onPress={goBack}>
              <BackArrowIcon /><Text style={styles.backText}>Back</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (page.ageRestricted) {
    const requiredAge = page.requiredAge ?? MIN_AGE_BY_RATING[page.requiredRating] ?? 17;
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
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
  const { nextEpisode, watchNext = [], bonusContent = [], parentSeriesName, isSignedIn, seasonEpisodes = [] } = page;
  const isSeries = episode.contentType === 'series' && Boolean(episode.seriesId);
  const typeLabel = CONTENT_TYPE_LABEL[episode.contentType] || 'Short';
  const code = episodeCode(episode);
  const seriesKicker = isSeries ? [parentSeriesName, code].filter(Boolean).join(' · ') : typeLabel;
  const tipFirstName = tipping && tipping.creatorName ? tipping.creatorName.trim().split(/\s+/)[0] : 'the maker';
  const tier = tierBadge(episode.tier, episode.adsEnabled);
  const metaLine = [minutesLabel(episode.runtime), episode.genre, episode.releaseYear].filter(Boolean).join(' · ');
  // Never a title this viewer may not open (a preview: someone else's).
  const upNext = isSeries && showPlayer && !showingTrailer && nextEpisode && nextEpisode.canOpen !== false ? nextEpisode : null;
  const returnTo = `/episode/${episode.id}`;
  const tokenFn = () => withTimeout(getToken().catch(() => null), 4000);
  // The title's caption track (never the trailer's): the gated route the
  // website's <track> reads, which the server put on the episode only
  // because this viewer may watch it; a preview asks it the preview's way.
  const captions = !showingTrailer && playback.src && episode.captionsUrl
    ? { path: previewing ? withQueryFlag(episode.captionsUrl, 'preview') : episode.captionsUrl, label: episode.captionsLabel || 'English' }
    : null;
  // Every link that opens another title keeps the preview (?preview=1).
  const pq = previewing ? 'preview=1&' : '';
  const playHref = (eid) => `/episode/${enc(eid)}?${pq}autoplay=1`;
  // The show's page at this episode's season (the kicker, See all).
  const seasonN = Number(episode.season) || 1;
  const seriesHref = episode.seriesId ? `/series/${enc(episode.seriesId)}?${pq}season=${seasonN}` : null;
  // The V2 landing (decision 11): every title with its own page, not
  // opened to play — a show's episode or an extra whose page is on, a film,
  // a short (the website's ownPageLayout).
  const landing = !showPlayer && episodeHasPage(episode);
  const still = episode.thumbnail || episode.poster || episode.heroImage || null;
  const notes = paragraphs(episode.pageNotes);
  const notesFrom = page.notesFrom || null;
  // The credit lines (decision 20): Made by, then the optional Studio and
  // Producer in the owner's order; before slice 4's server, Made by alone.
  const credits = Array.isArray(page.credits) && page.credits.length ? page.credits
    : episode.artist ? [{ key: 'maker', label: 'Made by', name: episode.artist, href: null }] : [];
  // Play on the landing: the player in place, and ?autoplay=1 in the
  // address (the website's shallow replace).
  const playHere = () => {
    setShowPlayer(true);
    router.setParams({ autoplay: '1' });
  };
  const ownCard = !previewing ? (
    <OwnTitleCard
      offer={purchase}
      bundle={page.bundle}
      episode={episode}
      creatorName={episode.artist}
      isSubscriber={page.isSubscriber}
      busy={buyBusy}
      onBuy={() => buy('episode', episode.id, returnTo)}
      onSeePlans={() => router.push('/account')}
      onSeries={() => router.push(`/series/${episode.seriesId}`)}
    />
  ) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={styles.scroll}>
        {previewing ? <PreviewBar preview={previewInfo} /> : null}

        {landing ? (
          // The strip (board V2): the still at the player's size, with the
          // trailer behind a round button when there is one.
          <View style={styles.strip}>
            {still ? <SmartImage uri={still} style={absoluteFill} /> : null}
            {episode.trailerSrc ? <View style={styles.stripTag}><Text style={styles.stripTagText}>Trailer</Text></View> : null}
            <Pressable
              style={({ pressed }) => [styles.stripBtn, pressed && { opacity: 0.8 }]}
              onPress={() => {
                if (episode.trailerSrc) { setShowingTrailer(true); setShowPlayer(true); } else playHere();
              }}
              accessibilityRole="button"
              accessibilityLabel={episode.trailerSrc ? 'Play the trailer' : 'Play'}
            >
              <PlayIcon size={22} color={colors.ink} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.playerWrap}>
            {playback.locked === 'held' ? (
              <View style={styles.lockPanel}>
                <Text style={styles.lockGlyph}>{'◈'}</Text>
                <Text style={styles.lockTitle}>Pulled while our team looks at it</Text>
                <Text style={styles.lockBody}>It plays again once it’s restored.</Text>
                <Pressable style={styles.unlockBtn} onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Pulled: ${episode.title}`)}`).catch(() => {})}>
                  <Text style={styles.unlockText}>Email us</Text>
                </Pressable>
              </View>
            ) : playback.locked ? (
              playback.locked === 'early' ? (
                <View style={styles.lockPanel}>
                  <Text style={styles.lockGlyph}>{'◈'}</Text>
                  <Text style={styles.lockTitle}>Early screening</Text>
                  <Text style={styles.lockBody}>
                    Tapa + members are watching this now. It opens for {state.page.isSubscriber ? 'your plan' : 'everyone'} {formatOpensAt(state.page.earlyAccess && state.page.earlyAccess.opensAt)}
                    {purchase && purchase.forSale ? ', or buy it and watch right away.' : '.'}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {purchase && purchase.forSale ? (
                      <Pressable style={[styles.unlockBtn, buyBusy && { opacity: 0.6 }]} disabled={buyBusy} onPress={() => buy('episode', episode.id, returnTo)}>
                        <Text style={styles.unlockText}>{buyBusy ? 'Opening Stripe…' : `Buy for ${dollars(purchase.payCents)}`}</Text>
                      </Pressable>
                    ) : null}
                    <Pressable style={[styles.unlockBtn, purchase && purchase.forSale ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.brass } : null]} onPress={() => router.push('/account')}>
                      <Text style={[styles.unlockText, purchase && purchase.forSale ? { color: colors.brass } : null]}>{state.page.isSubscriber ? 'Switch to Tapa +' : 'See plans'}</Text>
                    </Pressable>
                    {episode.trailerSrc ? (
                      <Pressable style={[styles.unlockBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.inkDim }]} onPress={() => setShowingTrailer(true)}>
                        <Text style={[styles.unlockText, { color: colors.ink }]}>Watch the trailer</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : purchase && purchase.forSale ? (
                <View style={styles.lockPanel}>
                  <Text style={styles.lockGlyph}>{'◈'}</Text>
                  <Text style={styles.lockTitle}>Two ways to watch</Text>
                  <Text style={styles.lockBody}>Join Tapa + for everything on the site, or buy this one title and keep it.</Text>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <Pressable style={[styles.unlockBtn, buyBusy && { opacity: 0.6 }]} disabled={buyBusy} onPress={() => buy('episode', episode.id, returnTo)}>
                      <Text style={styles.unlockText}>{buyBusy ? 'Opening Stripe…' : `Buy for ${dollars(purchase.payCents)}`}</Text>
                    </Pressable>
                    <Pressable style={[styles.unlockBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.brass }]} onPress={() => router.push('/account')}>
                      <Text style={[styles.unlockText, { color: colors.brass }]}>Join Tapa +</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.lockPanel}>
                  <Text style={styles.lockGlyph}>{'◈'}</Text>
                  <Text style={styles.lockTitle}>Available to Tapa + members</Text>
                  <Text style={styles.lockBody}>This one only screens for people who&rsquo;ve joined the circle. Members get early drops, deleted scenes, and creator updates before anyone else.</Text>
                  <Pressable style={styles.unlockBtn} onPress={() => router.push('/account')}>
                    <Text style={styles.unlockText}>Join Tapa +</Text>
                  </Pressable>
                </View>
              )
            ) : activeSrc ? (
              <EpisodePlayer
                key={activeSrc}
                player={player}
                playing={isPlaying}
                heading={{ kicker: showingTrailer ? 'Trailer' : seriesKicker, title: episode.title }}
                rating={episode.rating || null}
                onNext={upNext ? () => router.replace(playHref(upNext.id)) : null}
                nextLabel={upNext ? `Next · ${episodeCode(upNext) || upNext.title}` : 'Next episode'}
                resumeSeconds={showingTrailer ? 0 : resumeSeconds}
                endCard={endCardProps}
                captions={captions}
                getToken={tokenFn}
                advisoryOn={advisoryOn}
                topRight={!showingTrailer ? (
                  <TipButton tipping={tipping} isSignedIn={isSignedIn} router={router} getToken={tokenFn} returnTo={returnTo} style={[styles.fsTip, { height: chrome.s(36), paddingHorizontal: chrome.s(14) }]} textStyle={[styles.fsTipText, { fontSize: chrome.s(11.5) }]} iconSize={chrome.s(14)}>
                    Tip {tipFirstName}
                  </TipButton>
                ) : null}
              >
                <ContentAdvisory info={advisoryInfo} playing={isPlaying} episodeId={episode.id} onVisibleChange={setAdvisoryOn} />
              </EpisodePlayer>
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

          {/* The title block (pages/episode/[id].js .ep-head). */}
          <View style={styles.kickerRow}>
            {isSeries ? (
              <Pressable style={styles.kickerLink} onPress={() => router.push(seriesHref)} hitSlop={6} accessibilityRole="link">
                <Text style={styles.kickerLinkText} numberOfLines={1}>
                  {(parentSeriesName || 'Series').toUpperCase()}{episode.seriesOrder ? ` · SEASON ${seasonN} · EPISODE ${episode.seriesOrder}` : ''}
                </Text>
                <ChevronIcon />
              </Pressable>
            ) : (
              <Text style={[styles.kickerType, { color: TYPE_COLOR[episode.contentType] || colors.inkDim }]}>
                {typeLabel.toUpperCase()}{episode.mainGenre ? ` · ${episode.mainGenre.toUpperCase()}` : ''}
              </Text>
            )}
            {showingTrailer ? <Text style={styles.kickerNote}>TRAILER</Text> : null}
            {owned ? <OwnedChip small /> : null}
          </View>
          <Text style={[styles.title, landing && styles.titleLanding]}>{episode.title}</Text>
          <View style={styles.metaRow}>
            {metaLine ? <Text style={styles.metaText}>{metaLine}</Text> : null}
            {episode.rating ? <View style={styles.ratingTag}><Text style={styles.ratingText}>{episode.rating}</Text></View> : null}
            <View style={[styles.tierPill, { backgroundColor: owned ? oliveTint(0.2) : tier.bg }]}>
              <Text style={[styles.tierPillText, { color: owned ? colors.ink : tier.fg }]}>{owned ? 'Yours · ad-free' : tier.label}</Text>
            </View>
            {episode.isOriginal ? <View style={styles.originalTag}><Text style={styles.originalText}>Tapa Original</Text></View> : null}
          </View>

          {landing ? (
            // The landing's actions (board V2): pills that wrap rather than shrink.
            <View style={styles.pills}>
              <Pressable style={({ pressed }) => [styles.pillPlay, pressed && { opacity: 0.85 }]} onPress={playHere} accessibilityRole="button">
                <PlayIcon size={16} />
                <Text style={styles.pillPlayText}>{resumeSeconds > 0 && !previewing ? 'Continue' : 'Play'}</Text>
              </Pressable>
              {!previewing ? (
                <Pressable style={[styles.pill, saved && { borderColor: colors.danger }]} onPress={() => toggleWishlist(episode.id)} accessibilityRole="button" accessibilityState={{ selected: saved }}>
                  <HeartIcon active={saved} size={16} color={saved ? colors.danger : colors.ink} />
                  <Text style={styles.pillText}>{saved ? 'Saved' : 'Save'}</Text>
                </Pressable>
              ) : null}
              <TipButton
                tipping={tipping}
                isSignedIn={isSignedIn}
                router={router}
                getToken={tokenFn}
                returnTo={returnTo}
                style={[styles.pill, styles.pillTip]}
                renderInner={() => (
                  <>
                    <TipGlyph size={16} color={colors.olive} />
                    <Text style={[styles.pillText, { color: colors.olive }]}>Tip {tipFirstName}</Text>
                  </>
                )}
              />
              {/* Back it is a money link: never in a preview (the website's rule). */}
              {episode.fundingUrl && !previewing ? (
                <Pressable style={styles.pill} onPress={() => Linking.openURL(episode.fundingUrl)} accessibilityRole="link">
                  <DiamondIcon size={14} />
                  <Text style={styles.pillText}>Back it</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            // Four round actions: Save, Tip, Own, Trailer (Back it when the title has a funding link).
            <View style={styles.actions}>
              {!previewing ? (
                <Pressable style={styles.action} onPress={() => toggleWishlist(episode.id)} accessibilityRole="button" accessibilityState={{ selected: saved }}>
                  <View style={[styles.ring, saved && styles.ringOn]}><HeartIcon active={saved} size={18} color={saved ? colors.danger : colors.ink} /></View>
                  <Text style={styles.actionLabel}>{saved ? 'SAVED' : 'SAVE'}</Text>
                </Pressable>
              ) : null}
              {/* Tips: only once the maker's Stripe account can take charges. */}
              <TipButton
                tipping={tipping}
                isSignedIn={isSignedIn}
                router={router}
                getToken={tokenFn}
                returnTo={returnTo}
                style={styles.action}
                renderInner={() => (
                  <>
                    <View style={[styles.ring, styles.ringTip]}><TipGlyph size={18} color={colors.olive} /></View>
                    <Text style={[styles.actionLabel, { color: colors.olive }]}>TIP {tipFirstName.toUpperCase()}</Text>
                  </>
                )}
              />
              {/* Buy to own: compact while playing; the full card sits on the landing view. */}
              {showPlayer && !showingTrailer && purchase && purchase.forSale && !owned ? (
                <Pressable style={[styles.action, buyBusy && { opacity: 0.6 }]} disabled={buyBusy} onPress={() => buy('episode', episode.id, returnTo)} accessibilityRole="button">
                  <View style={styles.ring}><TicketIcon /></View>
                  <Text style={styles.actionLabel}>{buyBusy ? 'OPENING…' : `OWN · ${dollars(purchase.payCents)}`}</Text>
                </Pressable>
              ) : null}
              {episode.trailerSrc ? (showingTrailer ? (
                <Pressable style={styles.action} onPress={() => setShowingTrailer(false)} accessibilityRole="button">
                  <View style={styles.ring}><PlayIcon size={16} color={colors.ink} /></View>
                  <Text style={styles.actionLabel}>FULL EPISODE</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.action} onPress={() => { setShowingTrailer(true); setShowPlayer(true); }} accessibilityRole="button">
                  <View style={styles.ring}><PlayIcon size={16} color={colors.ink} /></View>
                  <Text style={styles.actionLabel}>TRAILER</Text>
                </Pressable>
              )) : null}
              {episode.fundingUrl && !previewing ? (
                <Pressable style={styles.action} onPress={() => Linking.openURL(episode.fundingUrl)} accessibilityRole="link">
                  <View style={styles.ring}><DiamondIcon /></View>
                  <Text style={styles.actionLabel}>BACK IT</Text>
                </Pressable>
              ) : null}
            </View>
          )}

          {upNext ? (
            <Pressable style={styles.upNext} onPress={() => router.replace(playHref(upNext.id))} accessibilityRole="button" accessibilityLabel={`Up next: ${episodeCode(upNext) ? `${episodeCode(upNext)} · ` : ''}${upNext.title}`}>
              <View style={styles.upNextThumb}>
                {upNext.thumbnail ? <SmartImage uri={upNext.thumbnail} style={absoluteFill} /> : null}
                <PlayIcon size={22} color={inkTint(0.85)} />
                {upNext.runtime ? <View style={styles.upNextDur}><Text style={styles.upNextDurText}>{minutesLabel(upNext.runtime)}</Text></View> : null}
              </View>
              <View style={styles.upNextText}>
                <Text style={styles.upNextKicker}>UP NEXT · PLAYS WHEN THIS ENDS</Text>
                <Text style={styles.upNextTitle} numberOfLines={2}>{episodeCode(upNext) ? `${episodeCode(upNext)} · ` : ''}{upNext.title}</Text>
                <Text style={styles.upNextSub}>{tierBadge(upNext.tier, upNext.adsEnabled).label.toUpperCase()}</Text>
              </View>
            </Pressable>
          ) : null}

          {/* The creator's notes on the landing ("Notes from Mara"); without them, the description. */}
          {landing && notes.length > 0 ? (
            <View style={styles.notes}>
              <Text style={styles.notesHeading}>{notesFrom ? `Notes from ${notesFrom}` : 'Notes'}</Text>
              {notes.map((p, i) => <Text key={i} style={styles.notesText}>{p}</Text>)}
            </View>
          ) : episode.desc ? <Text style={styles.desc}>{episode.desc}</Text> : null}
          {page.withdrawn ? (
            <View style={styles.withdrawn}><Text style={styles.withdrawnText}>No longer on Studio Tapa TV · still yours. The creator took this title down, so it isn&rsquo;t in the catalogue any more, but you bought it and it keeps playing for you.</Text></View>
          ) : null}

          {/* The credit lines (decision 20), then the maker's seal. */}
          <View style={styles.credits}>
            {credits.map((c) => {
              // "Made by Mara Reyes": the name links to its profile when it's an account's.
              const text = (
                <Text style={styles.makerText}>
                  {c.label}{' '}
                  {c.href ? <Text style={styles.creditLink} onPress={() => openSiteHref(router, c.href)} accessibilityRole="link">{c.name}</Text> : c.name}
                </Text>
              );
              return c.key === 'maker' ? (
                <View key={c.key} style={styles.maker}>
                  <View style={styles.makerAvatar}><Text style={styles.makerInitial}>{String(c.name).trim().charAt(0).toUpperCase()}</Text></View>
                  {text}
                </View>
              ) : <View key={c.key}>{text}</View>;
            })}
            {/* The maker's "Not for AI training" seal (components/AiSeal.js). */}
            {page.aiSeal !== false ? <AiSealChip /> : null}
          </View>

          {previewing ? <PreviewFootnote /> : null}

          {landing ? ownCard : null}
          {landing && ownCard && purchase && purchase.forSale && !owned ? <View style={{ height: 22 }} /> : null}

          {isSeries && seasonEpisodes.length > 1 ? (
            <EpisodeStrip
              title={`Episodes · Season ${seasonN}`}
              items={seasonEpisodes}
              currentLabel={showPlayer ? 'Now playing' : 'Now open'}
              onPressItem={(e) => { if (e.id !== episode.id && e.canOpen !== false) router.replace(playHref(e.id)); }}
              onSeeAll={() => router.push(seriesHref)}
            />
          ) : null}
          {isSeries && seasonEpisodes.length <= 1 ? (
            <View style={styles.note}>
              <Text style={styles.noteHeading}>Episodes</Text>
              <Text style={styles.noteText}>{(page.showEpisodeCount || 0) > seasonEpisodes.length ? `This is the only episode in Season ${seasonN} so far.` : 'This is the only episode in this show so far.'}</Text>
              <Pressable style={styles.noteBtn} onPress={() => router.push(seriesHref)}>
                <Text style={styles.noteBtnText}>See show page</Text>
              </Pressable>
            </View>
          ) : null}
          {!isSeries && !previewing && isSignedIn && watchNext.length > 0 ? (
            <EpisodeStrip
              title="Watch next"
              items={watchNext}
              showCode={false}
              onPressItem={(item) => router.push(item.contentType === 'podcast' && item.seriesId ? `/podcasts/${item.seriesId}` : `/episode/${item.id}?autoplay=1`)}
            />
          ) : null}
          {!isSeries && !previewing && !isSignedIn ? (
            <View style={styles.note}>
              <Text style={styles.noteHeading}>Watch next</Text>
              <Text style={styles.noteText}>Sign in to get picks based on your wishlist and what you've watched.</Text>
            </View>
          ) : null}

          {bonusContent.length > 0 ? (
            <CardRow title="Extras" cards={bonusContent} onPressCard={(b) => { if (b.canOpen !== false) router.push(`/episode/${enc(b.id)}${previewing ? '?preview=1' : ''}`); }} />
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scroll: { paddingBottom: 120 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24, flex: 1 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center', fontFamily: fonts.display },

  playerWrap: { width: '100%', backgroundColor: '#000' },

  // The V2 landing's strip (.epl-strip): the player's box, the still as
  // cover, "Trailer" top-left, a round button in the middle.
  strip: { width: '100%', aspectRatio: 16 / 9, maxHeight: 600, backgroundColor: colors.surface1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  stripTag: { position: 'absolute', top: 12, left: 12, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, backgroundColor: tint(colors.surface0, 0.78) },
  stripTagText: { fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', color: colors.ink },
  stripBtn: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: tint(colors.surface0, 0.55), alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },
  player: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },

  // .lock-panel / .unlock-btn
  lockPanel: { padding: 35, alignItems: 'center', backgroundColor: 'rgba(10,10,14,0.5)' },
  lockGlyph: { fontSize: 26, color: colors.ink, marginBottom: 10 },
  lockTitle: { fontFamily: fonts.displayBold, fontSize: 17.6, color: colors.ink, marginBottom: 6, textAlign: 'center' },
  lockBody: { fontFamily: fonts.body, fontSize: 13.6, lineHeight: 20, color: colors.inkDim, textAlign: 'center', maxWidth: 280, marginBottom: 16 },
  unlockBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 22 },
  unlockText: { fontFamily: fonts.displaySemi, fontSize: 13.6, color: '#08201e' },

  // .stage.ep-after
  stage: { paddingTop: 14, paddingHorizontal: 19 },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.4, borderColor: colors.olive, marginBottom: 16 },
  backText: { color: colors.olive, fontFamily: fonts.monoBold, fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase' },

  // .ep-kicker / .ep-title / .ep-meta
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 },
  kickerLink: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  kickerLinkText: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, color: colors.brass, flexShrink: 1 },
  kickerType: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6 },
  kickerNote: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, color: colors.inkDim },
  title: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 29, letterSpacing: -0.3, color: colors.ink, marginBottom: 6 },
  titleLanding: { fontSize: 30, lineHeight: 33 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.6, color: colors.inkDim },
  ratingTag: { borderWidth: 1, borderColor: 'rgba(202,181,158,0.7)', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
  ratingText: { fontFamily: fonts.mono, fontSize: 9.5, color: colors.inkDim },
  tierPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  tierPillText: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase' },
  originalTag: { backgroundColor: colors.oliveBright, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 },
  originalText: { fontFamily: fonts.monoBold, fontSize: 10, color: '#1a1408' },

  // .ep-actions / .ep-action
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 },
  action: { width: 78, alignItems: 'center', gap: 6 },
  ring: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(251,232,211,0.25)', alignItems: 'center', justifyContent: 'center' },
  ringOn: { borderColor: 'rgba(239,91,91,0.6)' },
  ringTip: { borderColor: 'rgba(242,193,78,0.6)' },
  actionLabel: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1, color: colors.inkDim, textAlign: 'center' },

  // .epl-actions: Play (cream, flex 1), Save, Tip, Back it — 48pt pills.
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  pillPlay: { flexGrow: 1, flexBasis: 140, minHeight: 48, borderRadius: 999, backgroundColor: colors.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18 },
  pillPlayText: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.surface0 },
  pill: { minHeight: 48, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.45), flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 16 },
  pillTip: { borderColor: oliveTint(0.7) },
  pillText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },

  // .epl-notes ("Notes from Mara")
  notes: { marginTop: 18, gap: 10 },
  notesHeading: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.inkDim },
  notesText: { fontFamily: fonts.body, fontSize: 15.5, lineHeight: 24.8, color: colors.ink },

  // .ep-upnext
  upNext: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 10, backgroundColor: colors.surface2, marginTop: 16 },
  upNextThumb: { width: 136, height: 76, borderRadius: 7, overflow: 'hidden', backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  upNextDur: { position: 'absolute', right: 5, bottom: 5, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3, backgroundColor: 'rgba(12,19,31,0.78)' },
  upNextDurText: { fontFamily: fonts.mono, fontSize: 8.5, color: colors.ink },
  upNextText: { flex: 1, minWidth: 0, gap: 4 },
  upNextKicker: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1.4, color: colors.brass },
  upNextTitle: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  upNextSub: { fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 0.6, color: colors.inkDim },

  // .ep-desc / .ep-credits
  desc: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22.5, color: colors.ink, marginTop: 14 },
  credits: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12, marginBottom: 22 },
  maker: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  makerAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.olive, alignItems: 'center', justifyContent: 'center' },
  makerInitial: { fontFamily: fonts.displayBold, fontSize: 12, color: '#241a05' },
  makerText: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  creditLink: { textDecorationLine: 'underline', textDecorationColor: inkTint(0.4) },
  withdrawn: { padding: 10, borderRadius: 10, backgroundColor: 'rgba(242,193,78,0.1)', borderWidth: 1, borderColor: 'rgba(242,193,78,0.4)', marginTop: 12 },
  withdrawnText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.inkDim },

  // The single-episode / signed-out notes under the strip's heading style.
  note: { marginBottom: 26 },
  noteHeading: { fontFamily: fonts.mono, fontSize: 15, letterSpacing: 2, textTransform: 'uppercase', color: colors.inkDim, marginBottom: 8 },
  noteText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: colors.inkDim },
  noteBtn: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999 },
  noteBtnText: { fontFamily: fonts.body, fontSize: 13, color: colors.ink },

  // The full-screen Tip pill (components/EpisodePlayer.js topRight).
  fsTip: { height: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(242,193,78,0.7)', backgroundColor: 'rgba(12,19,31,0.55)' },
  fsTipText: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 1, textTransform: 'uppercase', color: colors.olive },

  // age-restricted (.account-card)
  restrictedWrap: { padding: 19, paddingTop: 40 },
  accountCard: { backgroundColor: colors.surface2, borderRadius: 14, borderWidth: 1, borderColor: colors.oceanInk, padding: 22, alignItems: 'center' },
  accountEyebrow: { fontFamily: fonts.mono, fontSize: 10.9, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.brass, marginBottom: 8 },
  restrictedTitle: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.ink, textAlign: 'center', marginBottom: 10 },
  restrictedBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkDim, textAlign: 'center', marginBottom: 19 },
  primaryBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 24 },
  primaryBtnText: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.onBrass },
  restrictedSmall: { fontFamily: fonts.body, fontSize: 13, color: colors.inkDim, marginTop: 14 },
  linkText: { color: colors.olive, textDecorationLine: 'underline' }
});
