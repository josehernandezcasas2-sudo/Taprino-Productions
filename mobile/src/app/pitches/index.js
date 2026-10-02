import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect } from 'react-native-svg';
import { apiGet, apiPost } from '../../lib/api';
import { colors, fonts, absoluteFill } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import SmartImage from '../../components/SmartImage';
import WishlistHeart from '../../components/WishlistHeart';
import { SearchIcon } from '../../components/TabBarIcons';

const SITE_ORIGIN = 'https://www.studiotapatv.site';
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
function ArrowIcon({ size = 18, color = colors.onBrass }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 12h14M13 6l6 6-6 6" />
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
    apiPost('/api/pitch-save', { pitchId }, token).catch(() => {});
  }

  const pitches = state.data ? state.data.pitches : [];
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

      <Text style={styles.eyebrow}>Pitch Room</Text>
      <Text style={styles.heading}>Back what gets{'\n'}made next.</Text>
      <Text style={styles.sub}>
        Projects looking for backing. Each one links straight to the creator's own page — save one to follow along and get notified when they post an update.
      </Text>

      <Pressable onPress={() => router.push('/pitches/discover')} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
        <LinearGradient colors={[colors.brass, colors.brassDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.discoverCard}>
          <View style={styles.discoverIcon}><DeckIcon /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.discoverKicker}>Discover</Text>
            <Text style={styles.discoverTitle}>Swipe through ideas</Text>
          </View>
          <ArrowIcon />
        </LinearGradient>
      </Pressable>

      {state.data.isCreator ? (
        <View style={styles.creatorRow}>
          <Pressable style={styles.ghostBtn} onPress={() => Linking.openURL(`${SITE_ORIGIN}/creator/pitch/new`)}>
            <Text style={styles.ghostBtnText}>+ Submit your project</Text>
          </Pressable>
          <Pressable style={styles.ghostBtn} onPress={() => Linking.openURL(`${SITE_ORIGIN}/creator/pitch/dashboard`)}>
            <Text style={styles.ghostBtnText}>Your pitches</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.searchBox}>
        <SearchIcon size={16} color={colors.inkFaint} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by title or creator…"
          placeholderTextColor={colors.inkFaint}
          returnKeyType="search"
          autoCorrect={false}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}><Text style={styles.clear}>✕</Text></Pressable>
        ) : null}
      </View>

      <View style={styles.sortRow}>
        {SORTS.map((s) => (
          <Pressable key={s.key} style={[styles.sortChip, sortBy === s.key && styles.sortChipActive]} onPress={() => setSortBy(s.key)}>
            <Text style={[styles.sortChipText, sortBy === s.key && styles.sortChipTextActive]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      {usedTags.length > 2 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagRow} style={styles.tagScroll}>
          {usedTags.map((t) => (
            <Pressable key={t} style={[styles.tagPill, activeTag === t && styles.tagPillActive]} onPress={() => setActiveTag(t)}>
              <Text style={[styles.tagPillText, activeTag === t && styles.tagPillTextActive]}>{t}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <Text style={styles.count}>{visible.length} {visible.length === 1 ? 'project' : 'projects'}</Text>
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
    </SafeAreaView>
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

        {pitch.savedCount > 0 ? (
          <Text style={styles.following}>♥ {pitch.savedCount} {pitch.savedCount === 1 ? 'person' : 'people'} following</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  flatList: { flex: 1 },
  list: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 140, gap: 18 },
  errorText: { color: colors.danger, fontFamily: fonts.body, fontSize: 15, textAlign: 'center' },

  adminBanner: { padding: 12, borderRadius: 12, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.warn, marginBottom: 18 },
  adminBannerText: { color: colors.inkDim, fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },

  eyebrow: { fontFamily: fonts.monoMedium, fontSize: 11, letterSpacing: 2.4, textTransform: 'uppercase', color: colors.olive, marginBottom: 10 },
  heading: { fontFamily: fonts.bodyBold, fontSize: 34, lineHeight: 38, color: colors.ink, marginBottom: 12 },
  sub: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.inkDim, marginBottom: 20 },

  discoverCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, paddingVertical: 16, paddingHorizontal: 16, marginBottom: 14 },
  discoverIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(36,26,5,0.14)', alignItems: 'center', justifyContent: 'center' },
  discoverKicker: { fontFamily: fonts.monoMedium, fontSize: 10.5, letterSpacing: 1.8, textTransform: 'uppercase', color: colors.onBrass, opacity: 0.75 },
  discoverTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.onBrass, marginTop: 2 },

  creatorRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 14 },
  ghostBtn: { borderWidth: 1, borderColor: colors.hairline, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: colors.surface1 },
  ghostBtnText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.ink },

  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 14, paddingHorizontal: 14, marginTop: 6 },
  searchInput: { flex: 1, color: colors.ink, fontFamily: fonts.display, fontSize: 15, paddingVertical: 12 },
  clear: { color: colors.inkFaint, fontSize: 14 },

  sortRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  sortChip: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline },
  sortChipActive: { backgroundColor: colors.surface3, borderColor: colors.olive },
  sortChipText: { fontFamily: fonts.monoMedium, fontSize: 11, color: colors.inkDim },
  sortChipTextActive: { color: colors.olive },

  tagScroll: { marginTop: 12, marginHorizontal: -16 },
  tagRow: { gap: 8, paddingHorizontal: 16 },
  tagPill: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.hairline },
  tagPillActive: { backgroundColor: colors.brass, borderColor: colors.brass },
  tagPillText: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.inkDim },
  tagPillTextActive: { color: colors.onBrass },

  count: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.inkFaint, marginTop: 20 },

  emptyBox: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { color: colors.inkDim, fontFamily: fonts.body, fontSize: 15, textAlign: 'center' },

  card: { backgroundColor: colors.surface1, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: colors.hairline },
  cardArt: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surface2 },
  artFallback: { alignItems: 'center', justifyContent: 'center' },
  artInitial: { fontFamily: fonts.bodyBold, fontSize: 72, color: 'rgba(251,232,211,0.12)' },
  artScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  cardTag: { position: 'absolute', top: 10, left: 10, backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  cardTagText: { fontFamily: fonts.displayBold, fontSize: 11.5, color: colors.onBrass },
  deadlineChip: { position: 'absolute', bottom: 10, left: 10, backgroundColor: 'rgba(10,10,14,0.7)', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(231,162,85,0.5)', paddingVertical: 4, paddingHorizontal: 10 },
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

  following: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint, marginTop: 12 }
});
