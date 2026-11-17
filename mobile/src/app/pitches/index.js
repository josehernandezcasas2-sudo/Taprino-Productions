import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../../lib/stableAuth';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect } from 'react-native-svg';
import { apiGet, apiPost, freshToken } from '../../lib/api';
import { colors, fonts, absoluteFill, brassTint, oliveTint } from '../../lib/theme';
import BackItGlyph from '../../components/BackItGlyph';
import TopNav from '../../components/TopNav';
import SmartImage from '../../components/SmartImage';
import WishlistHeart from '../../components/WishlistHeart';
import { SearchIcon } from '../../components/TabBarIcons';

// lib/pitches.js PITCH_TAGS order, so the pills read the same as the site.
const PITCH_TAGS = ['Documentary', 'Narrative Film', 'Short Film', 'Series', 'Animation', 'Vertical', 'Podcast', 'Music Video', 'Other'];
const SORTS = [
  { key: 'newest', label: 'Newest' },
  { key: 'closest', label: 'Closest to goal' },
  { key: 'saved', label: 'Most saved' }
];

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

// Same rules as pages/pitches.js: live donation totals for in-platform
// funding, the self-reported number otherwise; null when there's no goal.
function raisedDollars(p) {
  return p.funding_enabled ? (p.liveRaisedCents || 0) / 100 : Number(p.funding_raised || 0);
}
function fundingPct(p) {
  if (!p.funding_goal) return null;
  return Math.min(100, Math.round((raisedDollars(p) / p.funding_goal) * 100));
}
// Whole calendar days left; a deadline of today reads as 1 ("Last day"),
// a past deadline as no deadline at all (it's informal metadata).
function daysLeft(p) {
  if (!p.funding_deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(`${p.funding_deadline}T00:00:00`) - today) / 86400000);
  return diff < 0 ? null : Math.max(1, diff);
}
function money(n, cents) {
  return `$${Number(n).toLocaleString(undefined, cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })}`;
}

