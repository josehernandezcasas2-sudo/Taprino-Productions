import { useAuth } from '@clerk/expo';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { apiGet, apiPost } from '../../lib/api';
import { colors, fonts, absoluteFill, brassTint, inkTint, okTint, oliveTint } from '../../lib/theme';
import { parseRuntimeToSeconds } from '../../lib/runtime';
import SmartImage from '../../components/SmartImage';
import TopNav from '../../components/TopNav';
import { PlayIcon, heroButtonStyles } from '../../components/HeroSpotlight';
import { BundleCard, BuyChip, OwnedChip, useBuy } from '../../components/BuyBits';
import { AiSealChip } from '../../components/AiSeal';
import PreviewBar, { PreviewFootnote, openSiteHref } from '../../components/PreviewBar';
import { freePlayNote, seriesPlayLabel, sortEpisodes } from '../../lib/seriesResume';
import { episodeCodeOf, rowTierWord } from '../../lib/showRules';

// Mirrors components/GenreRow.js's tierBadge classes (the same pills as
// LibraryRows.js): free-ads = olive-deep, free-noads = green, premium = brass.
function tierBadge(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', color: colors.brass, text: colors.onBrass };
  if (adsEnabled === false) return { label: 'Free', color: colors.ok, text: colors.surface0 };
  return { label: 'Free with ads', color: colors.oliveDeep, text: colors.ink };
}