function DeckIcon({ size = 26, color = colors.onBrass }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={6} y={3} width={12} height={16} rx={2} transform="rotate(8 12 11)" opacity={0.55} />
      <Rect x={5} y={5} width={12} height={16} rx={2} />
    </Svg>
  );
}
// Port of pages/pitches.js — same data (lib/pitchRoom.js via
// /api/pitch-room), search, sort, tag filters, save hearts, funding
// progress, days left, follower counts — laid out for a phone: an
// editorial header, a Discover call-out, and full-width project cards.
export default function PitchRoom() {
  const router = useRouter();
  const { getToken, isSignedIn } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [refreshing, setRefreshing] = useState(false);
  const [saved, setSaved] = useState(new Set());
  const [token, setToken] = useState(null);
  const [activeTag, setActiveTag] = useState('All');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [sortOpen, setSortOpen] = useState(false);
  const { width } = useWindowDimensions();
  // Under 360pt the Swipe pill shows its icon alone so the title fits.
  const narrow = width < 360;

  const load = useCallback(async () => {
    try {
      const t = isSignedIn ? await withTimeout(getToken().catch(() => null), 4000) : null;
      setToken(t);
      const data = await apiGet('/api/pitch-room', t);
      setState({ loading: false, error: null, data });
      setSaved(new Set(data.savedIds || []));
    } catch (err) {
      setState((s) => ({ loading: false, error: s.data ? null : err.message, data: s.data }));
    }
  }, [isSignedIn]);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function toggleSave(pitchId) {
    if (!isSignedIn || !token) {
      Alert.alert('Sign in to save projects', 'Saved projects notify you when the creator posts an update.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Sign in', onPress: () => router.push('/account') }
      ]);
      return;
    }
    setSaved((prev) => {
      const next = new Set(prev);
      next.has(pitchId) ? next.delete(pitchId) : next.add(pitchId);
      return next;
    });
    freshToken(getToken).then((t) => apiPost('/api/pitch-save', { pitchId }, t)).catch(() => {});
  }

  const pitches = state.data ? state.data.pitches : [];
  const sortLabel = (SORTS.find((x) => x.key === sortBy) || SORTS[0]).label;
  const usedTags = useMemo(() => ['All', ...PITCH_TAGS.filter((t) => pitches.some((p) => p.tag === t))], [pitches]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pitches
      .filter((p) => activeTag === 'All' || p.tag === activeTag)
      .filter((p) => !q || p.title.toLowerCase().includes(q) || (p.creatorDisplayName || '').toLowerCase().includes(q))
      .sort((a, b) => {
        if (sortBy === 'saved') return (b.savedCount || 0) - (a.savedCount || 0);
        if (sortBy === 'closest') {
          // No goal = not "close to" anything; those go after every pitch
          // that has one, same as the website.
          const pa = fundingPct(a);
          const pb = fundingPct(b);
          if (pa === null && pb === null) return 0;
          if (pa === null) return 1;
          if (pb === null) return -1;
          return pb - pa;
        }
        return 0; // newest — already the server's order
      });
  }, [pitches, activeTag, query, sortBy]);

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
        <View style={styles.center}>
          <Text style={styles.errorText}>Couldn't load the Pitch Room: {state.error}</Text>
          <Pressable style={[styles.ghostBtn, { marginTop: 14 }]} onPress={() => { setState({ loading: true, error: null, data: null }); load(); }}>
            <Text style={styles.ghostBtnText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }
  if (state.data.disabled) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><Text style={styles.emptyText}>The Pitch Room is closed right now — check back soon.</Text></View>
      </SafeAreaView>
    );
  }

  const header = (
    <View>
      {state.data.bypassingDisabled ? (
        <View style={styles.adminBanner}>
          <Text style={styles.adminBannerText}>⚠ Pitch Room is turned off for the public right now — you're seeing this because you're an admin.</Text>
        </View>
      ) : null}

      {/* Kept short so the projects come up on the first screen
          (2026-11-17), as on the website: one title row with Swipe ideas
          and, for a creator, the + to pitch; the search (it says how many
          there are); one row with the sort and the kinds. */}
      <View style={styles.topRow}>
        <Text style={styles.heading} numberOfLines={1}>Pitch Room</Text>
        <View style={styles.topActions}>
          <Pressable onPress={() => router.push('/pitches/discover')} accessibilityRole="link" accessibilityLabel="Swipe through ideas" style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
            <LinearGradient colors={[colors.brass, colors.brassDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.swipePill}>
              <DeckIcon size={17} />
              {narrow ? null : <Text style={styles.swipeText}>Swipe ideas</Text>}
            </LinearGradient>
          </Pressable>
          {state.data.isCreator ? (
            <Pressable style={styles.addBtn} onPress={() => router.push('/creator/pitch-new')} accessibilityRole="button" accessibilityLabel="Submit your project" hitSlop={4}>
              <Text style={styles.addText}>+</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.searchBox}>
        <SearchIcon size={16} color={colors.inkFaint} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder(pitches.length)}
          placeholderTextColor={colors.inkFaint}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search by title or creator"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear the search"><Text style={styles.clear}>✕</Text></Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.chipScroll} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.sortPill} onPress={() => setSortOpen(true)} accessibilityRole="button" accessibilityLabel={`Sort: ${sortLabel}. Change`}>
          <Text style={styles.sortPillText}>{sortLabel}</Text>
          <CaretIcon />
        </Pressable>
        {usedTags.length > 2 ? (
          <>
            <View style={styles.chipRule} />
            {usedTags.map((t) => (
              <Pressable key={t} style={[styles.tagPill, activeTag === t && styles.tagPillActive]} onPress={() => setActiveTag(t)} accessibilityRole="button" accessibilityState={{ selected: activeTag === t }}>
                <Text style={[styles.tagPillText, activeTag === t && styles.tagPillTextActive]}>{t}</Text>
              </Pressable>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <FlatList
        style={styles.flatList}
        data={visible}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brass} />}
        ListEmptyComponent={(
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              {pitches.length === 0 ? 'Nothing here yet — check back soon.' : 'No projects match your search or filter.'}
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <PitchCard
            pitch={item}
            saved={saved.has(item.id)}
            onToggleSave={() => toggleSave(item.id)}
            onOpen={() => router.push(`/pitches/${item.id}`)}
            onOpenCreator={item.created_by ? () => router.push(`/profile/${item.created_by}`) : null}
          />
        )}
      />
      <Modal visible={sortOpen} transparent animationType="fade" onRequestClose={() => setSortOpen(false)} supportedOrientations={['portrait', 'landscape']}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setSortOpen(false)} accessibilityLabel="Close">
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Sort projects</Text>
            {SORTS.map((s) => (
              <Pressable key={s.key} style={styles.sheetRow} onPress={() => { setSortBy(s.key); setSortOpen(false); }} accessibilityRole="button" accessibilityState={{ selected: sortBy === s.key }}>
                <Text style={[styles.sheetRowText, sortBy === s.key && styles.sheetRowTextOn]}>{s.label}</Text>
                {sortBy === s.key ? <Text style={styles.sheetTick}>✓</Text> : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// The search box says how many projects there are, so no separate count
// line is needed (the website says the same).
function searchPlaceholder(n) {
  return n > 0 ? `Search ${n} ${n === 1 ? 'project' : 'projects'}…` : 'Search by title or creator…';
}

function CaretIcon({ size = 10, color = colors.olive }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

function PitchCard({ pitch, saved, onToggleSave, onOpen, onOpenCreator }) {
  const pct = fundingPct(pitch);
  const remaining = daysLeft(pitch);
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}>
      <View style={styles.cardArt}>
        {pitch.thumbnail ? (
          <SmartImage uri={pitch.thumbnail} style={absoluteFill} resizeMode="cover" />
        ) : (
          // No art uploaded yet — a quiet gradient with the title's initial
          // rather than an empty grey box.
          <LinearGradient colors={[colors.surface3, colors.surface1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[absoluteFill, styles.artFallback]}>
            <Text style={styles.artInitial}>{(pitch.title || '?')[0].toUpperCase()}</Text>
          </LinearGradient>
        )}
        <LinearGradient colors={['transparent', 'rgba(10,10,14,0.75)']} style={styles.artScrim} pointerEvents="none" />
        {pitch.tag ? <View style={styles.cardTag}><Text style={styles.cardTagText}>{pitch.tag}</Text></View> : null}
        <WishlistHeart active={saved} onToggle={onToggleSave} top={10} />
        {remaining !== null ? (
          <View style={styles.deadlineChip}>
            <Text style={styles.deadlineText}>{remaining === 1 ? 'Last day' : `${remaining} days left`}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{pitch.title}</Text>
        {pitch.creatorDisplayName ? (
          <Pressable onPress={onOpenCreator} disabled={!onOpenCreator} hitSlop={6} style={{ alignSelf: 'flex-start' }}>
            <Text style={styles.cardCreator}>by <Text style={onOpenCreator ? styles.cardCreatorLink : null}>{pitch.creatorDisplayName}</Text></Text>
          </Pressable>
        ) : null}
        {pitch.logline ? <Text style={styles.cardLogline} numberOfLines={2}>{pitch.logline}</Text> : null}

        {pct !== null ? (
          <View style={styles.funding}>
            <View style={styles.track}>
              <LinearGradient colors={[colors.olive, colors.brass]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fill, { width: `${Math.max(pct, 2)}%` }]} />
            </View>
            <View style={styles.fundingRow}>
              <Text style={styles.raised}>
                {money(raisedDollars(pitch), pitch.funding_enabled)}
                <Text style={styles.goal}> of {money(pitch.funding_goal)}</Text>
              </Text>
              <Text style={styles.pct}>{pct}%</Text>
            </View>
          </View>
        ) : null}

        {pitch.savedCount > 0 || pitch.funding_enabled ? (
          <View style={styles.foot}>
            {pitch.savedCount > 0 ? (
              <Text style={styles.following}>♥ {pitch.savedCount} {pitch.savedCount === 1 ? 'person' : 'people'} following</Text>
            ) : <View />}
            {pitch.funding_enabled ? (
              <View style={styles.backIt}>
                <BackItGlyph size={12} color={colors.brass} />
                <Text style={styles.backItText}>Back it</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  flatList: { flex: 1 },
  list: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 140, gap: 18 },
  errorText: { color: colors.danger, fontFamily: fonts.body, fontSize: 15, textAlign: 'center' },

  adminBanner: { padding: 12, borderRadius: 12, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.warn, marginBottom: 18 },
  adminBannerText: { color: colors.inkDim, fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },

  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 },
  heading: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 28, lineHeight: 32, color: colors.ink },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swipePill: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 40, borderRadius: 999, paddingHorizontal: 14 },
  swipeText: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.onBrass },
  addBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface1, alignItems: 'center', justifyContent: 'center' },
  addText: { fontFamily: fonts.displaySemi, fontSize: 22, lineHeight: 24, color: colors.ink, marginTop: -2 },
  chipScroll: { marginTop: 12, marginHorizontal: -16 },
  chipRow: { gap: 8, paddingHorizontal: 16, alignItems: 'center' },
  sortPill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: oliveTint(0.55), backgroundColor: colors.surface1 },
  sortPillText: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.olive },
  chipRule: { width: 1, height: 20, backgroundColor: colors.hairline },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,8,14,0.6)' },
  sheet: { backgroundColor: colors.surface1, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingBottom: 34, paddingHorizontal: 20, borderWidth: 1, borderColor: colors.hairline },
  sheetTitle: { fontFamily: fonts.monoMedium, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.inkFaint, marginBottom: 6 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  sheetRowText: { fontFamily: fonts.displaySemi, fontSize: 16, color: colors.ink },
  sheetRowTextOn: { color: colors.olive },
  sheetTick: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.olive },


  ghostBtn: { borderWidth: 1, borderColor: colors.hairline, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: colors.surface1 },
  ghostBtnText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.ink },

  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 14, paddingHorizontal: 14 },
  searchInput: { flex: 1, color: colors.ink, fontFamily: fonts.display, fontSize: 15, paddingVertical: 10 },
  clear: { color: colors.inkFaint, fontSize: 14 },


  tagPill: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.hairline },
  tagPillActive: { backgroundColor: colors.brass, borderColor: colors.brass },
  tagPillText: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.inkDim },
  tagPillTextActive: { color: colors.onBrass },


  emptyBox: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { color: colors.inkDim, fontFamily: fonts.body, fontSize: 15, textAlign: 'center' },

  card: { backgroundColor: colors.surface1, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: colors.hairline },
  cardArt: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surface2 },
  artFallback: { alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.bodyBold, fontSize: 72, color: 'rgba(251,232,211,0.12)' },
  artScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  cardTag: { position: 'absolute', top: 10, left: 10, backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  cardTagText: { fontFamily: fonts.displayBold, fontSize: 11.5, color: colors.onBrass },
  deadlineChip: { position: 'absolute', bottom: 10, left: 10, backgroundColor: 'rgba(10,10,14,0.7)', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(242,193,78,0.5)', paddingVertical: 4, paddingHorizontal: 10 },
  deadlineText: { fontFamily: fonts.monoMedium, fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: colors.olive },

  cardBody: { padding: 16, paddingTop: 14 },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.ink },
  cardCreator: { fontFamily: fonts.body, fontSize: 13, color: colors.inkFaint, marginTop: 3 },
  cardCreatorLink: { color: colors.olive },
  cardLogline: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim, marginTop: 8 },

  funding: { marginTop: 14 },
  track: { height: 7, borderRadius: 999, backgroundColor: colors.surface3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  fundingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 },
  raised: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.ink },
  goal: { fontFamily: fonts.display, fontSize: 13, color: colors.inkFaint },
  pct: { fontFamily: fonts.monoBold, fontSize: 12, color: colors.olive },

  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12 },
  following: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint },
  backIt: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: brassTint(0.5), borderRadius: 999, paddingVertical: 2, paddingHorizontal: 9 },
  backItText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.4, color: colors.brass }
});