// A token colour at an alpha (the page's discs and scrims over a picture).
function tint(hex, a) {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// "23 min" from a "23:00" runtime (the website's minutesLabel).
function minutesLabel(runtime) {
  const s = parseRuntimeToSeconds(runtime);
  return s ? `${Math.max(1, Math.round(s / 60))} min` : null;
}

const enc = (x) => encodeURIComponent(String(x));

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
function LockIcon({ size = 13, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 11V7a6 6 0 0 1 12 0v4" />
      <Path d="M5 11h14v9H5z" />
    </Svg>
  );
}
function ChevronIcon({ size = 14, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M9 6l6 6-6 6" />
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

// What the hero says about the whole show (decision 10, option A): one
// pill "Free with ads" / "Free" when all of it is free, "Tapa +" when none
// of it is, "Tapa +" and the green chip ("E1 free", "E1–E3 free", "2 free")
// when it's mixed. Without a roll-up (a server before slice 4), the first
// episode's pill as before.
function ShowTier({ rollup, firstEpisode }) {
  if (rollup && rollup.tier) {
    if (rollup.tier === 'free') {
      const b = tierBadge('free', rollup.freeLabel !== 'Free');
      return <View style={[styles.tierBadge, { backgroundColor: b.color }]}><Text style={[styles.tierBadgeText, { color: b.text }]}>{rollup.freeLabel || b.label}</Text></View>;
    }
    return (
      <>
        <View style={[styles.tierBadge, { backgroundColor: colors.brass }]}><Text style={[styles.tierBadgeText, { color: colors.onBrass }]}>{rollup.tierLabel || 'Tapa +'}</Text></View>
        {rollup.tier === 'mixed' && rollup.freeLabel ? (
          <View style={styles.freeChip}><Text style={styles.freeChipText}>{rollup.freeLabel}</Text></View>
        ) : null}
      </>
    );
  }
  if (!firstEpisode) return null;
  const b = tierBadge(firstEpisode.tier, firstEpisode.adsEnabled);
  return <View style={[styles.tierBadge, { backgroundColor: b.color }]}><Text style={[styles.tierBadgeText, { color: b.text }]}>{b.label}</Text></View>;
}

// Every season the page shows: the server's list (with labels), else the
// seasons the rows are in.
function seasonNumbersOf(data) {
  const fromServer = Array.isArray(data.seasons) ? data.seasons.map((s) => Number(s.number)).filter((n) => Number.isInteger(n) && n > 0) : [];
  const fromRows = (data.seriesEpisodes || []).map((e) => Number(e.season) || 1);
  return [...new Set([...fromServer, ...fromRows])].sort((a, b) => a - b);
}

// Mirrors pages/series/[id].js (the series revamp, slice 4; board V1 of the
// series canvas, V3 for the owner's preview): the site header, the preview
// bar when the owner (or someone working on the show, or the team) opens a
// show that isn't public with ?preview=1, the same hero as the website's
// SeriesHero (image or a flat stand-in, kicker, Fraunces title,
// description, then the show's tier pill and free chip, the rating box,
// "2 seasons · 5 episodes", the credit lines, the year, the AI seal; Play
// with the free note / Preview S1 E1, Save this series), the Back pill,
// the compact "Own the whole series" card, the tabs Episodes / Extras /
// About, the season chips with their labels (a tap writes ?season=), and
// one row per episode (its code and, in a mixed show, Free / Tapa +; the
// lock for a non-member; Buy / Owned; Details › when it has its own page;
// in a preview, where it stands). Image-only hero (no autoplaying
// trailer), the same simplification as Stream/Home/Watch on mobile. Fed by
// GET /api/series-hub (+ &season=, &preview=1), the same lib/seriesHub.js
// the website page calls; a podcast's answer carries `redirect` and the
// screen goes on to the podcast screen.
export default function SeriesHub() {
  const { id, season: seasonParam, preview: previewParam } = useLocalSearchParams();
  const previewAsked = previewParam === '1';
  const router = useRouter();
  const { getToken } = useAuth();
  const { width, height: windowHeight } = useWindowDimensions();
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
        const q = `id=${enc(id)}${seasonParam ? `&season=${enc(seasonParam)}` : ''}${previewAsked ? '&preview=1' : ''}`;
        const data = await apiGet(`/api/series-hub?${q}`, token);
        if (cancelled) return;
        // A podcast lives on the podcast screen (the website 302s there).
        if (data && typeof data.redirect === 'string' && /^\/podcasts\/[^/?#]+$/.test(data.redirect)) {
          router.replace(data.redirect);
          return;
        }
        setState({ loading: false, error: null, data });
        setWishlisted((data.wishlist || []).includes(data.seriesInfo.id));
        const nums = seasonNumbersOf(data);
        setActiveSeason(nums.includes(Number(data.season)) ? Number(data.season) : nums[0] || 1);
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, data: null });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, reloadKey, previewAsked]); // eslint-disable-line react-hooks/exhaustive-deps

  // A link to ?season=2 while the screen is open (the episode screen's
  // kicker, a notification) opens that season.
  useEffect(() => {
    if (!state.data || !seasonParam) return;
    const n = Number(seasonParam);
    if (seasonNumbersOf(state.data).includes(n)) setActiveSeason(n);
  }, [seasonParam, state.data]);

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

  // A season chip writes ?season= (the website's shallow replace).
  function pickSeason(n) {
    setActiveSeason(n);
    router.setParams({ season: String(n) });
  }

  // The same 56% hero as the Stream screen's HeroSpotlight.
  const heroHeight = Math.min(600, Math.max(300, Math.round(windowHeight * 0.56)));
  const wide = width >= 900;

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

  const data = state.data;
  const { seriesInfo, bundle = null, episodeOffers = {}, rollup = null, crew = [], shotAt = [], crewCalls = [] } = data;
  const preview = data.preview && typeof data.preview === 'object' ? data.preview : null;
  const previewing = Boolean(preview);
  const isMember = Boolean(data.isSubscriber);
  const ownsSeries = Boolean(bundle && bundle.owned);
  const rows = sortEpisodes(data.seriesEpisodes || []);
  const seasonNumbers = seasonNumbersOf(data);
  const labelOf = (n) => {
    const s = (data.seasons || []).find((x) => Number(x.number) === n);
    return s && s.label ? s.label : `Season ${n}`;
  };
  const activeRows = rows.filter((e) => (Number(e.season) || 1) === activeSeason);
  const firstRow = rows[0] || null;
  const heroImage = seriesInfo.heroImage || (firstRow && firstRow.heroImage) || seriesInfo.poster || seriesInfo.thumbnail;
  const seriesGenres = [...new Set(rows.map((e) => e.genre).filter(Boolean))];
  const seriesArtist = seriesInfo.artist || (firstRow && firstRow.artist) || null;
  // The credit lines (decision 20): Made by, then the optional Studio and
  // Producer, in the owner's order; a server before slice 4 sends none, so
  // the page falls back to "Made by <artist>".
  const credits = Array.isArray(data.credits) && data.credits.length ? data.credits
    : seriesArtist ? [{ key: 'maker', label: 'Made by', name: seriesArtist, href: null }] : [];
  const madeBy = credits.find((c) => c.key === 'maker') || null;
  const makerName = madeBy ? (madeBy.href ? String(madeBy.name).trim().split(/\s+/)[0] : madeBy.name) : null;
  const episodeCount = rollup && rollup.episodeCount ? rollup.episodeCount : rows.length;
  const seasonCount = rollup && rollup.seasonCount ? rollup.seasonCount : seasonNumbers.length || (rows.length ? 1 : 0);
  const countLine = `${seasonCount} season${seasonCount === 1 ? '' : 's'} · ${episodeCount} episode${episodeCount === 1 ? '' : 's'}`;
  const ratingCode = rollup ? rollup.rating : (rows.find((e) => e.rating) || {}).rating || null;
  const shownRating = ratingCode && ratingCode !== 'Not Rated' ? ratingCode : null;
  const year = data.year || seriesInfo.releaseYear || (firstRow && firstRow.releaseYear) || null;
  const groups = Array.isArray(data.extraGroups) ? data.extraGroups.filter((g) => g && Array.isArray(g.items) && g.items.length)
    : (data.bonusContent || []).length ? [{ key: 'show', heading: 'With the show', items: data.bonusContent }] : [];

  // Play: the first episode before the viewer has started the show, the
  // episode they're on once they have (`resume`; the episode screen resumes
  // at the saved position by itself), " · free" when a non-member's Play
  // opens a free episode of a partly Tapa + show. In a preview: the first
  // episode this person may open, from the start.
  const resume = previewing ? null : data.resume || null;
  const firstCode = firstRow ? episodeCodeOf(firstRow) : null;
  const previewRow = previewing ? rows.find((r) => r.canOpen !== false) || null : null;
  const playEpisodeId = previewing ? (previewRow ? previewRow.id : null) : (resume && resume.episodeId) || (firstRow && firstRow.id) || null;
  const playLabel = previewing
    ? `Preview ${(previewRow && episodeCodeOf(previewRow)) || 'first episode'}`
    : seriesPlayLabel(resume, firstCode ? `Play ${firstCode}` : 'Play first episode', { free: freePlayNote({ resume, rollup, isMember, ownsSeries }) });
  const playHref = playEpisodeId ? `/episode/${enc(playEpisodeId)}?${previewing ? 'preview=1&' : ''}autoplay=1` : null;

  const ownsEp = (ep) => ownsSeries || Boolean(episodeOffers[ep.id] && episodeOffers[ep.id].owned);
  const ownedCodes = (bundle && bundle.ownedEpisodeIds ? bundle.ownedEpisodeIds : [])
    .map((eid) => { const e = rows.find((x) => x.id === eid); return e ? episodeCodeOf(e) || e.title : null; })
    .filter(Boolean);

  const thumbW = wide ? 176 : 120;
  const thumbH = wide ? 99 : 68;
  // Extras: 2 across on a phone, 3 on a small tablet, 4 from 900.
  const across = width >= 900 ? 4 : width >= 640 ? 3 : 2;
  const extraW = Math.floor((Math.min(width, 898) - 38 - 12 * (across - 1)) / across);

  function renderRow(ep) {
    // An unnumbered episode reads its season instead (the website's row).
    const code = episodeCodeOf(ep) || `Season ${Number(ep.season) || 1}`;
    const word = rowTierWord(ep, rollup);
    const locked = ep.tier === 'premium' && !isMember && !ownsEp(ep) && !previewing;
    const canOpen = !previewing || ep.canOpen !== false;
    const runtime = minutesLabel(ep.runtime);
    const note = previewing && ep.previewNote ? ep.previewNote : null;
    const offer = previewing ? null : episodeOffers[ep.id];
    const showDetails = ep.hasPage === true && canOpen;
    const name = `${code}, ${ep.title}${locked ? ', locked' : ''}`;
    const top = (
      <>
        <View style={[styles.rowThumb, { width: thumbW, height: thumbH }]}>
          {ep.thumbnail ? <SmartImage uri={ep.thumbnail} style={absoluteFill} /> : (
            <LinearGradient colors={[colors.surface2, colors.surface0]} style={absoluteFill} />
          )}
          <View style={styles.rowDisc}>
            {locked ? <LockIcon size={13} /> : <PlayIcon size={13} color={colors.ink} />}
          </View>
        </View>
        <View style={styles.rowInfo}>
          <View style={styles.rowCodeLine}>
            <Text style={styles.rowCode}>{code}</Text>
            {word ? <Text style={[styles.rowWord, { color: word === 'Free' ? colors.ok : colors.brass }]}>{word}</Text> : null}
          </View>
          <Text style={styles.rowTitle} numberOfLines={2}>{ep.title}</Text>
          {runtime ? <Text style={styles.rowRuntime}>{runtime}</Text> : null}
          {wide && ep.desc ? <Text style={styles.rowDesc} numberOfLines={2}>{ep.desc}</Text> : null}
        </View>
      </>
    );
    return (
      <View key={ep.id} style={styles.row}>
        {canOpen ? (
          <Pressable
            style={({ pressed }) => [styles.rowTop, pressed && { opacity: 0.8 }]}
            onPress={() => router.push(`/episode/${enc(ep.id)}?${previewing ? 'preview=1&' : ''}autoplay=1`)}
            accessibilityRole="link"
            accessibilityLabel={name}
          >
            {top}
          </Pressable>
        ) : (
          <View style={styles.rowTop} accessible accessibilityLabel={name}>{top}</View>
        )}
        {!wide && ep.desc ? <Text style={styles.rowDesc} numberOfLines={2}>{ep.desc}</Text> : null}
        {note || offer || showDetails ? (
          <View style={styles.rowFoot}>
            <View style={styles.rowFootLeft}>
              {note ? (
                <>
                  <View style={styles.notePill}><Text style={styles.notePillText}>{note.pill}</Text></View>
                  {note.note ? <Text style={styles.noteText}>{note.note}</Text> : null}
                </>
              ) : offer ? (
                offer.owned ? <OwnedChip small /> : <BuyChip offer={offer} busy={buyBusy} onBuy={() => buy('episode', ep.id, `/series/${seriesInfo.id}`)} />
              ) : null}
            </View>
            {showDetails ? (
              <Pressable
                style={({ pressed }) => [styles.details, pressed && { opacity: 0.75 }]}
                onPress={() => router.push(`/episode/${enc(ep.id)}${previewing ? '?preview=1' : ''}`)}
                accessibilityRole="link"
                accessibilityLabel={`Details: ${ep.title} has its own page`}
              >
                <Text style={styles.detailsText}>Details</Text>
                <ChevronIcon size={14} color={colors.ink} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  const tabs = [
    { key: 'episodes', label: 'Episodes' },
    groups.length > 0 ? { key: 'extras', label: 'Extras' } : null,
    { key: 'about', label: 'About' }
  ].filter(Boolean);
  const tab = tabs.some((t) => t.key === activeTab) ? activeTab : 'episodes';

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        {previewing ? <PreviewBar preview={preview} /> : null}
        <View style={[styles.hero, { height: heroHeight }]}>
          {heroImage ? <SmartImage uri={heroImage} style={absoluteFill} /> : <View style={[absoluteFill, styles.heroFallback]} />}
          <LinearGradient colors={[tint(colors.surface0, 0), tint(colors.surface0, 0.88), colors.surface0]} locations={[0.2, 0.72, 1]} style={absoluteFill} pointerEvents="none" />
          <View style={styles.heroContent}>
            <Text style={styles.eyebrow}>Series{seriesInfo.isOriginal ? ' · Tapa Original' : ''}</Text>
            <Text style={styles.title}>{seriesInfo.name}</Text>
            {seriesInfo.desc ? <Text style={styles.desc} numberOfLines={3}>{seriesInfo.desc}</Text> : null}
            <View style={styles.meta}>
              <ShowTier rollup={rollup} firstEpisode={firstRow} />
              {shownRating ? <View style={styles.ratingTag}><Text style={styles.ratingText}>{shownRating}</Text></View> : null}
              {rows.length || (rollup && rollup.episodeCount) ? <Text style={styles.metaText}>{countLine}</Text> : null}
              {credits.map((c) => <Text key={c.key} style={styles.metaText}>{c.label} {c.name}</Text>)}
              {year ? <Text style={styles.metaText}>{year}</Text> : null}
              {/* The maker's "Not for AI training" seal (components/AiSeal.js). */}
              {data.aiSeal !== false ? <AiSealChip /> : null}
            </View>
            <View style={[heroButtonStyles.actions, { flexWrap: 'wrap' }]}>
              {playHref ? (
                <Pressable style={heroButtonStyles.playBtn} onPress={() => router.push(playHref)} accessibilityRole="button">
                  <PlayIcon size={14} />
                  <Text style={heroButtonStyles.playText}>{playLabel}</Text>
                </Pressable>
              ) : null}
              {!previewing ? (
                <Pressable style={heroButtonStyles.infoBtn} onPress={toggleWishlist} accessibilityRole="button" accessibilityState={{ selected: wishlisted }}>
                  <HeartIcon active={wishlisted} size={15} />
                  <Text style={heroButtonStyles.infoText}>{wishlisted ? 'Saved' : 'Save this series'}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.stage}>
          <Pressable style={styles.backBtn} onPress={goBack}>
            <BackArrowIcon />
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          {ownsSeries ? (
            <Text style={styles.ownedSeries}>You own this series: every episode plays ad-free, including ones added later.</Text>
          ) : null}
          {!previewing ? (
            <BundleCard
              bundle={bundle}
              makerName={makerName}
              busy={buyBusy}
              onBuy={() => buy('series', seriesInfo.id, `/series/${seriesInfo.id}`)}
              ownedNames={ownedCodes}
            />
          ) : null}

          <View style={styles.tabs}>
            {tabs.map((t) => (
              <Pressable key={t.key} style={[styles.tab, tab === t.key && styles.tabOn]} onPress={() => setActiveTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}>
                <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          {tab === 'episodes' ? (
            rows.length === 0 ? (
              <Text style={styles.emptyText}>{previewing ? 'No episodes here yet. Episodes you send for review show up here.' : 'Nothing published in this series yet — check back soon.'}</Text>
            ) : (
              <>
                {seasonNumbers.length > 1 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.seasonTabs} contentContainerStyle={styles.seasonTabsContent}>
                    {seasonNumbers.map((num) => (
                      <Pressable key={num} style={[styles.seasonTab, num === activeSeason && styles.seasonTabOn]} onPress={() => pickSeason(num)} accessibilityRole="tab" accessibilityState={{ selected: num === activeSeason }}>
                        <Text style={[styles.seasonTabText, num === activeSeason && styles.seasonTabTextOn]}>{labelOf(num)}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={styles.seasonHeading}>{labelOf(activeSeason || 1)}</Text>
                )}
                <View style={[styles.list, wide && { maxWidth: 860 }]}>
                  {activeRows.map(renderRow)}
                </View>
              </>
            )
          ) : null}

          {tab === 'extras' ? (
            <View style={{ gap: 18 }}>
              {groups.map((g) => (
                <View key={g.key} style={{ gap: 10 }}>
                  <Text style={styles.groupHeading}>{g.heading}</Text>
                  <View style={styles.extrasGrid}>
                    {g.items.map((x) => {
                      const mins = minutesLabel(x.runtime);
                      // In a preview, someone else's extra isn't opened (as the rows).
                      const openable = !previewing || x.canOpen !== false;
                      return (
                        <Pressable
                          key={x.id}
                          style={[styles.extraCard, { width: extraW }]}
                          onPress={openable ? () => router.push(`/episode/${enc(x.id)}${previewing ? '?preview=1' : ''}`) : undefined}
                          disabled={!openable}
                          accessibilityRole={openable ? 'link' : undefined}
                          accessibilityLabel={`${x.title}, Extra${mins ? `, ${mins}` : ''}`}
                        >
                          {x.thumbnail ? <SmartImage uri={x.thumbnail} style={styles.extraThumb} /> : <View style={styles.extraThumb} />}
                          <Text style={styles.extraTitle} numberOfLines={2}>{x.title}</Text>
                          <Text style={styles.extraMeta}>{mins ? `Extra · ${mins}` : 'Extra'}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {tab === 'about' ? (
            <View style={{ gap: 14 }}>
              {/* Crew Call posts linked to this series (migration 082). */}
              {crewCalls.length > 0 ? (
                <View style={{ gap: 8 }}>
                  <Text style={styles.groupHeading}>Crew needed</Text>
                  {crewCalls.map((c) => (
                    <Pressable key={c.id} style={({ pressed }) => [styles.callCard, pressed && { opacity: 0.8 }]} onPress={() => router.push(`/crew/calls/${enc(c.id)}`)} accessibilityRole="link">
                      <View style={styles.callHead}>
                        <Text style={styles.callTitle} numberOfLines={2}>{c.title}</Text>
                        {c.payLabel ? <Text style={[styles.callPay, { color: c.payType === 'paid' || c.payType === 'union' ? colors.ok : c.payType === 'deferred' ? colors.olive : colors.inkDim }]}>{c.payLabel}</Text> : null}
                      </View>
                      <Text style={styles.callWhen}>
                        {[`${c.role || ''}${c.spots > 1 ? ` · ${c.spots} spots` : ''}`, c.remote ? 'Remote' : c.place, `${c.responsesCount || 0} ${c.responsesCount === 1 ? 'response' : 'responses'}`].filter(Boolean).join('  ·  ')}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={styles.aboutGrid}>
                <View style={styles.aboutBox}>
                  <Text style={styles.aboutLabel}>Genre</Text>
                  <Text style={styles.aboutValue}>{seriesGenres.length > 0 ? seriesGenres.join(', ') : '—'}</Text>
                </View>
                {credits.map((c) => (
                  <View key={c.key} style={styles.aboutBox}>
                    <Text style={styles.aboutLabel}>{c.label}</Text>
                    {c.href ? (
                      <Text style={[styles.aboutValue, styles.aboutLink]} onPress={() => openSiteHref(router, c.href)} accessibilityRole="link">{c.name}</Text>
                    ) : (
                      <Text style={styles.aboutValue}>{c.name}</Text>
                    )}
                  </View>
                ))}
                {year ? (
                  <View style={styles.aboutBox}>
                    <Text style={styles.aboutLabel}>Year</Text>
                    <Text style={styles.aboutValue}>{year}</Text>
                  </View>
                ) : null}
                <View style={styles.aboutBox}>
                  <Text style={styles.aboutLabel}>Rating</Text>
                  <Text style={styles.aboutValue}>{shownRating || 'Not rated'}</Text>
                </View>
                <View style={styles.aboutBox}>
                  <Text style={styles.aboutLabel}>Episodes</Text>
                  <Text style={styles.aboutValue}>{episodeCount} across {seasonCount} season{seasonCount === 1 ? '' : 's'}</Text>
                </View>
                {shotAt.length > 0 ? (
                  <View style={styles.aboutBox}>
                    <Text style={styles.aboutLabel}>Shot at</Text>
                    <Text style={styles.aboutValue}>
                      {shotAt.map((s, i) => (
                        <Text key={s.locationId || i}>
                          {i > 0 ? ', ' : ''}
                          <Text style={s.href ? styles.aboutLink : null} onPress={s.href ? () => openSiteHref(router, s.href) : undefined}>{s.title}</Text>
                          {s.city ? <Text style={styles.aboutFaint}> ({s.city})</Text> : null}
                        </Text>
                      ))}
                    </Text>
                  </View>
                ) : null}
                {crew.length > 0 ? (
                  <View style={styles.aboutBox}>
                    <Text style={styles.aboutLabel}>Crew</Text>
                    <Text style={styles.aboutValue}>
                      {crew.map((c, i) => (
                        <Text key={`${c.profilePath || c.displayName}-${i}`}>
                          {i > 0 ? ', ' : ''}
                          <Text style={c.profilePath ? styles.aboutLink : null} onPress={c.profilePath ? () => openSiteHref(router, c.profilePath) : undefined}>{c.displayName}</Text>
                          {c.role ? <Text style={styles.aboutFaint}> ({c.role})</Text> : null}
                        </Text>
                      ))}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          {previewing ? <PreviewFootnote /> : null}
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
  emptyText: { color: colors.inkDim, fontSize: 14, lineHeight: 20, fontFamily: fonts.body },

  // components/SeriesHero.js (.hero-carousel.full-bleed + .hero-content)
  hero: { width: '100%', position: 'relative', backgroundColor: colors.surface2, overflow: 'hidden' },
  heroFallback: { backgroundColor: colors.surface2 },
  heroContent: { position: 'absolute', left: 19, right: 19, bottom: 0, paddingBottom: 24 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 2.2, textTransform: 'uppercase', color: colors.olive, marginBottom: 8, ...shadow },
  title: { fontFamily: fonts.bodyBold, fontSize: 32, lineHeight: 34, color: colors.ink, marginBottom: 8, ...shadow },
  desc: { fontFamily: fonts.body, fontSize: 14.4, lineHeight: 21, color: colors.ink, opacity: 0.9, marginBottom: 11, ...shadow, textShadowRadius: 6 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 9, marginBottom: 16 },
  tierBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  tierBadgeText: { fontFamily: fonts.monoBold, fontSize: 11, letterSpacing: 0.2 },
  // The green free chip beside "Tapa +" (the website's .free-chip).
  freeChip: { paddingHorizontal: 11, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: colors.ok, backgroundColor: okTint(0.14) },
  freeChipText: { fontFamily: fonts.monoBold, fontSize: 12, color: colors.ok },
  // .hero-rating-tag
  ratingTag: { borderWidth: 1, borderColor: colors.ink, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
  ratingText: { fontFamily: fonts.mono, fontSize: 11, color: colors.ink },
  metaText: { color: colors.inkDim, fontFamily: fonts.mono, fontSize: 12.5, ...shadow, textShadowRadius: 6 },

  // .stage.stage-single (≤640px) with the website's BackButton pill
  stage: { paddingTop: 22, paddingHorizontal: 19 },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.4, borderColor: colors.olive, marginBottom: 19 },
  backText: { color: colors.olive, fontFamily: fonts.monoBold, fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase' },
  ownedSeries: { color: colors.inkFaint, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, paddingBottom: 14 },

  tabs: { flexDirection: 'row', gap: 8, paddingTop: 4, paddingBottom: 14, flexWrap: 'wrap' },
  tab: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.14), backgroundColor: 'transparent' },
  tabOn: { backgroundColor: colors.surface2, borderColor: colors.olive },
  tabText: { color: colors.inkDim, fontFamily: fonts.displaySemi, fontSize: 13.5 },
  tabTextOn: { color: colors.ink },

  // .season-tab
  seasonTabs: { marginBottom: 12 },
  seasonTabsContent: { gap: 8 },
  seasonTab: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 15, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.14), backgroundColor: colors.surface1 },
  seasonTabOn: { backgroundColor: colors.olive, borderColor: colors.olive },
  seasonTabText: { color: colors.inkDim, fontFamily: fonts.displaySemi, fontSize: 13 },
  seasonTabTextOn: { color: colors.oliveShadow },
  // .series-season-heading
  seasonHeading: { color: colors.inkDim, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 10 },

  // .spg-row
  list: { borderTopWidth: 1, borderTopColor: inkTint(0.1) },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: inkTint(0.1), gap: 10 },
  rowTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  rowThumb: { borderRadius: 6, overflow: 'hidden', backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  rowDisc: { width: 28, height: 28, borderRadius: 14, backgroundColor: tint(colors.surface0, 0.6), borderWidth: 1, borderColor: inkTint(0.35), alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, minWidth: 0, gap: 4 },
  rowCodeLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowCode: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.2, color: colors.inkDim },
  rowWord: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
  rowTitle: { fontFamily: fonts.displaySemi, fontSize: 16, lineHeight: 20, color: colors.ink },
  rowRuntime: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim },
  rowDesc: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkDim },
  rowFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rowFootLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, flexWrap: 'wrap' },
  details: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingLeft: 10 },
  detailsText: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.ink },
  // .pvbar-pill
  notePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: oliveTint(0.2) },
  notePillText: { fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', color: colors.olive },
  noteText: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim },

  // Extras (V1): a heading per group, then a grid of 16:9 cards.
  groupHeading: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.inkDim },
  extrasGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  extraCard: { gap: 4 },
  extraThumb: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: colors.surface2, marginBottom: 3 },
  extraTitle: { color: colors.ink, fontFamily: fonts.displaySemi, fontSize: 13.5, lineHeight: 17 },
  extraMeta: { color: colors.inkDim, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' },

  // Crew needed (.cc-call)
  callCard: { padding: 12, borderRadius: 10, backgroundColor: colors.surface1, borderWidth: 1, borderColor: inkTint(0.1), gap: 6 },
  callHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  callTitle: { flex: 1, fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  callPay: { fontFamily: fonts.mono, fontSize: 10.5, textTransform: 'uppercase' },
  callWhen: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim },

  aboutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  aboutBox: { width: '47%', backgroundColor: colors.surface2, borderRadius: 10, padding: 14 },
  aboutLabel: { color: colors.inkFaint, fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5 },
  aboutValue: { color: colors.ink, fontFamily: fonts.display, fontSize: 13.5, lineHeight: 18 },
  aboutLink: { color: colors.brass, textDecorationLine: 'underline', textDecorationColor: brassTint(0.5) },
  aboutFaint: { color: colors.inkFaint, fontSize: 12 }
});
